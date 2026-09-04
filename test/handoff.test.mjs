/* The AI Chat side of the terminal hand-off, asserted against the contract in
 * icor-terminal/docs/handoff.md: the state shape verbatim, the conservative
 * guard's leaf walk, and the reasons the hand-off is off. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERMINAL_VIEW_TYPE, TERMINAL_PLUGIN_ID, terminalState, leafHoldsSession, handoffUnavailableReason,
} from './build/pure.mjs';

/* The chat view type as the terminal restores it; stored in workspace.json, so a literal. */
const VIEW_TYPE_CHAT = 'icor-chat-view';

test('the terminal view type and plugin id are the contract\'s', () => {
  assert.equal(TERMINAL_VIEW_TYPE, 'icor-for-life-terminal');
  assert.equal(TERMINAL_PLUGIN_ID, 'icor-for-life-terminal');
});

test('the hand-off state is the contract\'s section 2, verbatim, with the way back', () => {
  const id = 'd6c87af6-1111-4222-8333-444455556666';
  assert.deepEqual(terminalState(id, '/Users/x/vault', 'claude'), {
    resumeSessionId: id,
    cwd: '/Users/x/vault',
    launch: 'claude',
    profile: null,
    returnTo: { type: VIEW_TYPE_CHAT, state: { resumeSessionId: id, provider: 'claude' } },
  });
  assert.equal(VIEW_TYPE_CHAT, 'icor-chat-view', 'the returnTo type is the chat view type the terminal restores');
});

test('the conservative guard walks terminal leaves by id, case-blind, and never matches nothing', () => {
  const leaves = [
    { resumeSessionId: 'D6C87AF6-1111-4222-8333-444455556666' },
    { resumeSessionId: null },
    { resumeSessionId: 42 },
  ];
  assert.equal(leafHoldsSession(leaves, 'd6c87af6-1111-4222-8333-444455556666'), true);
  assert.equal(leafHoldsSession(leaves, 'other'), false);
  assert.equal(leafHoldsSession(leaves, ''), false);
  assert.equal(leafHoldsSession([], 'd6c87af6-1111-4222-8333-444455556666'), false);
});

test('the hand-off is off for the right reason: not installed first, then not Claude, then no session', () => {
  const id = 'd6c87af6-1111-4222-8333-444455556666';
  assert.equal(handoffUnavailableReason('claude', id, false), 'Install ICOR for Life - Terminal');
  assert.equal(handoffUnavailableReason('codex', id, true), 'Terminal hand-off is for Claude Code conversations');
  assert.match(handoffUnavailableReason('claude', null, true), /Send a message first/);
  assert.equal(handoffUnavailableReason('claude', id, true), null);
});
