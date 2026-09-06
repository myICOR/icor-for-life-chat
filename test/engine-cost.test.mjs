import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAnthropicCost, anthropicModelDisplayName } from './build/pure.mjs';

function close(a, b) {
  assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);
}

test('Sonnet 5 prices at $2/$10 per million tokens, checked against docs.anthropic.com/pricing 2026-09-06', () => {
  close(estimateAnthropicCost('claude-sonnet-5', 1_000_000, 1_000_000, 0), 12);
  close(estimateAnthropicCost('claude-sonnet-5', 24, 12, 0), 0.000168);
});

test('a dated snapshot id still matches its family by prefix', () => {
  close(
    estimateAnthropicCost('claude-sonnet-5-20260914', 1_000_000, 0, 0),
    estimateAnthropicCost('claude-sonnet-5', 1_000_000, 0, 0),
  );
});

test('cache-read tokens bill at the lower rate, not the base input rate', () => {
  const withCache = estimateAnthropicCost('claude-sonnet-5', 0, 0, 1_000_000);
  close(withCache, 0.2);
  assert.ok(withCache < estimateAnthropicCost('claude-sonnet-5', 1_000_000, 0, 0));
});

test('an unpriced model returns null, never a guessed number', () => {
  assert.equal(estimateAnthropicCost('some-future-model', 100, 100, 0), null);
  assert.equal(anthropicModelDisplayName('some-future-model'), null);
});

test('Opus prices higher than Sonnet, Haiku lower - the three rows stay ordered', () => {
  const opus = estimateAnthropicCost('claude-opus-5', 1_000_000, 1_000_000, 0);
  const sonnet = estimateAnthropicCost('claude-sonnet-5', 1_000_000, 1_000_000, 0);
  const haiku = estimateAnthropicCost('claude-haiku-4-5', 1_000_000, 1_000_000, 0);
  assert.ok(haiku < sonnet && sonnet < opus, `expected haiku < sonnet < opus, got ${haiku} ${sonnet} ${opus}`);
});
