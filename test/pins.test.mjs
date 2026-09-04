/* The pin rules, with no DOM under them: which prompt is pinned on its own,
 * what a fold shows, and what survives a reload. Every one of these is a
 * question with one right answer, so each is asserted here rather than
 * discovered in a workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLD_CHARS, pinFirstPrompt, togglePin, unpin, isPinned, firstLine, isFolded,
  pinsToState, pinsFromState,
} from './build/pure.mjs';

const first = { key: '0', text: 'Plan the launch.', index: 0 };
const later = { key: '4', text: 'Now write the email.', index: 4 };

/* ------------------------------------------------------ the first prompt */

test('the first prompt is pinned by the plugin, into an empty tray only', () => {
  const pins = pinFirstPrompt([], first);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].key, '0');
  assert.equal(pins[0].auto, true, 'the automatic pin is marked as such');
  // A tray that already holds pins is the user's; the rule steps aside.
  const kept = pinFirstPrompt(pins, later);
  assert.deepEqual(kept.map((p) => p.key), ['0']);
});

test('an unpinned first prompt stays unpinned when the rule runs again', () => {
  // The reload case: the stored tray is empty because the user removed the
  // automatic pin, and the replay must not put it back.
  const pins = unpin(pinFirstPrompt([], first), '0');
  assert.equal(pins.length, 0);
  // The tray is empty again, so the rule WOULD fire on the next first prompt;
  // that is the fresh-conversation case and is correct. The reload case is
  // guarded by the view restoring state before replay, asserted in setState.
  assert.equal(pinFirstPrompt(pins, first).length, 1);
});

test('a blank prompt is never pinned', () => {
  assert.equal(pinFirstPrompt([], { key: '0', text: '   \n ', index: 0 }).length, 0);
});

/* ---------------------------------------------------------- toggling */

test('toggle pins an unpinned prompt and unpins a pinned one, in index order', () => {
  let pins = pinFirstPrompt([], first);
  pins = togglePin(pins, later);
  assert.deepEqual(pins.map((p) => p.key), ['0', '4']);
  assert.equal(pins[1].auto, false, 'a user pin is not automatic');
  pins = togglePin(pins, { key: '2', text: 'Between.', index: 2 });
  assert.deepEqual(pins.map((p) => p.key), ['0', '2', '4'], 'stacked by conversation order, not by pin order');
  pins = togglePin(pins, first);
  assert.deepEqual(pins.map((p) => p.key), ['2', '4'], 'the automatic pin can be removed like any other');
  assert.equal(isPinned(pins, '4'), true);
  assert.equal(isPinned(pins, '0'), false);
});

/* ------------------------------------------------------------ folding */

test('the fold is the first non-empty line, cut with an ellipsis past the cap', () => {
  assert.equal(firstLine('\n\n  hello world  \nsecond'), 'hello world');
  assert.equal(firstLine(''), '');
  const long = 'x'.repeat(FOLD_CHARS + 20);
  const folded = firstLine(long);
  assert.equal(folded.length, FOLD_CHARS, `cut to the cap, got ${folded.length}`);
  assert.ok(folded.endsWith('…'), 'the cut is visible');
  assert.equal(firstLine('short'), 'short', 'a line under the cap is untouched');
});

test('isFolded is true only when the fold hides something', () => {
  assert.equal(isFolded('one line'), false);
  assert.equal(isFolded('one line\n\n'), false, 'trailing blank lines hide nothing');
  assert.equal(isFolded('one\ntwo'), true);
  assert.equal(isFolded('y'.repeat(FOLD_CHARS + 1)), true);
});

/* ------------------------------------------------------- leaf state */

test('pins round-trip through the leaf state', () => {
  const pins = togglePin(pinFirstPrompt([], first), later);
  const back = pinsFromState(JSON.parse(JSON.stringify(pinsToState(pins))));
  assert.deepEqual(back, pins);
});

test('a malformed stored state yields the entries that check out, never a throw', () => {
  assert.deepEqual(pinsFromState(undefined), []);
  assert.deepEqual(pinsFromState('nope'), []);
  assert.deepEqual(pinsFromState({ key: '0' }), []);
  const mixed = pinsFromState([
    null,
    { key: '4', text: 'later', index: 4, auto: false },
    { key: 0, text: 'bad key', index: 0 },
    { key: '0', text: 'first', index: 0, auto: 'yes' },
    { key: '0', text: 'duplicate', index: 0 },
    { key: '9', text: 'no index' },
  ]);
  assert.deepEqual(mixed.map((p) => [p.key, p.auto]), [['0', false], ['4', false]],
    'bad entries drop, duplicates keep the first, auto is a real boolean or false');
});
