/* THE UUID SHAPE EVERY CLAUDE CODE SESSION ID HAS, in one place.
 *
 * Vex's gate (2026-09-07, M1) found one entry a session id reaches without
 * this check: `ChatView.setState()` read `resumeSessionId` and
 * `remoteControlSessionId` off restored workspace-leaf state with only
 * `typeof id === 'string' && id`. `quotePosix`/`quoteWindows` still defuse
 * shell injection either way (Vex proved this live, 15 hostile payloads,
 * zero breakouts), so this was defense-in-depth, not a live exploit - but a
 * malformed id built into `--resume <id>` fails the CLI, not silently, and
 * catching the malformed shape before it reaches a command line is cheaper
 * than reading a stranger's error.
 *
 * `archive/resume.ts` already enforced this shape on the one place a session
 * id is read from member-editable text (an archived note's frontmatter).
 * This file is that same pattern, pulled out so a second entry point (a
 * restored leaf's state, Remote Control's own command build) can share it
 * instead of drifting its own copy. */

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a string in exactly the shape Claude Code's own session ids take. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}
