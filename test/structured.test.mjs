/* The structured parser and the decision lifecycle. The parser's first duty is
 * not to claim text that is not in the format. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructured, decisionsOf, stripGlyphs, trackDecisions, openDecisions,
  badgeLabel, mentionsCode, isCode, STRUCTURED_REPLY_PROMPT,
} from './build/pure.mjs';

const card = [
  'Two lines of ordinary lead prose.',
  '',
  'FELIX · icor-chat P3 · COMPLETE',
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
  '/Users/tom/Dev/icor-chat/src/structured/parser.ts',
  'LINKS',
  'https://github.com/myICOR/icor-chat',
  '',
  'DECISION a1b2c · plugin id',
  'Keep icor-chat or rename? Recommend keep.',
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
  assert.equal(header.scope, 'icor-chat P3');
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

test('a decision body keeps every line the model wrote', () => {
  /* This asserted `body === 'one two three'`: the parser stopped at three
     lines, which was the format's EDITORIAL bound pressed into the parser -
     and the parser is the wrong enforcer. By the time text reaches it, the
     text has been written; the cap made lines four onward cease to exist, and
     the user saw a decision ending mid-sentence with nothing to unfold. The
     bound is the renderer's now: a measured three-line clamp with a door,
     gated in the browser suite. Here, the record must be whole. */
  const doc = parseStructured([
    'DECISION a1b2c · title',
    'one', 'two', 'three', 'four', 'five',
  ].join('\n'));
  const body = decisionsOf(doc)[0].body;
  assert.equal(body, 'one two three four five');
});

test('a decision body still ends at a blank line, a header, or the next decision', () => {
  // Keeping everything must not mean eating what follows.
  const doc = parseStructured([
    'DECISION a1b2c · first',
    'its body',
    '',
    'DECISION b2c3d · second',
    'other body',
  ].join('\n'));
  const all = decisionsOf(doc);
  assert.equal(all.length, 2);
  assert.equal(all[0].body, 'its body');
  assert.equal(all[1].body, 'other body');
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

/* ============================================ the reply is not in a terminal ==
 *
 * The card format was designed for a terminal, where the model wraps its own
 * lines because nothing else will. The plugin is a resizable panel that wraps
 * text itself, so a hard-wrapped reply arrives as a row followed by the
 * leftovers of its own value. Measured on screen: a row reading "duplicate
 * fact :: the 2026-07-27 video is" with "told twice, line 53 and line 57"
 * adrift below the group as loose prose. The parser was not losing the text -
 * the model had already broken it into pieces that are not rows. */

test('a value the model hard-wrapped is still one value', () => {
  const doc = parseStructured([
    'LARRY · paco-cantero.md · PARTIAL',
    '',
    'WHAT I SEE',
    '🔴 duplicate fact :: the 2026-07-27 video is',
    'told twice, line 53 and line 57',
    '🟡 timeline order :: 2026-08-06 sits at the',
    'top, 2026-08-04 near the bottom',
  ].join('\n'));
  const card = doc.segments.find((s) => s.kind === 'card');
  const group = card.blocks.find((b) => b.kind === 'group');
  assert.equal(group.rows.length, 2, 'the wrapped lines were counted as extra rows');
  assert.equal(group.rows[0].value, 'the 2026-07-27 video is told twice, line 53 and line 57',
    'the tail of the first row was dropped out of the card');
  assert.equal(group.rows[1].value, '2026-08-06 sits at the top, 2026-08-04 near the bottom');
  // And nothing was left over as orphaned prose, which is what the reader saw.
  assert.equal(card.blocks.filter((b) => b.kind === 'prose').length, 0,
    'a fragment of a row escaped the group as loose prose');
});

test('a blank line still ends the group, so real prose is left alone', () => {
  /* The discriminator, and the only honest one available: a hard wrap has no
     blank line, a new paragraph has one. Without this the fold would eat any
     paragraph written under a group. */
  const doc = parseStructured([
    'LARRY · scope · COMPLETE',
    '',
    'WHAT I SEE',
    '🔴 duplicate fact :: told twice',
    '',
    'This is a real paragraph the author wrote under the group.',
  ].join('\n'));
  const card = doc.segments.find((s) => s.kind === 'card');
  const group = card.blocks.find((b) => b.kind === 'group');
  assert.equal(group.rows[0].value, 'told twice', 'a separated paragraph was folded into the row');
  const prose = card.blocks.find((b) => b.kind === 'prose');
  assert.ok(prose && prose.text.startsWith('This is a real paragraph'),
    'the paragraph was swallowed instead of rendered');
});

test('a row missing its :: is not silently glued to the row above', () => {
  // It carries a disposition glyph, so it is a row the author fumbled, not a
  // continuation. Folding it would hide the mistake inside another row's value.
  const doc = parseStructured([
    'LARRY · scope · COMPLETE',
    '',
    'WHAT I SEE',
    '🔴 duplicate fact :: told twice',
    '🟡 timeline order is wrong',
  ].join('\n'));
  const card = doc.segments.find((s) => s.kind === 'card');
  const group = card.blocks.find((b) => b.kind === 'group');
  assert.equal(group.rows.length, 1);
  assert.equal(group.rows[0].value, 'told twice',
    'a malformed row was absorbed into the value of the row above it');
});

test('the format tells the model it is not writing into a terminal', () => {
  /* The parser fold above is the net; this is the fix. Without it the model
     keeps wrapping, and every wrapped row depends on a heuristic to survive. */
  assert.match(STRUCTURED_REPLY_PROMPT, /not a terminal/i,
    'the prompt does not tell the model what surface it is writing into');
  assert.match(STRUCTURED_REPLY_PROMPT, /never wrap a line to\na column width/i,
    'the prompt does not forbid wrapping to a column');
  assert.match(STRUCTURED_REPLY_PROMPT, /no character limit on any line/i,
    'the prompt leaves a line-length limit the panel does not have');
  /* And it must not throw out the format's own editorial limits with the
     column rule: "at most two lines of prose" is about how much to say, which
     a wider panel does not change. */
  assert.match(STRUCTURED_REPLY_PROMPT, /editorial and still\nhold/i,
    'the no-wrap rule also cancelled the limits on how much to write');
});
