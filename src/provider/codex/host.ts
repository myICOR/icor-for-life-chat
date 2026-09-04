/* Where the Codex CLI lives on this host, and what to tell a member who does
 * not have it. Kept apart from the provider entry so the service (which has
 * no DetectEnvironment handed to it) can resolve the same way. */

import { homedir, platform as osPlatform } from 'node:os';
import type { PathEnvironment, Platform } from '../cli';

export const CODEX_INSTALL_HINT =
  'Install the Codex CLI (https://developers.openai.com/codex/cli) and sign in with `codex login`, or set its path in the plugin settings under Providers.';

export function hostPlatform(): Platform {
  const p = osPlatform();
  return p === 'win32' ? 'win32' : p === 'darwin' ? 'darwin' : 'linux';
}

export function hostPathEnvironment(extra: string[] = []): PathEnvironment {
  let home = '';
  try {
    home = homedir();
  } catch {
    home = '';
  }
  return { platform: hostPlatform(), home, path: process.env.PATH ?? '', extra };
}
