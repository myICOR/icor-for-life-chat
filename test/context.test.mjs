/* THE VAULT AS CONTEXT, the pure half.
 *
 * Which caret is inside an unfinished `[[`, what a pick types, which links a
 * message names, and what the model is told about a group of notes: every one
 * of these has exactly one right answer, so every one is asserted here without
 * a workspace. The Obsidian resolvers (folder, tag, property) read the metadata
 * cache and are not here; what IS here is everything that decides what they
 * resolve INTO. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wikilinkQuery, applyWikilink, wikilinksIn, contextPreamble, withContext, contextRefsBlock,
  ATTACH_CAP, contextPickId, previewText, baseOf, folderOf,
} from './build/pure.mjs';

/* ------------------------------------------------------------ [[ query */

test('[[ opens the picker anywhere in the line, and a space does not close it', () => {
  assert.equal(wikilinkQuery('[[', 2), '');
  assert.equal(wikilinkQuery('see [[bernd', 11), 'bernd');
  // Most note names in a vault carry a space; the link query has to as well.
  assert.equal(wikilinkQuery('see [[Bernd Martin', 18), 'Bernd Martin');
});

test('a closed link is finished, and a newline abandons one', () => {
  assert.equal(wikilinkQuery('see [[bernd]] and', 17), null);
  assert.equal(wikilinkQuery('[[unfinished\nnext line', 22), null);
  assert.equal(wikilinkQuery('no link here', 12), null);
});

test('the caret decides: text behind it is not part of the query', () => {
  assert.equal(wikilinkQuery('[[bernd martin', 7), 'bernd');
});

/* --------------------------------------------------------- what it types */

test('accepting a note writes a wikilink and keeps the rest of the line', () => {
  const out = applyWikilink('compare [[ber with the other', 13, 'bernd-martin');
  assert.equal(out.value, 'compare [[bernd-martin]] with the other');
  assert.equal(out.value.slice(out.caret), ' with the other');
});

test('accepting at the end leaves a trailing space to keep typing in', () => {
  const out = applyWikilink('read [[AG', 9, 'AGENTS');
  assert.equal(out.value, 'read [[AGENTS]] ');
  assert.equal(out.caret, out.value.length);
});

/* -------------------------------------------------------- links in text */

test('every link target is found; aliases and headings are dropped', () => {
  assert.deepEqual(
    wikilinksIn('see [[bernd-martin]] and [[paco|Paco]] and [[INDEX#Goals]] and ![[img.png]]'),
    ['bernd-martin', 'paco', 'INDEX', 'img.png'],
  );
  assert.deepEqual(wikilinksIn('nothing [[]] here'), []);
  assert.deepEqual(wikilinksIn('plain text'), []);
});

/* ------------------------------------------------------- the preamble */

const OPEN = { path: 'a.md', basename: 'a', selection: null, fromLine: null, toLine: null };
const ref = (kind, label, paths) => ({ kind, id: label, label, detail: '', paths });

test('no refs means the preamble it always was, byte for byte', () => {
  assert.equal(contextPreamble(OPEN, []), contextPreamble(OPEN));
  assert.equal(contextPreamble(null, []), '');
  assert.equal(withContext('go', null, []), 'go');
});

