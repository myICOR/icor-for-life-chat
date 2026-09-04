/* The command picker's rules, and the status bar's geometry. Both are pure
 * functions over values, which is why they are tested here and not through a
 * browser: which names match `/ex` and how much of a pane a bar covers each
 * have exactly one right answer, and an answer with one right value belongs to
 * a script. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, filterCommands, normalizeCommands, slashQuery, overlapPx, withoutImageBytes,
} from './build/pure.mjs';

const COMMANDS = ['exit', 'execute', 'clear', 'plugin:next-export', 'compact'];

/* ---------------------------------------------------------- when it opens */

test('a leading slash opens the picker; a slash in prose never does', () => {
  assert.equal(slashQuery('/', 1), '');
  assert.equal(slashQuery('/ex', 3), 'ex');
  // The failures this rule exists for: all three contain a slash and none of
  // them is a command.
  assert.equal(slashQuery('and/or', 6), null);
  assert.equal(slashQuery('2026/08/31', 10), null);
  assert.equal(slashQuery('06 AI Team/Agents', 17), null);
});

test('the picker closes once the name is finished', () => {
  // A space means the user has moved on to the arguments, and the name they
  // typed is the name they meant.
  assert.equal(slashQuery('/close-session now', 18), null);
  assert.equal(slashQuery('/close ', 7), null);
});

test('a caret behind the word does not offer to replace text it is not in', () => {
  // Caret at 0, in front of the slash: the user is not typing a command, so
  // the picker stays shut rather than offering to rewrite the line they are
  // standing in front of.
  assert.equal(slashQuery('/exit', 0), null);
  // Caret inside the word narrows to what precedes it, never to the whole
  // word: standing after `/ex` in `/execute` offers what `/ex` offers.
  assert.equal(slashQuery('/execute', 3), 'ex');
});

/* ------------------------------------------------------------- what it shows */

test('a bare slash lists everything; typing narrows it', () => {
  assert.deepEqual(filterCommands(COMMANDS, ''), COMMANDS);
  // Tom's own example: /ex must offer exit and execute.
  const ex = filterCommands(COMMANDS, 'ex');
  assert.ok(ex.includes('exit'), 'exit missing from /ex');
  assert.ok(ex.includes('execute'), 'execute missing from /ex');
  assert.ok(!ex.includes('clear'), 'clear has no ex in it and was offered anyway');
});

test('prefix matches outrank substring matches, so the typist gets what they meant', () => {
  const out = filterCommands(COMMANDS, 'ex');
  // plugin:next-export CONTAINS 'ex' and must be reachable, but never above the
  // two names that start with it.
  assert.deepEqual(out.slice(0, 2), ['exit', 'execute']);
  assert.equal(out[2], 'plugin:next-export');
});

test('the match is case-insensitive in both directions', () => {
  assert.deepEqual(filterCommands(['Exit'], 'ex'), ['Exit']);
  assert.deepEqual(filterCommands(['exit'], 'EX'), ['exit']);
});

test('the list is capped, because the filter is the navigation', () => {
  const many = Array.from({ length: 40 }, (_, i) => `cmd-${i}`);
  assert.equal(filterCommands(many, '').length, 8);
});

test('the provider list is taken as it comes: slashes stripped, duplicates dropped', () => {
  assert.deepEqual(normalizeCommands(['/exit', 'exit', '  /clear ', '', '/']), ['exit', 'clear']);
});

test('a query that matches nothing returns nothing, and the caller closes', () => {
  assert.deepEqual(filterCommands(COMMANDS, 'zzz'), []);
});

/* ------------------------------------------------------------ what it types */

test('accepting a command leaves the caret where the arguments go', () => {
  const out = applyCommand('/ex', 'execute');
  assert.equal(out.value, '/execute ');
  assert.equal(out.caret, out.value.length);
});

test('accepting a command does not eat arguments already typed', () => {
  // The picker can be open on the name while text sits behind the caret.
  const out = applyCommand('/ex the rest', 'execute');
  assert.equal(out.value, '/execute the rest');
  // The caret lands after the name, not at the end of the line.
  assert.equal(out.caret, '/execute'.length);
});

