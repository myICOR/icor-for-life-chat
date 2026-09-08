/* Plumbing only. Nothing here changes what the team says or how it thinks:
 * the vault's own CLAUDE.md governs behaviour, and the plugin never injects a
 * prompt of its own beyond the one opt-in structured-replies constant.
 *
 * TWO RENDER PATHS, ONE TABLE. Obsidian 1.13 renders this tab from
 * `getSettingDefinitions()` and indexes it for settings search - the directory
 * review flagged that this tab did neither, so its settings were invisible to
 * search for every user on 1.13. Older Obsidian calls `display()`. The floor is
 * 1.7.2, so both stay, and both are driven from `settingDefinitions()` in
 * definitions.ts so they cannot disagree. `display()` is deprecated on 1.13 and
 * is never called there once definitions are returned; it is the fallback and
 * nothing else, which is exactly the case the deprecation notice carves out. */

import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';
import type IcorChatPlugin from '../main';
import { availableProviders } from '../provider/registry';
import { controlKeys, isAction, isNote, settingDefinitions, validateRetention } from './definitions';
import type { ActionDefinition, ControlSpec, DefinitionInput, GroupDefinition, ItemDefinition } from './definitions';
import { offerInstall } from '../provider/install';
import { EngineSettingsSection } from './EngineSection';

/* The 1.13 shapes, derived from the class rather than imported by name.
   `SettingDefinitionItem` and friends are `@since 1.13.0`, and the manifest
   gate convicts a named import newer than the floor - correctly, since the
   floor is a promise to 1.7.2 users. A type derived from a method that already
   exists on the parent class is the same shape without the false promise. */
type Definitions = ReturnType<PluginSettingTab['getSettingDefinitions']>;
type Definition = Definitions[number];
/* A group, and what a group may hold: narrower than the top-level union (a
   group cannot nest a page), so the item mapper is typed to it directly rather
   than widened and cast back down. */
type Group = Extract<Definition, { type: 'group' | 'list' }>;
type GroupItem = NonNullable<Group['items']>[number];

export class ChatSettingsTab extends PluginSettingTab {
  /* `chat-mobile-engine-spec-v1.md` §3 - the own-key engine's whole settings
   * block. Its own class, not a row in `settingDefinitions()`'s table: it
   * reads and writes `OwnKeySettings` (per-device `localStorage`, never
   * `data.json`), which is exactly the thing that table's hygiene test
   * exists to keep OUT of a `ChatSettings` row. See EngineSection.ts's
   * header for the whole reasoning. One instance, mounted on both render
   * paths below, so the key field's reveal/testing state survives a
   * search-driven re-render on 1.13 the way any other row's state would. */
  private readonly engineSection: EngineSettingsSection;

  constructor(app: App, private readonly plugin: IcorChatPlugin) {
    super(app, plugin);
    this.engineSection = new EngineSettingsSection(app);
  }

  private input(): DefinitionInput {
    return {
      settings: this.plugin.settings,
      catalog: this.plugin.modelCatalog,
      defaultArchiveFolder: this.plugin.defaultArchiveFolder(),
      providers: availableProviders().map((p) => ({ id: p.id, displayName: p.displayName })),
      detections: this.plugin.detections,
      installations: Object.fromEntries(availableProviders().map((p) => [p.id, p.installation])),
    };
  }

  /* Both render paths end here when the settings window closes. The pasted
     key's draft lives in `engineSection`, not in the DOM Obsidian tears down,
     so it is cleared by hand (Vex A-2, 0.13.0). */
  override hide(): void {
    this.engineSection.discardDraft();
    super.hide();
  }

  /* ------------------------------------------------ 1.13: declarative */

  override getSettingDefinitions(): Definitions {
    return [this.engineGroup(), ...settingDefinitions(this.input()).map((group) => this.toGroup(group))];
  }

  /**
   * The one group `definitions.ts` never carries, because it is Obsidian-
   * dependent, stateful, and writes somewhere other than `data.json` - see
   * `EngineSection.ts`'s header. Built as a single `render`-only item, the
   * same escape hatch a note item already uses (`toItem`'s `isNote` branch)
   * to take over `setting.settingEl`'s DOM wholesale rather than being
   * bound to one `ControlSpec`.
   */
  private engineGroup(): Group {
    return {
      type: 'group',
      heading: '00 · AI engine on this device',
      cls: 'aic-settings-group',
      items: [
        {
          name: '',
          render: (setting: Setting) => {
            setting.setName('');
            setting.settingEl.addClass('aic-settings-engine-host');
            this.engineSection.render(setting.settingEl);
          },
        },
      ],
    };
  }

  private toGroup(group: GroupDefinition): Group {
    return {
      type: 'group' as const,
      heading: `${group.index} · ${group.heading}`,
      cls: 'aic-settings-group',
      items: group.items.map((item) => this.toItem(item)),
    };
  }

  private toItem(item: ItemDefinition): GroupItem {
    if (isAction(item)) {
      return {
        name: item.name,
        desc: item.desc,
        render: (setting: Setting) => this.renderActions(setting, item),
      };
    }
    if (isNote(item)) {
      const text = item.desc;
      return {
        name: item.name,
        desc: text,
        render: (setting: Setting) => {
          setting.setName('');
          setting.settingEl.addClass('aic-settings-note');
          setting.descEl.setText(text);
        },
      };
    }
    const c = item.control;
    const control =
      c.type === 'number'
        ? { ...c, validate: validateRetention }
        : c;
    return { name: item.name, desc: item.desc, control };
  }

