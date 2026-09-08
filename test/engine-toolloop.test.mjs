import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnKeyTurn, WriteApprovalGate } from './build/pure.mjs';

/** A minimal in-memory vault: enough for read_note / append_to_note /
 * create_note to behave like the real Vault API against fixture notes. */
function fakeToolCtx(files = {}) {
  const notes = new Map(Object.entries(files));
  const asFile = (path) => (notes.has(path) ? { path, basename: path.split('/').pop(), extension: 'md' } : null);
  return {
    vault: {
      getFileByPath: (path) => asFile(path),
      getFolderByPath: () => null,
      getRoot: () => ({ path: '', name: '', children: [] }),
      getMarkdownFiles: () => [...notes.keys()].map((p) => asFile(p)),
      read: async (file) => notes.get(file.path) ?? '',
      create: async (path, data) => { notes.set(path, data); return asFile(path); },
      append: async (file, data) => notes.set(file.path, (notes.get(file.path) ?? '') + data),
    },
    activeNote: () => null,
    selection: () => '',
    notes, // exposed for assertions
  };
}

/** A ModelProvider whose `send` plays back one scripted round of deltas per
 * call, in order - the tool loop's own round-trip count IS the round index. */
function scriptedProvider(rounds) {
  let i = 0;
  return {
    id: 'anthropic',
    displayName: 'scripted',
    async send(params) {
      const round = rounds[i];
      i += 1;
      if (!round) throw new Error(`scriptedProvider ran out of rounds at round ${i}`);
      for (const delta of round) params.onDelta(delta);
    },
  };
}

function hooksCollecting() {
  const events = [];
  return {
    events,
    onEvent: (e) => events.push(e),
    onApprovalRequest: (request) => request.resolve('deny'), // overridden per-test where needed
    onApprovalSettled: () => {},
  };
}

const config = (provider, toolCtx) => ({
  provider, toolCtx, system: 'be helpful', model: 'claude-sonnet-5', maxTokens: 512,
});

test('a plain text-only turn: text streams, and the reply lands in history for the NEXT turn', async () => {
  const provider = scriptedProvider([
    [
      { type: 'text-delta', text: 'The answer' },
      { type: 'text-delta', text: ' is 4.' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }, costUsd: 0.001 },
    ],
  ]);
  const hooks = hooksCollecting();
  const result = await runOwnKeyTurn([], 'what is 2+2', config(provider, fakeToolCtx()), hooks, new WriteApprovalGate(), new AbortController().signal);

  const kinds = hooks.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['text-open', 'text-delta', 'text-delta', 'text-final', 'turn-end']);
  assert.equal(hooks.events.find((e) => e.kind === 'text-final').text, 'The answer is 4.');
  const turnEnd = hooks.events.find((e) => e.kind === 'turn-end');
  assert.equal(turnEnd.isError, false);
  assert.equal(turnEnd.usage.inputTokens, 10);
  assert.equal(turnEnd.usage.costUsd, 0.001);

  // THE BUG THIS TEST WAS WRITTEN TO CATCH: a text-only round used to `break`
  // before the assistant's own reply was ever pushed onto `history`, so the
  // member's SECOND message would reach the model with no memory of the
  // first answer at all.
  assert.equal(result.history.length, 2, 'the assistant\'s text-only reply never made it into history');
  assert.deepEqual(result.history[0], { role: 'user', content: 'what is 2+2' });
  assert.deepEqual(result.history[1], { role: 'assistant', content: [{ type: 'text', text: 'The answer is 4.' }] });
  assert.deepEqual(result.cost, { inputTokens: 10, outputTokens: 5, estimatedUsd: 0.001 });
});

test('a read tool runs with no confirmation, and its result reaches the next round', async () => {
  const provider = scriptedProvider([
    [
      { type: 'tool-call', id: 'call_1', name: 'read_note', input: { path: 'note.md' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 0 }, costUsd: 0.002 },
    ],
    [
      { type: 'text-delta', text: 'Your note says hello.' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 30, outputTokens: 8, cacheReadTokens: 0 }, costUsd: 0.003 },
    ],
  ]);
  const hooks = hooksCollecting();
  hooks.onApprovalRequest = () => assert.fail('read_note must never ask for confirmation');
  const toolCtx = fakeToolCtx({ 'note.md': 'hello world' });
  const result = await runOwnKeyTurn([], 'what does my note say', config(provider, toolCtx), hooks, new WriteApprovalGate(), new AbortController().signal);

  const toolCall = hooks.events.find((e) => e.kind === 'tool-call');
  assert.equal(toolCall.name, 'read_note');
  assert.equal(toolCall.target, 'note.md');
  assert.equal(toolCall.purpose, 'Read note.md');
  const toolResult = hooks.events.find((e) => e.kind === 'tool-result');
  assert.equal(toolResult.ok, true);
  assert.match(toolResult.output, /hello world/);

  // Cost accumulates ACROSS both rounds of the one turn.
  assert.deepEqual(result.cost, { inputTokens: 50, outputTokens: 13, estimatedUsd: 0.005 });
  assert.equal(result.history.length, 4, 'user, assistant(tool_use), user(tool_result), assistant(text)');
  assert.match(result.history[2].content[0].content, /hello world/);
});

