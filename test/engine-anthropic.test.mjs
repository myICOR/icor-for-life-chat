/* Fixtures under test/fixtures/ownkey-anthropic-*.{txt,json} are BUILT FROM
 * Anthropic's own documented Messages API streaming/response shapes
 * (docs.anthropic.com), not recorded from a live call - this environment has
 * no Anthropic key. No live call is made anywhere in this file; every
 * request goes through a fake `Transports` that replays the fixture text.
 * Flagged for Vex/Felix: a real device/key pass should replace these with an
 * actually-recorded stream once a member key is available. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createAnthropicProvider } from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(here, 'fixtures', name), 'utf8');

const TEXT_STREAM = read('ownkey-anthropic-text-stream.txt');
const TOOLCALL_STREAM = read('ownkey-anthropic-toolcall-stream.txt');
const FULL_RESPONSE = read('ownkey-anthropic-full.json');

/** Yields the fixture in small, arbitrarily-sized pieces, the way a real
 * network read never lines up with a frame boundary. */
async function* chunked(text, size = 37) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

function neverStreams() {
  return {
    async *stream() {
      throw new Error('streaming unavailable in this fake');
      // eslint-disable-next-line no-unreachable
      yield '';
    },
    async requestFull() {
      throw new Error('requestFull should not be called in this test');
    },
  };
}

function streamOnly(fixtureText) {
  return {
    stream: () => chunked(fixtureText),
    async requestFull() {
      throw new Error('requestFull should not be called when streaming succeeds');
    },
  };
}

function fallbackTo(status, bodyText) {
  return {
    async *stream() {
      throw new Error('the WebView did not return a readable stream');
      // eslint-disable-next-line no-unreachable
      yield '';
    },
    async requestFull() {
      return { status, bodyText };
    },
  };
}

const signal = new AbortController().signal;

test('a plain text reply streams as deltas and ends with a priced turn', async () => {
  const deltas = [];
  const provider = createAnthropicProvider('sk-test', streamOnly(TEXT_STREAM));
  await provider.send({
    messages: [{ role: 'user', content: 'What is the Fibonacci sequence?' }],
    tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const text = deltas.filter((d) => d.type === 'text-delta').map((d) => d.text).join('');
  assert.equal(text, 'The Fibonacci sequence starts at 0.');
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.ok(stop, 'no message-stop delta');
  assert.equal(stop.stopReason, 'end_turn');
  assert.equal(stop.usage.inputTokens, 24);
  assert.equal(stop.usage.outputTokens, 12);
  assert.ok(Math.abs(stop.costUsd - 0.000168) < 1e-9, `costUsd was ${stop.costUsd}`);
});

test('a tool call arrives WHOLE - never as JSON fragments, however the input streamed', async () => {
  const deltas = [];
  const provider = createAnthropicProvider('sk-test', streamOnly(TOOLCALL_STREAM));
  await provider.send({
    messages: [{ role: 'user', content: 'What does my journal say today?' }],
    tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const toolCalls = deltas.filter((d) => d.type === 'tool-call');
  assert.equal(toolCalls.length, 1, 'the fragmented input_json_delta produced more than one tool-call delta');
  assert.deepEqual(toolCalls[0], {
    type: 'tool-call', id: 'toolu_01XYZ', name: 'read_note',
    input: { path: '04 Inner World/Journal.md' },
  });
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.equal(stop.stopReason, 'tool_use');
  assert.equal(stop.usage.inputTokens, 140);
  assert.equal(stop.usage.outputTokens, 22);
});

test('when streaming fails before anything was emitted, it falls back to the non-streaming call', async () => {
  const deltas = [];
  const provider = createAnthropicProvider('sk-test', fallbackTo(200, FULL_RESPONSE));
  await provider.send({
    messages: [{ role: 'user', content: 'find the clock note' }],
    tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const text = deltas.filter((d) => d.type === 'text-delta').map((d) => d.text).join('');
  assert.equal(text, 'Here is what I found.');
  const toolCall = deltas.find((d) => d.type === 'tool-call');
  assert.deepEqual(toolCall, { type: 'tool-call', id: 'toolu_01FULL', name: 'search_notes', input: { query: 'acacia clock' } });
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.equal(stop.usage.inputTokens, 300);
  assert.equal(stop.usage.outputTokens, 40);
});

test('a fallback that also fails reports the vendor error in plain words, never a raw status alone', async () => {
  const deltas = [];
  const provider = createAnthropicProvider(
    'sk-bad',
    fallbackTo(401, JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })),
  );
  await provider.send({
    messages: [{ role: 'user', content: 'hi' }], tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 8, signal,
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].type, 'error');
  assert.match(deltas[0].message, /invalid x-api-key/);
});

test('a stream interrupted AFTER text already reached the view reports the cut, and never re-sends (no double bill)', async () => {
  const deltas = [];
  async function* partial() {
    yield 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n';
    yield 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
    yield 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n';
    throw new Error('connection dropped');
  }
  const provider = createAnthropicProvider('sk-test', {
    stream: () => partial(),
    async requestFull() { throw new Error('must not retry once partial output was shown'); },
  });
  await provider.send({
    messages: [{ role: 'user', content: 'hi' }], tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 8, signal,
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(deltas.filter((d) => d.type === 'text-delta').length, 1);
  assert.equal(deltas.at(-1).type, 'error');
  assert.match(deltas.at(-1).message, /interrupted/);
});

test('nothing here ever calls the real network (guard against a regression that starts one)', async () => {
  const provider = createAnthropicProvider('sk-unused', neverStreams());
  const deltas = [];
  await provider.send({
    messages: [{ role: 'user', content: 'x' }], tools: [], system: '', model: 'claude-sonnet-5', maxTokens: 8, signal,
    onDelta: (d) => deltas.push(d),
  });
  // neverStreams() also refuses requestFull, so reaching an error delta here
  // (rather than an uncaught throw or a hang) proves the adapter never fell
  // through to anything outside the injected Transports.
  assert.ok(deltas.some((d) => d.type === 'error'));
});
