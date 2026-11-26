/* WHERE A REPLY SAVED AS ITS OWN NOTE GOES, and its name, with no vault under it.
 *
 * The folder is the vault's Daily notes folder: Obsidian's own Daily notes
 * setting (`.obsidian/daily-notes.json`) when it names one, else
 * `00 Daily Notes` when the vault has it (ICOR for Life 3.0), else the vault
 * root. A vault from 2.x calls the folder `00 Daily Scratchpad`; it keeps
 * working while that folder exists, and a setting still naming it moves to
 * `00 Daily Notes` once only the new folder is there. Folders are matched by
 * their full name, never by the number in front.
 *
 * The folder is date-nested, and a note in it is named by the minute it was
 * made, never by its subject: a quick capture is
 * `00 Daily Notes/YYYY/MM/YYYYMMDDHHmm.md`, in the machine's own day, with
 * ` 2`, ` 3` after the stamp on a same-minute collision (GL-1004, the name
 * the ICOR for Life Scratchpad plugin writes). A given moment has one right
 * answer for the folders and the name, so both are asserted in
 * test/scratchpad-capture.test.mjs without a vault. */

import { localDate } from './format';

/** The Daily notes folder of an ICOR for Life 3.0 vault. */
export const DAILY_NOTES_FOLDER = '00 Daily Notes';
/** Its 2.x name. Read only: a vault migrated from 2.x may still have it. */
export const LEGACY_DAILY_NOTES_FOLDER = '00 Daily Scratchpad';

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function bareFolder(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

/** The folder Obsidian's Daily notes setting names, from the text of `daily-notes.json`; '' when unset or unreadable. */
export function dailyNotesFolderOf(json: string | null): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { folder?: unknown };
    return typeof parsed.folder === 'string' ? bareFolder(parsed.folder) : '';
  } catch {
    return '';
  }
}

/**
 * The folder a saved reply goes into, or null for the vault root.
 * `setting` is Obsidian's Daily notes folder ('' when unset); a folder it
 * names is used, and created when missing, except the 2.x name when only the
 * 3.0 folder exists.
 */
export function scratchFolder(setting: string, isFolder: (path: string) => boolean): string | null {
  const saved = bareFolder(setting);
  if (saved === LEGACY_DAILY_NOTES_FOLDER && !isFolder(LEGACY_DAILY_NOTES_FOLDER) && isFolder(DAILY_NOTES_FOLDER)) {
    return DAILY_NOTES_FOLDER;
  }
  if (saved) return saved;
  if (isFolder(DAILY_NOTES_FOLDER)) return DAILY_NOTES_FOLDER;
  if (isFolder(LEGACY_DAILY_NOTES_FOLDER)) return LEGACY_DAILY_NOTES_FOLDER;
  return null;
}

/** The folder, its year and its month, in that order, so a caller can create each that is missing. */
export function captureFolders(now = Date.now(), folder = DAILY_NOTES_FOLDER): string[] {
  const d = new Date(now);
  const year = `${folder}/${d.getFullYear()}`;
  return [folder, year, `${year}/${two(d.getMonth() + 1)}`];
}

/** `<folder>/YYYY/MM/YYYYMMDDHHmm`, before the extension and the collision check. */
export function captureBase(now = Date.now(), folder = DAILY_NOTES_FOLDER): string {
  const d = new Date(now);
  const stamp = `${localDate(now).replace(/-/g, '')}${two(d.getHours())}${two(d.getMinutes())}`;
  return `${folder}/${d.getFullYear()}/${two(d.getMonth() + 1)}/${stamp}`;
}

/** `base.md`, else `base<separator>2.md`, `base<separator>3.md`, ...: the first not already taken. */
export function uniquePath(base: string, exists: (path: string) => boolean, separator = '-'): string {
  let path = `${base}.md`;
  for (let n = 2; exists(path); n += 1) path = `${base}${separator}${n}.md`;
  return path;
}

/** The quick capture's full path for this moment: a same-minute collision takes ` 2`, never `-2`, which the 12-digit name does not allow. */
export function capturePath(now: number, exists: (path: string) => boolean, folder = DAILY_NOTES_FOLDER): string {
  return uniquePath(captureBase(now, folder), exists, ' ');
}

/** The frontmatter of a saved reply. `source` and `session_ids` are what lets the note find its conversation: `archivedSession` in main.ts reads both to resume it. */
export function captureFrontmatter(date: string, sessionId: string): string {
  return ['---', `date: ${date}`, 'source: icor-chat', `session_ids: ${JSON.stringify(sessionId ? [sessionId] : [])}`, '---', ''].join('\n');
}
