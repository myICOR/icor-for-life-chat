/* THE CROSS-PANE GUARD FOR REMOTE CONTROL'S OWN HAND-OFF (Vex H1, 2026-09-07).
 *
 * `view/handoff.ts`'s `terminalHoldsSession` was built for one hand-off
 * target - an Obsidian leaf of the ICOR for Life - Terminal plugin's own
 * view type - and it cannot see Remote Control's target at all: Remote
 * Control hands a session to an OS-LEVEL terminal window (`osascript` /
 * `cmd` / a resolved `x-terminal-emulator`), which is not an Obsidian leaf
 * and carries no `resumeSessionId` any workspace walk can read.
 *
 * So this hand-off keeps its own registry, at the PLUGIN level (one set for
 * the whole vault, never one per `ChatView` instance - a second pane must
 * see the first pane's hold), persisted to a file beside `data.json` so a
 * reload does not forget a session an external terminal still has open.
 *
 * The registry answers one question: is this id handed to Remote Control
 * right now? `ChatView.continueOnPhone` adds to it before the terminal
 * opens; `ChatView.bringItBack` is the only thing that removes an entry.
 * Every path that can attach a live writer to a session id - the
 * recent-sessions picker, `resume()`, a restored leaf's `setState`, a
 * reopened tab - all fold through `ChatView.resume()`, which reads this
 * registry first.
 *
 * Pure so the parsing and the lookup are asserted without a workspace;
 * `main.ts` is the one file that reads and writes the actual file. */

/** On-disk shape: the plain array `JSON.stringify`s the live `Set` to. */
export type StoredHeldSessions = string[];

/** Whatever was on disk, narrowed to a de-duplicated string array; a
 * malformed entry is dropped rather than crashing the load - the same rule
 * `model/catalogCache.ts`'s `parseCatalogCache` follows for its own file
 * beside this one. */
export function parseHeldSessions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/** Case-blind, like `handoff.ts`'s own guard: the CLI lower-cases ids before argv. */
export function heldSessionsHas(held: Iterable<string>, sessionId: string): boolean {
  const wanted = sessionId.trim().toLowerCase();
  if (!wanted) return false;
  for (const id of held) {
    if (id.toLowerCase() === wanted) return true;
  }
  return false;
}
