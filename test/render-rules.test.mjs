/* The rendering laws that a reviewer would otherwise have to eyeball. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  railRuns, iconForPath, isReadableInObsidian, extensionOf, basenameOf, parentOf, splitUrl,
} from './build/pure.mjs';

const rows = (...d) => d.map((disposition) => ({ disposition }));

test('every contiguous unowned run carries a rail, a run of one included', () => {
  assert.deepEqual(railRuns(rows('unowned')), [[0, 0]]);
  assert.deepEqual(railRuns(rows('handled', 'unowned', 'handled')), [[1, 1]]);
  assert.deepEqual(railRuns(rows('unowned', 'unowned', 'owned', 'unowned')), [[0, 1], [3, 3]]);
  assert.deepEqual(railRuns(rows('handled', 'owned', 'noted')), []);
  assert.deepEqual(railRuns([]), []);
});

test('a run that reaches the end of the group still closes', () => {
  assert.deepEqual(railRuns(rows('owned', 'unowned', 'unowned')), [[1, 2]]);
});

test('the file icon map is exhaustive with one fallback', () => {
  assert.equal(iconForPath('/a/b/notes.md'), 'file-text');
  assert.equal(iconForPath('/a/board.canvas'), 'layout-dashboard');
  assert.equal(iconForPath('/a/main.ts'), 'file-code');
  assert.equal(iconForPath('/a/data.json'), 'file-json');
  assert.equal(iconForPath('/a/sheet.csv'), 'file-spreadsheet');
  assert.equal(iconForPath('/a/shot.PNG'), 'file-image', 'extensions are case-insensitive');
  assert.equal(iconForPath('/a/clip.mov'), 'file-video');
  assert.equal(iconForPath('/a/mix.m4a'), 'file-audio');
  assert.equal(iconForPath('/a/doc.pdf'), 'file-type');
  assert.equal(iconForPath('/a/x.tar'), 'file-archive');
  assert.equal(iconForPath('/a/mypka.db'), 'database');
  assert.equal(iconForPath('/a/LICENSE'), 'file', 'no extension falls back');
  assert.equal(iconForPath('/a/thing.wat'), 'file', 'an unknown extension falls back');
});

test('readable-in-Obsidian decides open versus reveal', () => {
  for (const p of ['/a/n.md', '/a/b.canvas', '/a/c.txt', '/a/d.pdf', '/a/e.png']) {
    assert.equal(isReadableInObsidian(p), true, p);
  }
  for (const p of ['/a/main.ts', '/a/x.zip', '/a/y.db', '/a/clip.mov', '/a/LICENSE']) {
    assert.equal(isReadableInObsidian(p), false, p);
  }
});

test('paths split into a truncatable parent and a basename that never truncates', () => {
  assert.equal(parentOf('/a/b/c.md'), '/a/b/');
  assert.equal(basenameOf('/a/b/c.md'), 'c.md');
  assert.equal(parentOf('c.md'), '');
  assert.equal(extensionOf('/a/.hidden'), '', 'a dotfile has no extension');
});

test('links show the host first and survive a malformed URL', () => {
  assert.deepEqual(splitUrl('https://github.com/myICOR/icor-chat'), {
    host: 'github.com', rest: '/myICOR/icor-chat',
  });
  assert.deepEqual(splitUrl('https://example.com/'), { host: 'example.com', rest: '' });
  assert.deepEqual(splitUrl('not a url'), { host: 'not a url', rest: '' });
});
