/* The structured parser and the decision lifecycle. The parser's first duty is
 * not to claim text that is not in the format. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructured, decisionsOf, stripGlyphs, trackDecisions, openDecisions,
  badgeLabel, mentionsCode, isCode,
} from './build/pure.mjs';

const card = [
  'Two lines of ordinary lead prose.',
  '',
  'FELIX · icor-for-life-chat P3 · COMPLETE',
  'ASKED',
  'Does the parser hold?',
  'ANSWER',
  'It holds, and it declines what is not its business.',
  'VERDICT',
  '🟢 tests passing :: 49',
  '🔴 unowned rows :: 2 (was 3)',
  'INSIGHT',
  'A parser that claims too much is worse than one that claims nothing.',
  'NOT COVERED',
  '⚪ live UI drive :: Obsidian frozen',
  'NEXT',
  '1. Ship the renderer',
  '2. Wire the badge',
  'FILES',
  '/Users/tom/Dev/icor-for-life-chat/src/structured/parser.ts',
  'LINKS',
  'https://github.com/myICOR/icor-for-life-chat',
  '',
  'DECISION a1b2c · plugin id',
  'Keep the slug or rename? Recommend keep.',
].join('\n');

test('plain chat is never claimed by the parser', () => {
  const doc = parseStructured('Hi. Here is a normal answer with a 🔴 emoji in it.');
  assert.equal(doc.structured, false);
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].kind, 'prose');
});

test('a well-formed reply parses into its regions', () => {
  const doc = parseStructured(card);
  assert.equal(doc.structured, true);
  const kinds = doc.segments.map((s) => s.kind);
  assert.deepEqual(kinds, ['prose', 'card', 'decision']);
  const blocks = doc.segments[1].blocks.map((b) => b.kind);
  assert.deepEqual(blocks, ['asked', 'answer', 'group', 'insight', 'notCovered', 'next', 'files', 'links']);
});

test('the header carries name, scope and status', () => {
  const { header } = parseStructured(card).segments[1];
  assert.equal(header.name, 'FELIX');
  assert.equal(header.scope, 'icor-for-life-chat P3');
  assert.equal(header.status, 'COMPLETE');
});

test('rows keep their disposition, value and qualifier apart', () => {
  const group = parseStructured(card).segments[1].blocks.find((b) => b.kind === 'group');
  assert.equal(group.title, 'VERDICT');
  assert.deepEqual(group.rows[0], { disposition: 'handled', label: 'tests passing', value: '49', qualifier: null });
  assert.deepEqual(group.rows[1], { disposition: 'unowned', label: 'unowned rows', value: '2', qualifier: 'was 3' });
});

test('no emoji survives into a parsed card', () => {
  const doc = parseStructured(card);
  const json = JSON.stringify(doc);
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(json), false);
});

test('a card that never closes still renders what it has', () => {
  const doc = parseStructured('FELIX · scope · COMPLETE\nASKED\nA question with no more card after it.');
  assert.equal(doc.segments[0].kind, 'card');
  assert.equal(doc.segments[0].blocks[0].kind, 'asked');
});

test('fenced blocks are never interpreted, however card-shaped', () => {
  const text = [
    'Here is the shape:',
    '```',
    'FELIX · fake · COMPLETE',
    'DECISION zzzzz · not a real decision',
    '```',
    'and that is all.',
  ].join('\n');
  const doc = parseStructured(text);
  assert.equal(doc.structured, false);
  assert.equal(decisionsOf(doc).length, 0);
});

test('phantom-decision immunity: a red row is a row, not a decision', () => {
  const doc = parseStructured([
    'FELIX · x · PARTIAL',
    'VERDICT',
    '🔴 nobody owns the archive :: 1',
    '✅ gate cleared :: yes',
  ].join('\n'));
  assert.equal(decisionsOf(doc).length, 0);
});

test('we ask for exactly five characters and read a little wider', () => {
  // Strict in what we request: isCode is the canonical five.
  assert.equal(isCode('a1b2c'), true);
  assert.equal(isCode('abc'), false);
  assert.equal(isCode('abcdefg'), false);
  assert.equal(isCode('A1B2C'), false, 'codes are lowercase');
  // Liberal in what we accept: a live reply produced a six-character code under
  // a prompt asking for five, and dropping it would lose the whole decision.
  assert.equal(decisionsOf(parseStructured('DECISION a1b2c · just right')).length, 1);
  assert.equal(decisionsOf(parseStructured('DECISION vault1 · six chars')).length, 1);
  assert.equal(decisionsOf(parseStructured('DECISION ab · far too short')).length, 0);
  assert.equal(decisionsOf(parseStructured('DECISION abcdefghij · far too long')).length, 0);
});

test('a header whose last segment is not a status word is still a card, when a kicker confirms it', () => {
  const doc = parseStructured([
    'VAULT · /scratchpad/vault · estimated (no tools used)',
    'ASKED',
    'Note count.',
  ].join('\n'));
  assert.equal(doc.structured, true);
  assert.equal(doc.segments[0].header.name, 'VAULT');
  assert.equal(doc.segments[0].header.status, null);
});

test('ordinary prose containing a middot is never mistaken for a header', () => {
  const doc = parseStructured('I read the note · it was fine · and I moved on.\nThen I stopped.');
  assert.equal(doc.structured, false);
});

test('the three decision variants are distinguished', () => {
  const doc = parseStructured([
    'DECISION aaaa1 · open one',
    'BLOCKED bbbb2 · a blocker',
    'CLEARED cccc3 · a met gate',
  ].join('\n'));
  assert.deepEqual(decisionsOf(doc).map((d) => d.variant), ['decision', 'blocked', 'cleared']);
});

test('a decision body is bounded to three lines', () => {
  const doc = parseStructured([
    'DECISION a1b2c · title',
    'one', 'two', 'three', 'four',
  ].join('\n'));
  const body = decisionsOf(doc)[0].body;
  assert.equal(body, 'one two three');
});

/* ------------------------------------------------------------- lifecycle */

