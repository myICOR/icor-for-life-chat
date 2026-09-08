/* THE "AI ENGINE ON THIS DEVICE" SETTINGS SECTION.
 * `chat-mobile-engine-spec-v1.md` section 3, exactly (Felix, 2026-09-06,
 * Tom decision m3a), plus the suite-wide secrets contract (task
 * tsk-2026-09-08-005, 0.13.0): the keys themselves live in Obsidian's
 * keychain or in an env file in the vault, never in this record and never
 * in `data.json`, and this section is where a member picks which, sees
 * where each key is, and moves one between the two.
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
 * (the key field's draft, "Testing...", the status lines filled in after an
 * async read of the env file, the model list swapping when the provider
 * changes) that no declarative row shape covers either.
 *
 * THE KEY IS NEVER SHOWN BACK. The input is write-only: a password field
 * that is emptied after Save, no reveal toggle, no masked preview in a
 * description, nothing in a Notice. What the tab says about a key is WHERE
 * one exists (`keyStatusLine`), and only that.
 *
 * `SettingsTab.ts` mounts one instance of this class into a container on
 * both its render paths (the 1.13 declarative group's `render(setting)`
 * escape hatch, and `display()`'s plain container) - see its own comments
 * for how a single item can host a container this size. */

import { Notice, Platform, Setting } from 'obsidian';
import type { App } from 'obsidian';
import {
  ANTHROPIC_PRICES, BACKEND_LABEL, BACKEND_OPTIONS, DEFAULT_MODEL_FOR, GET_KEY_URL_FOR, MODEL_PROVIDER_IDS,
  MODEL_PROVIDER_NAMES, SECRETS_BACKENDS, effectiveBackend, isModelProviderId, isSecretsBackend, keyPresence,
  keyStatusLine, loadOwnKeySettings, missingKeyMessage, moveProviderKey, otherBackend, presentIn, readProviderKey,
  resolveTransports, saveOwnKeySettings, secretStorageOf, testProviderKey, writeProviderKey, vaultPathRefusal,
} from '../engine';
import type { EngineChoice, KeyHosts, KeyPresence, ModelProviderId, OwnKeySettings, SecretsBackend } from '../engine';

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
  /** Per-open-tab UI state that is not itself a saved setting: the key the
   * member has typed but not yet saved, whether a test or a move is running,
   * and the last "Test key" result. */
  private draft = '';
  private testResult: { ok: boolean; message: string } | null = null;
  private testing = false;
  private moving = false;
  /* Each render gets a number; an async read that finishes after a newer
   * render compares its number and paints nothing. */
  private renderSeq = 0;

  constructor(private readonly app: App) {}

  /** Called from the tab's `hide()` (Vex A-2, 0.13.0): a key pasted and never
   * saved must not outlive the settings window. The section is built once per
   * plugin load, so without this the draft would be painted back into the
   * password field the next time Settings opens, until unload. */
  discardDraft(): void {
    this.draft = '';
    this.testResult = null;
  }

  /** Renders (and, on every change, re-renders) the whole section into
   * `container`. `container` is emptied first, so a caller can pass either a
   * plain div (`display()`'s fallback path) or a `Setting`'s own `settingEl`
   * (the 1.13 declarative path) without caring which. */
  render(container: HTMLElement): void {
    this.renderSeq += 1;
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

  /** The store, the adapter and the env path, for `secrets.ts`'s door. The
   * adapter satisfies `EnvFileHost` structurally; nothing here calls it. */
  private hosts(settings: OwnKeySettings): KeyHosts {
    return { store: secretStorageOf(this.app), env: this.app.vault.adapter, envFilePath: settings.envFilePath };
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
          // A provider switch invalidates the last test result, the unsaved
          // draft, and any free-text OpenRouter model typed for the OTHER
          // provider - not a saved key, which is kept per provider in
          // whichever backend holds it.
          this.testResult = null;
          this.draft = '';
          this.save(container, { ...settings, provider: value });
        });
      });

    const hosts = this.hosts(settings);
    const backend = effectiveBackend(settings.secretsBackend, hosts.store);
    this.renderBackendRow(container, block, settings, hosts, backend);
    this.renderEnvPathRow(container, block, settings);
    for (const provider of MODEL_PROVIDER_IDS) this.renderStatusRow(container, block, hosts, backend, provider);
    this.renderKeyRow(container, block, settings, hosts, backend);
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

  /* --------------------------------------------------- where the keys live */

  private renderBackendRow(
    container: HTMLElement,
    block: HTMLElement,
    settings: OwnKeySettings,
    hosts: KeyHosts,
    backend: SecretsBackend,
  ): void {
    const hasStore = hosts.store !== null;
    const row = new Setting(block).setName('Where your keys live');
    row.setDesc(
      hasStore
        ? `Keys are read from ${BACKEND_LABEL[backend]} only. Choosing the other place moves nothing by itself; use the Move buttons below.`
        : "This Obsidian is older than 1.11.4 and has no keychain, so the env file is the only place. Update Obsidian to keep keys in Obsidian's keychain (Settings, General, Keychain).",
    );
    row.addDropdown((d) => {
      for (const id of SECRETS_BACKENDS) d.addOption(id, BACKEND_OPTIONS[id]);
      d.setValue(backend);
      d.setDisabled(!hasStore);
      d.onChange((value) => {
        if (!isSecretsBackend(value)) return;
        this.testResult = null;
        this.save(container, { ...settings, secretsBackend: value });
      });
    });
  }

  private renderEnvPathRow(container: HTMLElement, block: HTMLElement, settings: OwnKeySettings): void {
    new Setting(block)
      .setName('Env file location')
      .setDesc('Vault-relative. One variable per line as name=value; the plugin rewrites only its own lines and leaves the rest of the file exactly as it was.')
      .addText((t) => {
        t.setPlaceholder(settings.envFilePath);
        t.setValue(settings.envFilePath);
        t.inputEl.setAttr('spellcheck', 'false');
        t.onChange((value) => saveOwnKeySettings(this.app, { ...settings, envFilePath: value }));
        // The status lines read the file, so they catch up once the member
        // leaves the field - never on every keystroke, which would steal
        // focus and read a half-typed path. A path outside the vault is
        // refused here in the Planner's words (Vex A-1); `saveOwnKeySettings`
        // has already stored the default in its place, and the repaint shows
        // that default, so what the tab shows is what the plugin reads.
        t.inputEl.addEventListener('change', () => {
          const refusal = vaultPathRefusal(t.inputEl.value);
          if (refusal) new Notice(refusal, 8000);
          this.render(container);
        });
      });
  }

  /* ---------------------------------------------------- per-key status */

  private renderStatusRow(
    container: HTMLElement,
    block: HTMLElement,
    hosts: KeyHosts,
    backend: SecretsBackend,
    provider: ModelProviderId,
  ): void {
    const row = new Setting(block).setName(`${MODEL_PROVIDER_NAMES[provider]} key`).setDesc('Checking where a key is stored…');
    row.settingEl.addClass('aic-own-key-status');
    const seq = this.renderSeq;
    void keyPresence(hosts, provider).then((presence) => {
      if (seq !== this.renderSeq) return;
      row.setDesc(keyStatusLine(presence, backend));
      const from = otherBackend(backend);
      if (!presentIn(presence, from)) return;
      row.addButton((b) => {
        b.setButtonText(`Move to ${BACKEND_LABEL[backend]}`);
        b.setTooltip(`Copy the ${MODEL_PROVIDER_NAMES[provider]} key into ${BACKEND_LABEL[backend]} and blank it in ${BACKEND_LABEL[from]}.`);
        b.setDisabled(this.moving || (backend === 'secret-storage' && hosts.store === null));
        b.onClick(() => void this.runMove(container, hosts, from, backend, provider));
      });
    }).catch(() => {
      if (seq !== this.renderSeq) return;
      row.setDesc('Could not read the env file. Check the location above.');
    });
  }

  private async runMove(
    container: HTMLElement,
    hosts: KeyHosts,
    from: SecretsBackend,
    to: SecretsBackend,
    provider: ModelProviderId,
  ): Promise<void> {
    this.moving = true;
    try {
      const moved = await moveProviderKey(hosts, from, to, provider);
      new Notice(
        moved
          ? `${MODEL_PROVIDER_NAMES[provider]} key moved to ${BACKEND_LABEL[to]}.`
          : `There is no ${MODEL_PROVIDER_NAMES[provider]} key in ${BACKEND_LABEL[from]} to move.`,
      );
    } catch (error) {
      new Notice(`Could not move the key: ${error instanceof Error ? error.message : 'unknown error'}`, 8000);
    } finally {
      this.moving = false;
      this.render(container);
    }
  }

  /* ----------------------------------------------------------- the key row */

  private renderKeyRow(
    container: HTMLElement,
    block: HTMLElement,
    settings: OwnKeySettings,
    hosts: KeyHosts,
    backend: SecretsBackend,
  ): void {
    const name = MODEL_PROVIDER_NAMES[settings.provider];
    const setting = new Setting(block)
      .setName(`New ${name} key`)
      .setDesc(`Saved into ${BACKEND_LABEL[backend]} on this device. The field is emptied after Save and the key is never shown again.`);

    let saveNow: () => void = () => undefined;
    setting.addText((t) => {
      t.inputEl.type = 'password';
      t.inputEl.setAttr('autocomplete', 'off');
      t.inputEl.setAttr('spellcheck', 'false');
      t.inputEl.setAttr('aria-label', `${name} API key`);
      t.setPlaceholder(`Paste your ${name} key`);
      t.setValue(this.draft);
      t.onChange((value) => {
        this.draft = value;
      });
      t.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveNow();
        }
      });
      saveNow = () => {
        void this.runSave(container, settings, hosts, backend, t.inputEl);
      };
    });

    setting.addButton((b) => {
      b.setButtonText('Save');
      b.setCta();
      b.onClick(() => saveNow());
    });

    setting.addButton((b) => {
      b.setButtonText(this.testing ? 'Testing…' : 'Test key');
      b.setDisabled(this.testing);
      b.onClick(() => void this.runTest(container, settings, hosts, backend));
    });

    if (this.testResult) {
      const resultEl = block.createDiv({ cls: 'aic-own-key-test-result' });
      resultEl.toggleClass('is-ok', this.testResult.ok);
      resultEl.toggleClass('is-error', !this.testResult.ok);
      resultEl.setText(this.testResult.message);
    }

    /* The one sentence for "the backend I chose has no key for this
     * provider". Filled after the async read; absent while a key is there. */
    const missing = block.createDiv({ cls: 'aic-own-key-missing' });
    missing.setAttr('role', 'status');
    const seq = this.renderSeq;
    void keyPresence(hosts, settings.provider).then((presence: KeyPresence) => {
      if (seq !== this.renderSeq) return;
      if (!presentIn(presence, backend)) missing.setText(missingKeyMessage(settings.provider, backend));
    }).catch(() => undefined);

    const getKey = block.createDiv({ cls: 'aic-own-key-getkey' });
    const link = getKey.createEl('a', {
      text: `Get a ${name} key`,
      href: GET_KEY_URL_FOR[settings.provider],
    });
    link.setAttr('target', '_blank');
    link.setAttr('rel', 'noopener');
  }

  private async runSave(
    container: HTMLElement,
    settings: OwnKeySettings,
    hosts: KeyHosts,
    backend: SecretsBackend,
    inputEl: HTMLInputElement,
  ): Promise<void> {
    const value = this.draft.trim();
    if (!value) {
      new Notice('Paste a key first.');
      return;
    }
    try {
      await writeProviderKey(hosts, backend, settings.provider, value);
    } catch (error) {
      new Notice(`Could not save the key: ${error instanceof Error ? error.message : 'unknown error'}`, 8000);
      return;
    }
    // Cleared BEFORE anything else can read it back: the draft, the field.
    this.draft = '';
    inputEl.value = '';
    this.testResult = null;
    new Notice(`${MODEL_PROVIDER_NAMES[settings.provider]} key saved to ${BACKEND_LABEL[backend]}.`);
    this.render(container);
  }

  private async runTest(
    container: HTMLElement,
    settings: OwnKeySettings,
    hosts: KeyHosts,
    backend: SecretsBackend,
  ): Promise<void> {
    this.testing = true;
    this.testResult = null;
    this.render(container);
    let result: { ok: boolean; message: string };
    try {
      const key = await readProviderKey(hosts, backend, settings.provider);
      result = key
        ? await testProviderKey(settings.provider, key, resolveTransports(), new AbortController().signal)
        : { ok: false, message: missingKeyMessage(settings.provider, backend) };
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : 'Could not read the key.' };
    }
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
