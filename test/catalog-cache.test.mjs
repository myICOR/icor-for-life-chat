import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogCache, catalogFor, withCatalog, launchModelFor } from './build/pure.mjs';

const opus = { value: 'opus', displayName: 'Opus', description: 'the big one', supportedEffortLevels: ['low', 'high'] };
const gpt = { value: 'gpt-5', displayName: 'GPT-5', description: '', supportedEffortLevels: null };

test('the cache keeps only measured, well-formed rows and drops the rest without repair', () => {
  const raw = {
    claude: { models: [opus, { value: '', displayName: 'nameless' }, 'junk'], measuredAt: '2026-09-06T10:00:00.000Z' },
    codex: { models: [gpt], measuredAt: 12 },
    stray: 'not an entry',
  };
  const cache = parseCatalogCache(raw);
  assert.deepEqual(Object.keys(cache), ['claude']);
  assert.deepEqual(catalogFor(cache, 'claude'), [opus]);
  assert.equal(catalogFor(cache, 'codex'), null, 'a malformed stamp is a missing entry');
  assert.deepEqual(parseCatalogCache(null), {});
  assert.deepEqual(parseCatalogCache([opus]), {});
});

test('a report replaces the runtime entry with a stamp; an empty report changes nothing', () => {
  const now = new Date('2026-09-06T12:34:56.000Z');
  const one = withCatalog({}, 'codex', [gpt], now);
  assert.deepEqual(one.codex, { models: [gpt], measuredAt: '2026-09-06T12:34:56.000Z' });
  const same = withCatalog(one, 'codex', [], new Date());
  assert.equal(same, one, 'nothing measured, nothing stored');
  const two = withCatalog(one, 'codex', [opus], now);
  assert.deepEqual(two.codex.models, [opus], 'replaced, never merged');
  assert.deepEqual(one.codex.models, [gpt], 'the old cache is not mutated');
  // A round trip through disk is the same cache.
  assert.deepEqual(parseCatalogCache(JSON.parse(JSON.stringify(two))), two);
});

test('the launch carries the pane pick over the settings value, and empty means the runtime default', () => {
  assert.equal(launchModelFor('opus', 'sonnet'), 'opus');
  assert.equal(launchModelFor(null, 'sonnet'), 'sonnet');
  assert.equal(launchModelFor(null, ''), '');
  assert.equal(launchModelFor('', 'sonnet'), '', 'a pick of "default" is honoured as the runtime default');
});
