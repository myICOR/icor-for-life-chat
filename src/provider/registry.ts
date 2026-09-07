/* Every provider the build knows, by id. The only file outside `provider/`
 * that a view is allowed to reach a provider through, which is what makes the
 * hygiene gate's rule ("the view imports nothing from provider/claude")
 * checkable by grep rather than by review.
 *
 * Codex joined on 2026-09-04 through OpenAI's App Server (provider/codex).
 * The four ACP runtimes that joined the same day left on 2026-09-06; see the
 * note on `ProviderId` for why, and `RETIRED_NAMES` below for how a folder
 * they wrote is still named honestly.
 *
 * LAZY BY CONSTRUCTION (2026-09-06, `chat-mobile-engine-spec-v1.md` section
 * 4/5, Felix). `./claude` imports the Agent SDK and `node:fs` /
 * `node:child_process` at module scope; `./codex` imports `node:fs` /
 * `node:child_process` / `node:path` the same way. Both used to be a plain
 * top-of-file `import`, which meant merely LOADING this file - which every
 * platform does, the instant the plugin loads - evaluated all of that, and
 * Obsidian mobile has no Node runtime to evaluate it WITH: `require('node:fs')`
 * throws before a single `Platform.isDesktopApp` check anywhere in the
 * product ever runs.
 *
 * Neither runtime can exist on mobile anyway - both are CLIs the plugin
 * spawns as a child process, and mobile cannot spawn one - so the fix asks
 * for nothing neither runtime already had: `claudeModule()`/`codexModule()`
 * below call a plain `require()` of the real folder, but only from INSIDE a
 * function, so esbuild wraps that whole subtree (the SDK included) in a
 * lazy-init chunk that is never even reached unless something actually
 * calls a method on the provider. `main.ts` never calls `install()` or
 * `detect()` for either runtime off the desktop (`Platform.isDesktopApp`
 * guards both in `onload()`/`refreshDetections()`), and the mobile view
 * opens the own-key engine instead of `Provider.open()`, so on mobile this
 * `require()` is written but never executed. `test/mobile-load.test.mjs`
 * measures exactly that against the built `main.js`, not just this file's
 * shape.
 *
 * The three plain facts every metadata reader needs (id, display name,
 * install line) do NOT need the lazy load: they come from `./claude/meta`
 * and `./codex/meta`, two files with no import of their own, so a settings
 * row can name a runtime without ever touching the module that can crash a
 * phone. */

import { CLAUDE_DISPLAY_NAME, CLAUDE_ID, CLAUDE_INSTALLATION } from './claude/meta';
import { CODEX_DISPLAY_NAME, CODEX_ID, CODEX_INSTALLATION } from './codex/meta';
import type {
  DetectEnvironment, Detection, Provider, ProviderId,
  SessionConfig, SessionHooks, SessionReplay, SessionStore, SessionSummary,
} from './types';
import { isProviderId } from './types';
import type { ModelChoice, PermissionModeName } from '../model/types';

let claudeReal: typeof import('./claude') | null = null;
/** The real, SDK-and-`node:fs`-carrying module. Required exactly once, and
 * only by a caller that already knows it is on the desktop. */
function claudeModule(): typeof import('./claude') {
  claudeReal ??= require('./claude') as typeof import('./claude');
  return claudeReal;
}

let codexReal: typeof import('./codex') | null = null;
function codexModule(): typeof import('./codex') {
  codexReal ??= require('./codex') as typeof import('./codex');
  return codexReal;
}

/** A `SessionStore` whose every method defers its own `require()` the same
 * way the provider's own methods do. Store methods are already `Promise`s,
 * so forwarding costs nothing a caller can observe. */
function lazyStore(load: () => typeof import('./claude') | typeof import('./codex'), real: () => Provider['store']): SessionStore {
  const store = (): SessionStore => {
    const s = real();
    if (!s) throw new Error('This runtime has no session store.');
    return s;
  };
  void load;
  return {
    list: (cwd: string, limit: number): Promise<SessionSummary[]> => store().list(cwd, limit),
    createdAt: (sessionId: string, cwd: string): Promise<number | null> => store().createdAt(sessionId, cwd),
    exists: (sessionId: string, cwd: string): Promise<boolean> => store().exists(sessionId, cwd),
    read: (sessionId: string, cwd: string, cap: number): Promise<SessionReplay> => store().read(sessionId, cwd, cap),
    fork: (sessionId: string, cwd: string, upToMessageId?: string): Promise<string | null> => {
      const s = store();
      if (!s.fork) throw new Error('This runtime cannot fork a session.');
      return s.fork(sessionId, cwd, upToMessageId);
    },
    rename: (sessionId: string, cwd: string, title: string): Promise<void> => {
      const s = store();
      if (!s.rename) throw new Error('This runtime cannot rename a session.');
      return s.rename(sessionId, cwd, title);
    },
    delete: (sessionId: string, cwd: string): Promise<void> => {
      const s = store();
      if (!s.delete) throw new Error('This runtime cannot delete a session.');
      return s.delete(sessionId, cwd);
    },
  };
}

const claudeProviderLazy: Provider = {
  id: CLAUDE_ID,
  displayName: CLAUDE_DISPLAY_NAME,
  installation: CLAUDE_INSTALLATION,
  store: lazyStore(claudeModule, () => claudeModule().claudeProvider.store),
  install(): void {
    claudeModule().claudeProvider.install?.();
  },
  detect(env: DetectEnvironment): Promise<Detection> {
    return claudeModule().claudeProvider.detect(env);
  },
  models(cwd: string): Promise<ModelChoice[]> {
    return claudeModule().claudeProvider.models(cwd);
  },
  defaultModel(cwd: string): Promise<string | null> {
    return claudeModule().claudeProvider.defaultModel(cwd);
  },
  open(config: SessionConfig, hooks: SessionHooks) {
    return claudeModule().claudeProvider.open(config, hooks);
  },
  dispose(): void {
    // Never load the module just to dispose of nothing: a Claude session
    // was never opened here if the module was never required.
    claudeReal?.claudeProvider.dispose?.();
  },
};

const codexProviderLazy: Provider = {
  id: CODEX_ID,
  displayName: CODEX_DISPLAY_NAME,
  installation: CODEX_INSTALLATION,
  store: lazyStore(codexModule, () => codexModule().codexProvider.store),
  install(): void {
    codexModule().codexProvider.install?.();
  },
  detect(env: DetectEnvironment): Promise<Detection> {
    return codexModule().codexProvider.detect(env);
  },
  models(cwd: string): Promise<ModelChoice[]> {
    return codexModule().codexProvider.models(cwd);
  },
  defaultModel(cwd: string): Promise<string | null> {
    return codexModule().codexProvider.defaultModel(cwd);
  },
  modeLabel(mode: PermissionModeName): string | null {
    return codexReal ? (codexReal.codexProvider.modeLabel?.(mode) ?? null) : null;
  },
  open(config: SessionConfig, hooks: SessionHooks) {
    return codexModule().codexProvider.open(config, hooks);
  },
  dispose(): void {
    codexReal?.codexProvider.dispose?.();
  },
};

export const providers: Record<ProviderId, Provider | null> = {
  claude: claudeProviderLazy,
  codex: codexProviderLazy,
};

const NAMES: Record<ProviderId, string> = {
  claude: CLAUDE_DISPLAY_NAME,
  codex: CODEX_DISPLAY_NAME,
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
