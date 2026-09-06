/* THE LAST CATALOGUE EACH RUNTIME REPORTED, kept between sessions.
 *
 * The model menu has one law: it offers what the runtime itself listed, never
 * a list typed here. Until 0.11.0 that meant the menu was empty before the
 * first session answered ("Model list arrives when the session starts"), so
 * the model could not be chosen before launch even though the launch already
 * carries a model flag. Tom, 2026-09-06: choose up front, launch with the
 * flag, no waiting.
 *
 * This is the net under that: every entry here was MEASURED, reported by the
 * runtime's own catalogue call in an earlier session, and stamped with when.
 * It is stale data and is offered as such, replaced the moment a session
 * reports a fresher list. It is never seeded, never merged with a guess, and
 * a runtime that has not reported yet has no entry. Pure so the shape is
 * assertable headless; the plugin owns the file. */

import type { ModelChoice } from './types';

export interface CachedCatalog {
  models: ModelChoice[];
  /** ISO timestamp of the session that reported the list. */
  measuredAt: string;
}

export type CatalogCache = Partial<Record<string, CachedCatalog>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEffortList(v: unknown): v is ModelChoice['supportedEffortLevels'] {
  if (v === null) return true;
  return Array.isArray(v) && v.every((e) => typeof e === 'string');
}

function isChoice(v: unknown): v is ModelChoice {
  return (
    isRecord(v) &&
    typeof v.value === 'string' &&
    v.value.length > 0 &&
    typeof v.displayName === 'string' &&
    typeof v.description === 'string' &&
    isEffortList(v.supportedEffortLevels)
  );
}

/** Whatever was on disk, narrowed to the shape; a malformed entry is dropped, never repaired. */
export function parseCatalogCache(raw: unknown): CatalogCache {
  if (!isRecord(raw)) return {};
  const out: CatalogCache = {};
  for (const [provider, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !Array.isArray(entry.models) || typeof entry.measuredAt !== 'string') continue;
    const models = entry.models.filter(isChoice);
    if (!models.length) continue;
    out[provider] = { models, measuredAt: entry.measuredAt };
  }
  return out;
}

/** The cached list for a runtime, or null when it has never reported one. */
export function catalogFor(cache: CatalogCache, provider: string): ModelChoice[] | null {
  const entry = cache[provider];
  return entry && entry.models.length ? entry.models : null;
}

/** The cache with one runtime's list replaced. An empty list changes nothing: nothing measured, nothing stored. */
export function withCatalog(cache: CatalogCache, provider: string, models: ModelChoice[], now: Date): CatalogCache {
  if (!models.length) return cache;
  return { ...cache, [provider]: { models: [...models], measuredAt: now.toISOString() } };
}

/**
 * The model a launch carries. The pane's own pick wins over the settings
 * value, because the pick was made for THIS conversation and the setting is
 * the default for every one. Empty means the runtime's own default.
 */
export function launchModelFor(chosen: string | null, configured: string): string {
  return chosen ?? configured;
}
