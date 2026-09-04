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
 * The terminal plugin exposes no typed-text method today (its pty is private
 * to the pane), so the pane opens and the line rides the clipboard with a
 * Notice saying so. The day it exposes one, this is the one place to call it. */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { Provider } from './types';

const TERMINAL_PLUGIN_ID = 'icor-for-life-terminal';
const TERMINAL_NEW_COMMAND = 'icor-for-life-terminal:new-terminal';

interface PluginsApp {
  plugins?: { plugins?: Record<string, unknown>; enabledPlugins?: Set<string> };
  commands?: { executeCommandById?: (id: string) => boolean };
}

/** True when the suite's Terminal plugin is installed and enabled. */
export function terminalPluginPresent(app: App): boolean {
  const host = app as unknown as PluginsApp;
  return host.plugins?.plugins?.[TERMINAL_PLUGIN_ID] !== undefined;
}

export type InstallRoute = 'terminal' | 'clipboard';

/**
 * Put the install line where the member can run it. Returns the route taken,
 * so the caller's words match what happened.
 */
export async function offerInstall(app: App, provider: Provider): Promise<InstallRoute> {
  const { command, page } = provider.installation;
  let copied = false;
  try {
    await navigator.clipboard.writeText(command);
    copied = true;
  } catch {
    copied = false;
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
