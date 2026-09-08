import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadOwnKeySettings, saveOwnKeySettings,
  DEFAULT_OWN_KEY_SETTINGS, OWN_KEY_STORAGE_KEY, DEFAULT_ENV_FILE_PATH,
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
  assert.equal(DEFAULT_OWN_KEY_SETTINGS.secretsBackend, 'secret-storage', 'the keychain is the default backend');
  assert.equal(DEFAULT_OWN_KEY_SETTINGS.envFilePath, DEFAULT_ENV_FILE_PATH);
});

test('a round trip through save then load carries every field', () => {
  const host = fakeHost();
  const settings = {
    engine: 'own-key', provider: 'openrouter',
    model: 'anthropic/claude-opus-5', maxTokens: 8000,
    secretsBackend: 'env-file', envFilePath: 'secrets/.env',
  };
  saveOwnKeySettings(host, settings);
  assert.deepEqual(loadOwnKeySettings(host), settings);
});

test('a malformed or partial stored value falls back to defaults field by field, never throws', () => {
  const host = fakeHost({ provider: 'not-a-real-provider', maxTokens: -5, engine: 'own-key', secretsBackend: 'local', envFilePath: '   ' });
  const loaded = loadOwnKeySettings(host);
  assert.equal(loaded.engine, 'own-key');
  assert.equal(loaded.provider, DEFAULT_OWN_KEY_SETTINGS.provider);
  assert.equal(loaded.maxTokens, DEFAULT_OWN_KEY_SETTINGS.maxTokens);
  assert.equal(loaded.secretsBackend, 'secret-storage');
  assert.equal(loaded.envFilePath, DEFAULT_ENV_FILE_PATH, 'a blank path must fall back, never read the vault root');
});

test('the record never carries a key: a pre-0.13.0 plaintext field is neither read nor written back', () => {
  /* The key fields moved out of this record in 0.13.0 (secrets.ts owns the
     backends; main.ts migrates a leftover at load). The reader ignores them
     and the writer cannot emit them, so a save from a build that still had
     one in memory drops it rather than carrying it along. */
  const host = fakeHost({ engine: 'own-key', anthropicApiKey: 'sk-ant-plain', openrouterApiKey: 'sk-or-plain' });
  const loaded = loadOwnKeySettings(host);
  assert.equal('anthropicApiKey' in loaded, false);
  assert.equal('openrouterApiKey' in loaded, false);
  saveOwnKeySettings(host, { ...loaded, anthropicApiKey: 'smuggled' });
  assert.deepEqual(Object.keys(host.peek()).sort(), ['engine', 'envFilePath', 'maxTokens', 'model', 'provider', 'secretsBackend']);
});

test('the env file path is cleaned on the way in and out', () => {
  const host = fakeHost();
  saveOwnKeySettings(host, { ...DEFAULT_OWN_KEY_SETTINGS, envFilePath: ' ./secrets\\my.env ' });
  assert.equal(host.peek().envFilePath, 'secrets/my.env');
  assert.equal(loadOwnKeySettings(fakeHost({ envFilePath: './06 AI Team/.env' })).envFilePath, '06 AI Team/.env');
  // Vex A-1 (0.13.0): a stored path outside the vault is not cleaned into
  // the vault, it is refused, and the default takes its place on both paths.
  for (const outside of ['/06 AI Team/.env', '../.env', '~/.env']) {
    assert.equal(loadOwnKeySettings(fakeHost({ envFilePath: outside })).envFilePath, DEFAULT_OWN_KEY_SETTINGS.envFilePath, outside);
    const h = fakeHost();
    saveOwnKeySettings(h, { ...DEFAULT_OWN_KEY_SETTINGS, envFilePath: outside });
    assert.equal(h.peek().envFilePath, DEFAULT_OWN_KEY_SETTINGS.envFilePath, outside);
  }
});

test('the storage key is namespaced to this plugin, never a bare name Sync or another plugin could collide with', () => {
  assert.match(OWN_KEY_STORAGE_KEY, /^icor-for-life-chat:/);
});
