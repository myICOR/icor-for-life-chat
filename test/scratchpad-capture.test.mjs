/* THE DAILY NOTES CAPTURE PATH (issue #1; the folder moved in 0.17.1).
 *
 * "Save as note" wrote `00 Daily Scratchpad/<date>-<slug>.md`: at the folder
 * root, named by the reply's first words, dated by UTC. The folder is
 * date-nested and takes timestamp names only (`YYYY/MM/YYYYMMDDHHmm`, ` 2`
 * on a same-minute collision, GL-1004), and a UTC date files a save just
 * after midnight on the day before, anywhere east of Greenwich. The folders,
 * the name and the day have one right answer for a given moment, so they are
 * asserted here without a vault.
 *
 * ICOR for Life 3.0 calls the folder `00 Daily Notes` (the stages contract,
 * 2026-11-23). Which folder is decided by `scratchFolder`: Obsidian's Daily
 * notes setting first, then `00 Daily Notes`, and a 2.x vault's
 * `00 Daily Scratchpad` while it is there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_NOTES_FOLDER, LEGACY_DAILY_NOTES_FOLDER, captureBase, captureFolders, captureFrontmatter, capturePath, localDate, resumableSessionId, uniquePath, scratchFolder, dailyNotesFolderOf } from './build/pure.mjs';

/* Three path parts under the folder, YYYY then MM, then the canonical
   quick-capture shape: YYYYMMDDHHmm with an optional space-number collision
   suffix (`\d{12}( \d+)?( - .+)?\.md`). Its year and month are the
   folder's. */
const CAPTURE = /^00 Daily Notes\/(\d{4})\/(\d{2})\/\1\2\d{6}( \d+)?\.md$/;
const LEGACY_DASHED = /\d{4}-\d{2}-\d{2}-\d{6}/;

/* Runs `fn` with the process in a fixed zone, then puts the machine's own
   zone back. POSIX signs: Etc/GMT-1 is UTC+1, Etc/GMT+5 is UTC-5. Node applies
   a change to process.env.TZ at once, on every platform it supports. */
function inZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test('a capture is 00 Daily Notes/YYYY/MM/YYYYMMDDHHmm, the canonical quick-capture shape', () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime(); // 5 March 2026, 08:02:32, in the machine's own zone
  assert.equal(captureBase(at), `${DAILY_NOTES_FOLDER}/2026/03/202603050802`, 'the minute, no seconds');
  assert.match(`${captureBase(at)}.md`, CAPTURE);
  assert.doesNotMatch(captureBase(at), LEGACY_DASHED, 'never the legacy dashed YYYY-MM-DD-HHmmss');
  assert.equal(captureBase(new Date(2026, 0, 3, 4, 5, 6).getTime()), `${DAILY_NOTES_FOLDER}/2026/01/202601030405`, 'every part is zero-padded');
});

test('the folders a capture needs, the Daily notes folder first, so a caller can create each that is missing', () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime();
  assert.deepEqual(captureFolders(at), [DAILY_NOTES_FOLDER, `${DAILY_NOTES_FOLDER}/2026`, `${DAILY_NOTES_FOLDER}/2026/03`]);
});

test("the day is the machine's own, not UTC: a save at 00:30 east of Greenwich files on that day", () => {
  inZone('Etc/GMT-1', () => {
    const at = Date.UTC(2026, 2, 4, 23, 30, 15); // 00:30:15 on 5 March, local
    assert.equal(new Date(at).toISOString().slice(0, 10), '2026-03-04', 'the UTC day 0.16.0 filed under');
    assert.equal(captureBase(at), `${DAILY_NOTES_FOLDER}/2026/03/202603050030`);
    assert.equal(localDate(at), '2026-03-05', 'the frontmatter date agrees with the name');
  });
  inZone('Etc/GMT+5', () => {
    const at = Date.UTC(2026, 2, 5, 3, 0, 0); // 22:00:00 on 4 March, local
    assert.equal(captureBase(at), `${DAILY_NOTES_FOLDER}/2026/03/202603042200`);
    assert.equal(localDate(at), '2026-03-04');
  });
});

test('a save just after midnight on the first of the month lands in the new month folder', () => {
  inZone('Etc/GMT-1', () => {
    const at = Date.UTC(2026, 2, 31, 23, 0, 0); // 00:00:00 on 1 April, local
    assert.equal(captureBase(at), `${DAILY_NOTES_FOLDER}/2026/04/202604010000`);
    assert.deepEqual(captureFolders(at), [DAILY_NOTES_FOLDER, `${DAILY_NOTES_FOLDER}/2026`, `${DAILY_NOTES_FOLDER}/2026/04`]);
  });
});

test("a same-minute capture collision gets ' 2', then ' 3', never '-2', and keeps the validator's shape", () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime();
  const base = `${DAILY_NOTES_FOLDER}/2026/03/202603050802`;
  const taken = new Set();
  const exists = (path) => taken.has(path);
  assert.equal(capturePath(at, exists), `${base}.md`);
  taken.add(`${base}.md`);
  assert.equal(capturePath(at, exists), `${base} 2.md`);
  taken.add(`${base} 2.md`);
  assert.equal(capturePath(at, exists), `${base} 3.md`);
  for (const path of taken) assert.match(path, CAPTURE);
  assert.match(capturePath(at, exists), CAPTURE);
  assert.doesNotMatch(`${base}-2.md`, CAPTURE, 'the dash suffix is what the 12-digit shape refuses');
});

