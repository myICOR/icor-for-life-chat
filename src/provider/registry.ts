/* Every provider the build knows, by id. The only file outside `provider/`
 * that a view is allowed to reach a provider through, which is what makes the
 * hygiene gate's rule ("the view imports nothing from provider/claude")
 * checkable by grep rather than by review.
 *
 * Codex joined on 2026-09-04 through OpenAI's App Server (provider/codex). */

import { claudeProvider } from './claude';
import { codexProvider } from './codex';
import type { Provider, ProviderId } from './types';

/* `acp` is declared and null: the id exists so a manifest or a setting can
 * already name it, and a null answers "not in this build" rather than
 * "unknown provider", which are different failures. */
export const providers: Record<ProviderId, Provider | null> = {
  claude: claudeProvider,
  codex: codexProvider,
  acp: null,
};

/** The provider for an id, or the Claude one when the id names a provider this build lacks. */
export function providerFor(id: ProviderId): Provider {
  return providers[id] ?? claudeProvider;
}

export function availableProviders(): Provider[] {
  return Object.values(providers).filter((p): p is Provider => p !== null);
}
