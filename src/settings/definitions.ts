/* THE SETTINGS, AS DATA. One table, two renderers, no Obsidian import.
 *
 * Obsidian 1.13 renders a settings tab from `getSettingDefinitions()` and
 * indexes it for settings search; older versions call `display()`. This
 * plugin's floor is 1.7.2, so both paths exist - and two hand-written
 * renderings of the same fifteen settings is a drift waiting to happen: the
 * effort dropdown once listed three rungs while the composer offered four,
 * and the two disagreed for weeks because nothing tied them together.
 *
 * So the settings are declared ONCE, here, as plain data with no Obsidian
 * types. `SettingsTab.ts` maps this table onto the declarative API for 1.13
 * and walks the same table with `new Setting()` for the fallback. The table is
 * asserted headless: every persisted key appears exactly once, the option sets
 * match the composer's, the eight readout switches come in render order.
 *
 * The shapes below mirror Obsidian's `SettingDefinition*` types structurally
 * so the mapping in SettingsTab is one-to-one, but they are NOT imported from
 * 'obsidian': those names are `@since 1.13.0`, and the manifest gate rightly
 * convicts any named import newer than the declared floor. A structural twin
 * is honest about what it is - data a 1.7.2 build never hands to the app. */

import type { ChatSettings } from '../model/settings';
import type { ModelChoice } from '../model/types';
import type { Detection, ProviderId } from '../provider/types';
import { FACT_SETTING_KEYS, MEASURED_NOTE, NARROW_NOTE } from '../model/settings';
import { DROP_GROUPS, FACT_NAMES, FACT_TOOLTIPS, RENDER_ORDER } from '../model/facts';
import type { FactId } from '../model/facts';

export type SettingKey = keyof ChatSettings;

export type ControlSpec =
  | { type: 'toggle'; key: SettingKey }
  | { type: 'text'; key: SettingKey; placeholder?: string }
  | { type: 'textarea'; key: SettingKey; placeholder?: string; rows?: number }
  | { type: 'dropdown'; key: SettingKey; options: Record<string, string> }
  | { type: 'number'; key: SettingKey; min?: number; step?: number };

export interface ControlDefinition {
  name: string;
  desc?: string;
  control: ControlSpec;
}

/** A line of plugin-voice text between rows. No key, nothing persisted. */
export interface NoteDefinition {
  name: string;
  desc: string;
  note: true;
}

export type ItemDefinition = ControlDefinition | NoteDefinition;

export interface GroupDefinition {
  /** Two-digit index, kept from the imperative tab so the sections still read as a numbered list. */
  index: string;
  heading: string;
  items: ItemDefinition[];
}

export interface DefinitionInput {
  settings: ChatSettings;
  /** The provider's own catalogue, empty until a session has answered. */
  catalog: readonly ModelChoice[];
  /** Where archives go when the folder setting is empty. */
  defaultArchiveFolder: string;
  /** Every runtime this build knows, in registry order. */
  providers?: ReadonlyArray<{ id: ProviderId; displayName: string }>;
  /** What detection found per runtime; absent while it has not run. */
  detections?: Partial<Record<ProviderId, Detection | null>>;
}

/* THE RUNTIME DROPDOWN OFFERS ONLY WHAT WAS FOUND, plus the stored choice so
 * the picker can always show its own value. A runtime that detection has
 * not seen is not offered: "not found" is a real answer (Axon's detection
 * honesty gate, Lex's condition on 2026-09-04), and a dropdown naming a
 * runtime that cannot launch is the same lie as an invented model list. */
export function providerOptions(input: DefinitionInput): Record<string, string> {
  const options: Record<string, string> = {};
  for (const p of input.providers ?? [{ id: 'claude' as const, displayName: 'Claude Code' }]) {
    const found = input.detections?.[p.id]?.found;
    if (found === true || found === undefined && p.id === 'claude') options[p.id] = p.displayName;
  }
  const stored = input.settings.defaultProvider;
  if (!(stored in options)) {
    const named = (input.providers ?? []).find((p) => p.id === stored);
    options[stored] = named ? named.displayName : stored;
  }
  return options;
}

/** One line per runtime saying what detection found, in the runtime's own words. */
function detectionNote(input: DefinitionInput, id: ProviderId, displayName: string): NoteDefinition {
  const d = input.detections?.[id];
  const desc = d === undefined
    ? `${displayName}: looking for it.`
    : d === null
      ? `${displayName}: detection has not run.`
      : d.hint;
  return { name: displayName, desc, note: true };
}

const DROPPABLE = new Set<FactId>(DROP_GROUPS.flat());

export function isNote(item: ItemDefinition): item is NoteDefinition {
  return 'note' in item;
}

/* THE MODEL LIST IS THE PROVIDER'S, never this file's. It was a hand-typed
 * `{haiku, sonnet, opus}` once, which is the invented catalogue the composer's
 * own header rules out, and it aged the way invented lists do: Fable shipped
 * and the picker could not offer it. Empty stays empty and the row says so. */
export function modelOptions(input: DefinitionInput): Record<string, string> {
  const options: Record<string, string> = { '': 'CLI default' };
  for (const row of input.catalog) {
    // 'default' is the CLI default under the provider's own name for it, and
    // this picker already carries that choice as the empty string.
    if (row.value === 'default') continue;
    options[row.value] = row.displayName;
  }
  /* A model the user already picked, on a build whose catalogue has not
     arrived. Without this the dropdown snaps to 'CLI default' and the next
     save writes that back - a tab that loses the setting by being opened. */
  const stored = input.settings.model;
  if (stored && !(stored in options)) options[stored] = stored;
  return options;
}