test('a write tool asks once; "allow-always" opens the gate for the rest of the SESSION, not just the call', async () => {
  const toolCtx = fakeToolCtx();
  const gate = new WriteApprovalGate();
  let approvalRequests = 0;

  const provider1 = scriptedProvider([
    [
      { type: 'tool-call', id: 'call_1', name: 'create_note', input: { path: 'new.md', content: 'hi' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
    [
      { type: 'text-delta', text: 'Created.' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
  ]);
  const hooks1 = hooksCollecting();
  hooks1.onApprovalRequest = (request) => { approvalRequests += 1; request.resolve('allow-always'); };
  await runOwnKeyTurn([], 'make a note', config(provider1, toolCtx), hooks1, gate, new AbortController().signal);
  assert.equal(approvalRequests, 1);
  assert.equal(toolCtx.notes.get('new.md'), 'hi');
  assert.equal(gate.isOpen, true);

  // A SECOND, separate call to runOwnKeyTurn (the member's next message) with
  // the SAME gate: no prompt this time.
  const provider2 = scriptedProvider([
    [
      { type: 'tool-call', id: 'call_2', name: 'append_to_note', input: { path: 'new.md', text: ' more' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
    [
      { type: 'text-delta', text: 'Appended.' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
  ]);
  const hooks2 = hooksCollecting();
  hooks2.onApprovalRequest = () => assert.fail('the gate should already be open on the second write of the session');
  await runOwnKeyTurn([], 'add more', config(provider2, toolCtx), hooks2, gate, new AbortController().signal);
  assert.equal(toolCtx.notes.get('new.md'), 'hi more');
});

test('denying a write tool skips execution and tells the model it was denied', async () => {
  const toolCtx = fakeToolCtx();
  const provider = scriptedProvider([
    [
      { type: 'tool-call', id: 'call_1', name: 'create_note', input: { path: 'refused.md', content: 'x' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
    [
      { type: 'text-delta', text: 'OK, not creating it.' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 }, costUsd: null },
    ],
  ]);
  const hooks = hooksCollecting();
  hooks.onApprovalRequest = (request) => request.resolve('deny');
  const result = await runOwnKeyTurn([], 'make a note', config(provider, toolCtx), hooks, new WriteApprovalGate(), new AbortController().signal);

  assert.equal(toolCtx.notes.has('refused.md'), false);
  const toolResult = hooks.events.find((e) => e.kind === 'tool-result');
  assert.equal(toolResult.ok, false);
  assert.equal(toolResult.detail, 'Denied by the user');
  const resultMessage = result.history[2];
  assert.equal(resultMessage.content[0].isError, true);
  assert.match(resultMessage.content[0].content, /Denied/);
});

test('an already-aborted signal ends the turn immediately with no model call at all', async () => {
  const provider = { id: 'anthropic', displayName: 'x', async send() { assert.fail('the provider must not be called once aborted'); } };
  const controller = new AbortController();
  controller.abort();
  const hooks = hooksCollecting();
  await runOwnKeyTurn([], 'hi', config(provider, fakeToolCtx()), hooks, new WriteApprovalGate(), controller.signal);
  assert.deepEqual(hooks.events.map((e) => e.kind), ['aborted']);
});

test('a provider round that never asks a tool, forever, is stopped after the round cap and reported', async () => {
  const rounds = [];
  for (let i = 0; i < 20; i += 1) {
    rounds.push([
      { type: 'tool-call', id: `call_${i}`, name: 'list_folder', input: { path: '' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, costUsd: null },
    ]);
  }
  const provider = scriptedProvider(rounds);
  const hooks = hooksCollecting();
  const result = await runOwnKeyTurn([], 'loop forever', config(provider, fakeToolCtx()), hooks, new WriteApprovalGate(), new AbortController().signal);
  const turnEnd = hooks.events.find((e) => e.kind === 'turn-end');
  assert.ok(turnEnd, 'no turn-end was ever emitted - the loop never stopped');
  assert.equal(turnEnd.isError, true);
  assert.ok(hooks.events.some((e) => e.kind === 'error' && /Stopped after/.test(e.message)));
  assert.equal(result.cost.inputTokens, 12, 'expected exactly MAX_TOOL_ROUNDS (12) rounds to have run');
});
