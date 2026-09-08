/* WHERE THE KEYS LIVE (0.13.0, the suite-wide secrets contract). The store
 * and the adapter are fakes; nothing here touches Obsidian or the network.
 * The contract's own points, one test each where it is a property of code:
 * ids, the backend door with no fallback, moves, presence, migration -
 * including the proof that `data.json`'s own shape has no key field to
 * migrate FROM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  BACKEND_LABEL, BACKEND_OPTIONS, DEFAULT_SETTINGS, MODEL_PROVIDER_IDS, PLUGIN_ID, SECRETS_BACKENDS, SECRET_ID_FOR,
  SECRET_ID_RULE, effectiveBackend, isSecretsBackend, keyPresence, keyStatusLine, migratePlaintextKeys,
  missingKeyMessage, moveProviderKey, otherBackend, presentIn, readProviderKey, secretStorageOf, settingsFrom,
  writeProviderKey,
} from './build/pure.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fakeStore(initial = {}) {
  const secrets = { ...initial };
  return {
    getSecret: (id) => (id in secrets ? secrets[id] : null),
    setSecret: (id, v) => { secrets[id] = v; },
    listSecrets: () => Object.keys(secrets),
    secrets,
  };
}

function fakeAdapter(files = {}) {
  const store = { ...files };
  return {
    exists: async (p) => p in store,
    read: async (p) => store[p],
    write: async (p, data) => { store[p] = data; },
    files: store,
  };
}

const ENV = '06 AI Team/AI Team Knowledge/.env';
const hostsWith = (store, files) => ({ store, env: fakeAdapter(files), envFilePath: ENV });

/* ------------------------------------------------------------------ ids */

test('secret ids are <plugin-id>-<provider>-api-key, and every one passes Obsidian\'s own id rule', () => {
  assert.equal(PLUGIN_ID, 'icor-for-life-chat');
  assert.deepEqual(SECRET_ID_FOR, {
    anthropic: 'icor-for-life-chat-anthropic-api-key',
    openrouter: 'icor-for-life-chat-openrouter-api-key',
  });
  for (const id of Object.values(SECRET_ID_FOR)) assert.match(id, SECRET_ID_RULE, `${id} would make setSecret throw`);
  assert.deepEqual(Object.keys(SECRET_ID_FOR).sort(), [...MODEL_PROVIDER_IDS].sort(), 'a provider has no id');
});

