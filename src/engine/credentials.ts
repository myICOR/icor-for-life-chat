/* PER-DEVICE STORAGE. `chat-mobile-engine-spec-v1.md` section 3: "Where keys
 * live: per device, in `app.saveLocalStorage`, never in `data.json`.
 * `data.json` replicates through Obsidian Sync; a key must never ride along.
 * Same rule Vex applies to Connect's tokens."
 *
 * Everything in this file - the whole "AI engine on this device" block, not
 * only the keys - lives here rather than in `ChatSettings`/`data.json` on
 * purpose: the engine choice and provider choice are themselves per-device
 * facts (a phone has its own key; Tom's Mac keeps using the desktop engine),
 * so splitting "the key stays local" from "the choice syncs" would still let
 * a synced default silently switch a member's phone onto an engine with no
 * key behind it.
 *
 * Only a TYPE import from 'obsidian' (`App`, erased at build time), never a
 * value one - `LocalStorageHost` is the two methods this file actually calls,
 * so a real `App` satisfies it without a cast and this file stays out of
 * `src/provider/` entirely and in the pure test bundle. */

import { PLUGIN_ID } from '../constants';
import type { ModelProviderId } from './types';
import { isModelProviderId } from './registry';

export const OWN_KEY_STORAGE_KEY = `${PLUGIN_ID}:own-key-engine:v1`;

export type EngineChoice = 'claude-code' | 'own-key';

export interface OwnKeySettings {
  engine: EngineChoice;
  provider: ModelProviderId;
  anthropicApiKey: string;
  openrouterApiKey: string;
  /** Empty = the provider's own default (`DEFAULT_MODEL_FOR` in registry.ts). */
  model: string;
  /** Max output tokens per reply. Section 3's budget guard; default 4,000. */
  maxTokens: number;
}

export const DEFAULT_OWN_KEY_SETTINGS: OwnKeySettings = {
  engine: 'claude-code',
  provider: 'anthropic',
  anthropicApiKey: '',
  openrouterApiKey: '',
  model: '',
  maxTokens: 4000,
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
 * back to its default rather than propagating `undefined` into a request. */
export function loadOwnKeySettings(app: LocalStorageHost): OwnKeySettings {
  const raw = app.loadLocalStorage(OWN_KEY_STORAGE_KEY);
  const partial = isRecord(raw) ? raw : {};
  const provider = isModelProviderId(partial.provider) ? partial.provider : DEFAULT_OWN_KEY_SETTINGS.provider;
  return {
    engine: partial.engine === 'own-key' ? 'own-key' : DEFAULT_OWN_KEY_SETTINGS.engine,
    provider,
    anthropicApiKey: typeof partial.anthropicApiKey === 'string' ? partial.anthropicApiKey : '',
    openrouterApiKey: typeof partial.openrouterApiKey === 'string' ? partial.openrouterApiKey : '',
    model: typeof partial.model === 'string' ? partial.model : '',
    maxTokens:
      typeof partial.maxTokens === 'number' && Number.isFinite(partial.maxTokens) && partial.maxTokens > 0
        ? Math.trunc(partial.maxTokens)
        : DEFAULT_OWN_KEY_SETTINGS.maxTokens,
  };
}

export function saveOwnKeySettings(app: LocalStorageHost, settings: OwnKeySettings): void {
  app.saveLocalStorage(OWN_KEY_STORAGE_KEY, settings);
}

/** The key for whichever provider is active, so a caller never has to switch
 * on `settings.provider` itself to find it. */
export function activeApiKey(settings: OwnKeySettings): string {
  return settings.provider === 'anthropic' ? settings.anthropicApiKey : settings.openrouterApiKey;
}

/**
 * Masked for any echo, log, or error string: first four characters and the
 * last two, nothing in between. Never the whole key, never zero characters
 * (an empty mask reading "(set)" is still true and gives away nothing).
 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '(none)';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-2)}`;
}
