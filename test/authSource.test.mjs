/* The SDK's own `apiKeySource` mapped onto the plugin's neutral `AuthSource`.
 * Anything outside the five documented values - including `"none"`, measured
 * live in this build's own orchestrated environment on 2026-09-06 - reads as
 * 'unknown', never as a guess in either direction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authSourceFromApiKeySource } from './build/pure.mjs';

test('oauth is a subscription', () => {
  assert.equal(authSourceFromApiKeySource('oauth'), 'subscription');
});

test('user, project, org and temporary are all a literal API key', () => {
  for (const raw of ['user', 'project', 'org', 'temporary']) {
    assert.equal(authSourceFromApiKeySource(raw), 'api-key', raw);
  }
});

test('anything outside the documented union reads as unknown, never as a guess', () => {
  for (const raw of ['none', '', undefined, null, 42, {}, 'OAuth', 'Oauth ']) {
    assert.equal(authSourceFromApiKeySource(raw), 'unknown', JSON.stringify(raw));
  }
});
