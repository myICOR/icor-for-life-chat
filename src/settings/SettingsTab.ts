/* Plumbing only. Nothing here changes what the team says or how it thinks:
 * the vault's own CLAUDE.md governs behaviour, and the plugin never injects a
 * prompt of its own beyond the one opt-in structured-replies constant. */

import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';
import type IcorChatPlugin from '../main';
import type { EffortName, PermissionModeName } from '../model/types';
import type { VaultMode } from '../model/settings';
import { FACT_SETTING_KEYS, MEASURED_NOTE, NARROW_NOTE } from '../model/settings';
import { DROP_GROUPS, FACT_NAMES, FACT_TOOLTIPS, RENDER_ORDER } from '../model/facts';
import type { FactId } from '../model/facts';

const DROPPABLE = new Set<FactId>(DROP_GROUPS.flat());

/* The declarative settings API (getSettingDefinitions) is @since 1.13.0 and
   this plugin's honest floor is 1.7.2, so display() remains the only path.
   The two lint exemptions for that live in eslint.config.mjs, scoped to this
   file, because the plugin's own config forbids inline disables. */
export class ChatSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: IcorChatPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('aic-settings');
    containerEl.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);

    this.section(containerEl, '01', 'PROVIDER');

    new Setting(containerEl)
      .setName('Claude Code location')
      .setDesc(
        'Leave empty to find it automatically. Obsidian launched from the Dock does not ' +
          'inherit a login shell, so the plugin repairs PATH before looking.',
      )
      .addText((t) =>
        t
          .setPlaceholder('/usr/local/bin/claude')
          .setValue(this.plugin.settings.cliPath)
          .onChange(async (v) => {
            this.plugin.settings.cliPath = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Extra PATH entries')
      .setDesc('One directory per line, searched after your own PATH.')
      .addTextArea((t) =>
        t.setValue(this.plugin.settings.extraPath).onChange(async (v) => {
          this.plugin.settings.extraPath = v;
          await this.plugin.saveSettings();
        }),
      );

    /* THE MODEL LIST IS THE PROVIDER'S, never this file's.
     *
       It was a hand-typed `{haiku, sonnet, opus}` object, which is the invented
       catalogue the composer's own header rules out, and it failed the way an
       invented list fails: Fable shipped and the picker could not offer it. The
       options now come from the SDK's `supportedModels()`, cached on the plugin
       the first time a session answers. Before any session has run there is
       nothing true to list, and the picker says exactly that rather than
       offering three names it made up. */
    const catalog = this.plugin.modelCatalog;
    const modelOptions: Record<string, string> = { '': 'CLI default' };
    for (const row of catalog) {
      // 'default' is the CLI default under the provider's own name for it, and
      // this picker already carries that choice as the empty string. Two rows
      // meaning one thing is a picker that can disagree with itself.
      if (row.value === 'default') continue;
      modelOptions[row.value] = row.displayName;
    }
    /* A model the user already picked, on a build whose catalogue has not
       arrived yet. Without this the dropdown would silently snap to 'CLI
       default' and the next save would write that back - a settings tab that
       loses the setting by being opened. */
    const stored = this.plugin.settings.model;
    if (stored && !(stored in modelOptions)) modelOptions[stored] = stored;

    const model = new Setting(containerEl).setName('Model');
    if (catalog.length === 0) {
      model.setDesc('The full list arrives once a conversation has run: the models come from Claude Code itself, never from a list kept here.');
    }
    model.addDropdown((d) =>
      d
        .addOptions(modelOptions)
        .setValue(stored)
        .onChange(async (v) => {
          this.plugin.settings.model = v;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName('Reasoning effort').addDropdown((d) =>
      d
        /* Four rungs, matching the composer exactly. It listed three, so a user
           who picked Extra in the composer - which saves to this same setting -
           came back to a dropdown with no such option, and it displayed the
           value below it. A picker that cannot show its own stored value is a
           picker that quietly rewrites it. */
        .addOptions({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra' })
        .setValue(this.plugin.settings.effort)
        .onChange(async (v) => {
          this.plugin.settings.effort = v as EffortName;
          await this.plugin.saveSettings();
        }),
    );

    /* BYPASS IS OFFERED HERE, and it is still not the out-of-the-box default.
     *
       It was withheld from this list entirely, and the description said so as
       if withholding it were the safety. It was not: the mode picker in every
       composer offers Bypass, so the only thing this omission achieved was
       forcing a user who works in Bypass to re-pick it in every new tab, while
       `loadSettings` silently rewrote the stored value back to Ask on the next
       reload. Ask remains the shipped default and the recommendation; choosing
       otherwise is the user's to make, once, and have it stick. */
    new Setting(containerEl)
      .setName('Default permission mode')
      .setDesc('New conversations start here. Ask is the safe one; Bypass runs every tool without asking.')
      .addDropdown((d) =>
        d
          .addOptions({
            plan: 'Plan',
            default: 'Ask (recommended)',
            acceptEdits: 'Auto-accept edits',
            bypassPermissions: 'Bypass - no prompts at all',
          })
          .setValue(this.plugin.settings.defaultPermissionMode)
          .onChange(async (v) => {
            this.plugin.settings.defaultPermissionMode = v as PermissionModeName;
            await this.plugin.saveSettings();
          }),
      );

    this.section(containerEl, '02', 'CONVERSATIONS');

    new Setting(containerEl)
      .setName('Context awareness')
      .setDesc('Send the note you have open and the text you have selected.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.contextAwareness).onChange(async (v) => {
          this.plugin.settings.contextAwareness = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Structured replies')
      .setDesc('Ask for the ICOR card format and render it natively. On by default; turn it off for plain chat.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.structuredReplies).onChange(async (v) => {
          this.plugin.settings.structuredReplies = v;
          await this.plugin.saveSettings();
        }),
      );

    this.section(containerEl, '03', 'STATUSLINE');
    /* ONE LINE, and it is documentation rather than an apology.
       A readout with no measurement behind it is ABSENT, so a first-run strip
       renders nothing and the feature can look like it was never built. The
       cure is NOT a line in the strip saying facts appear later - that is the
       placeholder defect wearing words, the same refusal as printing a zero.
       It belongs here, on the surface someone opens when they want to ask. */
    containerEl.createDiv({
      cls: 'aic-settings-note',
      text: MEASURED_NOTE,
    });

    /* EIGHT ROWS, in the strip's own render order, so the settings list and the
       strip agree and the user can read one against the other. The description
       is the readout's tooltip string VERBATIM, from the same source: two
       copies would be two things to keep true, and this row is also the reason
       the strip itself never needs a placeholder. An unmeasured readout is
       absent, and a user who wonders why reads it here.

       No master toggle and no reset-to-defaults. Eight toggles is eight
       toggles; a ninth control that changes the other eight is chrome about
       chrome. */
    for (const id of RENDER_ORDER) {
      const key = FACT_SETTING_KEYS[id];
      const lines = [...FACT_TOOLTIPS[id]];
      if (DROPPABLE.has(id)) lines.push(NARROW_NOTE);
      new Setting(containerEl)
        .setName(FACT_NAMES[id])
        .setDesc(lines.join(' '))
        .addToggle((t) =>
          t.setValue(this.plugin.settings[key] === true).onChange(async (v) => {
            // Narrowed through the map rather than asserted on the assignment:
            // every key in FACT_SETTING_KEYS names a boolean field, and this is
            // where that stays checkable.
            Object.assign(this.plugin.settings, { [key]: v });
            await this.plugin.saveSettings();
          }),
        );
    }

    this.section(containerEl, '04', 'SESSION ARCHIVE');

    new Setting(containerEl)
      .setName('Archive sessions into the vault')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.archiveEnabled).onChange(async (v) => {
          this.plugin.settings.archiveEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Archive folder')
      .setDesc(`Empty uses ${this.plugin.defaultArchiveFolder()}.`)
      .addText((t) =>
        t.setValue(this.plugin.settings.archiveFolder).onChange(async (v) => {
          this.plugin.settings.archiveFolder = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Keep archives for')
      .setDesc('Number of days. Zero keeps everything.')
      .addText((t) =>
        t.setValue(String(this.plugin.settings.archiveRetentionDays)).onChange(async (v) => {
          const n = Number.parseInt(v, 10);
          this.plugin.settings.archiveRetentionDays = Number.isFinite(n) && n >= 0 ? n : 0;
          await this.plugin.saveSettings();
        }),
      );

    this.section(containerEl, '05', 'ADVANCED');

    new Setting(containerEl)
      .setName('Vault layout')
      .setDesc('Where the AI Sessions folder lives.')
      .addDropdown((d) =>
        d
          .addOptions({ auto: 'Detect', scaffold: 'ICOR for Life', standalone: 'Standalone' })
          .setValue(this.plugin.settings.vaultMode)
          .onChange(async (v) => {
            this.plugin.settings.vaultMode = v as VaultMode;
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }

  private section(parent: HTMLElement, index: string, name: string): void {
    const head = parent.createDiv({ cls: 'aic-settings-section' });
    head.createSpan({ cls: 'aic-settings-index', text: index });
    head.createSpan({ cls: 'aic-settings-name', text: name });
  }
}
