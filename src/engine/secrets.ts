/* WHERE A PROVIDER KEY LIVES, and the one door through which it is read,
 * written and moved. The suite-wide contract (task tsk-2026-09-08-005, from
 * Flint's 2026-09-08 secret-storage verdict) in code:
 *
 *   - Two backends. `secret-storage` is Obsidian's own keychain
 *     (`app.secretStorage`, Obsidian 1.11.4 and newer; the values show under
 *     Settings, General, Keychain). `env-file` is one `KEY=value` file in
 *     the vault (`envFile.ts`). The member picks one; the plugin reads THAT
 *     one and never the other, because a silent fallback is how a
 *     misconfiguration hides until the day it bills the wrong account.
 *   - On an Obsidian below 1.11.4 there is no store, so the effective
 *     backend is the env file whatever the setting says; the settings tab
 *     shows the dropdown disabled and says why.
 *   - Secret ids are `<plugin-id>-<key>`, lowercase with dashes, because the
 *     store is shared by every plugin in the vault (and across vaults on a
 *     phone), so a bare `anthropic` would be anyone's.
 *   - Moving a key between backends is an explicit button: copy to the new
 *     one, blank the old one. Switching the dropdown moves nothing.
 *   - Migration on load: a plaintext key found in a stored record (the
 *     pre-release local-storage shape, or `data.json` should one ever be
 *     written there) goes into the store and the field is blanked. Never
 *     the other way round.
 *
 * Pure on purpose. The store and the adapter arrive as parameters shaped by
 * two small interfaces, so `test/engine-secrets.test.mjs` runs all of it
 * without Obsidian; the ONE place the real `App` is touched is
 * `secretStorageOf`, which narrows structurally rather than through the
 * `App` type - the directory scanner's `no-unsupported-api` rule resolves
 * `App.secretStorage` to its 1.11.4 `@since` and would convict a typed
 * access against the 1.8.7 floor, and the floor is right: the plugin runs
 * there, it just has no keychain there. */

import { PLUGIN_ID } from '../constants';
import { ENV_KEY_FOR, readEnvKey, writeEnvKey } from './envFile';
import type { EnvFileHost } from './envFile';
import { MODEL_PROVIDER_IDS, MODEL_PROVIDER_NAMES } from './registry';
import type { ModelProviderId } from './types';

export type SecretsBackend = 'secret-storage' | 'env-file';

export const SECRETS_BACKENDS: readonly SecretsBackend[] = ['secret-storage', 'env-file'];

export function isSecretsBackend(value: unknown): value is SecretsBackend {
  return value === 'secret-storage' || value === 'env-file';
}

/** The words the settings tab and every message use for each backend.
 * "Obsidian's keychain" is Obsidian's own label for the section; never "the
 * OS keychain", which is only half true on desktop and false on a phone. */
export const BACKEND_LABEL: Record<SecretsBackend, string> = {
  'secret-storage': "Obsidian's keychain",
  'env-file': 'the env file',
};

/** The dropdown's own rows. */
export const BACKEND_OPTIONS: Record<SecretsBackend, string> = {
  'secret-storage': "Obsidian's keychain (Settings, General, Keychain)",
  'env-file': 'An env file in the vault',
};

/** `<plugin-id>-<provider>-api-key`, the contract's id shape. Listed in the
 * README so a member can find them under Settings, General, Keychain. */
export const SECRET_ID_FOR: Record<ModelProviderId, string> = {
  anthropic: `${PLUGIN_ID}-anthropic-api-key`,
  openrouter: `${PLUGIN_ID}-openrouter-api-key`,
};

/** Obsidian's own rule for an id, from the app bundle: lowercase
 * alphanumerics and dashes, at most 64 characters. `setSecret` throws on
 * anything else, so the ids are checked here by a test rather than found
 * wrong at runtime. */
export const SECRET_ID_RULE = /^[a-z0-9-]{1,64}$/;

/** The two calls the plugin makes on `app.secretStorage`. */
export interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

/** `app.secretStorage` when this Obsidian has one, else null. Structural
 * narrow, see the header for why it is not typed through `App`. */
export function secretStorageOf(app: unknown): SecretStore | null {
  if (typeof app !== 'object' || app === null) return null;
  const candidate = (app as { secretStorage?: unknown }).secretStorage;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const store = candidate as { getSecret?: unknown; setSecret?: unknown };
  if (typeof store.getSecret !== 'function' || typeof store.setSecret !== 'function') return null;
  return candidate as SecretStore;
}

/** Everything a read, write or move needs: the store (null below 1.11.4),
 * the vault adapter, and the env file's vault-relative path. */
export interface KeyHosts {
  store: SecretStore | null;
  env: EnvFileHost;
  envFilePath: string;
}

/** The backend that is actually read: the chosen one, or the env file when
 * this Obsidian has no keychain to choose. */
export function effectiveBackend(chosen: SecretsBackend, store: SecretStore | null): SecretsBackend {
  return store ? chosen : 'env-file';
}

