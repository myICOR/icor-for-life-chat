import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadOwnKeySettings, saveOwnKeySettings, activeApiKey, maskKey,
  DEFAULT_OWN_KEY_SETTINGS, OWN_KEY_STORAGE_KEY,
} from './build/pure.mjs';

function fakeHost(initial = null) {
  let stored = initial;
  return {
    loadLocalStorage: (key) => (key === OWN_KEY_STORAGE_KEY ? stored : null),
    saveLocalStorage: (key, data) => { if (key === OWN_KEY_STORAGE_KEY) stored = data; },
    peek: () => stored,
  };
}

test('a bare vault (nothing saved yet) reads back the defaults, never undefined', () => {
  const host = fakeHost();
  assert.deepEqual(loadOwnKeySettings(host), DEFAULT_OWN_KEY_SETTINGS);
});

test('a round trip through save then load carries every field', () => {
  const host = fakeHost();
  const settings = {
    engine: 'own-key', provider: 'openrouter',
    anthropicApiKey: 'sk-ant-abc', openrouterApiKey: 'sk-or-xyz',
    model: 'anthropic/claude-opus-5', maxTokens: 8000,
  };
  saveOwnKeySettings(host, settings);
  assert.deepEqual(loadOwnKeySettings(host), settings);
});

test('a malformed or partial stored value falls back to defaults field by field, never throws', () => {
  const host = fakeHost({ provider: 'not-a-real-provider', maxTokens: -5, engine: 'own-key' });
  const loaded = loadOwnKeySettings(host);
  assert.equal(loaded.engine, 'own-key');
  assert.equal(loaded.provider, DEFAULT_OWN_KEY_SETTINGS.provider);
  assert.equal(loaded.maxTokens, DEFAULT_OWN_KEY_SETTINGS.maxTokens);
  assert.equal(loaded.anthropicApiKey, '');
});

test('activeApiKey reads the key for whichever provider is chosen, not the other one', () => {
  const settings = { ...DEFAULT_OWN_KEY_SETTINGS, provider: 'anthropic', anthropicApiKey: 'sk-ant-1', openrouterApiKey: 'sk-or-2' };
  assert.equal(activeApiKey(settings), 'sk-ant-1');
  assert.equal(activeApiKey({ ...settings, provider: 'openrouter' }), 'sk-or-2');
});

test('maskKey never reveals the key: not the whole thing, not even an empty mask for an empty key', () => {
  assert.equal(maskKey(''), '(none)');
  assert.equal(maskKey('short'), '*****');
  const masked = maskKey('sk-ant-api03-verylongsecretvalue');
  assert.doesNotMatch(masked, /verylongsecretvalue/);
  assert.equal(masked, 'sk-a…ue');
});

test('the storage key is namespaced to this plugin, never a bare name Sync or another plugin could collide with', () => {
  assert.match(OWN_KEY_STORAGE_KEY, /^icor-for-life-chat:/);
});
