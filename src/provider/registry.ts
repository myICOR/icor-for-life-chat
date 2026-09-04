/* Every provider the build knows, by id. The only file outside `provider/`
 * that a view is allowed to reach a provider through, which is what makes the
 * hygiene gate's rule ("the view imports nothing from provider/claude")
 * checkable by grep rather than by review.
 *
 * `codex` and `acp` are declared and null: the ids exist so a manifest or a
 * setting can already name them, and a null answers "not in this build"
 * rather than "unknown provider", which are different failures. */

import { claudeProvider } from './claude';
import type { Provider, ProviderId } from './types';

export const providers: Record<ProviderId, Provider | null> = {
  claude: claudeProvider,
  codex: null,
  acp: null,
};

/** The provider for an id, or the Claude one when the id names a provider this build lacks. */
export function providerFor(id: ProviderId): Provider {
  return providers[id] ?? claudeProvider;
}

export function availableProviders(): Provider[] {
  return Object.values(providers).filter((p): p is Provider => p !== null);
}