export function settingDefinitions(input: DefinitionInput): GroupDefinition[] {
  const facts: ItemDefinition[] = [
    /* ONE LINE, documentation rather than apology. A readout with no
       measurement behind it is ABSENT, so a first-run strip renders nothing.
       The cure is not a placeholder in the strip; it is this note, on the
       surface someone opens when they want to ask. */
    { name: 'How the readouts fill', desc: MEASURED_NOTE, note: true },
  ];
  /* EIGHT ROWS in the strip's own render order, so the list and the strip
     agree. The description is the readout's tooltip VERBATIM, from the same
     source. No master toggle and no reset: a ninth control that changes the
     other eight is chrome about chrome. */
  for (const id of RENDER_ORDER) {
    const lines = [...FACT_TOOLTIPS[id]];
    if (DROPPABLE.has(id)) lines.push(NARROW_NOTE);
    facts.push({ name: FACT_NAMES[id], desc: lines.join(' '), control: { type: 'toggle', key: FACT_SETTING_KEYS[id] } });
  }

  return [
    {
      index: '01', heading: 'Providers',
      items: [
        {
          name: 'Runtime for new conversations',
          desc: 'The agent runtime a new conversation opens with. A conversation keeps its runtime for life. Only runtimes found on this machine are offered.',
          control: { type: 'dropdown', key: 'defaultProvider', options: providerOptions(input) },
        },
        detectionNote(input, 'claude', 'Claude Code'),
        {
          name: 'Claude Code location',
          desc: 'Leave empty to find it automatically. Obsidian launched from the Dock does not inherit a login shell, so the plugin repairs PATH before looking.',
          control: { type: 'text', key: 'cliPath', placeholder: '/usr/local/bin/claude' },
        },
        detectionNote(input, 'codex', 'Codex'),
        {
          name: 'Codex location',
          desc: 'The Codex CLI, signed in with `codex login` in a terminal. The plugin never signs in for you and holds no key. Leave empty to find it automatically.',
          control: { type: 'text', key: 'codexPath', placeholder: '/usr/local/bin/codex' },
        },
        {
          name: 'Extra PATH entries',
          desc: 'One directory per line, searched after your own PATH.',
          control: { type: 'textarea', key: 'extraPath', rows: 3 },
        },
        {
          name: 'Model',
          desc: input.catalog.length === 0
            ? 'The full list arrives once a conversation has run: the models come from Claude Code itself, never from a list kept here.'
            : undefined,
          control: { type: 'dropdown', key: 'model', options: modelOptions(input) },
        },
        {
          name: 'Reasoning effort',
          /* Four rungs, matching the composer exactly. It listed three, so a
             user who picked Extra in the composer came back to a dropdown with
             no such option, and a picker that cannot show its own stored value
             is a picker that quietly rewrites it. */
          control: { type: 'dropdown', key: 'effort', options: { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra' } },
        },
        {
          name: 'Default permission mode',
          desc: 'New conversations start here. Ask is the safe one; Bypass runs every tool without asking.',
          /* Bypass is offered and is still not the shipped default. Withholding
             it here only forced a Bypass user to re-pick it in every tab. */
          control: {
            type: 'dropdown', key: 'defaultPermissionMode',
            options: { plan: 'Plan', default: 'Ask (recommended)', acceptEdits: 'Auto-accept edits', bypassPermissions: 'Bypass - no prompts at all' },
          },
        },
      ],
    },
    {
      index: '02', heading: 'Conversations',
      items: [
        { name: 'Context awareness', desc: 'Send the note you have open and the text you have selected.', control: { type: 'toggle', key: 'contextAwareness' } },
        { name: 'Structured replies', desc: 'Ask for the ICOR card format and render it natively. On by default; turn it off for plain chat.', control: { type: 'toggle', key: 'structuredReplies' } },
        { name: 'Team strip', desc: 'Show who on the AI team did the work in this conversation, with their share of activity (tool calls and messages). Appears only in a vault with a 06 AI Team folder.', control: { type: 'toggle', key: 'factTeamStrip' } },
        { name: 'Mark the tab when a turn finishes', desc: 'A dot on the chat tab when a turn ends while you are looking elsewhere. It clears when you come back.', control: { type: 'toggle', key: 'finishBadge' } },
        { name: 'Chime when a turn finishes', desc: 'Two quiet notes when a turn ends while you are looking elsewhere. Off by default.', control: { type: 'toggle', key: 'finishChime' } },
      ],
    },
    { index: '03', heading: 'Statusline', items: facts },
    {
      index: '04', heading: 'Session archive',
      items: [
        { name: 'Archive sessions into the vault', control: { type: 'toggle', key: 'archiveEnabled' } },
        { name: 'Archive folder', desc: `Empty uses ${input.defaultArchiveFolder}.`, control: { type: 'text', key: 'archiveFolder' } },
        { name: 'Keep archives for', desc: 'Number of days. Zero keeps everything.', control: { type: 'number', key: 'archiveRetentionDays', min: 0, step: 1 } },
      ],
    },
    {
      index: '05', heading: 'Advanced',
      items: [
        { name: 'Vault layout', desc: 'Where the AI Sessions folder lives.', control: { type: 'dropdown', key: 'vaultMode', options: { auto: 'Detect', scaffold: 'ICOR for Life', standalone: 'Standalone' } } },
      ],
    },
  ];
}

/** Every persisted key the table covers, in order. The coverage gate reads this. */
export function controlKeys(groups: readonly GroupDefinition[]): SettingKey[] {
  const keys: SettingKey[] = [];
  for (const g of groups) for (const item of g.items) if (!isNote(item)) keys.push(item.control.key);
  return keys;
}

/** A non-negative whole number of days, or a message saying why not. */
export function validateRetention(value: unknown): string | undefined {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? undefined : 'Use zero or a whole number of days.';
}
