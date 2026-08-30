/* Thin wrappers over the SDK's own session layer. There is no conversation
 * store of our own, because the SDK publishes one and deleting a subsystem
 * beats writing one.
 *
 * Every read is scoped to a directory, without exception. `listSessions()` with
 * no `dir` reads sessions across every project on the machine, which is both a
 * privacy leak and a category error: the plugin is a window onto THIS vault. */

import {
  listSessions, getSessionInfo, forkSession, renameSession, deleteSession, getSessionMessages,
  resolveSettings,
} from '@anthropic-ai/claude-agent-sdk';

export interface SessionSummary {
  sessionId: string;
  title: string;
  lastModified: number;
  createdAt: number | null;
}

function titleOf(info: {
  customTitle?: string;
  summary?: string;
  firstPrompt?: string;
  sessionId: string;
}): string {
  const candidate = info.customTitle || info.summary || info.firstPrompt || '';
  const cleaned = candidate.replace(/\s+/g, ' ').trim();
  if (!cleaned) return `Session ${info.sessionId.slice(0, 6)}`;
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

/** Recent conversations for this vault, newest first. Never machine-wide. */
export async function listVaultSessions(dir: string, limit = 12): Promise<SessionSummary[]> {
  if (!dir) return [];
  try {
    // includeProgrammatic must stay ON. Every session this plugin creates is a
    // programmatic one (the SDK entrypoint), so filtering them out would hide
    // the plugin's own history from itself - measured 0 vs 3 on a live vault.
    const infos = await listSessions({ dir, limit, includeProgrammatic: true });
    return infos
      .map((info) => ({
        sessionId: info.sessionId,
        title: titleOf(info),
        lastModified: info.lastModified,
        createdAt: info.createdAt ?? null,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    // A vault with no history yet is the common case, not an error.
    return [];
  }
}

/**
 * The model the CLI will actually use for this vault, resolved from the same
 * settings cascade the CLI reads (managed, user, project, local) - WITHOUT
 * starting a session.
 *
 * This exists because the composer's model trigger read the word MODEL on a
 * fresh pane, which is a placeholder wearing a control's clothes: the model
 * that will answer is a knowable fact before any query runs, and Tom's
 * directive is that the trigger shows the actual model, never a stand-in. Null
 * is a real answer - no settings tier names a model, so the choice belongs to
 * the account tier and only a live session can report it. Null is never
 * substituted with a guess.
 */
export async function resolvedDefaultModel(cwd: string): Promise<string | null> {
  try {
    const resolved = await resolveSettings({ cwd });
    const model = resolved.effective.model;
    return typeof model === 'string' && model.trim() ? model.trim() : null;
  } catch {
    // resolveSettings is marked alpha; a moved or renamed API must degrade to
    // the fallback label, never to a broken pane.
    return null;
  }
}

/**
 * When a stored conversation was CREATED, or null.
 *
 * The one honest source for a resumed session's start time. Null is a real
 * answer and the caller must treat it as one: a record with no creation time
 * leaves the readout absent rather than substituting the moment the user
 * reopened the thread.
 */
export async function sessionCreatedAt(sessionId: string, dir: string): Promise<number | null> {
  if (!dir) return null;
  try {
    const info = await getSessionInfo(sessionId, { dir });
    return typeof info?.createdAt === 'number' ? info.createdAt : null;
  } catch {
    return null;
  }
}

export async function sessionExists(sessionId: string, dir: string): Promise<boolean> {
  try {
    return (await getSessionInfo(sessionId, { dir })) !== undefined;
  } catch {
    return false;
  }
}

/** Fork up to a message: this is both "fork a conversation" and "rewind". */
export async function forkVaultSession(
  sessionId: string,
  dir: string,
  upToMessageId?: string,
): Promise<string | null> {
  try {
    const result = await forkSession(sessionId, {
      dir,
      ...(upToMessageId ? { upToMessageId } : {}),
    });
    return result.sessionId ?? null;
  } catch {
    return null;
  }
}

export async function renameVaultSession(sessionId: string, dir: string, title: string): Promise<void> {
  try {
    await renameSession(sessionId, title, { dir });
  } catch {
    // A rename that fails is cosmetic; it never blocks the conversation.
  }
}

export async function deleteVaultSession(sessionId: string, dir: string): Promise<void> {
  await deleteSession(sessionId, { dir });
}

/**
 * Read a stored session's messages so a resumed conversation shows its own
 * history.
 *
 * Without this a resumed tab opens blank while the model behind it still
 * remembers everything, which is the worst shape a gap can take: nothing looks
 * broken, so the user trusts an empty transcript. The messages come back in
 * the same shape the live stream uses, so they go through the same Normalizer
 * and the same renderer rather than a second one that could drift.
 *
 * `cap` bounds the newest slice we replay. A very old conversation is not worth
 * unbounded DOM, and a replay that silently drops the beginning would be the
 * same lie in a smaller size, so the caller is told what it did not get.
 */
export interface SessionReplay {
  messages: unknown[];
  /** Messages that existed before the slice we returned. */
  omitted: number;
}

export async function readSessionMessages(
  sessionId: string,
  dir: string,
  cap = 400,
): Promise<SessionReplay> {
  try {
    const all = await getSessionMessages(sessionId, {
      dir,
      // Subagent spawns and compact boundaries are system messages; without
      // them a replayed transcript loses the shape of its own turns.
      includeSystemMessages: true,
    });
    if (all.length <= cap) return { messages: all, omitted: 0 };
    return { messages: all.slice(all.length - cap), omitted: all.length - cap };
  } catch {
    return { messages: [], omitted: 0 };
  }
}
