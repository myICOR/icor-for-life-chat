/* PER-DEVICE STORAGE. `chat-mobile-engine-spec-v1.md` section 3: "Where keys
 * live: per device ... never in `data.json`. `data.json` replicates through
 * Obsidian Sync; a key must never ride along. Same rule Vex applies to
 * Connect's tokens."
 *
 * Since 0.13.0 the KEYS THEMSELVES are no longer in this record at all.
 * They live in one of two backends (`secrets.ts`): Obsidian's keychain, or
 * an env file in the vault. What stays here is the "AI engine on this
 * device" block - the engine choice, the provider choice, the model, the
 * budget, and now WHICH backend holds the keys and where the env file is.
 * Those are per-device facts on purpose (a phone has its own key and, on an
 * Obsidian without a keychain, its own backend; Tom's Mac keeps using the
 * desktop engine), so splitting "the key stays local" from "the choice
 * syncs" would still let a synced default silently switch a member's phone
 * onto an engine, or a backend, with no key behind it.
 *
 * Only a TYPE import from 'obsidian' (`App`, erased at build time), never a
 * value one - `LocalStorageHost` is the two methods this file actually calls,
 * so a real `App` satisfies it without a cast and this file stays out of
 * `src/provider/` entirely and in the pure test bundle. */

import { PLUGIN_ID } from '../constants';
import type { ModelProviderId } from './types';
import { isModelProviderId } from './registry';
import { DEFAULT_ENV_FILE_PATH, cleanVaultPath } from './envFile';
import { isSecretsBackend } from './secrets';
import type { SecretsBackend } from './secrets';

export const OWN_KEY_STORAGE_KEY = `${PLUGIN_ID}:own-key-engine:v1`;

export type EngineChoice = 'claude-code' | 'own-key';

export interface OwnKeySettings {
  engine: EngineChoice;
  provider: ModelProviderId;
  /** Empty = the provider's own default (`DEFAULT_MODEL_FOR` in registry.ts). */
  model: string;
  /** Max output tokens per reply. Section 3's budget guard; default 4,000. */
  maxTokens: number;
  /** Which backend holds the provider keys. `secret-storage` out of the box;
   * `effectiveBackend` in secrets.ts turns it into `env-file` on an Obsidian
   * that has no keychain. */
  secretsBackend: SecretsBackend;
  /** The env-file backend's file, vault-relative. */
  envFilePath: string;
}

export const DEFAULT_OWN_KEY_SETTINGS: OwnKeySettings = {
  engine: 'claude-code',
  provider: 'anthropic',
  model: '',
  maxTokens: 4000,
  secretsBackend: 'secret-storage',
  envFilePath: DEFAULT_ENV_FILE_PATH,
};

export interface LocalStorageHost {
  loadLocalStorage(key: string): unknown;
  /** Obsidian's own `App` types this `unknown | null`; `null` is already a
   * member of `unknown`, so the narrower `unknown` here is the same type. */
  saveLocalStorage(key: string, data: unknown): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Untyped JSON from local storage becomes settings here, and nowhere else -
 * the same one-function-owns-the-shape rule `settingsFrom` follows for
 * `data.json` in `model/settings.ts`. Every missing or malformed field falls
 * back to its default rather than propagating `undefined` into a request.
 * A pre-0.13.0 record's `anthropicApiKey` / `openrouterApiKey` fields are
 * NOT read here: `migratePlaintextKeys` in secrets.ts moves them into the
 * store at load and drops them, and this reader never learns they existed. */
export function loadOwnKeySettings(app: LocalStorageHost): OwnKeySettings {
  const raw = app.loadLocalStorage(OWN_KEY_STORAGE_KEY);
  const partial = isRecord(raw) ? raw : {};
  const provider = isModelProviderId(partial.provider) ? partial.provider : DEFAULT_OWN_KEY_SETTINGS.provider;
  const envFilePath = typeof partial.envFilePath === 'string' ? cleanVaultPath(partial.envFilePath) : '';
  return {
    engine: partial.engine === 'own-key' ? 'own-key' : DEFAULT_OWN_KEY_SETTINGS.engine,
    provider,
    model: typeof partial.model === 'string' ? partial.model : '',
    maxTokens:
      typeof partial.maxTokens === 'number' && Number.isFinite(partial.maxTokens) && partial.maxTokens > 0
        ? Math.trunc(partial.maxTokens)
        : DEFAULT_OWN_KEY_SETTINGS.maxTokens,
    secretsBackend: isSecretsBackend(partial.secretsBackend) ? partial.secretsBackend : DEFAULT_OWN_KEY_SETTINGS.secretsBackend,
    envFilePath: envFilePath || DEFAULT_OWN_KEY_SETTINGS.envFilePath,
  };
}

/** Writes the record. The shape is `OwnKeySettings` and only that: a caller
 * cannot smuggle a key field in here, which is the point of the type. */
export function saveOwnKeySettings(app: LocalStorageHost, settings: OwnKeySettings): void {
  const record: OwnKeySettings = {
    engine: settings.engine,
    provider: settings.provider,
    model: settings.model,
    maxTokens: settings.maxTokens,
    secretsBackend: settings.secretsBackend,
    envFilePath: cleanVaultPath(settings.envFilePath) || DEFAULT_OWN_KEY_SETTINGS.envFilePath,
  };
  app.saveLocalStorage(OWN_KEY_STORAGE_KEY, record);
}
