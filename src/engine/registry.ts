/* Every model-API provider the own-key engine knows, by id. The small
 * counterpart to `provider/registry.ts` - same "one door" shape, scaled to
 * two adapters with no detection step (there is nothing to find on disk; the
 * member pastes a key). */

import { createAnthropicProvider } from './providers/anthropic';
import { createOpenRouterProvider } from './providers/openrouter';
import type { ModelProvider, ModelProviderId, Transports } from './types';

export const MODEL_PROVIDER_IDS: readonly ModelProviderId[] = ['anthropic', 'openrouter'];

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return value === 'anthropic' || value === 'openrouter';
}

export const MODEL_PROVIDER_NAMES: Record<ModelProviderId, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

/** Section 2's own default column. Empty in settings falls back to this. */
export const DEFAULT_MODEL_FOR: Record<ModelProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  openrouter: 'anthropic/claude-sonnet-5',
};

/** Section 3's "Get a key" link per provider. */
export const GET_KEY_URL_FOR: Record<ModelProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
};

export function createModelProvider(id: ModelProviderId, apiKey: string, transports: Transports): ModelProvider {
  return id === 'anthropic'
    ? createAnthropicProvider(apiKey, transports)
    : createOpenRouterProvider(apiKey, transports);
}