export async function readProviderKey(hosts: KeyHosts, backend: SecretsBackend, provider: ModelProviderId): Promise<string> {
  if (backend === 'secret-storage') return (hosts.store?.getSecret(SECRET_ID_FOR[provider]) ?? '').trim();
  return (await readEnvKey(hosts.env, hosts.envFilePath, ENV_KEY_FOR[provider])).trim();
}

export async function writeProviderKey(
  hosts: KeyHosts,
  backend: SecretsBackend,
  provider: ModelProviderId,
  value: string,
): Promise<void> {
  if (backend === 'secret-storage') {
    if (!hosts.store) throw new Error('This Obsidian has no keychain; choose the env file instead.');
    hosts.store.setSecret(SECRET_ID_FOR[provider], value.trim());
    return;
  }
  await writeEnvKey(hosts.env, hosts.envFilePath, ENV_KEY_FOR[provider], value);
}

/** Copies the key from `from` to `to`, then blanks `from`. False when there
 * was nothing to move; the caller says so in words and nothing is written. */
export async function moveProviderKey(
  hosts: KeyHosts,
  from: SecretsBackend,
  to: SecretsBackend,
  provider: ModelProviderId,
): Promise<boolean> {
  if (from === to) return false;
  const value = await readProviderKey(hosts, from, provider);
  if (!value) return false;
  await writeProviderKey(hosts, to, provider, value);
  await writeProviderKey(hosts, from, provider, '');
  return true;
}

/** Where a value exists for one provider, one flag per backend. */
export interface KeyPresence {
  secretStorage: boolean;
  envFile: boolean;
}

export async function keyPresence(hosts: KeyHosts, provider: ModelProviderId): Promise<KeyPresence> {
  const [inStore, inEnv] = await Promise.all([
    hosts.store ? readProviderKey(hosts, 'secret-storage', provider) : Promise.resolve(''),
    readProviderKey(hosts, 'env-file', provider),
  ]);
  return { secretStorage: inStore.length > 0, envFile: inEnv.length > 0 };
}

export function presentIn(presence: KeyPresence, backend: SecretsBackend): boolean {
  return backend === 'secret-storage' ? presence.secretStorage : presence.envFile;
}

export function otherBackend(backend: SecretsBackend): SecretsBackend {
  return backend === 'secret-storage' ? 'env-file' : 'secret-storage';
}

/** The per-key status sentence the settings tab shows. Never a value, never
 * a length, never a masked fragment - only where one exists. */
export function keyStatusLine(presence: KeyPresence, backend: SecretsBackend): string {
  if (presence.secretStorage && presence.envFile) {
    return `Stored in both Obsidian's keychain and the env file; ${BACKEND_LABEL[backend]} is the one in use.`;
  }
  if (presence.secretStorage) return "Stored in Obsidian's keychain.";
  if (presence.envFile) return 'Stored in the env file.';
  return 'Not set.';
}

/** What the settings tab and the chat say when the selected backend holds
 * no key for the provider. Names the backend, so a key sitting in the other
 * one is found rather than retyped. */
export function missingKeyMessage(provider: ModelProviderId, backend: SecretsBackend): string {
  const where = backend === 'secret-storage' ? "Obsidian's keychain on this device" : 'the env file';
  return `No ${MODEL_PROVIDER_NAMES[provider]} key in ${where}. Add one under Settings, AI engine on this device, or move it from ${BACKEND_LABEL[otherBackend(backend)]}.`;
}

/* ------------------------------------------------------------ migration */

/** The field names the pre-release local-storage record carried a key
 * under. Read here for migration only; nothing writes them any more. */
const PLAINTEXT_FIELD_FOR: Record<ModelProviderId, string> = {
  anthropic: 'anthropicApiKey',
  openrouter: 'openrouterApiKey',
};

export interface PlaintextMigration {
  /** Providers whose key went into the store on this pass. */
  moved: ModelProviderId[];
  /** The record with every plaintext key field removed, or null when the
   * record had none and there is nothing to save back. */
  cleaned: Record<string, unknown> | null;
}

/**
 * Moves any plaintext key in `raw` into `store` and returns the record
 * without those fields. A key already in the store is kept as it is (the
 * store is the newer fact); the plaintext copy is dropped either way, so
 * one load is enough to leave no key in a synced or plaintext file. Empty
 * strings count as absent. `raw` that is not a record yields nothing.
 */
export function migratePlaintextKeys(raw: unknown, store: SecretStore): PlaintextMigration {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { moved: [], cleaned: null };
  const record = raw as Record<string, unknown>;
  const moved: ModelProviderId[] = [];
  let touched = false;
  const cleaned: Record<string, unknown> = { ...record };
  for (const provider of MODEL_PROVIDER_IDS) {
    const field = PLAINTEXT_FIELD_FOR[provider];
    if (!(field in record)) continue;
    touched = true;
    const value = record[field];
    if (typeof value === 'string' && value.trim()) {
      const existing = (store.getSecret(SECRET_ID_FOR[provider]) ?? '').trim();
      if (!existing) {
        store.setSecret(SECRET_ID_FOR[provider], value.trim());
        moved.push(provider);
      }
    }
    delete cleaned[field];
  }
  return { moved, cleaned: touched ? cleaned : null };
}
