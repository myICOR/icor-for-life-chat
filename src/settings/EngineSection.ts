/* THE "AI ENGINE ON THIS DEVICE" SETTINGS SECTION.
 * `chat-mobile-engine-spec-v1.md` section 3, exactly (Felix, 2026-09-06,
 * Tom decision m3a).
 *
 * Deliberately NOT part of `definitions.ts`'s data-driven table. That table
 * exists so `ChatSettings` (persisted to `data.json`, replicated through
 * Obsidian Sync) and its rows can never drift - one key, one row, a hygiene
 * test that fails on either side being incomplete. Everything this section
 * reads and writes is the OPPOSITE of that on purpose: `OwnKeySettings`
 * (`src/engine/credentials.ts`) lives in `app.saveLocalStorage`, per device,
 * never in `data.json` - "Your key stays on this device" has to be true of
 * the STORAGE, not just the label next to it, or a synced default could
 * carry a key along the day Obsidian Sync is turned on. A data-driven row
 * bound to a `ChatSettings` key literally cannot write anywhere else, which
 * is exactly why this section is hand-built instead: live interactive state
 * (the key field's mask, "Testing...", the model list swapping when the
 * provider changes) that no declarative row shape covers either.
 *
 * `SettingsTab.ts` mounts one instance of this class into a container on
 * both its render paths (the 1.13 declarative group's `render(setting)`
 * escape hatch, and `display()`'s plain container) - see its own comments
 * for how a single item can host a container this size. */

import { Notice, Platform, Setting } from 'obsidian';
import type { App } from 'obsidian';
import {
  ANTHROPIC_PRICES, DEFAULT_MODEL_FOR, GET_KEY_URL_FOR, MODEL_PROVIDER_IDS, MODEL_PROVIDER_NAMES,
  activeApiKey, isModelProviderId, loadOwnKeySettings, maskKey, resolveTransports, saveOwnKeySettings, testProviderKey,
} from '../engine';
import type { EngineChoice, OwnKeySettings } from '../engine';

/** The always-visible billing notice, verbatim from the spec - four lines,
 * never collapsed, never dismissed. A member who has not opened Settings in
 * months still reads this the first time they look, because it is not a
 * one-time toast; it is what "AI engine on this device" always says under
 * "My own API key". */
const OWN_KEY_NOTICE: readonly string[] = [
  'This is a different kind of use.',
  'With your own key, every message is billed by the provider you choose, per use.',
  'It is not included in, and separate from, a Claude Pro or Max subscription.',
  'Your key stays on this device. myICOR never sees it.',
];

export class EngineSettingsSection {
  /** Per-open-tab UI state that is not itself a saved setting: whether the
   * key field currently shows plain text, and the last "Test key" result. */
  private revealed = false;
  private testResult: { ok: boolean; message: string } | null = null;
  private testing = false;

  constructor(private readonly app: App) {}

  /** Renders (and, on every change, re-renders) the whole section into
   * `container`. `container` is emptied first, so a caller can pass either a
   * plain div (`display()`'s fallback path) or a `Setting`'s own `settingEl`
   * (the 1.13 declarative path) without caring which. */
  render(container: HTMLElement): void {
    container.empty();
    container.addClass('aic-engine-section');
    const settings = loadOwnKeySettings(this.app);

    this.renderRadio(container, settings);
    if (settings.engine === 'own-key') this.renderOwnKeyBlock(container, settings);
  }

  private save(container: HTMLElement, next: OwnKeySettings): void {
    saveOwnKeySettings(this.app, next);
    this.render(container);
  }

  /* -------------------------------------------------------------- radio */

  private renderRadio(container: HTMLElement, settings: OwnKeySettings): void {
    const fieldset = container.createEl('fieldset', { cls: 'aic-engine-radio' });
    fieldset.createEl('legend', { text: 'AI engine on this device', cls: 'aic-engine-radio-legend' });

    const claudeRow = this.radioRow(
      fieldset,
      'aic-engine-choice',
      'claude-code',
      'Claude Code on this computer',
      settings.engine === 'claude-code',
      !Platform.isDesktopApp,
      Platform.isDesktopApp ? undefined : 'Not available on phones and tablets.',
      (choice) => this.save(container, { ...settings, engine: choice }),
    );
    if (!Platform.isDesktopApp) claudeRow.addClass('is-disabled');

    this.radioRow(
      fieldset,
      'aic-engine-choice',
      'own-key',
      'My own API key',
      settings.engine === 'own-key',
      false,
      undefined,
      (choice) => this.save(container, { ...settings, engine: choice }),
    );
  }

  private radioRow(
    fieldset: HTMLElement,
    name: string,
    value: EngineChoice,
    label: string,
    checked: boolean,
    disabled: boolean,
    note: string | undefined,
    onSelect: (value: EngineChoice) => void,
  ): HTMLElement {
    const row = fieldset.createEl('label', { cls: 'aic-engine-radio-row' });
    const input = row.createEl('input', { type: 'radio', attr: { name } });
    input.checked = checked;
    input.disabled = disabled;
    input.value = value;
    input.addEventListener('change', () => {
      if (input.checked) onSelect(value);
    });
    row.createSpan({ text: label, cls: 'aic-engine-radio-label' });
    if (note) row.createSpan({ text: note, cls: 'aic-engine-radio-note' });
    return row;
  }

  /* --------------------------------------------------------- own-key block */

