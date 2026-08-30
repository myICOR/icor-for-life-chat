/* WHERE A CHAT OPENS, decided once, with no Obsidian import so the decision is
 * assertable headless.
 *
 * Tom's directive, before his video: "a new ICOR chat session should open as a
 * new tab in the right sidepanel, not in the center main area." So the chat
 * lands beside the planner tray, and the centre stays the editor's.
 *
 * Three outcomes, in priority order, and the order is the ruling:
 *
 *   1. REVEAL - a leaf already holds the requested conversation (or, for a
 *      new session, an unoccupied chat pane already exists). Revealing beats
 *      spawning: two identical panes answer to two different states and one of
 *      them is always stale.
 *   2. RESUME-INTO - resuming, and an unoccupied chat pane exists: the thread
 *      is resumed into it rather than minting a second pane beside an empty
 *      one.
 *   3. CREATE-RIGHT - nothing reusable exists: a NEW TAB in the right
 *      sidebar. Never the centre.
 *
 * "Occupied" is the view's own claim (a live session object or a reported
 * session id), not an inference from DOM: a pane the user has typed into but
 * not sent from is unoccupied and safely reusable, because reuse only ever
 * REVEALS or RESUMES - it never clears anything. */

export interface ChatLeafFacts {
  /** The session this leaf holds or is resuming, or null for a fresh pane. */
  sessionId: string | null;
  /** The view's own claim that a conversation lives here. */
  occupied: boolean;
}

export type LeafRoute<T> =
  | { kind: 'reveal'; leaf: T }
  | { kind: 'resume-into'; leaf: T }
  | { kind: 'create-right' };

export function routeChatLeaf<T>(
  leaves: Array<{ leaf: T; facts: ChatLeafFacts }>,
  resumeSessionId: string | null,
): LeafRoute<T> {
  let unoccupied: T | null = null;
  for (const { leaf, facts } of leaves) {
    if (resumeSessionId && facts.sessionId === resumeSessionId) return { kind: 'reveal', leaf };
    if (!facts.occupied && unoccupied === null) unoccupied = leaf;
  }
  if (unoccupied !== null) {
    return resumeSessionId
      ? { kind: 'resume-into', leaf: unoccupied }
      : { kind: 'reveal', leaf: unoccupied };
  }
  return { kind: 'create-right' };
}
