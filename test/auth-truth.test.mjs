/* The desktop auth-truth line (`chat-mobile-engine-spec-v1.md` section 4):
 * pure functions over measured facts, tested the same way `cli.ts`'s
 * resolution rules are - no session, no Obsidian, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authTruthLine, describeAuthTruth } from './build/pure.mjs';

test('a session that has answered reads its own words, subscription or key', () => {
  assert.deepEqual(describeAuthTruth(true, 'subscription'), { kind: 'subscription' });
  assert.deepEqual(describeAuthTruth(true, 'api-key'), { kind: 'api-key' });
  assert.equal(authTruthLine(describeAuthTruth(true, 'subscription')), 'Signed in through Claude Code: subscription');
  assert.equal(
    authTruthLine(describeAuthTruth(true, 'api-key')),
    'Signed in through Claude Code: API key (billed per use)',
  );
});

test('not found outranks an unknown auth source - it is never called "not signed in" from a guess', () => {
  // Detection.signedIn is ALWAYS null for Claude (only a live session can
  // ever know that); found === false is the one thing detection CAN say,
  // and the words say exactly that, not more.
  const state = describeAuthTruth(false, 'unknown');
  assert.deepEqual(state, { kind: 'not-found' });
  assert.match(authTruthLine(state), /not signed in on this computer/);
  assert.doesNotMatch(authTruthLine(state), /subscription|API key/);
});

test('before any session has connected, the line says so honestly rather than guessing', () => {
  const state = describeAuthTruth(true, 'unknown');
  assert.deepEqual(state, { kind: 'unknown' });
  assert.match(authTruthLine(state), /send a message/i);
  // It may ASK which one it is; it must never CLAIM to already know.
  assert.doesNotMatch(authTruthLine(state), /Code: subscription|Code: API key \(billed/);
});

test('found undefined (detection has not run yet) is treated the same as found, never as not-found', () => {
  // `found` is `boolean | undefined`; only an EXPLICIT `false` may ever
  // produce "not-found" - an absent measurement is not a negative one.
  assert.deepEqual(describeAuthTruth(undefined, 'unknown'), { kind: 'unknown' });
  assert.deepEqual(describeAuthTruth(undefined, 'subscription'), { kind: 'subscription' });
});

test('the four states are exhaustive and each has exactly one line', () => {
  const kinds = ['not-found', 'unknown', 'subscription', 'api-key'];
  const lines = kinds.map((kind) => authTruthLine({ kind }));
  assert.equal(new Set(lines).size, 4, 'two states share a line');
  for (const line of lines) assert.ok(line.length > 0);
});
