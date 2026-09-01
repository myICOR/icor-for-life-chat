/* The composer card: one card, rounded, no dividers, two rows.
 *
 * Row 1 the textarea (with the attachment strip, the awareness tray and the
 * open-decisions badge above it), row 2 the action row. The send pill is the
 * view's one loud marker moment; nothing else in this card may take a solid
 * fill.
 *
 * The statusline strip is NOT a third row and never was: the pane census
 * makes it rung 4, a SIBLING of this card. It used to be created here, which
 * put a non-focusable readout inside this card's `:focus-within` affordance -
 * chrome lighting up as part of the input's focus state. The view mounts it as
 * the pane's last child instead, and nothing below may walk that back: every
 * control this file adds is INSIDE the card because it is focusable and the
 * card's affordance is honest about it.
 *
 * THE THREE PICKERS SHOW ONE VALUE AND OPEN A MENU. They used to be a
 * four-button segmented row plus two click-to-cycle buttons: the row spent
 * horizontal space showing three values nobody had chosen, and cycling hides
 * the option set behind repeated clicks so the user cannot see what exists
 * without changing state. The mode trigger keeps `.aic-seg-btn` with the live
 * `is-active` + `data-tone` pair, so it is still the element the contrast gate
 * measures per tone.
 *
 * THE MODEL TRIGGER NEVER SAYS "DEFAULT". A label that reads "default" is
 * technically true and tells the user nothing about what will answer them. The
 * catalogue comes from the SDK's own `supportedModels()`, so the name shown is
 * the provider's `displayName` and never one assembled here. Until a session
 * has reported a model AND the catalogue has arrived, the trigger reads
 * "Model": no measurement, no fact. */

import { Menu, setIcon, setTooltip } from 'obsidian';
import type { EffortName, ModelChoice, PermissionModeName } from '../../model/types';
import { applyCommand, filterCommands, normalizeCommands, slashQuery } from './slash';
import { applyMention, filterMentions, mentionQuery } from './mention';
import type { MentionFile } from './mention';

const MODES: Array<{ id: PermissionModeName; label: string }> = [
  { id: 'plan', label: 'Plan' },
  { id: 'default', label: 'Ask' },
  { id: 'acceptEdits', label: 'Auto' },
  { id: 'bypassPermissions', label: 'Bypass' },
];

/* 'xhigh' is the SDK's name and "Extra" is the word for it in the UI: the
 * levels are a ladder and the label has to read as one rung above High. */
const EFFORTS: Array<{ id: EffortName; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra' },
];

/** What an image attachment costs to carry: the bytes, and how to show them. */
export interface Attachment {
  /** Stable within one composer instance; the remove button's whole handle. */
  id: string;
  name: string;
  mediaType: string;
  /** Raw base64, no data: prefix. What the SDK's image block wants. */
  data: string;
  /** A data: URL for the thumbnail, built once at attach time. */
  previewUrl: string;
}

/* The image types the API's own image block accepts. A file the API will
 * reject is refused at the composer rather than sent and failed mid-turn,
 * because a rejection there arrives as a wall of provider error text. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** One counter per plugin load; see `slashId`. */
let composerSeq = 0;

/** A row the picker can show, whichever source produced it. */
interface PickerRow {
  /** What accepting it inserts: a command name, or a vault-relative path. */
  id: string;
  label: string;
  /** The folder, for mentions. Empty when there is nothing to disambiguate. */
  detail: string;
  prefix: string;
}

/* 5MB per image, which is the API's own per-image ceiling. Checked on the raw
 * bytes rather than on the base64, because base64 inflates by a third and a
 * limit applied to the encoded form would reject files the API accepts. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ComposerCallbacks {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onModeChange: (mode: PermissionModeName) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: EffortName) => void;
  /** Something the user did that could not be honoured, in their words. */
  onNotice?: (message: string) => void;
}

export interface ComposerState {
  streaming: boolean;
  mode: PermissionModeName;
  model: string;
  effort: EffortName;
}

