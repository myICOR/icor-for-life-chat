/* Every provider the build knows, by id. The only file outside `provider/`
 * that a view is allowed to reach a provider through, which is what makes the
 * hygiene gate's rule ("the view imports nothing from provider/claude")
 * checkable by grep rather than by review.
 *
 * Codex joined on 2026-09-04 through OpenAI's App Server (provider/codex).
 * The four ACP runtimes that joined the same day left on 2026-09-06; see the
 * note on `ProviderId` for why, and `RETIRED_NAMES` below for how a folder
 * they wrote is still named honestly. */

import { claudeProvider } from './claude';
import { codexProvider } from './codex';
import type { Provider, ProviderId } from './types';
import { isProviderId } from './types';

export const providers: Record<ProviderId, Provider | null> = {
  claude: claudeProvider,
  codex: codexProvider,
};

const NAMES: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/* Runtimes this build no longer carries, kept only so a Notice about an
 * archive they wrote can say "Gemini CLI" rather than "gemini". Nothing here
 * can launch. */
const RETIRED_NAMES: Record<string, string> = {
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
  opencode: 'OpenCode',
  qwen: 'Qwen Code',
};

/**
 * The provider for an id, or NULL when this build lacks it. Never a
 * substitute: a manifest naming Codex on a machine without Codex must say so,
 * not resume with Claude behind a chip that reads Codex (the architecture
 * review's finding, 2026-09-04). The id is a STRING here on purpose: it
 * arrives from a manifest, a note's frontmatter or a stored setting, and any
 * of those can name a runtime that has since left the build. Every caller
 * owns the words.
 */
export function providerFor(id: string): Provider | null {
  return isProviderId(id) ? providers[id] : null;
}

/** The display name for an id, for a Notice about a provider that is not here. */
export function providerName(id: string): string {
  if (isProviderId(id)) return providers[id]?.displayName ?? NAMES[id];
  return RETIRED_NAMES[id] ?? id;
}

/** One sentence a Notice can print when a runtime is missing. */
export function missingProviderMessage(id: string): string {
  const name = providerName(id);
  return providerFor(id)
    ? `${name} was not found on this machine. Install it and check the plugin settings under Providers.`
    : `${name} is not part of this build of the plugin, so this conversation cannot open on it.`;
}

/* HOW FAR A RUNTIME HAS BEEN TAKEN (Tom, 2026-09-06). Claude Code is the
 * runtime this plugin was built on and measured against turn by turn. Every
 * other runtime joined through the seam in one day and has not been
 * through that; it works, and the user is told it is Alpha and not fully
 * tested yet, on the chip, in the menu and in settings. The list of stable
 * runtimes is this function, so promoting one is a one-word change here. */
export function providerMaturity(id: string): 'stable' | 'alpha' {
  return id === 'claude' ? 'stable' : 'alpha';
}

/** The one sentence every Alpha surface says, so the three cannot drift. */
export const ALPHA_NOTE = 'Alpha, not fully tested yet.';

export function availableProviders(): Provider[] {
  return Object.values(providers).filter((p): p is Provider => p !== null);
}
