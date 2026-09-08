/* The one file that touches the real clipboard, the real child process and
 * the real ICOR for Life - Terminal plugin for Remote Control. Everything in
 * `launch.ts` takes these as parameters instead, so the routing decision is
 * asserted headless; this file is what `ChatView` actually calls. */

import { Notice, Platform } from 'obsidian';
import type { App } from 'obsidian';
/* `node:child_process` is NOT imported at module scope on purpose (0.13.0,
 * Flint finding 2 at the merge): `manifest.json` declares `isDesktopOnly:
 * false`, so this file is evaluated on Obsidian mobile too, through
 * `ChatView.ts`'s static import of `realLaunchPorts`. A top-of-file `import`
 * would `require('node:child_process')` the instant the plugin loads, on a
 * platform that has no Node runtime at all. `spawnDetached` below reaches for
 * the module only when it runs, and only on the desktop; `test/mobile-load
 * .test.mjs` measures the outcome against the built bundle. Same shape as
 * `main.ts`'s `homeDir` getter and `provider/registry.ts`'s lazy loaders. */
import type { ClipboardPort, LaunchPorts, NoticePort, SpawnPort, TerminalPluginPort } from './launch';

const TERMINAL_PLUGIN_ID = 'icor-for-life-terminal';

interface TerminalPluginInstance {
  newTerminalWithText?: (text: string, cwd?: string) => Promise<boolean>;
}

/** The Terminal plugin's public typed-text door, when it is installed, enabled, and current
 * enough to expose it. Mirrors `provider/install.ts`'s own narrow read of the same instance. */
export function terminalPluginPort(app: App): TerminalPluginPort | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  const found = plugins?.[TERMINAL_PLUGIN_ID];
  if (!found || typeof found !== 'object') return null;
  const typed = (found as TerminalPluginInstance).newTerminalWithText;
  if (typeof typed !== 'function') return null;
  return { newTerminalWithText: (text, cwd) => typed.call(found, text, cwd) };
}

/** Detached, ignored stdio: the plugin never waits on or reads this process.
 * `cwd` and `windowsVerbatimArguments` ride straight through to Node's own
 * `spawn`; `onExit`/`onError` are wired even though the child is detached and
 * unref'd - `unref` only tells the event loop not to wait for it, it does not
 * remove listeners, so a failed launch (Flint MEDIUM) still reaches the
 * caller. */
export const nodeSpawnPort: SpawnPort = {
  spawnDetached(file, args, opts) {
    // First statement, before the require: mobile has no child process to
    // spawn and no module to load, and `launch.ts` never routes here off the
    // desktop; this is the guard that makes that a fact rather than a hope.
    if (!Platform.isDesktopApp) {
      opts?.onError?.(new Error('Remote Control needs the desktop app: there is no terminal to open on this device.'));
      return;
    }
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const child = spawn(file, args, {
      cwd: opts?.cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: opts?.windowsVerbatimArguments === true,
    });
    if (opts?.onExit) child.on('exit', (code) => opts.onExit?.(code));
    if (opts?.onError) child.on('error', (err) => opts.onError?.(err));
    child.unref();
  },
};

export const browserClipboardPort: ClipboardPort = {
  writeText: (text) => navigator.clipboard.writeText(text),
};

export const obsidianNoticePort: NoticePort = {
  show(message, durationMs) {
    new Notice(message, durationMs);
  },
};

/** Every real port at once, for the one call site that needs them together. */
export function realLaunchPorts(app: App): LaunchPorts {
  return {
    terminalPlugin: terminalPluginPort(app),
    spawn: nodeSpawnPort,
    clipboard: browserClipboardPort,
    notice: obsidianNoticePort,
  };
}