test('a ref becomes a block: its label, its count, and one quoted attachment per note', () => {
  const p = contextPreamble(OPEN, [ref('tag', '#gamedev', ['06 AI Team/x.md', 'y.md'])]);
  assert.match(p, /^Open note: a\.md\n\nContext: #gamedev \(2 notes\)\n@"06 AI Team\/x\.md"\n@"y\.md"$/);
});

test('every attachment is quoted, even one with no space, because one rule is one rule', () => {
  // The bare form works for space-free paths; the quoted form works for all
  // of them, and a preamble with two forms is a preamble with a case nobody
  // tests. Measured 2026-08-31: quoted arrives.
  const p = contextRefsBlock([ref('note', 'y', ['y.md'])]);
  assert.equal(p, 'Context: y (1 note)\n@"y.md"');
});

test('the open note is never attached a second time, and refs do not repeat each other', () => {
  const p = contextPreamble(OPEN, [
    ref('note', 'a', ['a.md']),
    ref('folder', 'F', ['a.md', 'b.md']),
    ref('tag', '#t', ['b.md', 'c.md']),
  ]);
  assert.equal((p.match(/@"a\.md"/g) ?? []).length, 0, 'the open note was attached again');
  assert.equal((p.match(/@"b\.md"/g) ?? []).length, 1, 'b.md attached twice');
  assert.match(p, /Context: F \(1 note\)/, 'the count must be the count AFTER dedupe');
  assert.match(p, /Context: #t \(1 note\)/);
});

test('a ref whose every note is already named contributes nothing', () => {
  const p = contextPreamble(OPEN, [ref('note', 'a', ['a.md'])]);
  assert.equal(p, contextPreamble(OPEN));
});

test('past the cap notes are LISTED, not dropped, and the cap is spent in pick order', () => {
  const many = Array.from({ length: ATTACH_CAP + 5 }, (_, i) => `n${i}.md`);
  const p = contextRefsBlock([ref('note', 'first', ['first.md']), ref('tag', '#big', many)]);
  const attached = p.match(/^@"/gm) ?? [];
  assert.equal(attached.length, ATTACH_CAP);
  assert.match(p, /^@"first\.md"$/m, 'the note picked first lost its attachment to the group');
  assert.match(p, /More notes in this context, read them on demand:/);
  for (const path of many.slice(ATTACH_CAP - 1)) {
    assert.match(p, new RegExp(`^${path.replace('.', '\\.')}$`, 'm'), `${path} vanished`);
  }
  assert.doesNotMatch(p, /^@"n\d+\.md"\n(?:(?!More).)*More notes/s, 'the list header must come after the attachments');
});

test('withContext puts the preamble first and the words last', () => {
  const out = withContext('summarise these', null, [ref('folder', 'F', ['x.md'])]);
  assert.equal(out, 'Context: F (1 note)\n@"x.md"\n\nsummarise these');
});

/* ------------------------------------------------------------- the ids */

test('a pick has one stable id, so a second pick of the same thing is a no-op', () => {
  assert.equal(contextPickId({ kind: 'tag', tag: 'gamedev' }), '#gamedev');
  assert.equal(contextPickId({ kind: 'tag', tag: '#gamedev' }), '#gamedev');
  assert.equal(contextPickId({ kind: 'property', key: 'age', value: '4' }), 'age: 4');
  assert.equal(contextPickId({ kind: 'folder', path: '04 Inner World' }), '04 Inner World');
  assert.equal(contextPickId({ kind: 'note', path: 'a.md' }), 'a.md');
});

test('a path splits into the name a user thinks in and the folder it lives in', () => {
  assert.equal(baseOf('04 Inner World/Contacts/People/bernd-martin.md'), 'bernd-martin');
  assert.equal(folderOf('04 Inner World/Contacts/People/bernd-martin.md'), '04 Inner World/Contacts/People');
  assert.equal(baseOf('README.md'), 'README');
  assert.equal(folderOf('README.md'), '');
});

/* ---------------------------------------------------------- the preview */

test('the preview drops the frontmatter and cuts at a word', () => {
  const src = '---\ntitle: x\ntags:\n  - a\n---\n\n# Paco\n\n## Summary\n\nPaco ist Co-founder.';
  assert.equal(previewText(src), '# Paco\n\n## Summary\n\nPaco ist Co-founder.');
  const long = 'word '.repeat(300);
  const out = previewText(long, 100);
  assert.ok(out.length <= 104, 'over the limit');
  assert.ok(out.endsWith('...'), 'a cut preview says it was cut');
  assert.doesNotMatch(out, /wor\.\.\.$/, 'cut mid-word');
});

test('a note that is only frontmatter previews as empty rather than as YAML', () => {
  assert.equal(previewText('---\ntitle: x\n---\n'), '');
});
