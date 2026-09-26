/* THE DAILY SCRATCHPAD CAPTURE PATH (issue #1).
 *
 * "Save as note" wrote `00 Daily Scratchpad/<date>-<slug>.md`: at the room
 * root, named by the reply's first words, dated by UTC. The scaffold's room
 * is date-nested and takes timestamp names only (`YYYY/MM/YYYYMMDDHHmm`, ` 2`
 * on a same-minute collision, GL-1004; its validate-scaffold.py check 3
 * rejects both the root and the slug), and a UTC date files a save just after midnight on the day before,
 * anywhere east of Greenwich. The folders, the name and the day have one
 * right answer for a given moment, so they are asserted here without a
 * vault, the way the WiP room's names are in wip.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCRATCHPAD_FOLDER, captureBase, captureFolders, capturePath, localDate, uniquePath } from './build/pure.mjs';

/* validate-scaffold.py check 3: three path parts under the room, YYYY then MM,
   then a name in one of the room's shapes; the canonical quick-capture shape
   is YYYYMMDDHHmm with an optional space-number collision suffix (the
   validator's `\d{12}( \d+)?( - .+)?\.md`). Its year and month are the
   folder's. */
const CAPTURE = /^00 Daily Scratchpad\/(\d{4})\/(\d{2})\/\1\2\d{6}( \d+)?\.md$/;
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

test('a capture is 00 Daily Scratchpad/YYYY/MM/YYYYMMDDHHmm, the canonical shape the scaffold validator accepts', () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime(); // 5 March 2026, 08:02:32, in the machine's own zone
  assert.equal(captureBase(at), `${SCRATCHPAD_FOLDER}/2026/03/202603050802`, 'the minute, no seconds');
  assert.match(`${captureBase(at)}.md`, CAPTURE);
  assert.doesNotMatch(captureBase(at), LEGACY_DASHED, 'never the legacy dashed YYYY-MM-DD-HHmmss');
  assert.equal(captureBase(new Date(2026, 0, 3, 4, 5, 6).getTime()), `${SCRATCHPAD_FOLDER}/2026/01/202601030405`, 'every part is zero-padded');
});

test('the folders a capture needs, room first, so a caller can create each that is missing', () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime();
  assert.deepEqual(captureFolders(at), [SCRATCHPAD_FOLDER, `${SCRATCHPAD_FOLDER}/2026`, `${SCRATCHPAD_FOLDER}/2026/03`]);
});

test("the day is the machine's own, not UTC: a save at 00:30 east of Greenwich files on that day", () => {
  inZone('Etc/GMT-1', () => {
    const at = Date.UTC(2026, 2, 4, 23, 30, 15); // 00:30:15 on 5 March, local
    assert.equal(new Date(at).toISOString().slice(0, 10), '2026-03-04', 'the UTC day 0.16.0 filed under');
    assert.equal(captureBase(at), `${SCRATCHPAD_FOLDER}/2026/03/202603050030`);
    assert.equal(localDate(at), '2026-03-05', 'the frontmatter date agrees with the name');
  });
  inZone('Etc/GMT+5', () => {
    const at = Date.UTC(2026, 2, 5, 3, 0, 0); // 22:00:00 on 4 March, local
    assert.equal(captureBase(at), `${SCRATCHPAD_FOLDER}/2026/03/202603042200`);
    assert.equal(localDate(at), '2026-03-04');
  });
});

test('a save just after midnight on the first of the month lands in the new month folder', () => {
  inZone('Etc/GMT-1', () => {
    const at = Date.UTC(2026, 2, 31, 23, 0, 0); // 00:00:00 on 1 April, local
    assert.equal(captureBase(at), `${SCRATCHPAD_FOLDER}/2026/04/202604010000`);
    assert.deepEqual(captureFolders(at), [SCRATCHPAD_FOLDER, `${SCRATCHPAD_FOLDER}/2026`, `${SCRATCHPAD_FOLDER}/2026/04`]);
  });
});

test("a same-minute capture collision gets ' 2', then ' 3', never '-2', and keeps the validator's shape", () => {
  const at = new Date(2026, 2, 5, 8, 2, 32).getTime();
  const base = `${SCRATCHPAD_FOLDER}/2026/03/202603050802`;
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

test('a note outside the room, named by its slug, keeps its -2 suffix', () => {
  const taken = new Set(['reply.md']);
  const exists = (path) => taken.has(path);
  assert.equal(uniquePath('reply', exists), 'reply-2.md');
  taken.add('reply-2.md');
  assert.equal(uniquePath('reply', exists), 'reply-3.md');
});
