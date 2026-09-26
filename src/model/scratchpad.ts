/* THE DAILY SCRATCHPAD ROOM'S NAMING RULE, and no vault under it.
 *
 * The room is date-nested, and a note in it is named by the minute it was
 * made, never by its subject: a quick capture is
 * `00 Daily Scratchpad/YYYY/MM/YYYYMMDDHHmm.md`, in the machine's own day,
 * with ` 2`, ` 3` after the stamp on a same-minute collision (the Scaffold's
 * GL-1004 naming rule, and the name the ICOR for Life Scratchpad plugin and
 * the Scaffold's Unique note setting write; its validate-scaffold.py rejects
 * a file at the room root, or one named by a slug). A given moment has one
 * right answer for the folders and the name, so both are asserted in
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

/** `00 Daily Scratchpad/YYYY/MM/YYYYMMDDHHmm`, before the extension and the collision check. */
export function captureBase(now = Date.now()): string {
  const d = new Date(now);
  const stamp = `${localDate(now).replace(/-/g, '')}${two(d.getHours())}${two(d.getMinutes())}`;
  return `${SCRATCHPAD_FOLDER}/${d.getFullYear()}/${two(d.getMonth() + 1)}/${stamp}`;
}

/** `base.md`, else `base<separator>2.md`, `base<separator>3.md`, ...: the first not already taken. */
export function uniquePath(base: string, exists: (path: string) => boolean, separator = '-'): string {
  let path = `${base}.md`;
  for (let n = 2; exists(path); n += 1) path = `${base}${separator}${n}.md`;
  return path;
}

/** The quick capture's full path for this moment: a same-minute collision takes ` 2`, never `-2`, which the room's 12-digit shape does not allow. */
export function capturePath(now: number, exists: (path: string) => boolean): string {
  return uniquePath(captureBase(now), exists, ' ');
}
