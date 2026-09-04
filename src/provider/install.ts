/* Offering a runtime's install to the member, without installing anything.
 *
 * Obsidian's directory policy forbids a plugin installing its own
 * dependencies, and the vault's own rule is that a runtime is started by the
 * user, never by an agent. So the plugin hands the vendor's one-line install
 * to the member and stops: into a terminal pane when the ICOR for Life
 * Terminal plugin is here, otherwise onto the clipboard, and the vendor's
 * page opens either way. The member presses Enter; `Check again` then reruns
 * detection.
 *
 * The Terminal plugin (0.1.0, commit 503f0f9) exposes
 * `newTerminalWithText(text, cwd)`: it opens a shell pane, waits for the
 * prompt, and types the line the way a paste does, never with an Enter. So
 * the member reads the exact command sitting after their prompt and presses
 * Enter themselves. When that method is absent (an older Terminal, or none),
 * the line rides the clipboard with a Notice saying so. */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { Provider } from './types';

const TERMINAL_PLUGIN_ID = 'icor-for-life-terminal';
const TERMINAL_NEW_COMMAND = 'icor-for-life-terminal:new-terminal';

interface PluginsApp {
  plugins?: { plugins?: Record<string, unknown>; enabledPlugins?: Set<string> };
  commands?: { executeCommandById?: (id: string) => boolean };
}

/** The Terminal plugin's public typed-text door, per its docs/handoff.md section 6. */
interface TerminalTyping {
  newTerminalWithText?: (text: string, cwd?: string) => Promise<boolean>;
}

function terminalTyping(app: App): TerminalTyping | null {
  const host = app as unknown as PluginsApp;
  const plugin = host.plugins?.plugins?.[TERMINAL_PLUGIN_ID];
  if (!plugin || typeof plugin !== 'object') return null;
  const typed = plugin as TerminalTyping;
  return typeof typed.newTerminalWithText === 'function' ? typed : null;
}

/** True when the suite's Terminal plugin is installed and enabled. */
export function terminalPluginPresent(app: App): boolean {
  const host = app as unknown as PluginsApp;
  return host.plugins?.plugins?.[TERMINAL_PLUGIN_ID] !== undefined;
}

export type InstallRoute = 'typed' | 'terminal' | 'clipboard';

/**
 * Put the install line where the member can run it. Returns the route taken,
 * so the caller's words match what happened: `typed` when the line sits after
 * the prompt of a new terminal pane, `terminal` when a pane opened and the line
 * is on the clipboard, `clipboard` when there is no terminal plugin at all.
 */
export async function offerInstall(app: App, provider: Provider, cwd?: string): Promise<InstallRoute> {
  const { command, page } = provider.installation;
  let copied = false;
  try {
    await navigator.clipboard.writeText(command);
    copied = true;
  } catch {
    copied = false;
  }
  const typing = terminalTyping(app);
  if (typing?.newTerminalWithText) {
    let typed = false;
    try {
      typed = await typing.newTerminalWithText(command, cwd);
    } catch {
      typed = false;
    }
    if (typed) {
      new Notice(`${provider.displayName}: the install command is typed into the terminal pane. Read it, then press Enter.`, 12000);
      window.open(page, '_blank');
      return 'typed';
    }
  }
  const host = app as unknown as PluginsApp;
  const route: InstallRoute = terminalPluginPresent(app) && host.commands?.executeCommandById?.(TERMINAL_NEW_COMMAND) ? 'terminal' : 'clipboard';
  if (route === 'terminal') {
    new Notice(copied
      ? `${provider.displayName}: install command copied. Paste it into the terminal pane and press Enter.`
      : `${provider.displayName}: run this in the terminal pane: ${command}`, 12000);
  } else {
    new Notice(copied
      ? `${provider.displayName}: install command copied. Paste it into a terminal and press Enter.`
      : `${provider.displayName}: run this in a terminal: ${command}`, 12000);
  }
  window.open(page, '_blank');
  return route;
}