test('a note outside the Daily notes folder, named by its slug, keeps its -2 suffix', () => {
  const taken = new Set(['reply.md']);
  const exists = (path) => taken.has(path);
  assert.equal(uniquePath('reply', exists), 'reply-2.md');
  taken.add('reply-2.md');
  assert.equal(uniquePath('reply', exists), 'reply-3.md');
});

/* WHICH FOLDER (0.17.1). A vault is a set of folders here: `isFolder` is all
   `scratchFolder` asks of it. */
const vaultWith = (...folders) => (path) => folders.includes(path);

test("Obsidian's Daily notes setting decides the folder, and a folder it names is used even before it exists", () => {
  assert.equal(scratchFolder('00 Daily Notes', vaultWith('00 Daily Notes')), '00 Daily Notes');
  assert.equal(scratchFolder('Journal/Daily', vaultWith('00 Daily Notes')), 'Journal/Daily', 'the setting outranks the ICOR default');
  assert.equal(scratchFolder('Journal', vaultWith()), 'Journal', 'a folder the setting names is created, as Obsidian would');
  assert.equal(scratchFolder('/00 Daily Notes/', vaultWith('00 Daily Notes')), '00 Daily Notes', 'slashes around the setting');
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime();
  assert.deepEqual(captureFolders(at, 'Journal'), ['Journal', 'Journal/2026', 'Journal/2026/03']);
  assert.equal(capturePath(at, () => false, 'Journal'), 'Journal/2026/03/202603050802.md');
});

test('with no Daily notes setting: 00 Daily Notes when the vault has it, a 2.x vault\'s 00 Daily Scratchpad, else the vault root', () => {
  assert.equal(DAILY_NOTES_FOLDER, '00 Daily Notes');
  assert.equal(scratchFolder('', vaultWith('00 Daily Notes', '01 Inbox')), '00 Daily Notes');
  assert.equal(scratchFolder('', vaultWith('00 Daily Notes', LEGACY_DAILY_NOTES_FOLDER)), '00 Daily Notes', 'the 3.0 folder comes first');
  assert.equal(scratchFolder('', vaultWith(LEGACY_DAILY_NOTES_FOLDER)), '00 Daily Scratchpad');
  assert.equal(scratchFolder('', vaultWith('01 Inbox')), null, 'a vault with neither saves at its root, as before');
});

test('a saved Daily notes setting that still names 00 Daily Scratchpad keeps working, and moves once only 00 Daily Notes is there', () => {
  assert.equal(scratchFolder(LEGACY_DAILY_NOTES_FOLDER, vaultWith(LEGACY_DAILY_NOTES_FOLDER)), '00 Daily Scratchpad', 'used as saved while the old folder exists');
  assert.equal(scratchFolder(LEGACY_DAILY_NOTES_FOLDER, vaultWith(LEGACY_DAILY_NOTES_FOLDER, '00 Daily Notes')), '00 Daily Scratchpad');
  assert.equal(scratchFolder(LEGACY_DAILY_NOTES_FOLDER, vaultWith('00 Daily Notes')), '00 Daily Notes', 'the old folder is gone, the new one is there');
  assert.equal(scratchFolder(LEGACY_DAILY_NOTES_FOLDER, vaultWith()), '00 Daily Scratchpad', 'neither there: the setting as saved');
});

test('folders are matched by their full name, never by the number in front', () => {
  assert.equal(scratchFolder('', vaultWith('00 Daily')), null);
  assert.equal(scratchFolder('', vaultWith('00 Daily Notes old')), null);
  assert.equal(scratchFolder('', vaultWith('00 Inbox')), null);
  assert.equal(scratchFolder(LEGACY_DAILY_NOTES_FOLDER, vaultWith('00 Daily Notes 2')), '00 Daily Scratchpad', 'a near name is not the new folder');
});

test("the Daily notes setting is read from Obsidian's daily-notes.json, and anything unreadable reads as unset", () => {
  assert.equal(dailyNotesFolderOf('{"folder": "00 Daily Notes", "format": "YYYY/MM/YYYY-MM-DD", "autorun": false}'), '00 Daily Notes');
  assert.equal(dailyNotesFolderOf('{"folder": "00 Daily Scratchpad/"}'), '00 Daily Scratchpad');
  assert.equal(dailyNotesFolderOf('{"format": "YYYY-MM-DD"}'), '');
  assert.equal(dailyNotesFolderOf('{"folder": 7}'), '');
  assert.equal(dailyNotesFolderOf('{ half'), '');
  assert.equal(dailyNotesFolderOf(null), '');
});

/* Tool Lab item 14. Resume reads `source` and `session_ids` back, so both stay
   in a saved reply; a double-quoted flow list is YAML and JSON alike. */
test('a saved reply carries its session as a quoted YAML list, and resume can read it back', () => {
  const id = '3f2b8c1e-0d4a-4e6b-9a77-1c2d3e4f5a6b';
  const text = captureFrontmatter('2026-11-02', id);
  assert.equal(text, `---\ndate: 2026-11-02\nsource: icor-chat\nsession_ids: ["${id}"]\n---\n`);
  const value = JSON.parse(/^session_ids: (.*)$/m.exec(text)[1]);
  assert.deepEqual(value, [id]);
  assert.equal(resumableSessionId(value), id);
});

test('a saved reply with no session writes an empty list, not a null or a blank string', () => {
  const text = captureFrontmatter('2026-11-02', '');
  assert.match(text, /^session_ids: \[\]$/m);
  assert.equal(resumableSessionId(JSON.parse(/^session_ids: (.*)$/m.exec(text)[1])), null);
});
