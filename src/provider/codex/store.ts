/* The Codex session record, through the shared service.
 *
 * Every read is scoped to a directory, without exception, for the same reason
 * the Claude store is: `thread/list` with no cwd filter reads every thread on
 * the machine, and the plugin is a window onto THIS vault. Measured
 * 2026-09-04: `thread/list {cwd}` filters as documented, `thread/read
 * {includeTurns: true}` carries every item of every turn, `thread/fork`
 * mints a new id with `forkedFromId` set, and `thread/name/set` answers `{}`. */

import { withService } from './service';
import { replayFromThread } from './normalize';
import type { SessionReplay, SessionStore, SessionSummary } from '../types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Thread timestamps are unix seconds (measured: 1788525034 on 2026-09-04). */
function ms(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null;
}

function titleOf(thread: Record<string, unknown>): string {
  const candidate = str(thread.name) || str(thread.preview) || '';
  const cleaned = candidate.replace(/\s+/g, ' ').trim();
  if (!cleaned) return `Session ${(str(thread.id) ?? '').slice(0, 6)}`;
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

async function readThread(threadId: string, cwd: string, includeTurns: boolean): Promise<Record<string, unknown> | null> {
  try {
    const result = await withService(cwd, (rpc) => rpc.request('thread/read', { threadId, includeTurns }));
    return isRecord(result) && isRecord(result.thread) ? result.thread : null;
  } catch {
    return null;
  }
}

export const codexStore: SessionStore = {
  async list(cwd: string, limit: number): Promise<SessionSummary[]> {
    if (!cwd) return [];
    try {
      const result = await withService(cwd, (rpc) =>
        rpc.request('thread/list', { cwd, limit, sortKey: 'updated_at', sortDirection: 'desc', archived: false }),
      );
      const rows = isRecord(result) && Array.isArray(result.data) ? result.data.filter(isRecord) : [];
      return rows
        .map((thread) => ({
          sessionId: str(thread.id) ?? '',
          title: titleOf(thread),
          lastModified: ms(thread.updatedAt) ?? ms(thread.createdAt) ?? 0,
          createdAt: ms(thread.createdAt),
        }))
        .filter((row) => row.sessionId !== '')
        .sort((a, b) => b.lastModified - a.lastModified);
    } catch {
      // No Codex, or no threads yet: the common case, not an error.
      return [];
    }
  },

  async createdAt(sessionId: string, cwd: string): Promise<number | null> {
    const thread = await readThread(sessionId, cwd, false);
    return thread ? ms(thread.createdAt) : null;
  },

  async exists(sessionId: string, cwd: string): Promise<boolean> {
    return (await readThread(sessionId, cwd, false)) !== null;
  },

  async read(sessionId: string, cwd: string, cap: number): Promise<SessionReplay> {
    const thread = await readThread(sessionId, cwd, true);
    if (!thread) return { entries: [], omitted: 0 };
    const entries = replayFromThread(thread, cwd);
    if (entries.length <= cap) return { entries, omitted: 0 };
    return { entries: entries.slice(entries.length - cap), omitted: entries.length - cap };
  },

  async fork(sessionId: string, cwd: string): Promise<string | null> {
    try {
      const result = await withService(cwd, (rpc) => rpc.request('thread/fork', { threadId: sessionId, cwd }));
      return isRecord(result) && isRecord(result.thread) ? str(result.thread.id) : null;
    } catch {
      return null;
    }
  },

  async rename(sessionId: string, cwd: string, title: string): Promise<void> {
    try {
      await withService(cwd, (rpc) => rpc.request('thread/name/set', { threadId: sessionId, name: title }));
    } catch {
      // Cosmetic; never blocks the conversation.
    }
  },

  async delete(sessionId: string, cwd: string): Promise<void> {
    await withService(cwd, (rpc) => rpc.request('thread/delete', { threadId: sessionId }));
  },
};