export class Composer {
  readonly el: HTMLElement;
  private readonly badgeSlot: HTMLElement;
  private readonly thumbsEl: HTMLElement;
  private readonly trayEl: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly modeEl: HTMLElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly modelBtn: HTMLButtonElement;
  private readonly effortBtn: HTMLButtonElement;
  private readonly sendBtn: HTMLButtonElement;
  /** Rung 4 lives INSIDE the card now; see the note over its creation. */
  readonly factsEl: HTMLElement;
  private readonly slashEl: HTMLElement;
  private slashNames: string[] = [];
  /* ONE PICKER, TWO SOURCES. `/` and `@` differ only in where the query comes
     from and what accepting one types; everything about opening, filtering,
     arrowing and dismissing is identical. Two pickers would be two places for
     the Enter-key handling to drift apart. */
  private picker: PickerRow[] = [];
  private pickerKind: 'slash' | 'mention' = 'slash';
  private slashActive = 0;
  private slashOpen = false;
  /** The vault's notes, supplied by the view. Empty until it hands them over. */
  private mentionFiles: readonly MentionFile[] = [];
  private state: ComposerState;
  /** The SDK's catalogue, or null while it has not answered yet. */
  private catalog: ModelChoice[] | null = null;
  /** The model the SESSION reported, which outranks the configured choice. */
  private resolvedModel: string | null = null;
  private attachments: Attachment[] = [];
  private attachSeq = 0;
  /* A document-wide id, and a vault can hold two chat tabs: without the counter
     the second pane's `aria-activedescendant` would name the FIRST pane's row. */
  private readonly slashId = `aic-slash-${composerSeq++}`;

