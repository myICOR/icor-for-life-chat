/* THE SAME-PANE HAND-OFF TO ICOR FOR LIFE - TERMINAL, the AI Chat side.
 *
 * The contract lives in the terminal's repo (`docs/handoff.md`) and this file
 * conforms to it; nothing here is negotiated. Two facts shape it:
 *
 *   - A session id is held by exactly one view at a time. Two live writers on
 *     one session file do not collide, they fork it silently, and the next
 *     resume follows one branch and orphans the other. So AI Chat disposes
 *     its session BEFORE the swap, and refuses to resume an id a terminal
 *     pane holds.
 *   - The swap happens on the SAME leaf, with `leaf.setViewState`. The
 *     terminal gets a `returnTo` that names this view and the state it is
 *     reopened with, verbatim, and passes it back untouched.
 *
 * Everything that can be pure is pure, so the state shape and the guard's
 * leaf walk are asserted against the contract without a workspace. */

import type { App, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_CHAT } from '../constants';
import type { ProviderId } from '../provider/types';

export const TERMINAL_VIEW_TYPE = 'icor-for-life-terminal';
export const TERMINAL_PLUGIN_ID = 'icor-for-life-terminal';

/** The terminal's leaf state, exactly as `docs/handoff.md` section 1 states it. */
export interface TerminalLeafState {
  resumeSessionId: string | null;
  cwd: string;
  launch: 'claude' | 'shell';
  profile: string | null;
  returnTo: { type: string; state: Record<string, unknown> } | null;
}

/** What `Continue in terminal` hands the leaf (contract section 2). */
export function terminalState(resumeSessionId: string, cwd: string, provider: ProviderId): TerminalLeafState {
  return {
    resumeSessionId,
    cwd,
    launch: 'claude',
    profile: null,
    returnTo: { type: VIEW_TYPE_CHAT, state: { resumeSessionId, provider } },
  };
}

/**
 * Why the hand-off is not available, or null when it is.
 *
 * The terminal resumes Claude Code sessions and nothing else, so a Codex or
 * ACP conversation says so instead of offering a swap that would fail in the
 * terminal's own Notice. The install wording is the contract's.
 */
export function handoffUnavailableReason(
  provider: ProviderId,
  sessionId: string | null,
  installed: boolean,
): string | null {
  if (!installed) return 'Install ICOR for Life - Terminal';
  if (provider !== 'claude') return 'Terminal hand-off is for Claude Code conversations';
  if (!sessionId) return 'Send a message first: a fresh pane has no session to hand over';
  return null;
}

/** One leaf's facts, as the conservative guard reads them. */
export interface TerminalLeafFacts {
  resumeSessionId: unknown;
}

/**
 * The workspace-level check from contract section 4: a terminal leaf opened
 * on that id and still open. Conservative on purpose (it stays true after the
 * CLI has exited until the pane is closed or relaunched), and case-blind
 * because the terminal lower-cases ids before argv.
 */
export function leafHoldsSession(leaves: readonly TerminalLeafFacts[], sessionId: string): boolean {
  const wanted = sessionId.trim().toLowerCase();
  if (!wanted) return false;
  return leaves.some((leaf) => typeof leaf.resumeSessionId === 'string' && leaf.resumeSessionId.toLowerCase() === wanted);
}

/* Obsidian's plugin registry is not in the public typings; it is read through
   one narrow shape and never written. */
interface TerminalPluginApi {
  holdsSession?: (sessionId: string) => boolean;
}

function terminalPlugin(app: App): TerminalPluginApi | undefined {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  const found = plugins?.[TERMINAL_PLUGIN_ID];
  return found && typeof found === 'object' ? found : undefined;
}

/** True when the terminal plugin is installed AND enabled (the contract's test). */
export function terminalInstalled(app: App): boolean {
  return terminalPlugin(app) !== undefined;
}

function terminalLeaves(app: App): WorkspaceLeaf[] {
  return app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
}

/** The terminal leaf opened on this id, or null. */
export function terminalLeafFor(app: App, sessionId: string): WorkspaceLeaf | null {
  const wanted = sessionId.trim().toLowerCase();
  for (const leaf of terminalLeaves(app)) {
    const id = (leaf.getViewState().state as { resumeSessionId?: unknown } | undefined)?.resumeSessionId;
    if (typeof id === 'string' && id.toLowerCase() === wanted) return leaf;
  }
  return null;
}

/**
 * The guard: is this id held by a terminal pane right now? The plugin's own
 * `holdsSession` is the exact answer (true only while a live `claude` runs on
 * the id); the leaf walk is the fallback when the API is absent, and it is
 * the conservative one. Either answer is honest; neither is a guess.
 */
export function terminalHoldsSession(app: App, sessionId: string): boolean {
  const api = terminalPlugin(app);
  if (api && typeof api.holdsSession === 'function') {
    try {
      return api.holdsSession(sessionId) === true;
    } catch {
      // A throwing API is treated as absent, and the leaf walk answers.
    }
  }
  return leafHoldsSession(
    terminalLeaves(app).map((leaf) => ({
      resumeSessionId: (leaf.getViewState().state as { resumeSessionId?: unknown } | undefined)?.resumeSessionId,
    })),
    sessionId,
  );
}
