/* Plumbing only. Nothing here shapes what the team says: identity, context
 * rules and behaviour live in the vault's own CLAUDE.md, which the CLI reads
 * from cwd. The plugin is a window, not a second brain. */

import type { EffortName, PermissionModeName } from './types';
import type { FactId } from './facts';
import { ARCHIVE_FOLDER_SCAFFOLD, ARCHIVE_FOLDER_STANDALONE } from '../constants';

export type VaultMode = 'auto' | 'scaffold' | 'standalone';

export interface ChatSettings {
  /** Absolute path to the Claude Code executable. Empty = resolve automatically. */
  cliPath: string;
  /** Model id passed to the CLI. Empty = whatever the CLI is configured to use. */
  model: string;
  effort: EffortName;
  /** Startup permission mode. Never anything but 'default' out of the box. */
  defaultPermissionMode: PermissionModeName;
  /** Ask for the ICOR card format and render it natively. ON out of the box. */
  structuredReplies: boolean;
  archiveEnabled: boolean;
  archiveFolder: string;
  /** Days to keep archived sessions. 0 = keep forever. */
  archiveRetentionDays: number;
  vaultMode: VaultMode;
  /** Send the open note and the current selection as context. */
  contextAwareness: boolean;
  /** Extra PATH entries for GUI-launched Obsidian, one per line. */
  extraPath: string;
  /* THE EIGHT READOUT SWITCHES. Eight toggles is eight toggles: there is no
     master switch and no reset-to-defaults, because a ninth control that
     changes the other eight is chrome about chrome. */
  factContext: boolean;
  factPlan: boolean;
  factTokensIn: boolean;
  factTokensOut: boolean;
  factElapsed: boolean;
  factAgents: boolean;
  factSessionStart: boolean;
  factSessionUpdated: boolean;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  cliPath: '',
  model: '',
  effort: 'medium',
  defaultPermissionMode: 'default',
  structuredReplies: true,
  archiveEnabled: true,
  archiveFolder: '',
  archiveRetentionDays: 90,
  vaultMode: 'auto',
  contextAwareness: true,
  extraPath: '',
  /* FIVE ON, THREE OFF, and the default set is what the feature IS: most people
     never open settings. The two budgets because they are the only facts that
     answer "am I about to hit a wall"; the token pair because it is the only
     fact that answers "what did this cost"; ELAPSED because it self-hides when
     idle, so it costs nothing at rest and answers "is it still working" while
     streaming.

     AGENTS is off because rung 2 already answers it - the chip tray renders one
     chip per live subagent directly above the composer, and a count of the
     chips the user is looking at can be removed without changing a meaning.
     START and UPD are off because a chat is a live surface: they earn their
     place on a RESUMED session, which is the minority case, and the user who
     works that way turns them on once. */
  factContext: true,
  factPlan: true,
  factTokensIn: true,
  factTokensOut: true,
  factElapsed: true,
  factAgents: false,
  factSessionStart: false,
  factSessionUpdated: false,
};

/* THE STATUSLINE SECTION'S TWO PROSE STRINGS.
 *
 * They live HERE rather than in the settings tab because the tab imports
 * Obsidian, and a string the gate cannot mount is a string nobody has ever
 * measured for legibility. Documentation nobody can read is the same as no
 * documentation. */

/**
 * The whole answer to "why is my strip empty", and the reason the strip itself
 * never needs a placeholder. A line IN the strip saying facts appear later
 * would be the placeholder defect wearing words - the same refusal as printing
 * a zero - so it lives on the surface someone opens when they want to ask.
 */
export const MEASURED_NOTE =
  'Each readout appears once it has been measured. Nothing here is estimated.';

/**
 * The one sentence explaining an absence the strip deliberately never signals.
 * A dropped fact leaves no overflow chip, no ellipsis and no "+2" - chrome that
 * reports on its own truncation has become content.
 */
export const NARROW_NOTE = 'Hidden automatically when the pane is too narrow.';

/** The settings key behind each readout, so neither list can drift. */
export const FACT_SETTING_KEYS: Record<FactId, keyof ChatSettings> = {
  context: 'factContext',
  plan: 'factPlan',
  tokensIn: 'factTokensIn',
  tokensOut: 'factTokensOut',
  elapsed: 'factElapsed',
  agents: 'factAgents',
  sessionStart: 'factSessionStart',
  sessionUpdated: 'factSessionUpdated',
};

/** The user's eight switches, in the shape the strip consumes. */
export function factVisibility(settings: ChatSettings): Record<FactId, boolean> {
  const out = {} as Record<FactId, boolean>;
  for (const [id, key] of Object.entries(FACT_SETTING_KEYS) as [FactId, keyof ChatSettings][]) {
    out[id] = settings[key] === true;
  }
  return out;
}

/** The archive root, resolved against the vault mode. */
export function archiveRoot(settings: ChatSettings, scaffoldDetected: boolean): string {
  if (settings.archiveFolder.trim()) return settings.archiveFolder.trim();
  const scaffold =
    settings.vaultMode === 'scaffold' ||
    (settings.vaultMode === 'auto' && scaffoldDetected);
  return scaffold ? ARCHIVE_FOLDER_SCAFFOLD : ARCHIVE_FOLDER_STANDALONE;
}

/** Only ever true when the user is explicitly in Bypass. */
export function skipPermissions(mode: PermissionModeName): boolean {
  return mode === 'bypassPermissions';
}