/* -------------------------------------------------------- the status bar */

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('the pane reserves exactly the band the status bar covers', () => {
  // A 400x800 right sidebar; a 28px bar across the bottom of the window.
  const pane = rect(1000, 0, 1400, 800);
  const bar = rect(0, 772, 1400, 800);
  assert.equal(overlapPx(pane, bar), 28);
});

test('a bar that does not reach the pane costs the pane nothing', () => {
  // The defect a blanket bottom padding would have shipped: every main-area tab
  // in the vault carrying an empty band for a bar that is nowhere near it.
  const pane = rect(0, 0, 600, 800);
  const bar = rect(900, 772, 1400, 800);
  assert.equal(overlapPx(pane, bar), 0);
});

test('a bar above the pane, or hidden, reserves nothing', () => {
  const pane = rect(0, 100, 600, 800);
  assert.equal(overlapPx(pane, rect(0, 0, 600, 40)), 0, 'a bar above the pane');
  assert.equal(overlapPx(pane, rect(0, 0, 0, 0)), 0, 'a bar with no box at all');
});

test('the clearance never exceeds the pane, so the composer stays in its own leaf', () => {
  const pane = rect(0, 780, 600, 800);
  const bar = rect(0, 700, 600, 900);
  assert.equal(overlapPx(pane, bar), 20);
});

/* --------------------------------------------------------- the archive */

const turn = (images) => ({ kind: 'user-turn', text: 'what is this?', contextNote: null, images, stream: null });

test('the archive keeps the picture name and drops its bytes', () => {
  const [out] = withoutImageBytes([turn([{ name: 'shot.png', mediaType: 'image/png', data: 'AAAABBBB' }])]);
  assert.equal(out.images[0].data, '', 'a multi-megabyte base64 blob reached the vault note');
  assert.equal(out.images[0].name, 'shot.png');
  assert.equal(out.images[0].mediaType, 'image/png');
  assert.equal(out.text, 'what is this?');
});

test('redaction copies rather than mutates: the live event still draws its image', () => {
  const live = turn([{ name: 'a.png', mediaType: 'image/png', data: 'KEEP' }]);
  withoutImageBytes([live]);
  assert.equal(live.images[0].data, 'KEEP',
    'the archive pass emptied the event the stream renders from');
});

test('an event with no images is passed through untouched', () => {
  const plain = { kind: 'text-final', blockId: 'b1', text: 'hi', stream: null };
  const [out] = withoutImageBytes([plain]);
  assert.equal(out, plain);
});

/* ============================================================ @ mentions ==
 *
 * The placeholder promised "@ mentions files" and typing @ did nothing, the
 * same shape as the slash promise before it. The rules below are the picker's;
 * the interesting one is `mentionRef`, and it exists because of a measurement
 * rather than a preference. */

import { applyMention, filterMentions, mentionQuery, mentionRef } from './build/pure.mjs';

const FILES = [
  { path: 'AGENTS.md', basename: 'AGENTS' },
  { path: '06 AI Team/AI Team Knowledge/INDEX.md', basename: 'INDEX' },
  { path: '04 Inner World/INDEX.md', basename: 'INDEX' },
  { path: '04 Inner World/My Life/Goals/ship-the-plugin.md', basename: 'ship-the-plugin' },
];

test('@ opens at the start of a line and after a space, never mid-word', () => {
  assert.equal(mentionQuery('@', 1), '');
  assert.equal(mentionQuery('look at @ind', 12), 'ind');
  // The obvious way this goes wrong, and it is in every signature block.
  assert.equal(mentionQuery('tom@example.com', 15), null);
});

test('a space ends the mention, because the note is named by then', () => {
  assert.equal(mentionQuery('@INDEX and then', 15), null);
});

