/* Archive naming and the retention sweep. The sweep deletes folders, so the
 * rule that decides what is ours is asserted, not assumed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, shortId, folderName, looksLikeOurArchive, expiredFolders, isOurManifest, ARCHIVE_SCHEMA,
} from './build/pure.mjs';

test('a folder name carries date, time, slug and a stable short id', () => {
  const at = new Date(2026, 7, 29, 14, 32).getTime();
  const name = folderName(at, 'Ship the archive writer', '7f3a9b21-dead-beef-0000-111122223333');
  assert.equal(name, '2026-08-29_1432_ship-the-archive-writer_7f3a9b');
  assert.equal(looksLikeOurArchive(name), true);
});

test('a title that slugs to nothing still produces a legal folder', () => {
  const name = folderName(Date.now(), '???', '');
  assert.equal(looksLikeOurArchive(name), true);
  assert.equal(slugify('???'), 'session');
  assert.equal(shortId(''), 'nosess');
});

test('slugs are bounded and never end in a dash', () => {
  const slug = slugify('a'.repeat(80));
  assert.equal(slug.length, 40);
  assert.equal(/-$/.test(slugify('trailing spaces   ')), false);
});

test('the sweep recognises only our own folder shape', () => {
  for (const name of [
    'Some notes', '2026-08-29', 'archive', '2026-08-29_1432_x', 'README.md',
    '2026-08-29_1432_slug_TOOLONG',
  ]) {
    assert.equal(looksLikeOurArchive(name), false, name);
  }
  assert.equal(looksLikeOurArchive('2026-08-29_1432_slug_abc123'), true);
});

test('retention deletes nothing when it is switched off', () => {
  const now = Date.now();
  const old = [{ name: '2026-01-01_0900_x_abc123', endedAt: now - 400 * 86400000 }];
  assert.deepEqual(expiredFolders(old, 0, now), []);
  assert.deepEqual(expiredFolders(old, -5, now), []);
});

test('retention deletes only what is both ours and past the cut', () => {
  const now = Date.now();
  const entries = [
    { name: '2026-01-01_0900_old_abc123', endedAt: now - 120 * 86400000 },
    { name: '2026-08-01_0900_recent_def456', endedAt: now - 5 * 86400000 },
    { name: 'My own folder', endedAt: now - 999 * 86400000 },
    { name: '2026-01-01_0900_nomanifest_ghi789', endedAt: 0 },
  ];
  assert.deepEqual(expiredFolders(entries, 90, now), ['2026-01-01_0900_old_abc123']);
});

test('a manifest is ours only when it says so', () => {
  assert.equal(isOurManifest({ schema: ARCHIVE_SCHEMA }), true);
  assert.equal(isOurManifest({ schema: 'something/else@1' }), false);
  assert.equal(isOurManifest({}), false);
  assert.equal(isOurManifest(null), false);
  assert.equal(isOurManifest('text'), false);
});

/* One conversation, one folder. The bug: two tabs on one session minted two
 * folders, each holding only the slice that tab had seen - measured on disk as
 * three folders for one session id, two messages each. */

test('the short id is what ties a folder to its session', () => {
  const id = '791a48b4-6b49-4e67-80bf-311ed93a052a';
  const first = folderName(new Date(2026, 7, 30, 0, 1).getTime(), 'One brief card', id);
  const later = folderName(new Date(2026, 7, 30, 0, 12).getTime(), 'A different opener', id);
  // Different names, but both end in the same session-derived suffix, which is
  // what the reuse lookup matches on.
  assert.notEqual(first, later);
  assert.equal(first.endsWith('_791a48'), true);
  assert.equal(later.endsWith('_791a48'), true);
});

test('two different sessions never collide on that suffix', () => {
  const a = folderName(Date.now(), 'x', '791a48b4-6b49-4e67-80bf-311ed93a052a');
  const b = folderName(Date.now(), 'x', '9c3bd15d-feda-4b98-a1cd-1c7c44112fcc');
  assert.notEqual(a.slice(-6), b.slice(-6));
});

test('a short id is stable and case-insensitive for one session', () => {
  const id = 'D4E5C789-1DC8-46B2-A1C6-1BA8AD9D7325';
  assert.equal(shortId(id), shortId(id.toLowerCase()));
  assert.equal(shortId(id), 'd4e5c7');
});