  constructor(parent: HTMLElement, initial: ComposerState, private readonly cb: ComposerCallbacks) {
    this.state = { ...initial };
    this.el = parent.createDiv({ cls: 'aic-composer' });
    this.badgeSlot = this.el.createDiv({ cls: 'aic-badge-slot' });
    this.thumbsEl = this.el.createDiv({ cls: 'aic-thumbs is-empty' });
    this.trayEl = this.el.createDiv({ cls: 'aic-tray' });
    this.textarea = this.el.createEl('textarea', { cls: 'aic-input' });
    this.textarea.rows = 1;
    this.textarea.placeholder = 'Ask the team. @ mentions files, / runs commands';
    this.textarea.setAttr('aria-label', 'Message the AI team');

    const action = this.el.createDiv({ cls: 'aic-action' });
    /* The mode trigger keeps the segmented button's class and its tone pair.
       The wrapper survives because the contrast gate reaches the chip through
       `.aic-seg-btn.is-active[data-tone=...]`, and because a picker that
       changed class would silently leave those four measurements pointing at
       an element that no longer exists - a sweep going green by absence. */
    this.modeEl = action.createDiv({ cls: 'aic-seg' });
    this.modeBtn = this.modeEl.createEl('button', { cls: 'aic-seg-btn', type: 'button' });
    this.modeBtn.addEventListener('click', (ev) => this.openModeMenu(ev));

    this.modelBtn = action.createEl('button', { cls: 'aic-text-btn', type: 'button' });
    this.modelBtn.addEventListener('click', (ev) => this.openModelMenu(ev));
    this.effortBtn = action.createEl('button', { cls: 'aic-text-btn', type: 'button' });
    this.effortBtn.addEventListener('click', (ev) => this.openEffortMenu(ev));

    /* THE FACT THAT THESE OPEN A MENU, stated where a screen reader can hear
       it. The chevron was the only thing that ever said so, and it said it to
       nobody: it carried `aria-hidden`, correctly, because a glyph announcing
       "chevron down" is noise. So removing it took away the sighted
       affordance and revealed that the other one was never built. `aria-
       haspopup` is the affordance; the arrow was its picture. */
    for (const btn of [this.modeBtn, this.modelBtn, this.effortBtn]) {
      btn.setAttr('aria-haspopup', 'menu');
    }
    /* THE ATTACH BUTTON IS GONE, and removing it is the honest move.
     *
       It could not attach anything. Clicking it raised a toast telling the user
       to paste or drop an image instead, which is a control whose entire
       function is to explain that it has none - and it sat in the action row
       looking exactly as operable as the three pickers beside it. Paste and
       drop are wired on the card itself and are what the placeholder and the
       toast were both pointing at, so nothing was lost with it. */
    action.createDiv({ cls: 'aic-action-spacer' });
    this.sendBtn = action.createEl('button', { cls: 'aic-send', type: 'button' });

    /* RUNG 4, THE READOUT STRIP, inside the card and below the action row.
     *
       It was the pane's last child, a sibling of this card, and on a right
       sidebar Obsidian's own status bar is painted straight over that band: the
       strip rendered perfectly and was invisible. Inside the card it clears the
       bar, and the card's bottom padding is pulled back so the hairline still
       spans edge to edge.

       The old placement had a real reason and it has since been retired
       independently. The card's focus affordance is `:has(> textarea.aic-input:
       focus)`, a DIRECT-child trigger, so a non-focusable readout in here can no
       longer light up as part of the input's focus state - which was the entire
       argument for keeping it outside. The property that mattered is enforced
       by the selector now, not by the geometry. */
    this.factsEl = this.el.createDiv({ cls: 'aic-facts' });

    /* The command picker, positioned over the card rather than inside its flow:
       a list that pushed the textarea down would move the target the user is
       typing at, every keystroke. */
    this.slashEl = this.el.createDiv({ cls: 'aic-slash' });
    this.slashEl.id = this.slashId;
    this.slashEl.setAttr('role', 'listbox');
    this.slashEl.setAttr('aria-label', 'Slash commands');
    /* The field is the combobox and the list is what it controls, stated so a
       screen reader announces the row the arrow keys are moving over. Without
       these the picker is visible chrome that nothing narrates. */
    this.textarea.setAttr('role', 'combobox');
    this.textarea.setAttr('aria-autocomplete', 'list');
    this.textarea.setAttr('aria-controls', this.slashId);
    this.closeSlash();

    this.sendBtn.addEventListener('click', () => this.fire());
    this.textarea.addEventListener('input', () => {
      this.autoGrow();
      this.refreshSlash();
      // The send pill's enabled state is derived from the textarea, so it has
      // to be re-derived when the textarea changes. Without this the pill only
      // ever left `disabled` on a full repaint, which nothing on the typing
      // path triggers - the view's one marker moment was unreachable by typing.
      this.syncSend();
    });
    this.textarea.addEventListener('keydown', (ev: KeyboardEvent) => {
      /* The picker owns these keys while it is open, and only while it is open.
         Enter must accept the highlighted command rather than send: a list you
         can see but cannot choose from with the keyboard is a list that forces
         the mouse. */
      if (this.slashOpen && !ev.isComposing) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const step = ev.key === 'ArrowDown' ? 1 : -1;
          const n = this.picker.length;
          if (n > 0) this.slashActive = (this.slashActive + step + n) % n;
          this.paintSlash();
          return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          ev.preventDefault();
          this.accept(this.picker[this.slashActive]);
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          this.closeSlash();
          return;
        }
      }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        this.fire();
      }
    });
    /* Moving the caret changes the answer without changing the text: clicking
       behind the slash, or arrowing out of the word, has to close the picker. */
    this.textarea.addEventListener('keyup', (ev: KeyboardEvent) => {
      if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') this.refreshSlash();
    });
    this.textarea.addEventListener('click', () => this.refreshSlash());
    /* THE CARD'S FOCUS AFFORDANCE, driven from here. The stylesheet used to
       derive it with `:has(> textarea:focus)`; the directory's CSS lint flags
       `:has` for its invalidation cost, and this component already owns the
       field's focus. The rule is unchanged - the card steps for the TEXTAREA
       and for no other control inside it - only the carrier moved from a
       selector to a class. `focus`/`blur`, not focusin/out: those bubble from
       the send pill and the pickers, which is the exact lie the narrow
       trigger exists to prevent. */
    this.textarea.addEventListener('focus', () => this.el.addClass('is-input-focused'));
    this.textarea.addEventListener('blur', () => this.el.removeClass('is-input-focused'));
    this.textarea.addEventListener('blur', () => {
      // A click on a row is a mousedown on the list and a blur on the field, in
      // that order, so the close has to wait for the click to land.
      window.setTimeout(() => this.closeSlash(), 120);
    });

    /* PASTE AND DROP, on the CARD rather than on the textarea.
     *
     * A screenshot is pasted while the caret is in the field, but a file is
     * dropped anywhere over the composer and a drop bound to the textarea
     * alone lands on the card's padding and is handled by the browser: the
     * image opens as a page and the vault's workspace is gone. Both handlers
     * therefore sit on the card, and `preventDefault` on dragover is what
     * makes this element a drop target at all - without it the browser never
     * offers the drop and the handler below never runs. */
    this.el.addEventListener('paste', (ev: ClipboardEvent) => {
      const files = imageFilesOf(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      void this.attachFiles(files);
    });
    this.el.addEventListener('dragover', (ev: DragEvent) => {
      if (!hasFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      this.el.addClass('is-dropping');
    });
    this.el.addEventListener('dragleave', (ev: DragEvent) => {
      // A dragleave fires for every child the pointer crosses, so the class is
      // only cleared when the pointer has actually left the card.
      if (ev.relatedTarget instanceof Node && this.el.contains(ev.relatedTarget)) return;
      this.el.removeClass('is-dropping');
    });
    this.el.addEventListener('drop', (ev: DragEvent) => {
      const files = imageFilesOf(ev.dataTransfer);
      this.el.removeClass('is-dropping');
      if (!files.length) return;
      ev.preventDefault();
      void this.attachFiles(files);
    });

    this.paint();
  }

  get badgeContainer(): HTMLElement {
    return this.badgeSlot;
  }

  get trayContainer(): HTMLElement {
    return this.trayEl;
  }

  focus(): void {
    this.textarea.focus();
  }

  /** Insert text at the caret and focus. The decision chip's whole job. */
  insert(text: string): void {
    const start = this.textarea.selectionStart ?? this.textarea.value.length;
    const end = this.textarea.selectionEnd ?? start;
    const value = this.textarea.value;
    this.textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    const caret = start + text.length;
    this.textarea.setSelectionRange(caret, caret);
    this.textarea.focus();
    this.autoGrow();
    this.refreshSlash();
    this.paint();
  }

  setStreaming(streaming: boolean): void {
    this.state.streaming = streaming;
    this.paint();
  }

  /**
   * The model the settings cascade says WILL be used, resolved before any
   * session exists. It fills the trigger on a fresh pane and is outranked by
   * everything truer: a configured plugin choice, a menu pick, and the
   * session event all win. Applied only while nothing else is known, so a
   * slow resolve can never overwrite a fact that arrived first.
   */
  presetModel(model: string): void {
    if (this.resolvedModel !== null || this.state.model) return;
    this.resolvedModel = model;
    this.paint();
  }

  /** The model the SESSION reported. Outranks the configured choice on screen. */
  setModel(model: string): void {
    this.resolvedModel = model || null;
    this.state.model = model;
    this.paint();
  }

  /** The SDK's own catalogue. Until this lands the model menu has nothing true to offer. */
  setModelCatalog(models: ModelChoice[]): void {
    this.catalog = models;
    this.paint();
  }

  setMode(mode: PermissionModeName): void {
    this.state.mode = mode;
    this.paint();
  }

  /** Every image currently attached, in attach order. */
  get pendingAttachments(): Attachment[] {
    return [...this.attachments];
  }

  /* ----------------------------------------------------------- the pickers */

  /** The provider's own command list, from the session event. Never invented. */
  setSlashCommands(names: readonly string[]): void {
    this.slashNames = normalizeCommands(names);
  }

  /** The vault's own notes. Never a list assembled here. */
  setMentionFiles(files: readonly MentionFile[]): void {
    this.mentionFiles = files;
  }

  /** Open, filter or close the picker from the field's current state. */
  private refreshSlash(): void {
    const caret = this.textarea.selectionStart ?? 0;
    const rows = this.rowsFor(caret);
    if (rows === null || rows.length === 0) {
      this.closeSlash();
      return;
    }
    /* The highlight follows the LIST, not the previous index: after typing one
       more character the row that was second may not exist, and an index left
       pointing past the end accepts nothing on Enter. */
    const previous = this.picker[this.slashActive]?.id;
    const kept = previous ? rows.findIndex((r) => r.id === previous) : -1;
    this.picker = rows;
    this.slashActive = kept >= 0 ? kept : 0;
    this.slashOpen = true;
    this.paintSlash();
  }

  /* Which picker the caret is in, and its rows. Slash is checked first because
     its rule is the stricter one - column zero - so the two can never both
     claim the same caret. */
  private rowsFor(caret: number): PickerRow[] | null {
    const value = this.textarea.value;
    const command = slashQuery(value, caret);
    if (command !== null && this.slashNames.length > 0) {
      this.pickerKind = 'slash';
      return filterCommands(this.slashNames, command).map((name) => ({
        id: name, label: name, detail: '', prefix: '/',
      }));
    }
    const mention = mentionQuery(value, caret);
    if (mention !== null && this.mentionFiles.length > 0) {
      this.pickerKind = 'mention';
      return filterMentions(this.mentionFiles, mention).map((file) => ({
        id: file.path,
        label: file.basename,
        // The folder, so two notes with the same name are told apart. Without
        // it the picker offers the user a choice it has not shown them.
        detail: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '',
        prefix: '@',
      }));
    }
    return null;
  }

  private closeSlash(): void {
    this.slashOpen = false;
    this.picker = [];
    this.slashActive = 0;
    this.slashEl.empty();
    this.slashEl.removeClass('is-open');
    this.textarea.removeAttribute('aria-activedescendant');
    this.textarea.setAttr('aria-expanded', 'false');
  }

  private paintSlash(): void {
    this.slashEl.empty();
    this.slashEl.addClass('is-open');
    this.textarea.setAttr('aria-expanded', 'true');
    this.picker.forEach((item, i) => {
      const row = this.slashEl.createDiv({ cls: 'aic-slash-row' });
      row.id = `${this.slashId}-${i}`;
      row.setAttr('role', 'option');
      row.setAttr('aria-selected', i === this.slashActive ? 'true' : 'false');
      row.toggleClass('is-active', i === this.slashActive);
      row.createSpan({ cls: 'aic-slash-slash', text: item.prefix });
      row.createSpan({ cls: 'aic-slash-name', text: item.label });
      if (item.detail) row.createSpan({ cls: 'aic-slash-detail', text: item.detail });
      // mousedown, not click: the field blurs on mousedown and the blur handler
      // closes the list, so a click listener would fire on a row already gone.
      row.addEventListener('mousedown', (ev: MouseEvent) => {
        ev.preventDefault();
        this.accept(item);
      });
      row.addEventListener('mouseenter', () => {
        this.slashActive = i;
        this.paintSlash();
      });
    });
    if (this.picker[this.slashActive] !== undefined) {
      this.textarea.setAttr('aria-activedescendant', `${this.slashId}-${this.slashActive}`);
    }
  }

  private accept(item: PickerRow | undefined): void {
    if (!item) return;
    const caret = this.textarea.selectionStart ?? this.textarea.value.length;
    const next = this.pickerKind === 'slash'
      ? applyCommand(this.textarea.value, item.id)
      : applyMention(this.textarea.value, caret, item.id);
    this.textarea.value = next.value;
    this.textarea.setSelectionRange(next.caret, next.caret);
    this.closeSlash();
    this.autoGrow();
    this.syncSend();
    this.textarea.focus();
  }

  private fire(): void {
    if (this.state.streaming) {
      this.cb.onStop();
      return;
    }
    const text = this.textarea.value.trim();
    // An image with no words is still a message: "what is this?" is the most
    // common thing a pasted screenshot means, so an empty prompt with an
    // attachment sends.
    if (!text && !this.attachments.length) return;
    const attachments = this.attachments;
    this.attachments = [];
    this.textarea.value = '';
    this.closeSlash();
    this.autoGrow();
    this.paint();
    this.cb.onSubmit(text, attachments);
  }

  /* ---------------------------------------------------------- the pickers */

  private openModeMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const mode of MODES) {
      menu.addItem((item) =>
        item
          .setTitle(mode.label)
          .setChecked(mode.id === this.state.mode)
          .onClick(() => {
            this.state.mode = mode.id;
            this.paint();
            this.cb.onModeChange(mode.id);
          }),
      );
    }
    this.showMenu(menu, evt);
  }

  private openModelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const catalog = this.catalog;
    if (!catalog || !catalog.length) {
      /* No catalogue is not an empty catalogue, and it is certainly not a
         reason to offer a list assembled here. The menu says which one it is. */
      menu.addItem((item) =>
        item.setTitle('Model list arrives when the session starts').setDisabled(true),
      );
      this.showMenu(menu, evt);
      return;
    }
    for (const choice of catalog) {
      menu.addItem((item) =>
        item
          .setTitle(choice.displayName)
          .setChecked(this.activeModelId() === choice.value)
          .onClick(() => {
            this.resolvedModel = choice.value;
            this.state.model = choice.value;
            this.paint();
            this.cb.onModelChange(choice.value);
          }),
      );
    }
    this.showMenu(menu, evt);
  }

  private openEffortMenu(evt: MouseEvent): void {
    const menu = new Menu();
    /* Scoped to what the ACTIVE model actually carries, when the catalogue
       says. A level the model silently downgrades is a control that lies. */
    const allowed = this.allowedEfforts();
    for (const effort of EFFORTS) {
      if (allowed && !allowed.includes(effort.id)) continue;
      menu.addItem((item) =>
        item
          .setTitle(effort.label)
          .setChecked(effort.id === this.state.effort)
          .onClick(() => {
            this.state.effort = effort.id;
            this.paint();
            this.cb.onEffortChange(effort.id);
          }),
      );
    }
    this.showMenu(menu, evt);
  }

  private showMenu(menu: Menu, evt: MouseEvent): void {
    const dom = (menu as unknown as { dom?: HTMLElement }).dom;
    if (dom) dom.addClass('aic-menu');
    menu.showAtMouseEvent(evt);
  }

  private activeModelId(): string {
    return this.resolvedModel ?? this.state.model;
  }

  private allowedEfforts(): EffortName[] | null {
    const id = this.activeModelId();
    const row = this.catalog?.find((c) => c.value === id);
    return row?.supportedEffortLevels ?? null;
  }

  /** The provider's own name for the active model, or null when nothing is known. */
  private modelLabel(): string | null {
    const id = this.activeModelId();
    if (!id) return null;
    const row = this.catalog?.find((c) => c.value === id);
    // The raw id is a fact even without the catalogue; "default" is not.
    return row ? row.displayName : id;
  }

  /* ------------------------------------------------------- the attachments */

  /* Public because the computed-style fixture attaches through it, so the
     thumbnail the gate measures is built by the shipped render and not by
     hand-typed markup that would only ever agree with itself. */
  async attachFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (!IMAGE_TYPES.has(file.type)) {
        this.notice(`${file.name || 'That file'} is not an image type the model reads.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        this.notice(`${file.name || 'That image'} is over the 5 MB per-image limit.`);
        continue;
      }
      const data = await base64Of(file);
      if (!data) {
        this.notice(`${file.name || 'That image'} could not be read.`);
        continue;
      }
      this.attachSeq += 1;
      this.attachments.push({
        id: `att-${this.attachSeq}`,
        name: file.name || 'pasted image',
        mediaType: file.type,
        data,
        previewUrl: `data:${file.type};base64,${data}`,
      });
    }
    this.renderThumbs();
    this.syncSend();
  }

  private removeAttachment(id: string): void {
    this.attachments = this.attachments.filter((a) => a.id !== id);
    this.renderThumbs();
    this.syncSend();
    this.textarea.focus();
  }

  private notice(message: string): void {
    this.cb.onNotice?.(message);
  }

  /** The thumbnail strip. Zero attachments renders nothing at all. */
  private renderThumbs(): void {
    this.thumbsEl.empty();
    this.thumbsEl.toggleClass('is-empty', this.attachments.length === 0);
    for (const att of this.attachments) {
      const cell = this.thumbsEl.createDiv({ cls: 'aic-thumb' });
      const img = cell.createEl('img', { cls: 'aic-thumb-img' });
      img.src = att.previewUrl;
      img.alt = att.name;
      /* The remove control is a real <button> and not a hover-only glyph: it
         is reachable by keyboard whether or not a pointer ever hovers the
         cell, which is what the CSS then chooses to reveal on hover. */
      const x = cell.createEl('button', { cls: 'aic-thumb-x', type: 'button' });
      setIcon(x, 'x');
      x.setAttr('aria-label', `Remove ${att.name}`);
      setTooltip(x, `Remove ${att.name}`);
      x.addEventListener('click', () => this.removeAttachment(att.id));
    }
  }

  /** Narrow enough to run on every keystroke: no DOM churn, one boolean. */
  private syncSend(): void {
    if (this.state.streaming) return;
    this.sendBtn.disabled = this.textarea.value.trim().length === 0 && this.attachments.length === 0;
  }

  private autoGrow(): void {
    /* A computed value, so it rides the sanctioned dynamic channel rather than
       a class: there is no finite set of heights to enumerate. The auto pass
       first, because scrollHeight read under the previous fixed height reports
       that height back and the field never shrinks. */
    this.textarea.setCssStyles({ height: 'auto' });
    this.textarea.setCssStyles({ height: `${Math.min(this.textarea.scrollHeight, 260)}px` });
  }

  private paint(): void {
    const mode = MODES.find((m) => m.id === this.state.mode) ?? MODES[1];
    this.modeBtn.empty();
    this.modeBtn.createSpan({ text: mode?.label ?? 'Ask' });
    this.modeBtn.addClass('is-active');
    this.modeBtn.dataset.mode = this.state.mode;
    this.modeBtn.dataset.tone = this.state.mode;
    setTooltip(this.modeBtn, 'Permission mode for this conversation');
    this.modeBtn.setAttr('aria-label', `Permission mode: ${mode?.label ?? 'Ask'}`);

    const label = this.modelLabel();
    this.modelBtn.empty();
    this.modelBtn.createSpan({ text: label ?? 'Model' });
    this.modelBtn.toggleClass('is-unset', label === null);
    setTooltip(
      this.modelBtn,
      label ? `Model for this conversation: ${label}` : 'Model for this conversation',
    );
    /* The visible string is the VALUE, so on its own the accessible name reads
       "Opus (1M context)" and never says what choosing it changes. `setTooltip`
       is Obsidian's own hover chrome and is not an accessible name. With the
       arrow gone the label is the only carrier left, so it is stated. */
    this.modelBtn.setAttr('aria-label', label ? `Model: ${label}` : 'Model');

    const effort = EFFORTS.find((e) => e.id === this.state.effort) ?? EFFORTS[1];
    this.effortBtn.empty();
    this.effortBtn.createSpan({ text: effort?.label ?? 'Medium' });
    setTooltip(this.effortBtn, 'Reasoning effort');
    this.effortBtn.setAttr('aria-label', `Reasoning effort: ${effort?.label ?? 'Medium'}`);

    this.renderThumbs();

    this.sendBtn.empty();
    if (this.state.streaming) {
      this.sendBtn.addClass('is-stop');
      this.sendBtn.setText('Stop');
      this.sendBtn.disabled = false;
      this.sendBtn.setAttr('aria-label', 'Stop the current turn');
    } else {
      this.sendBtn.removeClass('is-stop');
      this.sendBtn.setText('Send');
      this.sendBtn.disabled =
        this.textarea.value.trim().length === 0 && this.attachments.length === 0;
      this.sendBtn.setAttr('aria-label', 'Send the message');
    }
  }

  /** The awareness tray. Zero context renders nothing. */
  renderTray(chips: Array<{ icon: string; label: string; detail?: string; onDismiss?: () => void }>): void {
    this.trayEl.empty();
    this.trayEl.toggleClass('is-empty', chips.length === 0);
    for (const chip of chips) {
      const el = this.trayEl.createSpan({ cls: 'aic-chip' });
      const glyph = el.createSpan({ cls: 'aic-chip-icon' });
      setIcon(glyph, chip.icon);
      el.createSpan({ text: chip.label });
      if (chip.detail) {
        el.createSpan({ cls: 'aic-middot', text: '·' });
        el.createSpan({ cls: 'aic-chip-detail', text: chip.detail });
      }
      if (chip.onDismiss) {
        const x = el.createEl('button', { cls: 'aic-chip-x', type: 'button' });
        setIcon(x, 'x');
        x.setAttr('aria-label', `Remove ${chip.label} from context`);
        x.addEventListener('click', chip.onDismiss);
      }
    }
  }
}

function hasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes('Files');
}

function imageFilesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
}

/* Raw base64 with the `data:` prefix stripped, because the API's image block
 * wants the payload and rejects the URL form. FileReader rather than a manual
 * walk over an ArrayBuffer: a byte-by-byte String.fromCharCode loop blows the
 * argument limit on a multi-megabyte screenshot. */
async function base64Of(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma < 0 ? null : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