  private renderOwnKeyBlock(container: HTMLElement, settings: OwnKeySettings): void {
    const block = container.createDiv({ cls: 'aic-own-key-block' });

    /* THE NOTICE. Framed, not collapsible - a `<div>` with its own border
     * from `styles.css`'s own-key region, never a `<details>`. */
    const notice = block.createDiv({ cls: 'aic-own-key-notice' });
    for (const line of OWN_KEY_NOTICE) notice.createEl('p', { text: line });

    new Setting(block)
      .setName('Provider')
      .setDesc('Which model API this device sends your messages to.')
      .addDropdown((d) => {
        for (const id of MODEL_PROVIDER_IDS) d.addOption(id, MODEL_PROVIDER_NAMES[id]);
        d.setValue(settings.provider).onChange((value) => {
          if (!isModelProviderId(value)) return;
          // A provider switch invalidates the last test result and any
          // free-text OpenRouter model typed for the OTHER provider - not
          // the key, which is kept per provider already
          // (`anthropicApiKey` / `openrouterApiKey` are separate fields).
          this.testResult = null;
          this.save(container, { ...settings, provider: value });
        });
      });

    this.renderKeyRow(container, block, settings);
    this.renderModelRow(container, block, settings);

    new Setting(block)
      .setName('Max output tokens per reply')
      .setDesc('The budget guard for a single reply. 4,000 is the default.')
      .addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = '1';
        t.setValue(String(settings.maxTokens));
        t.onChange((raw) => {
          const n = Number.parseInt(raw, 10);
          if (Number.isFinite(n) && n > 0) this.save(container, { ...settings, maxTokens: Math.trunc(n) });
        });
      });
  }

  /* ----------------------------------------------------------- the key row */

  private renderKeyRow(container: HTMLElement, block: HTMLElement, settings: OwnKeySettings): void {
    const key = activeApiKey(settings);
    const setting = new Setting(block)
      .setName(`${MODEL_PROVIDER_NAMES[settings.provider]} API key`)
      .setDesc(
        key.trim()
          ? `A key is set (${maskKey(key)}). Paste a new one to replace it.`
          : 'No key is set yet. Paste one from your provider account.',
      );

    setting.addText((t) => {
      t.inputEl.type = this.revealed ? 'text' : 'password';
      t.inputEl.setAttr('autocomplete', 'off');
      t.inputEl.setAttr('spellcheck', 'false');
      t.setPlaceholder(`Paste your ${MODEL_PROVIDER_NAMES[settings.provider]} key`);
      t.setValue(key);
      t.onChange((value) => {
        const field = settings.provider === 'anthropic' ? 'anthropicApiKey' : 'openrouterApiKey';
        saveOwnKeySettings(this.app, { ...settings, [field]: value });
        // No full re-render on every keystroke - that would steal focus and
        // the caret mid-paste. The masked-preview text above catches up the
        // next time this section renders (a provider switch, a radio flip).
      });
    });

    setting.addExtraButton((b) => {
      b.setIcon(this.revealed ? 'eye-off' : 'eye');
      b.setTooltip(this.revealed ? 'Hide the key' : 'Show the key');
      b.onClick(() => {
        this.revealed = !this.revealed;
        this.render(container);
      });
    });

    setting.addButton((b) => {
      b.setButtonText(this.testing ? 'Testing…' : 'Test key');
      b.setDisabled(this.testing);
      b.onClick(() => void this.runTest(container, settings));
    });

    if (this.testResult) {
      const resultEl = block.createDiv({ cls: 'aic-own-key-test-result' });
      resultEl.toggleClass('is-ok', this.testResult.ok);
      resultEl.toggleClass('is-error', !this.testResult.ok);
      resultEl.setText(this.testResult.message);
    }

    const getKey = block.createDiv({ cls: 'aic-own-key-getkey' });
    const link = getKey.createEl('a', {
      text: `Get a ${MODEL_PROVIDER_NAMES[settings.provider]} key`,
      href: GET_KEY_URL_FOR[settings.provider],
    });
    link.setAttr('target', '_blank');
    link.setAttr('rel', 'noopener');
  }

  private async runTest(container: HTMLElement, settings: OwnKeySettings): Promise<void> {
    const key = activeApiKey(settings);
    this.testing = true;
    this.testResult = null;
    this.render(container);
    const controller = new AbortController();
    const result = await testProviderKey(settings.provider, key, resolveTransports(), controller.signal);
    this.testing = false;
    this.testResult = result;
    this.render(container);
    if (!result.ok) new Notice(result.message, 8000);
  }

  /* --------------------------------------------------------------- model */

  private renderModelRow(container: HTMLElement, block: HTMLElement, settings: OwnKeySettings): void {
    const setting = new Setting(block).setName('Model');
    if (settings.provider === 'anthropic') {
      setting.setDesc('The models this build has a price for; an unlisted id still works, priced or not.');
      setting.addDropdown((d) => {
        d.addOption('', `Default (${DEFAULT_MODEL_FOR.anthropic})`);
        for (const row of ANTHROPIC_PRICES) d.addOption(row.prefix, row.displayName);
        const stored = settings.model.trim();
        if (stored && !ANTHROPIC_PRICES.some((r) => r.prefix === stored)) d.addOption(stored, stored);
        d.setValue(stored);
        d.onChange((value) => this.save(container, { ...settings, model: value }));
      });
      return;
    }
    setting.setDesc(`Free text - any model id OpenRouter serves. Empty uses ${DEFAULT_MODEL_FOR.openrouter}.`);
    setting.addText((t) => {
      t.setPlaceholder(DEFAULT_MODEL_FOR.openrouter);
      t.setValue(settings.model);
      t.onChange((value) => saveOwnKeySettings(this.app, { ...settings, model: value }));
    });
  }
}
