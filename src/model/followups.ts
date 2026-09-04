/* FOLLOW-UP BOOKKEEPING, with no DOM under it.
 *
 * Measured against the real CLI on 2026-09-04 (tools/followup-entry.ts, the
 * finding is written up at the top of sdk/session.ts): a user message pushed
 * into the streaming input while a turn is running is QUEUED by the CLI and
 * answered as its own turn after the running one ends, in the same session.
 * It is never merged into the running turn and it never interrupts it.
 *
 * That measurement fixes the shape of the state below. The view has to know
 * three things: how many follow-ups the CLI is still holding, whether the next
 * turn boundary means "idle" or "the queued turn is about to start", and when
 * a well that said QUEUED should stop saying it. All three are one counter
 * and a flag, and both are pure so they can be asserted without a session. */

export interface FollowUpState {
  /** Messages the CLI is holding for later turns. */
  pending: number;
  /** True between a turn's end and the first signal of the queued turn that follows it. */
  awaitingNext: boolean;
}

export const NO_FOLLOW_UPS: FollowUpState = { pending: 0, awaitingNext: false };

/** A message was sent while a turn was running: the CLI will queue it. */
export function followUpSent(state: FollowUpState): FollowUpState {
  return { ...state, pending: state.pending + 1 };
}

/**
 * A turn ended. Whether the composer stays busy is the whole answer here: with
 * a follow-up pending the session is not idle, it is between two turns, and a
 * composer that flipped to Send for that half-second would let Enter start a
 * THIRD message the user believed was a second.
 */
export function turnEnded(state: FollowUpState): { state: FollowUpState; stillBusy: boolean } {
  if (state.pending <= 0) return { state: NO_FOLLOW_UPS, stillBusy: false };
  return { state: { pending: state.pending - 1, awaitingNext: true }, stillBusy: true };
}

/**
 * The queued turn has begun (the CLI re-announces the session, then thinks or
 * writes). The oldest QUEUED mark is released. Returns whether a mark should
 * clear, so the renderer is only touched when there is something to touch.
 */
export function queuedTurnBegan(state: FollowUpState): { state: FollowUpState; clearOne: boolean } {
  if (!state.awaitingNext) return { state, clearOne: false };
  return { state: { ...state, awaitingNext: false }, clearOne: true };
}

/** An interrupt or an error settles everything; the CLI's queue is not ours to trust after that. */
export function turnAborted(): FollowUpState {
  return NO_FOLLOW_UPS;
}
