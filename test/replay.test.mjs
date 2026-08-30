/* Resume replay. The bug it closes: a resumed tab painted nothing while the
 * model behind it still remembered the whole conversation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { userTextOf, Normalizer } from './build/pure.mjs';

const userMsg = (content, extra = {}) => ({
  type: 'user', uuid: 'u', session_id: 's', parent_tool_use_id: null,
  message: { role: 'user', content }, ...extra,
});

test('a typed message yields its text, string or block form alike', () => {
  assert.equal(userTextOf(userMsg('hello there')), 'hello there');
  assert.equal(userTextOf(userMsg([{ type: 'text', text: 'hello there' }])), 'hello there');
});

test('multiple text blocks join in order', () => {
  assert.equal(
    userTextOf(userMsg([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }])),
    'first\nsecond',
  );
});

test('a tool result is the transport answering, never a person typing', () => {
  assert.equal(userTextOf(userMsg([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }])), null);
  // Even mixed with text: this shape is a tool answer, and a well would lie.
  assert.equal(
    userTextOf(userMsg([{ type: 'text', text: 'x' }, { type: 'tool_result', tool_use_id: 't' }])),
    null,
  );
});

test('a subagent message never becomes a well in the main transcript', () => {
  assert.equal(userTextOf(userMsg('inner', { parent_tool_use_id: 'toolu_1' })), null);
});

test('empty and whitespace-only messages produce nothing', () => {
  assert.equal(userTextOf(userMsg('')), null);
  assert.equal(userTextOf(userMsg('   \n  ')), null);
  assert.equal(userTextOf(userMsg([])), null);
  assert.equal(userTextOf(userMsg([{ type: 'text', text: '  ' }])), null);
});

test('assistant and system messages are never user wells', () => {
  assert.equal(userTextOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }), null);
  assert.equal(userTextOf({ type: 'system', subtype: 'init' }), null);
  assert.equal(userTextOf(null), null);
  assert.equal(userTextOf('text'), null);
});

test('a replayed assistant message renders through the same normalizer', () => {
  const n = new Normalizer();
  const out = n.normalize({
    type: 'assistant', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
  });
  const finals = out.filter((e) => e.kind === 'text-final');
  assert.equal(finals.length, 1);
  assert.equal(finals[0].text, 'the answer');
});

test('a replayed tool call and its result pair up exactly as a live one does', () => {
  const n = new Normalizer();
  const call = n.normalize({
    type: 'assistant', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.md' } }] },
  });
  assert.equal(call.filter((e) => e.kind === 'tool-call').length, 1);
  const result = n.normalize({
    type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  });
  assert.equal(result.filter((e) => e.kind === 'tool-result').length, 1);
  // And that same message must not also become a user well.
  assert.equal(userTextOf({
    type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  }), null);
});