test('names rank above folders, so typing a name gets the name', () => {
  const out = filterMentions(FILES, 'index');
  assert.deepEqual(out.map((f) => f.basename).slice(0, 2), ['INDEX', 'INDEX']);
  // The path tier is what makes a note reachable by the folder it lives in.
  const byFolder = filterMentions(FILES, 'inner world');
  assert.ok(byFolder.some((f) => f.path.startsWith('04 Inner World')),
    'a note could not be found by the folder it lives in');
});

test('a mention that matches nothing returns nothing, and the caller closes', () => {
  assert.deepEqual(filterMentions(FILES, 'zzzz'), []);
});

/* ------------------------------------------------- the form that survives */

/* MEASURED, not chosen. Driven against the real CLI in Tom's vault on
 * 2026-08-31, asking each time whether the file actually reached the model:
 *
 *   @AGENTS.md                            arrived
 *   @.claude/hooks/no-em-dash-guard.py    arrived
 *   @06 AI Team/.../INDEX.md              NOTHING arrived
 *   @"06 AI Team/.../INDEX.md"            arrived (twice)
 *   @06\ AI\ Team/.../INDEX.md            NOTHING arrived
 *
 * A bare reference stops at the first space. Nearly every path in this vault
 * has one, so the obvious implementation would have inserted a mention that
 * looked right, sent cleanly, and delivered nothing, on almost every note. */

test('a path with a space is quoted, because a bare one delivers nothing', () => {
  assert.equal(mentionRef('06 AI Team/AI Team Knowledge/INDEX.md'),
    '@"06 AI Team/AI Team Knowledge/INDEX.md"');
});

test('a path without a space stays bare, which is the form the CLI can attach', () => {
  assert.equal(mentionRef('AGENTS.md'), '@AGENTS.md');
  assert.equal(mentionRef('.claude/hooks/no-em-dash-guard.py'), '@.claude/hooks/no-em-dash-guard.py');
});

test('every path this vault would offer survives the round trip', () => {
  // The guard against a future "simplify" that drops the quoting: any path
  // carrying whitespace must come back quoted, whatever else changes.
  for (const file of FILES) {
    const ref = mentionRef(file.path);
    if (/\s/.test(file.path)) {
      assert.ok(ref.startsWith('@"') && ref.endsWith('"'),
        `${file.path} was inserted bare and would deliver nothing`);
    } else {
      assert.equal(ref, `@${file.path}`);
    }
  }
});

/* ------------------------------------------------------------ what it types */

test('accepting a note replaces the typed word and keeps the rest of the line', () => {
  const value = 'compare @ind with the other one';
  const out = applyMention(value, 12, '06 AI Team/AI Team Knowledge/INDEX.md');
  assert.equal(out.value, 'compare @"06 AI Team/AI Team Knowledge/INDEX.md" with the other one',
    'accepting mid-sentence left a double space behind the reference');
  // The caret lands after the reference, ready for the next word.
  assert.equal(out.value.slice(out.caret), ' with the other one');
});

test('accepting a note at the end leaves a trailing space to keep typing in', () => {
  const out = applyMention('read @AG', 8, 'AGENTS.md');
  assert.equal(out.value, 'read @AGENTS.md ');
  assert.equal(out.caret, out.value.length);
});

/* ============================================================ [[ links ==
 *
 * The third source. Its rules live in test/context.test.mjs; what is asserted
 * here is that the three sources cannot both claim one caret, which is the
 * property that keeps one picker from opening two lists. */

import { wikilinkQuery } from './build/pure.mjs';

test('a caret inside [[ is a link and never a mention, even with an @ in it', () => {
  assert.equal(wikilinkQuery('see [[tom@work', 14), 'tom@work');
  assert.equal(mentionQuery('see [[tom@work', 14), null, 'the mention rule fired inside a link');
});

test('a caret inside @ is a mention and never a link', () => {
  assert.equal(mentionQuery('see @paco', 9), 'paco');
  assert.equal(wikilinkQuery('see @paco', 9), null);
});

test('a slash at column zero outranks both, because its rule is the strictest', () => {
  assert.equal(slashQuery('/ex', 3), 'ex');
  assert.equal(wikilinkQuery('/ex', 3), null);
  assert.equal(mentionQuery('/ex', 3), null);
});