  /* The framework reads and writes through these on 1.13. `saveSettings`
     rather than `saveData`, because saving also repaints the readout strip in
     every open pane: a fact switched on here has to appear without another
     message being sent, and that repaint lives in saveSettings. */
  override getControlValue(key: string): unknown {
    return this.record()[key];
  }

  /* Every ChatSettings value is a string, a number or a boolean, and typing the
     record that way is what makes `String(...)` below honest: there is no
     object here to stringify into '[object Object]'. */
  private record(): Record<string, string | number | boolean> {
    return this.plugin.settings as unknown as Record<string, string | number | boolean>;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    Object.assign(this.plugin.settings, { [key]: value });
    await this.plugin.saveSettings();
    /* The archive-folder description names the layout's default, and a layout
       change makes it stale until the tab is next opened. The 1.13 answer is
       `this.update()`, and it is deliberately NOT called: `update` is
       @since 1.13.0, the floor is 1.7.2, and the API lint convicts the call
       against that floor - rightly, a floor is a promise. `getSettingDefinitions`
       is re-run on every open, so the text catches up the next time the tab is
       shown. A stale description for one open beats a false floor. */
  }

  /* ----------------------------------------- < 1.13: imperative fallback */

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('aic-settings');
    containerEl.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    const engineHead = containerEl.createDiv({ cls: 'aic-settings-section' });
    engineHead.createSpan({ cls: 'aic-settings-index', text: '00' });
    engineHead.createSpan({ cls: 'aic-settings-name', text: 'AI ENGINE ON THIS DEVICE' });
    this.engineSection.render(containerEl.createDiv({ cls: 'aic-settings-engine-host' }));
    for (const group of settingDefinitions(this.input())) {
      const head = containerEl.createDiv({ cls: 'aic-settings-section' });
      head.createSpan({ cls: 'aic-settings-index', text: group.index });
      head.createSpan({ cls: 'aic-settings-name', text: group.heading.toUpperCase() });
      for (const item of group.items) this.renderItem(containerEl, item);
    }
  }

  private renderItem(parent: HTMLElement, item: ItemDefinition): void {
    if (isNote(item)) {
      parent.createDiv({ cls: 'aic-settings-note', text: item.desc });
      return;
    }
    if (isAction(item)) {
      this.renderActions(new Setting(parent).setName(item.name).setDesc(item.desc), item);
      return;
    }
    const row = new Setting(parent).setName(item.name);
    if (item.desc) row.setDesc(item.desc);
    this.bind(row, item.control);
  }

  /* The buttons of an install row. `install` never installs: it hands the
     vendor's line over (see provider/install.ts); `recheck` reruns detection
     and repaints, so a runtime installed a minute ago is found without a
     restart. The 1.13 declarative path cannot repaint through `update()`
     (below the floor), so the fallback tab is re-displayed and the 1.13 tab
     asks the member to reopen it. */
  private renderActions(setting: Setting, item: ActionDefinition): void {
    setting.settingEl.addClass('aic-settings-actions');
    for (const action of item.actions) {
      setting.addButton((b) => {
        b.setButtonText(action.label).setIcon(action.icon);
        if (action.run === 'install') b.setCta();
        b.onClick(() => void this.runAction(action));
      });
    }
  }

  private async runAction(action: ActionDefinition['actions'][number]): Promise<void> {
    const provider = availableProviders().find((p) => p.id === action.provider);
    if (!provider) return;
    if (action.run === 'install') {
      await offerInstall(this.app, provider, this.plugin.vaultPath);
      return;
    }
    if (action.run === 'page') {
      window.open(provider.installation.page, '_blank');
      return;
    }
    await this.plugin.refreshDetections();
    const found = this.plugin.detections[action.provider]?.found === true;
    new Notice(found ? `${provider.displayName} found. Reopen the settings tab to see it.` : `${provider.displayName} is still not found.`);
    this.display();
  }

  private bind(row: Setting, c: ControlSpec): void {
    const settings = this.record();
    const save = async (value: unknown): Promise<void> => {
      Object.assign(this.plugin.settings, { [c.key]: value });
      await this.plugin.saveSettings();
      if (c.key === 'vaultMode') this.display();
    };
    switch (c.type) {
      case 'toggle':
        row.addToggle((t) => t.setValue(settings[c.key] === true).onChange((v) => void save(v)));
        return;
      case 'text':
        row.addText((t) => {
          if (c.placeholder) t.setPlaceholder(c.placeholder);
          t.setValue(String(settings[c.key] ?? '')).onChange((v) => void save(v));
        });
        return;
      case 'textarea':
        row.addTextArea((t) => t.setValue(String(settings[c.key] ?? '')).onChange((v) => void save(v)));
        return;
      case 'dropdown':
        row.addDropdown((d) => d.addOptions(c.options).setValue(String(settings[c.key] ?? '')).onChange((v) => void save(v)));
        return;
      case 'number':
        row.addText((t) =>
          t.setValue(String(settings[c.key] ?? 0)).onChange((v) => {
            const n = Number.parseInt(v, 10);
            void save(validateRetention(n) === undefined ? n : 0);
          }),
        );
        return;
      default:
        return;
    }
  }
}

/** The keys the table persists, exported for the coverage gate. */
export { controlKeys };
