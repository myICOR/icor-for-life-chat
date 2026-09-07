/* The own-key engine's per-reply cost line: pure text formatting, so it is
 * tested the same way `shortAge` / `shortDuration` already are. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownKeyCostLine } from './build/pure.mjs';

test('a fraction of a cent keeps four decimal places, so it does not round to zero', () => {
  assert.equal(ownKeyCostLine(0.0042), 'about 0.0042 USD');
  assert.equal(ownKeyCostLine(0.00034), 'about 0.0003 USD');
});

test('a cent or more rounds to cent precision', () => {
  assert.equal(ownKeyCostLine(0.02), 'about 0.02 USD');
  assert.equal(ownKeyCostLine(1.2), 'about 1.20 USD');
});

test('exactly the boundary (0.01) takes the cent-precision branch', () => {
  assert.equal(ownKeyCostLine(0.01), 'about 0.01 USD');
});

test('zero is a real, measured zero-cost reply, not the absent case - that is null, handled by the caller', () => {
  // `appendOwnKeyCostLine` never calls this function with null; it returns
  // before formatting anything. This function's own contract is narrower:
  // given a number, format it. 0 is a legitimate number (e.g. an entirely
  // cache-served turn priced at zero) and must not be special-cased away.
  assert.equal(ownKeyCostLine(0), 'about 0.0000 USD');
});
