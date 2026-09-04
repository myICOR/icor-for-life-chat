/* FOLLOW-UP BOOKKEEPING, with no DOM under it.
 *
 * Measured twice against the real CLI on 2026-09-04 (both findings are written
 * up at the top of sdk/session.ts), and the two measurements disagree, which
 * is the fact that shapes this file:
 *
 *   - Pushed during a plain text turn (haiku, counting): the CLI QUEUES the
 *     message and answers it as its own turn after the running one, with a
 *     fresh `system/init` and its own `result`.
 *   - Pushed during a tool loop (opus, Bash and Glob calls): the CLI hands the
 *     message to the model at its next call, the running turn ANSWERS it, and
 *     exactly one `result` arrives.
 *
 * So the plugin cannot know, when a turn ends, whether a follow-up was already
 * answered inside it or is about to get a turn of its own. A counter that
 * waited for a second `result` kept the composer on Stop forever in the merged
 * case (seen live, 2026-09-04 12:42). The honest rule is therefore the simple
 * one: a turn end is idle, every QUEUED mark comes off, and if the CLI then
 * opens a turn of its own for a queued message, its first signal re-arms the
 * busy state. The composer never lies about a turn that is over, and never
 * reads Send while a turn is visibly running. */

export interface FollowUpState {
  /** Messages sent while a turn was running and not yet closed by a turn end. */
  pending: number;
}

export const NO_FOLLOW_UPS: FollowUpState = { pending: 0 };

/** A message was sent while a turn was running. The well wears QUEUED. */
export function followUpSent(state: FollowUpState): FollowUpState {
  return { pending: state.pending + 1 };
}

/**
 * A turn ended. It is idle, whatever was queued: either the turn answered the
 * follow-up, or the CLI is about to open a turn for it and that turn will say
 * so itself. `clearMarks` is true when there were marks to take off.
 */
export function turnEnded(state: FollowUpState): { state: FollowUpState; clearMarks: boolean } {
  return { state: NO_FOLLOW_UPS, clearMarks: state.pending > 0 };
}

/**
 * The first signal of a turn (the session announcing itself, thinking, text,
 * or a tool call) while the composer reads idle: the CLI opened a turn on its
 * own, for a queued message. True means "arm the busy state now".
 */
export function selfStartedTurn(composerStreaming: boolean): boolean {
  return !composerStreaming;
}

/** An interrupt or an error settles everything; the CLI's queue is not ours to trust after that. */
export function turnAborted(): FollowUpState {
  return NO_FOLLOW_UPS;
}
