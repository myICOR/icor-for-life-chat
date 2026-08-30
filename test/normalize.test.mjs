/* Stream normalization: the quiet correctness that is cheap to assert here and
 * expensive to discover in a live conversation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Normalizer, toolTarget, resultDetail } from './build/pure.mjs';

const partial = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' });
const assistant = (content, id = 'msg_1') => ({
  type: 'assistant',
  message: { id, role: 'assistant', content, usage: {} },
  parent_tool_use_id: null,
  uuid: 'u',
  session_id: 's',
});

test('unknown and future SDK message types are ignored, never thrown', () => {
  const n = new Normalizer();
  for (const raw of [
    { type: 'some_future_event', payload: 1 },
    { type: 'system', subtype: 'a_new_subtype' },
    { type: 'stream_event', event: { type: 'not_a_real_event' }, parent_tool_use_id: null },
    null, undefined, 42, 'text', [],
  ]) {
    assert.deepEqual(n.normalize(raw), []);
  }
});

test('a tool whose input arrives in fragments emits exactly one complete call', () => {
  const n = new Normalizer();
  n.normalize(partial({ type: 'message_start', message: { id: 'msg_1' } }));
  n.normalize(partial({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Write' } }));
  for (const frag of ['{"file_', 'path":"/a/b', '.md","content":"x"}']) {
    assert.deepEqual(
      n.normalize(partial({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: frag } })),
      [],
      'a partial tool input must produce no event',
    );
  }
  const events = n.normalize(assistant([
    { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/a/b.md', content: 'x' } },
  ]));
  const calls = events.filter((e) => e.kind === 'tool-call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, '/a/b.md');
});

test('a result that arrives before its call still names that call', () => {
  const n = new Normalizer();
  const early = n.normalize({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }] },
    parent_tool_use_id: null,
  });
  assert.equal(early.length, 1);
  assert.equal(early[0].kind, 'tool-result');
  assert.equal(early[0].toolUseId, 't9');
});

test('an interrupted turn keeps the text received so far', () => {
  const n = new Normalizer();
  n.normalize(partial({ type: 'message_start', message: { id: 'msg_2' } }));
  n.normalize(partial({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  const a = n.normalize(partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'half ' } }));
  const b = n.normalize(partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a sen' } }));
  assert.equal(a[0].text, 'half ');
  assert.equal(b[0].text, 'a sen');
  assert.equal(a[0].blockId, b[0].blockId, 'deltas of one block must share an id');
});

test('the token figure is the whole turn, not the last message of it', () => {
  const n = new Normalizer();
  const [end] = n.normalize({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    result: 'done',
    total_cost_usd: 0.02,
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 60,
    },
  });
  assert.equal(end.kind, 'turn-end');
  assert.equal(end.usage.inputTokens, 160);
  assert.equal(end.usage.cacheReadTokens, 900);
  assert.equal(end.usage.totalTokens, 1100);
  assert.equal(end.usage.costUsd, 0.02);
});

test('a compaction boundary renders once, with its own numbers', () => {
  const n = new Normalizer();
  const out = n.normalize({
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'auto', pre_tokens: 150000, post_tokens: 20000 },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'compact-boundary');
  assert.equal(out[0].preTokens, 150000);
});

test('plan-usage facts come only from a real rate_limit_event', () => {
  const n = new Normalizer();
  assert.deepEqual(n.normalize({ type: 'rate_limit_event' }), [], 'no info, no fact');
  const [e] = n.normalize({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.82, resetsAt: 123 },
  });
  assert.equal(e.facts.window, 'five_hour');
  assert.equal(e.facts.utilization, 0.82);
  assert.equal(e.facts.status, 'allowed_warning');
});

test('an unrecognised rate-limit window degrades to unknown, never to a guess', () => {
  const n = new Normalizer();
  const [e] = n.normalize({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'thirty_day' } });
  assert.equal(e.facts.window, 'unknown');
  assert.equal(e.facts.utilization, null);
});

test('the first-party task events drive the subagent lifecycle', () => {
  const n = new Normalizer();
  const started = n.normalize({
    type: 'system', subtype: 'task_started', task_id: 'tk1', tool_use_id: 'toolu_1',
    description: 'find the thing', subagent_type: 'pax', prompt: 'go and find it',
  });
  assert.equal(started.length, 1);
  assert.equal(started[0].kind, 'subagent-start');
  assert.equal(started[0].agentId, 'toolu_1');
  assert.equal(started[0].agentType, 'pax');
  assert.equal(started[0].task, 'go and find it');
  const done = n.normalize({
    type: 'system', subtype: 'task_notification', task_id: 'tk1', tool_use_id: 'toolu_1',
    status: 'completed', output_file: '', summary: '',
  });
  assert.equal(done[0].kind, 'subagent-end');
  assert.equal(done[0].ok, true);
});

test('a failed task closes the subagent as failed, not as done', () => {
  const n = new Normalizer();
  n.normalize({ type: 'system', subtype: 'task_started', task_id: 'tk', tool_use_id: 't', description: '', subagent_type: 'x' });
  const [end] = n.normalize({ type: 'system', subtype: 'task_notification', tool_use_id: 't', status: 'failed' });
  assert.equal(end.ok, false);
});

test('the spawn tool opens a subagent whatever the CLI calls it', () => {
  for (const name of ['Task', 'Agent']) {
    const n = new Normalizer();
    const out = n.normalize(assistant([
      { type: 'tool_use', id: 'a1', name, input: { subagent_type: 'pax', description: 'd' } },
    ]));
    assert.equal(out.filter((e) => e.kind === 'subagent-start').length, 1, name);
  }
});

test('the two spawn signals never open the same agent twice, in either order', () => {
  const first = new Normalizer();
  first.normalize({ type: 'system', subtype: 'task_started', tool_use_id: 'x1', description: 'd', subagent_type: 'pax' });
  const afterEvent = first.normalize(assistant([
    { type: 'tool_use', id: 'x1', name: 'Agent', input: { subagent_type: 'pax', description: 'd' } },
  ]));
  assert.equal(afterEvent.filter((e) => e.kind === 'subagent-start').length, 0);

  // This is the order the live CLI actually uses: the tool_use lands first.
  const second = new Normalizer();
  const fromTool = second.normalize(assistant([
    { type: 'tool_use', id: 'x2', name: 'Agent', input: { subagent_type: 'pax', description: 'd', prompt: 'go' } },
  ]));
  assert.equal(fromTool.filter((e) => e.kind === 'subagent-start').length, 1);
  assert.equal(fromTool.find((e) => e.kind === 'subagent-start').task, 'go');
  const afterTool = second.normalize({
    type: 'system', subtype: 'task_started', tool_use_id: 'x2', description: 'd', subagent_type: 'pax',
  });
  assert.equal(afterTool.length, 0);
});

test('a spawn opens a subagent and its result closes it, once each', () => {
  const n = new Normalizer();
  const spawn = n.normalize(assistant([
    { type: 'tool_use', id: 'task1', name: 'Task', input: { subagent_type: 'pax', description: 'research' } },
  ]));
  assert.equal(spawn.filter((e) => e.kind === 'subagent-start').length, 1);
  const done = n.normalize({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'task1', content: 'report' }] },
    parent_tool_use_id: null,
  });
  assert.equal(done.filter((e) => e.kind === 'subagent-end').length, 1);
  const again = n.normalize({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'task1', content: 'report' }] },
    parent_tool_use_id: null,
  });
  assert.equal(again.filter((e) => e.kind === 'subagent-end').length, 0, 'a subagent closes once');
});

test('concurrent subagents keep their own transcripts', () => {
  const n = new Normalizer();
  n.normalize(assistant([
    { type: 'tool_use', id: 'a', name: 'Task', input: { subagent_type: 'pax', description: 'one' } },
    { type: 'tool_use', id: 'b', name: 'Task', input: { subagent_type: 'quinn', description: 'two' } },
  ]));
  const fromA = n.normalize({ ...assistant([{ type: 'text', text: 'hi' }], 'm_a'), parent_tool_use_id: 'a' });
  const fromB = n.normalize({ ...assistant([{ type: 'text', text: 'yo' }], 'm_b'), parent_tool_use_id: 'b' });
  assert.equal(fromA[0].stream, 'a');
  assert.equal(fromB[0].stream, 'b');
});

test('tool targets are one line, never a JSON dump', () => {
  assert.equal(toolTarget('Bash', { command: 'ls -la' }), 'ls -la');
  assert.equal(toolTarget('Grep', { pattern: 'foo' }), 'foo');
  assert.equal(toolTarget('TodoWrite', { todos: [1, 2] }), '');
  assert.equal(toolTarget('SomeMcpTool', { url: 'https://x' }), 'https://x');
});

test('a tool result gloss is the first line, bounded', () => {
  assert.equal(resultDetail('one\ntwo'), 'one');
  assert.equal(resultDetail([{ type: 'text', text: 'first\nsecond' }]), 'first');
  assert.equal(resultDetail('x'.repeat(400)).length, 160);
  assert.equal(resultDetail(undefined), '');
});