const surfaced = (code, index, variant = 'decision') => ({
  decision: { code, title: `t-${code}`, body: '', variant },
  index, at: 1000 + index,
});

test('a decision resolves when a LATER user message contains its code', () => {
  const tracked = trackDecisions([surfaced('a1b2c', 1)], [
    { role: 'user', text: 'go', index: 0, at: 0 },
    { role: 'assistant', text: 'DECISION a1b2c', index: 1, at: 1 },
    { role: 'user', text: 'a1b2c go ahead', index: 2, at: 2 },
  ]);
  assert.equal(tracked[0].resolved, true);
  assert.deepEqual(openDecisions(tracked), []);
});

test('an assistant re-surface never resolves anything', () => {
  const tracked = trackDecisions([surfaced('a1b2c', 1)], [
    { role: 'assistant', text: 'DECISION a1b2c', index: 1, at: 1 },
    { role: 'assistant', text: 'still open: a1b2c', index: 2, at: 2 },
    { role: 'assistant', text: 'a1b2c again', index: 3, at: 3 },
  ]);
  assert.equal(tracked[0].resolved, false);
  assert.equal(tracked[0].mentions.length, 3);
});

test('a user message BEFORE the decision cannot resolve it', () => {
  const tracked = trackDecisions([surfaced('a1b2c', 5)], [
    { role: 'user', text: 'a1b2c', index: 4, at: 4 },
    { role: 'assistant', text: 'DECISION a1b2c', index: 5, at: 5 },
  ]);
  assert.equal(tracked[0].resolved, false);
});

test('a cleared gate arrives already resolved', () => {
  const tracked = trackDecisions([surfaced('ccccc', 1, 'cleared')], []);
  assert.equal(tracked[0].resolved, true);
});

test('a code inside a longer token is not a mention', () => {
  assert.equal(mentionsCode('x4a3fk9 is a filename', '4a3fk'), false);
  assert.equal(mentionsCode('do 4a3fk now', '4a3fk'), true);
  assert.equal(mentionsCode('4a3fk.', '4a3fk'), true);
});

test('resolution is derived, so the same inputs always give the same answer', () => {
  const args = [[surfaced('a1b2c', 1)], [
    { role: 'assistant', text: 'DECISION a1b2c', index: 1, at: 1 },
    { role: 'user', text: 'ok a1b2c', index: 2, at: 2 },
  ]];
  assert.deepEqual(trackDecisions(...args), trackDecisions(...args));
});

test('the badge is hidden at zero and counts in the right grammar', () => {
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(-1), null);
  assert.equal(badgeLabel(1), '1 OPEN DECISION');
  assert.equal(badgeLabel(3), '3 OPEN DECISIONS');
});

test('glyph stripping leaves the words alone', () => {
  assert.equal(stripGlyphs('🟢 handled'), 'handled');
  assert.equal(stripGlyphs('no glyph here'), 'no glyph here');
  assert.equal(stripGlyphs('✅ 🔶 done'), 'done');
});
