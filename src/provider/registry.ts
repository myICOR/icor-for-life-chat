/* Every provider the build knows, by id. The only file outside `provider/`
 * that a view is allowed to reach a provider through, which is what makes the
 * hygiene gate's rule ("the view imports nothing from provider/claude") 
 * checkable by grep rather than by review.
 *
 * Codex joined on 2026-09-04 through OpenAI's App Server (provider/codex).
 * The ACP runtimes (Gemini CLI, Copilot CLI, OpenCode, Qwen Code) joined the
 * same day through one Agent Client Protocol client (provider/acp), each
 * with its own id so a manifest names the runtime that had the session. */

import { claudeProvider } from './claude';
import { codexProvider } from './codex';
import { acpProviders } from './acp';

/* The one ACP hook a host must set: where the archive is, because the ACP
 * runtimes' session record IS the vault's archive. Re-exported here so
 * main.ts reaches it through the registry, the only door the hygiene gate
 * allows. */
export { configureArchiveIndex } from './acp';
export type { ArchiveIndex, ArchivedSession, AcpProviderId } from './acp';
import type { Provider, ProviderId } from './types';

export const providers: Record<ProviderId, Provider | null> = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: acpProviders.gemini,
  copilot: acpProviders.copilot,
  opencode: acpProviders.opencode,
  qwen: acpProviders.qwen,
};

const NAMES: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
  opencode: 'OpenCode',
  qwen: 'Qwen Code',
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
  return providers[id]?.displayName ?? NAMES[id] ?? id;
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
