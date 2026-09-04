/* Follow-ups: a message sent mid-turn is queued, never a stop.
 *
 * The CLI's behaviour was measured on 2026-09-04 (the finding is at the top of
 * src/sdk/session.ts): a second user message pushed while a turn runs is
 * answered as its own turn after the running one, in the same session. These
 * tests hold the bookkeeping that behaviour dictates, and the one contract the
 * old composer broke: submitting while streaming does not interrupt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FOLLOW_UPS, followUpSent, turnEnded, queuedTurnBegan, turnAborted,
  ChatStore,
} from './build/pure.mjs';

test('a mid-turn send counts one pending follow-up; the turn end keeps the session busy', () => {
  let s = followUpSent(NO_FOLLOW_UPS);
  assert.equal(s.pending, 1);
  const end = turnEnded(s);
  assert.equal(end.stillBusy, true, 'the composer flipped to Send with a follow-up still queued');
  assert.deepEqual(end.state, { pending: 0, awaitingNext: true });
});

test('a turn end with nothing pending is idle', () => {
  const end = turnEnded(NO_FOLLOW_UPS);
  assert.equal(end.stillBusy, false);
  assert.deepEqual(end.state, NO_FOLLOW_UPS);
});

test('the queued mark clears exactly once, on the first signal of the queued turn', () => {
  const s = turnEnded(followUpSent(NO_FOLLOW_UPS)).state;
  const first = queuedTurnBegan(s);
  assert.equal(first.clearOne, true);
  const second = queuedTurnBegan(first.state);
  assert.equal(second.clearOne, false, 'a second signal in the same turn cleared a second mark');
});

test('two follow-ups drain one turn boundary at a time', () => {
  let s = followUpSent(followUpSent(NO_FOLLOW_UPS));
  let end = turnEnded(s);
  assert.equal(end.stillBusy, true);
  s = queuedTurnBegan(end.state).state;
  end = turnEnded(s);
  assert.equal(end.stillBusy, true, 'the second follow-up was forgotten at the first boundary');
  s = queuedTurnBegan(end.state).state;
  end = turnEnded(s);
  assert.equal(end.stillBusy, false);
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
