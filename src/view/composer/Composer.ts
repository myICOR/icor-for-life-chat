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
import { applyMention, applyWikilink, filterMentions, mentionQuery, wikilinkQuery } from './mention';
import type { MentionFile } from './mention';
import { baseOf, folderOf } from '../../model/context';
import type { ContextPick } from '../../model/context';

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
  /** What accepting it inserts: a command name, a vault path, or a link text. */
  id: string;
  label: string;
  /** The folder, for mentions. Empty when there is nothing to disambiguate. */
  detail: string;
  prefix: string;
  /** The note behind the row, when there is one, so the preview can read it. */
  path: string | null;
}

/* THE `+` MENU'S VOCABULARY. Lists arrive as FUNCTIONS: a tag scan walks
   every note's cache and a property scan walks every frontmatter, and neither
   should run because a menu opened - only because its submenu did. */
export interface ContextSources {
  notes: () => readonly MentionFile[];
  folders: () => ReadonlyArray<{ path: string; count: number }>;
  tags: () => ReadonlyArray<{ tag: string; count: number }>;
  properties: () => ReadonlyArray<{ key: string; values: ReadonlyArray<{ value: string; count: number }> }>;
}

type MenuView = 'root' | 'notes' | 'folders' | 'tags' | 'properties' | 'values';

/** One row of the `+` menu. A row either opens a view or makes a pick. */
interface MenuRow {
  icon: string;
  label: string;
  detail: string;
  count: number | null;
  opens: MenuView | null;
  pick: ContextPick | null;
  /** For the properties view: the key whose values the row opens. */
  key: string | null;
}

/** The debounce on a preview read: long enough to skip rows arrowed past. */
const PREVIEW_DELAY_MS = 80;

