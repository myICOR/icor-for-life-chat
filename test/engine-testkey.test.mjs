import test from 'node:test';
import assert from 'node:assert/strict';
import { testProviderKey } from './build/pure.mjs';

const signal = new AbortController().signal;

function transportsReturning(status, bodyText = '') {
  return {
    async *stream() { throw new Error('testKey must never stream'); },
    async requestFull() { return { status, bodyText }; },
  };
}

test('no key yet is reported without making any call', async () => {
  const transports = { async *stream() { throw new Error('must not be called'); }, async requestFull() { throw new Error('must not be called'); } };
  const result = await testProviderKey('anthropic', '', transports, signal);
  assert.equal(result.ok, false);
  assert.match(result.message, /no key/i);
});

test('a 2xx from Anthropic reads as success, in plain words', async () => {
  const result = await testProviderKey('anthropic', 'sk-ant-1', transportsReturning(200, '{}'), signal);
  assert.equal(result.ok, true);
  assert.match(result.message, /works/i);
});

test('a 401 from Anthropic reads as a rejected key, not a generic failure', async () => {
  const result = await testProviderKey('anthropic', 'sk-ant-bad', transportsReturning(401, ''), signal);
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
});

test('a 429 from either provider still counts as a working key', async () => {
  const anthropic = await testProviderKey('anthropic', 'sk-ant-1', transportsReturning(429, ''), signal);
  assert.equal(anthropic.ok, true);
  const openrouter = await testProviderKey('openrouter', 'sk-or-1', transportsReturning(429, ''), signal);
  assert.equal(openrouter.ok, true);
});

test('a 402 from OpenRouter reads as "no credit", not a generic error', async () => {
  const result = await testProviderKey('openrouter', 'sk-or-1', transportsReturning(402, ''), signal);
  assert.equal(result.ok, false);
  assert.match(result.message, /credit/i);
});

test('a thrown network error is caught and reported, never an unhandled rejection', async () => {
  const transports = { async *stream() { throw new Error('n/a'); }, async requestFull() { throw new Error('offline'); } };
  const result = await testProviderKey('openrouter', 'sk-or-1', transports, signal);
  assert.equal(result.ok, false);
  assert.match(result.message, /offline/);
});
