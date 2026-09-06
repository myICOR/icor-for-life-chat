/* Fixtures under test/fixtures/ownkey-openrouter-*.{txt,json} are BUILT FROM
 * OpenRouter's own documented chat-completions streaming/response shapes
 * (openrouter.ai/docs), checked 2026-09-06 via Perplexity against their live
 * docs - not recorded from a live call, this environment has no OpenRouter
 * key. No live call is made anywhere in this file. Flagged for Vex/Felix: a
 * real device/key pass should replace these with an actually-recorded stream. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createOpenRouterProvider } from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(here, 'fixtures', name), 'utf8');

const TEXT_STREAM = read('ownkey-openrouter-text-stream.txt');
const TOOLCALL_STREAM = read('ownkey-openrouter-toolcall-stream.txt');
const FULL_RESPONSE = read('ownkey-openrouter-full.json');

async function* chunked(text, size = 41) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
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

test('a plain text reply streams as deltas and reads OpenRouter\'s own reported cost', async () => {
  const deltas = [];
  const provider = createOpenRouterProvider('sk-or-test', streamOnly(TEXT_STREAM));
  await provider.send({
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
    tools: [], system: '', model: 'anthropic/claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const text = deltas.filter((d) => d.type === 'text-delta').map((d) => d.text).join('');
  assert.equal(text, 'The capital of France is Paris.');
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.equal(stop.stopReason, 'end_turn');
  assert.equal(stop.usage.inputTokens, 18);
  assert.equal(stop.usage.outputTokens, 9);
  // OpenRouter reports its own cost; this adapter never computes one itself.
  assert.ok(Math.abs(stop.costUsd - 0.00034) < 1e-9, `costUsd was ${stop.costUsd}`);
});

test('tool-call arguments streamed across several fragments still arrive as ONE whole call', async () => {
  const deltas = [];
  const provider = createOpenRouterProvider('sk-or-test', streamOnly(TOOLCALL_STREAM));
  await provider.send({
    messages: [{ role: 'user', content: 'what is in my inner world folder?' }],
    tools: [], system: '', model: 'anthropic/claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const toolCalls = deltas.filter((d) => d.type === 'tool-call');
  assert.equal(toolCalls.length, 1, 'fragmented function.arguments produced more than one tool-call delta');
  assert.deepEqual(toolCalls[0], { type: 'tool-call', id: 'call_abc', name: 'list_folder', input: { path: '04 Inner World' } });
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.equal(stop.stopReason, 'tool_use');
  assert.equal(stop.usage.inputTokens, 210);
  assert.equal(stop.usage.outputTokens, 14);
  assert.ok(Math.abs(stop.costUsd - 0.0009) < 1e-9);
});

test('when streaming fails before anything was emitted, it falls back to the non-streaming call', async () => {
  const deltas = [];
  const provider = createOpenRouterProvider('sk-or-test', fallbackTo(200, FULL_RESPONSE));
  await provider.send({
    messages: [{ role: 'user', content: 'what note is open?' }],
    tools: [], system: '', model: 'anthropic/claude-sonnet-5', maxTokens: 512, signal,
    onDelta: (d) => deltas.push(d),
  });
  const toolCall = deltas.find((d) => d.type === 'tool-call');
  assert.deepEqual(toolCall, { type: 'tool-call', id: 'call_xyz', name: 'current_note', input: {} });
  const stop = deltas.find((d) => d.type === 'message-stop');
  assert.equal(stop.usage.inputTokens, 50);
  assert.equal(stop.usage.outputTokens, 5);
  assert.ok(Math.abs(stop.costUsd - 0.0002) < 1e-9);
});

test('a fallback that also fails reports the vendor error in plain words', async () => {
  const deltas = [];
  const provider = createOpenRouterProvider(
    'sk-or-bad',
    fallbackTo(402, JSON.stringify({ error: { message: 'Insufficient credits' } })),
  );
  await provider.send({
    messages: [{ role: 'user', content: 'hi' }], tools: [], system: '', model: 'anthropic/claude-sonnet-5', maxTokens: 8, signal,
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].type, 'error');
  assert.match(deltas[0].message, /Insufficient credits/);
});

test('a requestFull call that throws outright still ends in an error delta, never an unhandled rejection', async () => {
  const deltas = [];
  const provider = createOpenRouterProvider('sk-or-test', {
    async *stream() {
      throw new Error('no stream here');
      // eslint-disable-next-line no-unreachable
      yield '';
    },
    async requestFull() {
      throw new Error('network is down');
    },
  });
  await provider.send({
    messages: [{ role: 'user', content: 'hi' }], tools: [], system: '', model: 'anthropic/claude-sonnet-5', maxTokens: 8, signal,
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].type, 'error');
  assert.match(deltas[0].message, /network is down/);
});
