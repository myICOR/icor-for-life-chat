/* The one file that touches the real clipboard, the real child process and
 * the real ICOR for Life - Terminal plugin for Remote Control. Everything in
 * `launch.ts` takes these as parameters instead, so the routing decision is
 * asserted headless; this file is what `ChatView` actually calls. */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import { spawn } from 'node:child_process';
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

/** Detached, ignored stdio: the plugin never waits on or reads this process. */
export const nodeSpawnPort: SpawnPort = {
  spawnDetached(file, args) {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
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
