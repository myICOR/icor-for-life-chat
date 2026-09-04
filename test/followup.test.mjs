/* Follow-ups: a message sent mid-turn is queued, never a stop.
 *
 * The CLI's behaviour was measured on 2026-09-04 (the finding is at the top of
 * src/provider/claude/session.ts, twice): a second user message pushed while a turn runs
 * is answered either inside the running turn or as its own turn after it,
 * and the plugin cannot tell which at the boundary. These tests hold the
 * bookkeeping that dictates, and the one contract the old composer broke:
 * submitting while streaming does not interrupt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FOLLOW_UPS, followUpSent, turnEnded, selfStartedTurn, turnAborted,
  ChatStore,
} from './build/pure.mjs';

test('a mid-turn send counts one pending follow-up; the turn end is idle and clears the marks', () => {
  const s = followUpSent(NO_FOLLOW_UPS);
  assert.equal(s.pending, 1);
  const end = turnEnded(s);
  assert.equal(end.clearMarks, true, 'the QUEUED mark survived the turn that read it');
  assert.deepEqual(end.state, NO_FOLLOW_UPS);
});

test('a turn end with nothing pending is idle and touches no mark', () => {
  const end = turnEnded(NO_FOLLOW_UPS);
  assert.equal(end.clearMarks, false);
  assert.deepEqual(end.state, NO_FOLLOW_UPS);
});

test('a turn the CLI starts on its own re-arms the busy state, and a signal mid-turn does not', () => {
  assert.equal(selfStartedTurn(false), true, 'a self-started turn left the composer on Send');
  assert.equal(selfStartedTurn(true), false, 'a signal inside a running turn re-armed a state already armed');
});

test('two follow-ups both clear at the one turn end that read them', () => {
  const s = followUpSent(followUpSent(NO_FOLLOW_UPS));
  assert.equal(s.pending, 2);
  const end = turnEnded(s);
  assert.equal(end.clearMarks, true);
  assert.deepEqual(end.state, NO_FOLLOW_UPS);
});

test('an interrupt or an error forgets the queue', () => {
  assert.deepEqual(turnAborted(), NO_FOLLOW_UPS);
});

test('a user-turn applied while streaming is a second user-turn, not a stop', () => {
  /* The store is what the view reads to decide `queued`. Two user-turns in a
     row must both land as events: the old composer never produced the second
     one because Enter called onStop instead of onSubmit. */
  const store = new ChatStore();
  const kinds = [];
  store.subscribe((e) => kinds.push(e.kind));
  store.apply({ kind: 'user-turn', text: 'count to 30', contextNote: null, contextPath: null, images: [], stream: null });
  assert.equal(store.state.status, 'streaming');
  store.apply({ kind: 'user-turn', text: 'then say PINEAPPLE', contextNote: null, contextPath: null, images: [], queued: true, stream: null });
  assert.deepEqual(kinds, ['user-turn', 'user-turn']);
  assert.equal(store.state.status, 'streaming');
});
