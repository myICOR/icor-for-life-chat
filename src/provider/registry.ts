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

/**
 * The provider for an id, or NULL when this build lacks it. Never a
 * substitute: a manifest naming Codex on a machine without Codex must say so,
 * not resume with Claude behind a chip that reads Codex (the architecture
 * review's finding, 2026-09-04). Every caller owns the words.
 */
export function providerFor(id: ProviderId): Provider | null {
  return providers[id] ?? null;
}

/** The display name for an id, for a Notice about a provider that is not here. */
export function providerName(id: ProviderId): string {
  return providers[id]?.displayName ?? (id === 'codex' ? 'Codex' : id === 'acp' ? 'an ACP agent' : 'Claude Code');
}

/** One sentence a Notice can print when a runtime is missing. */
export function missingProviderMessage(id: ProviderId): string {
  const name = providerName(id);
  return providers[id]
    ? `${name} was not found on this machine. Install it and check the plugin settings under Providers.`
    : `${name} is not part of this build of the plugin, so this conversation cannot open on it.`;
}

export function availableProviders(): Provider[] {
  return Object.values(providers).filter((p): p is Provider => p !== null);
}
