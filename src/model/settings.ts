/* Plumbing only. Nothing here shapes what the model says: identity, context
 * rules and behaviour live in the vault's own CLAUDE.md, which the CLI reads
 * from cwd. The plugin is a window, not a second brain. */

import type { EffortName, PermissionModeName } from './types';
import type { ProviderId } from '../provider/types';
import { isProviderId } from '../provider/types';
import type { FactId } from './facts';
import { ARCHIVE_FOLDER_DEFAULT, ARCHIVE_FOLDER_LEGACY, ARCHIVE_SUBFOLDER_DATABASES } from '../constants';

export interface ChatSettings {
  /** The runtime new conversations open with. A conversation keeps its provider for life. */
  defaultProvider: ProviderId;
  /** Absolute path to the Claude Code executable. Empty = resolve automatically. */
  cliPath: string;
  /** Absolute path to the Codex CLI. Empty = resolve automatically. */
  codexPath: string;
  /** Model id passed to the CLI. Empty = whatever the CLI is configured to use. */
  model: string;
  effort: EffortName;
  /** Startup permission mode. Never anything but 'default' out of the box. */
  defaultPermissionMode: PermissionModeName;
  archiveEnabled: boolean;
  archiveFolder: string;
  /** Days to keep archived sessions. 0 = keep forever. */
  archiveRetentionDays: number;
  /** Send the open note and the current selection as context. */
  contextAwareness: boolean;
  /** Extra PATH entries for GUI-launched Obsidian, one per line. */
  extraPath: string;
  /** Show "Continue on your phone" on desktop, so a chat can be handed to a
   * terminal running Remote Control. On by default; off hides the button. */
  remoteControl: boolean;
  /** Desktop auth truth (`chat-mobile-engine-spec-v1.md` section 4). Off by
   * default: the Claude child's spawn env is stripped of any
   * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN
   * inherited from the launching shell, so it falls back to Claude Code's own
   * sign-in. On re-allows them, for a member who set Claude Code up with an
   * API key on purpose. */
  allowEnvApiKey: boolean;
  /* FINISH SIGNALS. A long turn ends while the user is in another tab or
     another app; the badge marks the tab so the finished work is found, the
     chime says it out loud. The chime is off by default: a sound nobody asked
     for is the one thing a plugin should never ship on. */
  finishBadge: boolean;
  finishChime: boolean;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  defaultProvider: 'claude',
  cliPath: '',
  codexPath: '',
  model: '',
  effort: 'medium',
  defaultPermissionMode: 'default',
  /* OFF until the member turns it on (Tom, 2026-11-26): a conversation is
     written into the vault only when they asked for that. */
  archiveEnabled: false,
  archiveFolder: '',
  archiveRetentionDays: 90,
  contextAwareness: true,
  extraPath: '',
  remoteControl: true,
  allowEnvApiKey: false,
  finishBadge: true,
  finishChime: false,
};

/* THE STATUSLINE'S READOUTS, fixed (0.17.0; they were eight switches before).
 * The two budgets answer "am I about to hit a wall", the token pair "what did
 * this cost", ELAPSED "is it still working" and hides itself when idle. AGENTS
 * repeats the chip tray above the composer; START and UPDATED only matter on a
 * resumed session. Each readout appears once measured and never as an estimate,
 * and drops out on its own when the pane is too narrow. */
export const FACT_VISIBILITY: Readonly<Record<FactId, boolean>> = {
  context: true,
  plan: true,
  tokensIn: true,
  tokensOut: true,
  elapsed: true,
  agents: false,
  sessionStart: false,
  sessionUpdated: false,
};

/**
 * The archive root, first match wins:
 *   1. the folder the settings name;
 *   2. the folder 0.16 and older archived into, while this vault still has it;
 *   3. `<Databases room>/AI Sessions` in an ICOR for Life vault (`databasesFolder`,
 *      from `vault/databases.ts`; null when the vault is not one or has no such room);
 *   4. `AI Sessions` at the vault root.
 */
export function archiveRoot(settings: ChatSettings, legacyDetected: boolean, databasesFolder: string | null = null): string {
  const named = settings.archiveFolder.trim().replace(/^\/+|\/+$/g, '');
  if (named) return named;
  if (legacyDetected) return ARCHIVE_FOLDER_LEGACY;
  if (databasesFolder) return `${databasesFolder}/${ARCHIVE_SUBFOLDER_DATABASES}`;
  return ARCHIVE_FOLDER_DEFAULT;
}

/* STORED SETTINGS BECOME SETTINGS HERE, and nowhere else. Untyped JSON from
 * disk, every missing field its default, and one field checked rather than
 * trusted: `defaultProvider` is a string a past build wrote, and a build that
 * has since dropped that runtime (the ACP four, 2026-09-06) must not carry
 * the name into a picker that cannot launch it. It falls back to Claude,
 * which is what a fresh install has; nothing else is rewritten. */
export function settingsFrom(stored: unknown): ChatSettings {
  const partial = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  /* Known keys only: a setting a past build wrote and this one retired
     (structuredReplies, vaultMode, the readout switches, the team strip) is
     dropped here, so the next save leaves it out of data.json. */
  const merged: ChatSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ChatSettings)[]) {
    if (key in partial) (merged as unknown as Record<string, unknown>)[key] = partial[key];
  }
  if (!isProviderId(merged.defaultProvider)) merged.defaultProvider = DEFAULT_SETTINGS.defaultProvider;
  return merged;
}

/** Only ever true when the user is explicitly in Bypass. */
export function skipPermissions(mode: PermissionModeName): boolean {
  return mode === 'bypassPermissions';
}

/** The settings key that holds a runtime's executable path. */
export function pathSettingKey(provider: ProviderId): keyof ChatSettings {
  switch (provider) {
    case 'claude': return 'cliPath';
    case 'codex': return 'codexPath';
    default: return 'cliPath';
  }
}
