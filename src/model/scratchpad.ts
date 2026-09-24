/* THE DAILY SCRATCHPAD ROOM'S NAMING RULE, and no vault under it.
 *
 * The room is date-nested, and a note in it is named by the moment it was
 * made, never by its subject: a quick capture is
 * `00 Daily Scratchpad/YYYY/MM/YYYY-MM-DD-HHmmss.md`, in the machine's own
 * day (the scaffold's GL-1004; its validate-scaffold.py rejects a file at the
 * room root, or one named by a slug). A given moment has one right answer for
 * the folders and the name, so both are asserted in
 * test/scratchpad-capture.test.mjs without a vault, the way the WiP room's
 * names are. */

import { localDate } from '../wip/naming';

export const SCRATCHPAD_FOLDER = '00 Daily Scratchpad';

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** The room, its year and its month, in that order, so a caller can create each that is missing. */
export function captureFolders(now = Date.now()): string[] {
  const d = new Date(now);
  const year = `${SCRATCHPAD_FOLDER}/${d.getFullYear()}`;
  return [SCRATCHPAD_FOLDER, year, `${year}/${two(d.getMonth() + 1)}`];
}

/** `00 Daily Scratchpad/YYYY/MM/YYYY-MM-DD-HHmmss`, before the extension and the collision check. */
export function captureBase(now = Date.now()): string {
  const d = new Date(now);
  const time = `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  return `${SCRATCHPAD_FOLDER}/${d.getFullYear()}/${two(d.getMonth() + 1)}/${localDate(now)}-${time}`;
}

/** `base.md`, else `base-2.md`, `base-3.md`, ...: the first not already taken. */
export function uniquePath(base: string, exists: (path: string) => boolean): string {
  let path = `${base}.md`;
  for (let n = 2; exists(path); n += 1) path = `${base}-${n}.md`;
  return path;
}
