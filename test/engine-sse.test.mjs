import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer, isDoneSentinel } from './build/pure.mjs';

test('a complete frame parses, named event and all', () => {
  const { frames, remainder } = parseSseBuffer('event: message_start\ndata: {"a":1}\n\n');
  assert.deepEqual(frames, [{ event: 'message_start', data: '{"a":1}' }]);
  assert.equal(remainder, '');
});

test('an unnamed frame (OpenRouter shape) still parses', () => {
  const { frames } = parseSseBuffer('data: {"a":1}\n\n');
  assert.deepEqual(frames, [{ event: null, data: '{"a":1}' }]);
});

test('a frame split across two network reads is never dropped', () => {
  const first = parseSseBuffer('event: content_block_delta\ndata: {"a"');
  assert.deepEqual(first.frames, []);
  assert.equal(first.remainder, 'event: content_block_delta\ndata: {"a"');
  const second = parseSseBuffer(`${first.remainder}:1}\n\n`);
  assert.deepEqual(second.frames, [{ event: 'content_block_delta', data: '{"a":1}' }]);
});

test('multiple complete frames in one chunk all parse, in order', () => {
  const { frames, remainder } = parseSseBuffer('data: {"a":1}\n\ndata: {"a":2}\n\ndata: {"a":3}\n\n');
  assert.deepEqual(frames.map((f) => f.data), ['{"a":1}', '{"a":2}', '{"a":3}']);
  assert.equal(remainder, '');
});

test('CRLF line endings parse the same as LF', () => {
  const { frames } = parseSseBuffer('event: ping\r\ndata: {"a":1}\r\n\r\n');
  assert.deepEqual(frames, [{ event: 'ping', data: '{"a":1}' }]);
});

test('a comment-only or field-only frame carries no data and yields nothing', () => {
  const { frames } = parseSseBuffer(': keep-alive\n\nretry: 3000\n\n');
  assert.deepEqual(frames, []);
});

test('multi-line data joins with a newline, per the SSE spec', () => {
  const { frames } = parseSseBuffer('data: line one\ndata: line two\n\n');
  assert.deepEqual(frames, [{ event: null, data: 'line one\nline two' }]);
});

test('the [DONE] sentinel is recognised and nothing else is', () => {
  assert.equal(isDoneSentinel('[DONE]'), true);
  assert.equal(isDoneSentinel(' [DONE] '), true);
  assert.equal(isDoneSentinel('{"a":1}'), false);
});