test('the ids in the README are the ids in the code', () => {
  const readme = readFileSync(resolve(repo, 'README.md'), 'utf8');
  for (const id of Object.values(SECRET_ID_FOR)) assert.ok(readme.includes(`\`${id}\``), `README does not list ${id}`);
  assert.match(readme, /## Where your keys live/);
});

test('the two backends, their labels, and the words never say "OS keychain"', () => {
  assert.deepEqual([...SECRETS_BACKENDS], ['secret-storage', 'env-file']);
  assert.ok(isSecretsBackend('env-file') && isSecretsBackend('secret-storage') && !isSecretsBackend('local'));
  for (const text of [...Object.values(BACKEND_LABEL), ...Object.values(BACKEND_OPTIONS)]) {
    assert.doesNotMatch(text, /OS keychain/i);
  }
  assert.match(BACKEND_OPTIONS['secret-storage'], /Settings, General, Keychain/);
  assert.equal(otherBackend('env-file'), 'secret-storage');
  assert.equal(otherBackend('secret-storage'), 'env-file');
});

/* ------------------------------------------------------- the store door */

test('secretStorageOf narrows structurally: a real-shaped store is found, anything else is null', () => {
  assert.equal(secretStorageOf(null), null);
  assert.equal(secretStorageOf({}), null, 'an app without secretStorage (Obsidian < 1.11.4) must read as no store');
  assert.equal(secretStorageOf({ secretStorage: {} }), null, 'an object without the two methods is not a store');
  const store = fakeStore();
  assert.equal(secretStorageOf({ secretStorage: store }), store);
});

test('below 1.11.4 the effective backend is the env file whatever the setting says', () => {
  assert.equal(effectiveBackend('secret-storage', null), 'env-file');
  assert.equal(effectiveBackend('secret-storage', fakeStore()), 'secret-storage');
  assert.equal(effectiveBackend('env-file', fakeStore()), 'env-file');
});

test('a read comes from the selected backend only; the other one is never a fallback', async () => {
  const store = fakeStore({ [SECRET_ID_FOR.anthropic]: 'sk-in-store' });
  const hosts = hostsWith(store, { [ENV]: 'OPENROUTER_API_KEY=sk-in-env\n' });
  assert.equal(await readProviderKey(hosts, 'secret-storage', 'anthropic'), 'sk-in-store');
  assert.equal(await readProviderKey(hosts, 'env-file', 'anthropic'), '', 'the env file has no Anthropic key and the store must not answer for it');
  assert.equal(await readProviderKey(hosts, 'env-file', 'openrouter'), 'sk-in-env');
  assert.equal(await readProviderKey(hosts, 'secret-storage', 'openrouter'), '', 'the store has no OpenRouter key and the env file must not answer for it');
  const noStore = hostsWith(null, { [ENV]: 'ANTHROPIC_API_KEY=sk-env\n' });
  assert.equal(await readProviderKey(noStore, 'secret-storage', 'anthropic'), '', 'no store means no key, not a silent env read');
});

test('a write lands in the selected backend, trimmed, and refuses the store when there is none', async () => {
  const store = fakeStore();
  const hosts = hostsWith(store, {});
  await writeProviderKey(hosts, 'secret-storage', 'anthropic', '  sk-1 ');
  assert.equal(store.secrets[SECRET_ID_FOR.anthropic], 'sk-1');
  await writeProviderKey(hosts, 'env-file', 'openrouter', 'sk-2');
  assert.equal(hosts.env.files[ENV], 'OPENROUTER_API_KEY=sk-2\n');
  await assert.rejects(() => writeProviderKey(hostsWith(null, {}), 'secret-storage', 'anthropic', 'x'), /no keychain/);
});

/* ---------------------------------------------------------------- moves */

test('a move copies to the new backend and blanks the old one, in both directions', async () => {
  const store = fakeStore();
  const hosts = hostsWith(store, { [ENV]: '# keep me\nANTHROPIC_API_KEY=sk-env\nOTHER=1\n' });
  assert.equal(await moveProviderKey(hosts, 'env-file', 'secret-storage', 'anthropic'), true);
  assert.equal(store.secrets[SECRET_ID_FOR.anthropic], 'sk-env');
  assert.equal(hosts.env.files[ENV], '# keep me\nANTHROPIC_API_KEY=\nOTHER=1\n', 'the old line was not blanked, or another line moved');
  assert.equal(await moveProviderKey(hosts, 'secret-storage', 'env-file', 'anthropic'), true);
  assert.equal(store.secrets[SECRET_ID_FOR.anthropic], '');
  assert.equal(hosts.env.files[ENV], '# keep me\nANTHROPIC_API_KEY=sk-env\nOTHER=1\n');
});

test('a move with nothing to move writes nothing and says so', async () => {
  const store = fakeStore();
  const hosts = hostsWith(store, {});
  assert.equal(await moveProviderKey(hosts, 'env-file', 'secret-storage', 'openrouter'), false);
  assert.deepEqual(store.secrets, {});
  assert.deepEqual(hosts.env.files, {});
  assert.equal(await moveProviderKey(hosts, 'env-file', 'env-file', 'openrouter'), false);
});

/* ------------------------------------------------------------- presence */

test('presence reports where a value exists, and the status line names it without the value', async () => {
  const store = fakeStore({ [SECRET_ID_FOR.anthropic]: 'sk-store-secret' });
  const hosts = hostsWith(store, { [ENV]: 'ANTHROPIC_API_KEY=sk-env-secret\n' });
  const both = await keyPresence(hosts, 'anthropic');
  assert.deepEqual(both, { secretStorage: true, envFile: true });
  const none = await keyPresence(hosts, 'openrouter');
  assert.deepEqual(none, { secretStorage: false, envFile: false });
  assert.equal(presentIn(both, 'env-file'), true);
  assert.equal(presentIn(none, 'secret-storage'), false);
  for (const [presence, backend] of [[both, 'secret-storage'], [both, 'env-file'], [none, 'env-file'],
    [{ secretStorage: true, envFile: false }, 'env-file'], [{ secretStorage: false, envFile: true }, 'secret-storage']]) {
    const line = keyStatusLine(presence, backend);
    assert.doesNotMatch(line, /secret/, `the status line leaked a value: ${line}`);
    assert.ok(line.length > 0);
  }
  assert.equal(keyStatusLine(none, 'env-file'), 'Not set.');
  assert.equal(keyStatusLine({ secretStorage: true, envFile: false }, 'env-file'), "Stored in Obsidian's keychain.");
  assert.match(keyStatusLine(both, 'env-file'), /both .* the env file is the one in use/);
});

test('a blanked store entry or a blanked env line reads as absent', async () => {
  const store = fakeStore({ [SECRET_ID_FOR.anthropic]: '' });
  const hosts = hostsWith(store, { [ENV]: 'ANTHROPIC_API_KEY=\n' });
  assert.deepEqual(await keyPresence(hosts, 'anthropic'), { secretStorage: false, envFile: false });
});

test('the missing-key message names the selected backend and points at the other one', () => {
  const m = missingKeyMessage('anthropic', 'secret-storage');
  assert.match(m, /No Anthropic key in Obsidian's keychain/);
  assert.match(m, /move it from the env file/);
  const e = missingKeyMessage('openrouter', 'env-file');
  assert.match(e, /No OpenRouter key in the env file/);
  assert.match(e, /move it from Obsidian's keychain/);
});

/* ------------------------------------------------------------ migration */

test('data.json has no key field to migrate: the settings shape carries none, and a real-vault fixture has none', () => {
  /* The contract's migration exists for a plaintext key that MIGHT be in
     data.json. This plugin never wrote one there: `ChatSettings` has no key
     field, `settingsFrom` invents none, and the fixture below is the field
     list of the installed plugin's data.json (0.12.1) on 2026-09-08 - names
     only, values never copied, minus `remoteControl`, a 0.12 setting this
     branch does not carry yet. If a future setting ever adds a field whose
     name says "key" or "token", this goes red and the migration gets a real
     case. */
  /* Only a STRING field can hold a key. `allowEnvApiKey` matches the name
     pattern and is a boolean toggle (spec section 4), which is exactly why the
     type is checked and not the name alone. */
  const keyish = /apikey|token|secret|password/i;
  const credentialShaped = (record) => Object.entries(record)
    .filter(([field, value]) => keyish.test(field) && typeof value === 'string')
    .map(([field]) => field);
  assert.deepEqual(credentialShaped(DEFAULT_SETTINGS), [], 'ChatSettings carries a string field named like a credential');
  const fixture = JSON.parse(readFileSync(resolve(repo, 'test/fixtures/data-json-fields.json'), 'utf8'));
  assert.deepEqual(credentialShaped(fixture), [], 'data.json carries a string field named like a credential');
  // The instrument's own control: the pre-release local-storage shape IS
  // credential-shaped, so silence above means clean, not unmeasured.
  assert.deepEqual(credentialShaped({ anthropicApiKey: 'x', allowEnvApiKey: true }), ['anthropicApiKey']);
  for (const field of Object.keys(fixture)) assert.ok(field in DEFAULT_SETTINGS, `data.json carries ${field}, which no setting owns`);
  const store = fakeStore();
  assert.deepEqual(migratePlaintextKeys(fixture, store), { moved: [], cleaned: null }, 'the migration found something in a clean data.json');
  assert.deepEqual(migratePlaintextKeys(settingsFrom(fixture), store), { moved: [], cleaned: null });
  assert.deepEqual(store.secrets, {});
});

test('a plaintext key in a stored record moves into the store and the field is dropped', () => {
  const store = fakeStore();
  const raw = { engine: 'own-key', provider: 'anthropic', anthropicApiKey: ' sk-ant-plain ', openrouterApiKey: '', model: '' };
  const result = migratePlaintextKeys(raw, store);
  assert.deepEqual(result.moved, ['anthropic']);
  assert.equal(store.secrets[SECRET_ID_FOR.anthropic], 'sk-ant-plain');
  assert.equal(SECRET_ID_FOR.openrouter in store.secrets, false, 'an empty plaintext field wrote an empty secret');
  assert.deepEqual(result.cleaned, { engine: 'own-key', provider: 'anthropic', model: '' });
  assert.equal(raw.anthropicApiKey, ' sk-ant-plain ', 'the input record was mutated');
});

test('a key already in the store is kept; the plaintext copy is still dropped', () => {
  const store = fakeStore({ [SECRET_ID_FOR.openrouter]: 'sk-or-newer' });
  const result = migratePlaintextKeys({ openrouterApiKey: 'sk-or-older' }, store);
  assert.deepEqual(result.moved, []);
  assert.equal(store.secrets[SECRET_ID_FOR.openrouter], 'sk-or-newer');
  assert.deepEqual(result.cleaned, {});
});

test('a record without the fields, or not a record at all, yields nothing to save', () => {
  const store = fakeStore();
  assert.deepEqual(migratePlaintextKeys({ engine: 'own-key' }, store), { moved: [], cleaned: null });
  assert.deepEqual(migratePlaintextKeys(null, store), { moved: [], cleaned: null });
  assert.deepEqual(migratePlaintextKeys('sk-not-a-record', store), { moved: [], cleaned: null });
  assert.deepEqual(migratePlaintextKeys(['anthropicApiKey'], store), { moved: [], cleaned: null });
  assert.deepEqual(store.secrets, {});
});

/* ------------------------------------------------------ nothing echoed */

test('no source file prints, notices or logs a key value', () => {
  /* Contract point 5: "No value ever appears in a Notice, a log or the
     console, not even masked." The masked preview `maskKey` is gone with
     this release; this reads the engine and settings sources for any
     console call at all and for a template that interpolates a key. */
  const files = ['src/engine/secrets.ts', 'src/engine/envFile.ts', 'src/engine/credentials.ts', 'src/settings/EngineSection.ts'];
  for (const f of files) {
    const text = readFileSync(resolve(repo, f), 'utf8');
    assert.doesNotMatch(text, /console\.(log|warn|error|info|debug)/, `${f} logs to the console`);
    assert.doesNotMatch(text, /maskKey|activeApiKey/, `${f} still names the retired plaintext helpers`);
    assert.doesNotMatch(text, /Notice\([^)]*\$\{(key|value|apiKey|secret)\}/, `${f} interpolates a key into a Notice`);
  }
});