/** How many rows a `+` submenu shows at once; the filter is the navigation. */
const MENU_LIMIT = 40;

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
  /**
   * The beginning of a note, for the picker's preview. Absent means no
   * preview panel at all, never an empty one.
   */
  readPreview?: (path: string) => Promise<string>;
  /** A `+` menu pick. The view resolves it into notes and owns the list. */
  onAddContext?: (pick: ContextPick) => void;
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
  /** Click only. Never bound to Enter; see `fire`. */
  private readonly stopBtn: HTMLButtonElement;
  /** Rung 4 lives INSIDE the card now; see the note over its creation. */
  readonly factsEl: HTMLElement;
  private readonly slashEl: HTMLElement;
  /** The rows, inside the floating box, under the preview. */
  private readonly slashListEl: HTMLElement;
  /** The preview panel, above the rows. Empty and hidden until a note row is lit. */
  private readonly previewEl: HTMLElement;
  private previewTimer: number | null = null;
  private previewSeq = 0;
  private readonly previewCache = new Map<string, string>();
  /** The `+` button and the popover it opens. */
  private readonly addBtn: HTMLButtonElement;
  private readonly menuEl: HTMLElement;
  private menuOpen = false;
  private menuView: MenuView = 'root';
  private menuKey: string | null = null;
  private menuActive = 0;
  private menuRows: MenuRow[] = [];
  private menuFilterText = '';
  private sources: ContextSources | null = null;
  /** Lists fetched while the menu is open; dropped when it closes. */
  private menuCache: { [K in keyof ContextSources]?: ReturnType<ContextSources[K]> } = {};
  private readonly onDocMouseDown = (ev: MouseEvent): void => {
    if (!this.menuOpen) return;
    const target = ev.target as Node | null;
    if (target && (this.menuEl.contains(target) || this.addBtn.contains(target))) return;
    this.closeMenu(false);
  };
  private slashNames: string[] = [];
  /* ONE PICKER, TWO SOURCES. `/` and `@` differ only in where the query comes
     from and what accepting one types; everything about opening, filtering,
     arrowing and dismissing is identical. Two pickers would be two places for
     the Enter-key handling to drift apart. */
  private picker: PickerRow[] = [];
  private pickerKind: 'slash' | 'mention' | 'wikilink' = 'slash';
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
    this.textarea.placeholder = 'Ask the team. [[ or @ mentions notes, / runs commands';
    this.textarea.setAttr('aria-label', 'Message the AI team');

    const action = this.el.createDiv({ cls: 'aic-action' });
    /* THE `+` BUTTON, first in the row, because it is the one control here
       that is about the MESSAGE rather than about the session: what the
       team gets to read alongside the words. It opens a menu of the vault's
       own shapes - the open note, any note, a folder, a tag, a property - and
       the view turns a pick into the notes it stands for. */
    this.addBtn = action.createEl('button', { cls: 'aic-add', type: 'button' });
    setIcon(this.addBtn, 'plus');
    this.addBtn.setAttr('aria-label', 'Add context');
    this.addBtn.setAttr('aria-haspopup', 'menu');
    this.addBtn.setAttr('aria-expanded', 'false');
    setTooltip(this.addBtn, 'Add context: a note, a folder, a tag, a property');
    this.addBtn.addEventListener('click', () => {
      if (this.menuOpen) this.closeMenu(true);
      else this.openMenu();
    });
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
    /* STOP IS ITS OWN CONTROL, and Enter never reaches it (Tom, 2026-09-04).
     *
       The send pill used to BECOME Stop while a turn ran, so a follow-up typed
       mid-turn and sent with Enter interrupted the very work it was about.
       The CLI queues a mid-turn message and answers it after the running turn
       (measured; the finding is at the top of sdk/session.ts), so Enter always
       submits and this button, reachable by click or by focusing it, is the
       only way to interrupt. It exists only while a turn is running: a Stop
       with nothing to stop is a control that lies. */
    this.stopBtn = action.createEl('button', { cls: 'aic-stop', type: 'button' });
    const stopGlyph = this.stopBtn.createSpan({ cls: 'aic-stop-icon' });
    setIcon(stopGlyph, 'square');
    this.stopBtn.createSpan({ text: 'Stop' });
    this.stopBtn.setAttr('aria-label', 'Stop the current turn');
    setTooltip(this.stopBtn, 'Stop the current turn');
    this.stopBtn.addEventListener('click', () => this.cb.onStop());
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
    /* THE PREVIEW SITS ABOVE THE ROWS, in the same floating box, and the rows
       scroll under it: a preview inside the scrolling list would scroll away
       with the third arrow press. It is a glance at the lit note - path and
       opening lines - so the user picks the note they meant rather than the
       note that shares its name. */
    this.previewEl = this.slashEl.createDiv({ cls: 'aic-picker-preview' });
    this.slashListEl = this.slashEl.createDiv({ cls: 'aic-slash-list' });
    this.slashListEl.id = this.slashId;
    this.slashListEl.setAttr('role', 'listbox');
    this.slashListEl.setAttr('aria-label', 'Commands and notes');
    /* The `+` menu, a second floating box over the card. Built once, hidden
       until opened; nothing in it can catch a click while it is closed. */
    this.menuEl = this.el.createDiv({ cls: 'aic-ctx-menu' });
    this.menuEl.setAttr('role', 'dialog');
    this.menuEl.setAttr('aria-label', 'Add context');
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
    /* The `+` menu closes on a click anywhere else. Registered on the
       document once; the handler checks the open flag first so a closed menu
       costs one boolean per click. */
    document.addEventListener('mousedown', this.onDocMouseDown);

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

  /** What the pill is showing right now. The view reads it to spot a self-started turn. */
  get isStreaming(): boolean {
    return this.state.streaming;
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

  /** The `+` menu's lists, as functions the menu calls when a submenu opens. */
  setContextSources(sources: ContextSources): void {
    this.sources = sources;
  }

  /** Release the document listener. The view calls this on close. */
  dispose(): void {
    document.removeEventListener('mousedown', this.onDocMouseDown);
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
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
        id: name, label: name, detail: '', prefix: '/', path: null,
      }));
    }
    /* `[[` before `@`: a link's query may contain a space and an `@`, while a
       mention's may contain neither, so the link rule is the one that can
       claim a caret the mention rule would refuse. */
    const link = wikilinkQuery(value, caret);
    if (link !== null && this.mentionFiles.length > 0) {
      this.pickerKind = 'wikilink';
      return filterMentions(this.mentionFiles, link).map((file) => ({
        id: file.linktext ?? file.basename,
        label: file.basename,
        detail: file.folder ?? folderOf(file.path),
        prefix: '[[',
        path: file.path,
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
        detail: file.folder ?? folderOf(file.path),
        prefix: '@',
        path: file.path,
      }));
    }
    return null;
  }

  private closeSlash(): void {
    this.slashOpen = false;
    this.picker = [];
    this.slashActive = 0;
    this.slashListEl.empty();
    this.slashEl.removeClass('is-open');
    this.clearPreview();
    this.previewCache.clear();
    this.textarea.removeAttribute('aria-activedescendant');
    this.textarea.setAttr('aria-expanded', 'false');
  }

  private paintSlash(): void {
    this.slashListEl.empty();
    this.slashEl.addClass('is-open');
    this.textarea.setAttr('aria-expanded', 'true');
    this.picker.forEach((item, i) => {
      const row = this.slashListEl.createDiv({ cls: 'aic-slash-row' });
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
    this.schedulePreview(this.picker[this.slashActive]?.path ?? null);
  }

  /* ---------------------------------------------------------- the preview */

  /* THE PREVIEW FOLLOWS THE LIT ROW, and it never lies about which row.
     Reads are asynchronous and a user arrowing down a list outruns them, so
     every request carries a sequence number and a reply is painted only if it
     is still the newest ask. Debounced so five rows arrowed past cost no read
     at all, and cached so arrowing back costs none either. */
  private schedulePreview(path: string | null): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    const read = this.cb.readPreview;
    if (!path || !read) {
      this.clearPreview();
      return;
    }
    const cached = this.previewCache.get(path);
    if (cached !== undefined) {
      this.paintPreview(path, cached);
      return;
    }
    const seq = ++this.previewSeq;
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void read(path).then((text) => {
        this.previewCache.set(path, text);
        if (seq !== this.previewSeq || !this.slashOpen) return;
        if (this.picker[this.slashActive]?.path !== path) return;
        this.paintPreview(path, text);
      }).catch(() => undefined);
    }, PREVIEW_DELAY_MS);
  }

  private paintPreview(path: string, text: string): void {
    this.previewEl.empty();
    this.previewEl.addClass('is-open');
    this.previewEl.createDiv({ cls: 'aic-kicker', text: 'PREVIEW' });
    this.previewEl.createDiv({ cls: 'aic-picker-preview-path', text: path });
    this.previewEl.createDiv({
      cls: 'aic-picker-preview-body',
      text: text.trim() ? text : 'This note is empty.',
    });
  }

  private clearPreview(): void {
    this.previewSeq += 1;
    this.previewEl.empty();
    this.previewEl.removeClass('is-open');
  }

  private accept(item: PickerRow | undefined): void {
    if (!item) return;
    const caret = this.textarea.selectionStart ?? this.textarea.value.length;
    const next = this.pickerKind === 'slash'
      ? applyCommand(this.textarea.value, item.id)
      : this.pickerKind === 'wikilink'
        ? applyWikilink(this.textarea.value, caret, item.id)
        : applyMention(this.textarea.value, caret, item.id);
    this.textarea.value = next.value;
    this.textarea.setSelectionRange(next.caret, next.caret);
    this.closeSlash();
    this.autoGrow();
    this.syncSend();
    this.textarea.focus();
  }

  /* Enter and the pill ALWAYS submit. While a turn runs the message is queued
     by the CLI for the next turn; stopping is the click-only button beside. */
  private fire(): void {
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
    // Derived from the field in every state: a queued message is still a message.
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
    /* The pill names what will happen, and it never turns into Stop. "Queue"
       is the measured word: the CLI holds a mid-turn message and answers it
       after the running turn. The disabled state is the field's, not the turn's. */
    const queueing = this.state.streaming;
    this.sendBtn.toggleClass('is-queue', queueing);
    this.sendBtn.setText(queueing ? 'Queue' : 'Send');
    this.sendBtn.disabled =
      this.textarea.value.trim().length === 0 && this.attachments.length === 0;
    this.sendBtn.setAttr(
      'aria-label',
      queueing ? 'Queue this message for the running turn' : 'Send the message',
    );
    // `hidden`, not a class: the property is the one thing no theme can restyle.
    this.stopBtn.hidden = !this.state.streaming;
  }

  /** The awareness tray. Zero context renders nothing. */
  renderTray(chips: TrayChip[]): void {
    this.trayEl.empty();
    this.trayEl.toggleClass('is-empty', chips.length === 0);
    for (const chip of chips) {
      /* A chip that OPENS something is a button; a chip that only says
         something is a span. A group chip opens the list it stands for, and a
         list nobody can see is a count nobody can check. */
      const el = chip.onOpen
        ? this.trayEl.createEl('button', { cls: 'aic-chip is-link', type: 'button' })
        : this.trayEl.createSpan({ cls: 'aic-chip' });
      if (chip.count !== undefined) el.addClass('is-group');
      const glyph = el.createSpan({ cls: 'aic-chip-icon' });
      setIcon(glyph, chip.icon);
      el.createSpan({ text: chip.label });
      if (chip.detail) {
        el.createSpan({ cls: 'aic-middot', text: '·' });
        el.createSpan({ cls: 'aic-chip-detail', text: chip.detail });
      }
      if (chip.count !== undefined) {
        el.createSpan({ cls: 'aic-chip-count', text: `· ${chip.count}` });
      }
      if (chip.onOpen) {
        const what = chip.count !== undefined
          ? `Show the ${chip.count} notes in ${chip.label}`
          : `Open ${chip.label}`;
        el.setAttr('aria-label', what);
        setTooltip(el, what);
        el.addEventListener('click', (ev: MouseEvent) => {
          if ((ev.target as HTMLElement | null)?.closest('.aic-chip-x')) return;
          chip.onOpen?.();
        });
      }
      if (chip.onDismiss) {
        const x = el.createEl('button', { cls: 'aic-chip-x', type: 'button' });
        setIcon(x, 'x');
        x.setAttr('aria-label', `Remove ${chip.label} from context`);
        x.addEventListener('click', (ev: MouseEvent) => {
          ev.stopPropagation();
          chip.onDismiss?.();
        });
      }
    }
  }

  /* ------------------------------------------------------------ the + menu */

  private openMenu(): void {
    this.closeSlash();
    this.menuOpen = true;
    this.menuView = 'root';
    this.menuKey = null;
    this.menuFilterText = '';
    this.menuCache = {};
    this.addBtn.setAttr('aria-expanded', 'true');
    this.menuEl.addClass('is-open');
    this.paintMenu();
  }

  /** Close, and put the caret back where the user was typing. */
  private closeMenu(refocus: boolean): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menuRows = [];
    this.menuCache = {};
    this.menuEl.empty();
    this.menuEl.removeClass('is-open');
    this.addBtn.setAttr('aria-expanded', 'false');
    if (refocus) this.textarea.focus();
  }

  private enterView(view: MenuView, key: string | null = null): void {
    this.menuView = view;
    this.menuKey = key;
    this.menuFilterText = '';
    this.menuActive = 0;
    this.paintMenu();
  }

  /** One level up. From the root, up is out. */
  private menuBack(): void {
    if (this.menuView === 'root') {
      this.closeMenu(true);
      return;
    }
    this.enterView(this.menuView === 'values' ? 'properties' : 'root');
  }

  private source<K extends keyof ContextSources>(key: K): ReturnType<ContextSources[K]> {
    const cache = this.menuCache as Record<string, unknown>;
    const cached = cache[key];
    if (cached !== undefined) return cached as ReturnType<ContextSources[K]>;
    const fetched = (this.sources ? this.sources[key]() : []) as ReturnType<ContextSources[K]>;
    cache[key] = fetched;
    return fetched;
  }

  private noteRows(query: string, limit = MENU_LIMIT): MenuRow[] {
    return filterMentions(this.source('notes'), query, limit).map((file) => ({
      icon: 'file-text',
      label: file.basename,
      detail: file.folder ?? folderOf(file.path),
      count: null,
      opens: null,
      pick: { kind: 'note', path: file.path },
      key: null,
    }));
  }

  /** The rows for the current view and filter. Pure over the sources. */
  private rowsForMenu(): MenuRow[] {
    const q = this.menuFilterText.trim().toLowerCase();
    const has = (s: string): boolean => !q || s.toLowerCase().includes(q);
    switch (this.menuView) {
      case 'root': {
        if (q) return this.noteRows(q);
        return [
          { icon: 'eye', label: 'Active note', detail: '', count: null, opens: null, pick: { kind: 'active' }, key: null },
          { icon: 'file-text', label: 'Notes', detail: '', count: null, opens: 'notes', pick: null, key: null },
          { icon: 'folder', label: 'Folders', detail: '', count: null, opens: 'folders', pick: null, key: null },
          { icon: 'tag', label: 'Tags', detail: '', count: null, opens: 'tags', pick: null, key: null },
          { icon: 'sliders-horizontal', label: 'Properties', detail: '', count: null, opens: 'properties', pick: null, key: null },
        ];
      }
      case 'notes':
        return this.noteRows(q);
      case 'folders':
        return this.source('folders')
          .filter((f) => has(f.path))
          .slice(0, MENU_LIMIT)
          .map((f) => ({
            icon: 'folder', label: baseOf(f.path), detail: folderOf(f.path), count: f.count,
            opens: null, pick: { kind: 'folder', path: f.path }, key: null,
          }));
      case 'tags':
        return this.source('tags')
          .filter((t) => has(t.tag))
          .slice(0, MENU_LIMIT)
          .map((t) => ({
            icon: 'tag', label: t.tag, detail: '', count: t.count,
            opens: null, pick: { kind: 'tag', tag: t.tag }, key: null,
          }));
      case 'properties':
        return this.source('properties')
          .filter((p) => has(p.key))
          .slice(0, MENU_LIMIT)
          .map((p) => ({
            icon: 'sliders-horizontal', label: p.key,
            detail: `${p.values.length} ${p.values.length === 1 ? 'value' : 'values'}`,
            count: null, opens: 'values', pick: null, key: p.key,
          }));
      case 'values': {
        const key = this.menuKey ?? '';
        const prop = this.source('properties').find((p) => p.key === key);
        return (prop?.values ?? [])
          .filter((v) => has(v.value))
          .slice(0, MENU_LIMIT)
          .map((v) => ({
            icon: 'sliders-horizontal', label: `${key}: ${v.value}`, detail: '', count: v.count,
            opens: null, pick: { kind: 'property', key, value: v.value }, key: null,
          }));
      }
    }
  }

  private menuTitle(): string {
    switch (this.menuView) {
      case 'root': return 'Add context';
      case 'notes': return 'Notes';
      case 'folders': return 'Folders';
      case 'tags': return 'Tags';
      case 'properties': return 'Properties';
      case 'values': return this.menuKey ?? 'Values';
    }
  }

  /** Rebuild the popover for the current view. Cheap: forty rows at most. */
  private paintMenu(): void {
    const el = this.menuEl;
    el.empty();
    const listId = `${this.slashId}-menu`;

    const head = el.createDiv({ cls: 'aic-ctx-head' });
    if (this.menuView !== 'root') {
      const back = head.createEl('button', { cls: 'aic-ctx-back', type: 'button' });
      setIcon(back, 'chevron-left');
      back.setAttr('aria-label', 'Back');
      setTooltip(back, 'Back');
      back.addEventListener('click', () => this.menuBack());
    }
    head.createSpan({ cls: 'aic-kicker aic-ctx-title', text: this.menuTitle().toUpperCase() });

    /* THE ROOT'S FIELD SITS BELOW ITS ROWS and a submenu's ABOVE: at the root
       the five rows are the menu and the field is the shortcut past them; in
       a submenu the field is the navigation and the rows are what it finds. */
    const list = el.createDiv({ cls: 'aic-ctx-list' });
    list.id = listId;
    list.setAttr('role', 'listbox');
    list.setAttr('aria-label', this.menuTitle());

    const field = el.createEl('input', { cls: 'aic-ctx-search', type: 'text' });
    field.placeholder = this.menuView === 'root' ? 'Search notes' : `Filter ${this.menuTitle().toLowerCase()}`;
    field.value = this.menuFilterText;
    field.setAttr('role', 'combobox');
    field.setAttr('aria-autocomplete', 'list');
    field.setAttr('aria-controls', listId);
    field.setAttr('aria-expanded', 'true');
    field.setAttr('aria-label', field.placeholder);
    if (this.menuView === 'root') el.appendChild(field);
    else el.insertBefore(field, list);

    field.addEventListener('input', () => {
      this.menuFilterText = field.value;
      this.menuActive = 0;
      this.paintMenuRows(list, field);
    });
    field.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.isComposing) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = this.menuRows.length;
        if (n > 0) this.menuActive = (this.menuActive + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.paintMenuRows(list, field);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.activateMenuRow(this.menuRows[this.menuActive]);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeMenu(true);
        return;
      }
      if (ev.key === 'Backspace' && field.value === '') {
        ev.preventDefault();
        this.menuBack();
      }
    });

    this.paintMenuRows(list, field);
    field.focus();
  }

  private paintMenuRows(list: HTMLElement, field: HTMLInputElement): void {
    this.menuRows = this.rowsForMenu();
    list.empty();
    if (this.menuRows.length === 0) {
      list.createDiv({ cls: 'aic-ctx-empty', text: this.menuFilterText ? 'Nothing matches.' : 'Nothing here yet.' });
      field.removeAttribute('aria-activedescendant');
      return;
    }
    const listId = list.id;
    this.menuRows.forEach((row, i) => {
      const el = list.createDiv({ cls: 'aic-ctx-row' });
      el.id = `${listId}-${i}`;
      el.setAttr('role', 'option');
      el.setAttr('aria-selected', i === this.menuActive ? 'true' : 'false');
      el.toggleClass('is-active', i === this.menuActive);
      const glyph = el.createSpan({ cls: 'aic-ctx-row-icon' });
      setIcon(glyph, row.icon);
      const text = el.createSpan({ cls: 'aic-ctx-row-text' });
      text.createSpan({ cls: 'aic-ctx-row-label', text: row.label });
      if (row.detail) text.createSpan({ cls: 'aic-ctx-row-detail', text: row.detail });
      if (row.count !== null) el.createSpan({ cls: 'aic-ctx-row-count', text: `${row.count}` });
      if (row.opens) {
        const chevron = el.createSpan({ cls: 'aic-ctx-row-more' });
        setIcon(chevron, 'chevron-right');
      }
      // mousedown, not click: the field blurs on mousedown and the document
      // handler would otherwise see a click that has left the menu.
      el.addEventListener('mousedown', (ev: MouseEvent) => {
        ev.preventDefault();
        this.activateMenuRow(row);
      });
      el.addEventListener('mouseenter', () => {
        if (this.menuActive === i) return;
        this.menuActive = i;
        this.paintMenuRows(list, field);
      });
    });
    field.setAttr('aria-activedescendant', `${listId}-${this.menuActive}`);
  }

  private activateMenuRow(row: MenuRow | undefined): void {
    if (!row) return;
    if (row.opens) {
      this.enterView(row.opens, row.key);
      return;
    }
    if (row.pick) {
      this.cb.onAddContext?.(row.pick);
      this.closeMenu(true);
    }
  }
}

/** One chip in the awareness tray. */
export interface TrayChip {
  icon: string;
  label: string;
  detail?: string;
  /** A group: how many notes it stands for. Absent for a single note. */
  count?: number;
  /** Opens the note, or the group's list. Makes the chip a button. */
  onOpen?: () => void;
  onDismiss?: () => void;
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
