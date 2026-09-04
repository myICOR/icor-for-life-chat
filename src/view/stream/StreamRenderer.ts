/* The message stream: append-mostly DOM, one renderer per transcript.
 *
 * Every event either appends a node or mutates the one node it names, which is
 * why there is no diffing here and no framework under it. Two behaviours are
 * structural rather than incidental:
 *   - A tool row is created by whichever event arrives first. A result that
 *     beats its own call still lands on the right row.
 *   - Streaming text is written as text; markdown is rendered once, at
 *     finalize. Code fences and math therefore never re-parse mid-token. */

import { Component, MarkdownRenderer, setIcon, setTooltip } from 'obsidian';
import type { App } from 'obsidian';
import type { ChatEvent, ToolStatus, TurnContext, TurnImage } from '../../model/types';
import { dot, kicker, shortAge, shortDuration } from '../dom';
import { fallbackPurpose } from '../../sdk/normalize';
import type { ApprovalChoice } from '../../sdk/permissions';
import { parseStructured, decisionsOf } from '../../structured/parser';
import { remeasureDecisionBodies, renderStructured } from '../../structured/render';
import type { RenderHost } from '../../structured/render';
import type { DecisionBlock } from '../../structured/model';
import { Lightbox } from './Lightbox';

const COLLAPSE_AFTER = 3;

/** One glyph per context kind, the same set the composer tray uses. */
const CONTEXT_ICON: Record<TurnContext['kind'], string> = {
  active: 'eye',
  note: 'file-text',
  folder: 'folder',
  tag: 'tag',
  property: 'sliders-horizontal',
};

interface ToolRow {
  el: HTMLElement;
  gutter: HTMLElement;
  iconEl: HTMLElement;
  /** The purpose sentence: what the call did. The one thing the closed row says. */
  purposeEl: HTMLElement;
  rightEl: HTMLElement;
  /** The opened row: command or input, then the result. Empty while closed. */
  bodyEl: HTMLElement;
  name: string;
  purpose: string;
  /** The raw argument. Empty when the call carried none. */
  target: string;
  /** The result body, once it has arrived. */
  output: string;
  status: ToolStatus;
  startedAt: number;
  /** Stamped by the result, so the duration stops being re-read on repaint. */
  finishedAt: number | null;
  group: ToolGroup;
  /**
   * Survives every repaint, because a row is keyed by its tool-use id and
   * reused rather than rebuilt. A stream that collapsed a row the user had
   * opened, every time a later tool finished, would be unusable.
   */
  expanded: boolean;
}

/** The live "thinking / writing" row and the box it opens. */
interface WorkingIndicator {
  el: HTMLElement;
  head: HTMLElement;
  labelEl: HTMLElement;
  body: HTMLElement;
  label: string;
}

interface ToolGroup {
  el: HTMLElement;
  summary: HTMLElement;
  summaryLabel: HTMLElement;
  summaryGutter: HTMLElement;
  rowsEl: HTMLElement;
  rows: ToolRow[];
  expanded: boolean;
  forcedOpen: boolean;
}

export interface StreamCallbacks {
  onApproval: (toolUseId: string, choice: ApprovalChoice) => void;
  onOpenSubagent?: (agentId: string) => void;
  /** A group chip on a sent turn was clicked: show the notes it stood for. */
  onOpenContextGroup?: (label: string) => void;
  /** The pin control on a user well was clicked. `key` is the well's transcript index. */
  onTogglePin?: (key: string, text: string) => void;
  /** True while the opt-in structured-replies mode is on. */
  structured: () => boolean;
  renderHost: RenderHost;
  /** Every decision a finished assistant block surfaced, with its position. */
  onDecisions: (decisions: DecisionBlock[], blockId: string) => void;
}

/* THE EMPTY STATE'S TEAM BLOCK, supplied by the view.
 *
 * `detected` carries the roster count and where "insights" goes; null means
 * the vault has no `06 AI Team/Agents` and the block offers to make one. The
 * renderer never decides which case it is in - it draws what it is handed,
 * and the view re-hands it after a setup so the block repaints without the
 * rest of the empty state being rebuilt. */
export interface EmptyTeamBlock {
  detected: { count: number; onInsights: () => void } | null;
  /** Resolves when the team has been written; the view repaints afterwards. */
  onSetup: () => Promise<void>;
}

export class StreamRenderer {
  private readonly blocks = new Map<string, HTMLElement>();
  private readonly blockText = new Map<string, string>();
  private readonly tools = new Map<string, ToolRow>();
  /** User wells by transcript key, so a pin can repaint or scroll to its well. */
  private readonly wells = new Map<string, { el: HTMLElement; pin: HTMLElement }>();
  private group: ToolGroup | null = null;
  private emptyEl: HTMLElement | null = null;
  /* THE WORKING INDICATOR, one per renderer, reused for the whole turn.
   *
   * It used to be a bare "thinking..." line that appeared on the first thinking
   * token and was destroyed by the next tool call, so the reasoning it was
   * named after was never visible - the label promised a window onto the work
   * and showed a row of dots. It is now a disclosure: the dots while there is
   * nothing to read, a control that opens the live reasoning the moment there
   * is. */
  private working: WorkingIndicator | null = null;
  /** Opened by clicking a sent image. Mounted on the pane root, not on body. */
  private readonly lightbox: Lightbox;
  /** This turn's reasoning, kept across hide/show so reopening restores it. */
  private thinkingText = '';
  /** The block currently being withheld, so the box can show the live draft. */
  private heldBlockId: string | null = null;
  /** Open/closed survives every repaint; a box that shut itself is unreadable. */
  private thinkingOpen = false;

  constructor(
    private readonly app: App,
    private readonly owner: Component,
    private readonly column: HTMLElement,
    private readonly sourcePath: string,
    private readonly callbacks: StreamCallbacks,
  ) {
    // Any element in the right document will do; the Lightbox mounts on that
    // document's body so a popout window gets its own overlay.
    this.lightbox = new Lightbox(this.column);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => {
        // The decision bodies' clamp is width-bound, and it answers the resize.
        // The tool rows no longer do: whether a row opens is a fact about its
        // content, not about the pane's width.
        remeasureDecisionBodies(this.column);
      });
      this.resize.observe(this.column);
    }
  }

  private resize: ResizeObserver | null = null;

  get isEmpty(): boolean {
    return this.blocks.size === 0 && this.tools.size === 0;
  }

  /** The empty state is typography: kicker, display line, one hand note. */
  renderEmptyState(team?: EmptyTeamBlock): void {
    if (this.emptyEl) return;
    const wrap = this.column.createDiv({ cls: 'aic-empty' });
    const k = wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide' });
    k.createSpan({ text: 'AI TEAM' });
    k.createSpan({ cls: 'aic-middot', text: '·' });
    k.createSpan({ text: 'ICOR FOR LIFE' });
    wrap.createDiv({ cls: 'aic-empty-display', text: 'What are we working on?' });
    wrap.createDiv({ cls: 'aic-empty-hand', text: 'the team reads this vault' });
    this.emptyEl = wrap;
    if (team) this.renderEmptyTeam(team);
  }

  /**
   * Repaint only the team block of the empty state. A setup that just wrote
   * eight agents changes exactly one thing on this screen, and rebuilding the
   * whole empty state would also throw away the resume rows under it.
   */
  renderEmptyTeam(team: EmptyTeamBlock): void {
    if (!this.emptyEl) return;
    this.emptyEl.querySelector('.aic-empty-team')?.remove();
    const block = this.emptyEl.createDiv({ cls: 'aic-empty-team' });
    /* Placed right under the hand note, ahead of the resume rows: the resume
       block is appended later by the view, and a query-then-insert keeps the
       order stable whichever arrives first. */
    const sessions = this.emptyEl.querySelector('.aic-sessions');
    if (sessions) this.emptyEl.insertBefore(block, sessions);
    if (team.detected) {
      const { count, onInsights } = team.detected;
      block.createSpan({
        cls: 'aic-empty-team-line',
        text: `${count} agent${count === 1 ? '' : 's'} on the team`,
      });
      const open = block.createEl('button', { cls: 'aic-text-btn aic-insights-btn', type: 'button', text: 'Open AI team insights' });
      open.setAttr('aria-label', 'Open AI team insights');
      open.addEventListener('click', onInsights);
      return;
    }
    block.addClass('is-setup');
    block.createDiv({ cls: 'aic-kicker', text: 'AI TEAM' });
    block.createDiv({ cls: 'aic-empty-team-line', text: 'No AI team in this vault yet.' });
    const btn = block.createEl('button', { cls: 'aic-setup-btn', type: 'button', text: 'Set up the ICOR AI team' });
    btn.setAttr('aria-label', 'Set up the ICOR AI team in this vault');
    btn.addEventListener('click', () => {
      /* Disabled for the duration, and never re-enabled here: the view repaints
         this block when the setup resolves, in whichever state the vault is
         then in. A failed setup leaves the vault without a team and the
         repaint offers the button again. */
      btn.disabled = true;
      btn.setText('Setting up the team');
      void team.onSetup();
    });
  }

  /** At most three resume rows, and only when there is history to resume. */
  renderResumeRows(
    sessions: Array<{ sessionId: string; title: string; lastModified: number }>,
    onPick: (sessionId: string) => void,
  ): void {
    if (!this.emptyEl || sessions.length === 0) return;
    const existing = this.emptyEl.querySelector('.aic-sessions');
    if (existing) existing.remove();
    const block = this.emptyEl.createDiv({ cls: 'aic-sessions' });
    kicker(block, 'SESSIONS');
    for (const session of sessions.slice(0, 3)) {
      const row = block.createDiv({ cls: 'aic-session-row' });
      row.setAttr('role', 'button');
      row.setAttr('tabindex', '0');
      row.setAttr('aria-label', `Resume: ${session.title}`);
      row.createDiv({ cls: 'aic-session-title', text: session.title });
      row.createDiv({
        cls: 'aic-session-meta',
        text: shortAge(Date.now() - session.lastModified),
      });
      const pick = (): void => onPick(session.sessionId);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          pick();
        }
      });
    }
  }

  private clearEmptyState(): void {
    this.emptyEl?.remove();
    this.emptyEl = null;
  }

  apply(event: ChatEvent): void {
    switch (event.kind) {
      case 'user-turn':
        this.appendUserWell(
          event.text, event.contextNote, event.images, event.contextPath, event.contexts ?? [], event.key ?? null,
        );
        if (event.queued) this.markLastWellQueued();
        /* BUSY FROM THE FIRST MOMENT (Tom, 2026-09-01). The indicator used to
           appear only when the model's output began - thinking tokens or held
           text - which left the FIRST stretch of every turn, the seconds
           between send and the model's first signal, with nothing on screen at
           all. Fifteen quiet seconds read as a stalled session when they were
           a session at work. The turn itself is the busy signal: the SDK
           brackets it with this event and turn-end, so no polling and no new
           provider surface is needed - only the honesty of showing it. */
        this.showWorking('working');
        break;
      case 'text-open':
        this.closeToolGroup();
        /* HELD BACK, when the reply is going to be a card.
           Creating the block here is what made the raw format visible: the
           source streams in section by section as plain text and is only
           replaced by the rendered card at the end. In hold mode the block is
           not created until there is a finished document to put in it. */
        if (this.holding()) this.showWorking('writing');
        else this.ensureBlock(event.blockId, 'aic-assistant');
        break;
      case 'text-delta':
        this.appendDelta(event.blockId, event.text);
        break;
      case 'text-final':
        this.hideWorking();
        this.commitThinking();
        void this.finalizeMarkdown(event.blockId, event.text);
        break;
      case 'thinking-open':
        this.showWorking('thinking');
        break;
      case 'thinking-delta':
        /* The reasoning is READ, not counted. These deltas used to be dropped
           on the floor, which is why a long silent stretch of thinking looked
           exactly like a stalled session: there was nothing on screen that
           could change. */
        this.appendThinking(event.text);
        break;
      case 'thinking-final':
        this.setThinking(event.text);
        break;
      case 'tool-call': {
        // The running tool row's pulsing dot carries the busy signal now;
        // two pulses on screen would say "twice as busy" and mean nothing.
        this.hideWorking();
        /* A transcript stored before 0.6 carries no purpose. The row derives
           one from the name and the target rather than showing a blank. */
        const purpose = event.purpose || fallbackPurpose(event.name, event.target);
        this.upsertTool(event.toolUseId, event.name, event.target, purpose).status = 'running';
        this.paintTool(event.toolUseId);
        break;
      }
      case 'tool-approval': {
        const purpose = event.purpose || fallbackPurpose(event.name, event.target);
        const row = this.upsertTool(event.toolUseId, event.name, event.target, purpose);
        row.status = 'awaiting-approval';
        row.group.forcedOpen = true;
        this.paintTool(event.toolUseId);
        this.renderApprovalControls(event.toolUseId);
        break;
      }
      case 'tool-approval-resolved': {
        const row = this.tools.get(event.toolUseId);
        if (row) {
          row.status = event.allowed ? 'running' : 'failed';
          row.rightEl.empty();
          this.paintTool(event.toolUseId);
        }
        break;
      }
      case 'tool-result': {
        const row = this.upsertTool(event.toolUseId, 'tool', '', '');
        row.status = event.ok ? 'done' : 'failed';
        row.finishedAt = Date.now();
        // A stored transcript from before 0.6 carries no body; the field is
        // read defensively so a replay of one still paints the row.
        row.output = (event as { output?: string }).output ?? '';
        if (!event.ok && event.detail) setTooltip(row.el, event.detail);
        this.paintTool(event.toolUseId);
        /* The OTHER quiet stretch: between a tool's result and the model's
           next move the pane used to hold still - no dot, no text, nothing.
           The model is reading that result right now, so say so. Only when
           nothing else is still pulsing: while a sibling tool runs, its dot
           is the signal. */
        if (![...this.tools.values()].some((r) => r.status === 'running')) {
          this.showWorking('working');
        }
        break;
      }
      case 'compact-boundary':
        this.appendCompactBoundary();
        break;
      case 'turn-end':
      case 'aborted':
        this.hideWorking();
        this.commitThinking();
        this.flushHeld();
        this.settleRunningRows();
        break;
      case 'error':
        this.hideWorking();
        this.commitThinking();
        this.flushHeld();
        this.settleRunningRows();
        this.appendError(event.message);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------- messages */

  /* THE USER'S OWN TURN, pictures included.
   *
   * The images arrive here because a message is what was SENT, and a screenshot
   * that previewed in the composer and then vanished on send reads as a message
   * that failed. They render above the words for the same reason the SDK block
   * puts them first: the picture is the subject and the sentence is about it.
   *
   * `text` may be empty when the turn was an image on its own, which is a real
   * message ("what is this?") and not an empty one - so the text line is
   * omitted rather than left as a blank row. */
  appendUserWell(
    text: string,
    contextNote: string | null,
    images: readonly TurnImage[] = [],
    contextPath: string | null = null,
    contexts: readonly TurnContext[] = [],
    key: string | null = null,
  ): void {
    this.clearEmptyState();
    this.closeToolGroup();
    const well = this.column.createDiv({ cls: 'aic-user' });
    well.dataset.userText = text;
    /* THE PIN CONTROL, only on a well that has a key. The key is the
       transcript index the view assigned, and it is what ties this well to
       its row in the pin tray; a well without one (a stored transcript from
       an older build) has nothing to pin against and gets no control, rather
       than a button that does nothing. */
    if (key !== null && text) {
      well.dataset.wellKey = key;
      const pin = well.createEl('button', { cls: 'aic-user-pin', type: 'button' });
      setIcon(pin, 'pin');
      pin.setAttr('aria-label', 'Pin this prompt');
      setTooltip(pin, 'Pin this prompt');
      pin.addEventListener('click', () => this.callbacks.onTogglePin?.(key, text));
      this.wells.set(key, { el: well, pin });
    }
    /* THE CONTEXT CHIPS, above the words, because they are what the words are
       ABOUT: a `[[note]]` the user named, a folder or a tag they added. A
       single note opens; a group opens the list it stood for. The old open
       note pill below is kept for transcripts that carry only that, and it is
       skipped when the chips already say it. */
    if (contexts.length > 0) {
      const strip = well.createDiv({ cls: 'aic-user-chips' });
      for (const ctx of contexts) {
        const openable = ctx.path !== null || ctx.count > 1 || ctx.kind !== 'note';
        const chip = openable
          ? strip.createEl('button', { cls: 'aic-chip is-link', type: 'button' })
          : strip.createSpan({ cls: 'aic-chip' });
        if (ctx.count > 1) chip.addClass('is-group');
        const glyph = chip.createSpan({ cls: 'aic-chip-icon' });
        setIcon(glyph, CONTEXT_ICON[ctx.kind]);
        chip.createSpan({ text: ctx.label });
        if (ctx.count > 1) chip.createSpan({ cls: 'aic-chip-count', text: `· ${ctx.count}` });
        if (!openable) continue;
        const what = ctx.path !== null ? `Open ${ctx.label}` : `Show the ${ctx.count} notes in ${ctx.label}`;
        chip.setAttr('aria-label', what);
        setTooltip(chip, what);
        chip.addEventListener('click', () => {
          if (ctx.path !== null) this.callbacks.renderHost.openFile(ctx.path);
          else this.callbacks.onOpenContextGroup?.(ctx.label);
        });
      }
      if (contexts.some((c) => c.kind === 'active')) contextNote = null;
    }
    if (images.length > 0) {
      const strip = well.createDiv({ cls: 'aic-user-images' });
      for (const image of images) {
        if (!image.data) continue;
        const src = `data:${image.mediaType};base64,${image.data}`;
        const alt = image.name || 'attached image';
        /* A BUTTON, because it does something. It was a div, which meant the
           only way to read a screenshot back was to squint at a 240px
           thumbnail - and a keyboard user had no way at all. */
        const cell = strip.createEl('button', { cls: 'aic-user-image', type: 'button' });
        const img = cell.createEl('img', { cls: 'aic-user-image-img' });
        img.src = src;
        img.alt = alt;
        cell.setAttr('aria-label', `Open ${alt} full size`);
        setTooltip(cell, alt);
        cell.addEventListener('click', () => this.lightbox.open({ src, alt }));
      }
    }
    if (text) well.createDiv({ cls: 'aic-user-text', text });
    if (contextNote) {
      const row = well.createDiv({ cls: 'aic-user-context' });
      /* THE PILL OPENS THE NOTE when we know where it is.
         It named a note and did nothing, which is the worst of both: it looks
         like a link, it is the only reference to that note in the
         conversation, and clicking it taught the user that this surface does
         not respond. Without a path it stays a plain label rather than
         pretending. */
      const openable = contextPath !== null && contextPath !== '';
      const chip = openable
        ? row.createEl('button', { cls: 'aic-chip is-link', type: 'button' })
        : row.createSpan({ cls: 'aic-chip' });
      const glyph = chip.createSpan({ cls: 'aic-chip-icon' });
      setIcon(glyph, 'eye');
      chip.createSpan({ text: contextNote });
      if (openable) {
        chip.setAttr('aria-label', `Open ${contextNote}`);
        setTooltip(chip, `Open ${contextNote}`);
        chip.addEventListener('click', () => this.callbacks.renderHost.openFile(contextPath));
      }
    }
  }

  private ensureBlock(blockId: string, cls: string): HTMLElement {
    const existing = this.blocks.get(blockId);
    if (existing) return existing;
    this.clearEmptyState();
    const el = this.column.createDiv({ cls });
    this.blocks.set(blockId, el);
    this.blockText.set(blockId, '');
    return el;
  }

  /* True while a reply is being withheld until it is whole.
   *
   * Only in structured mode, and the reason is what the two modes stream. An
   * ordinary reply streams as the prose it will end up being, so watching it
   * arrive is the feature. A structured reply streams as its SOURCE - kickers,
   * rules, row markup - which is assembled into a card at the end, so watching
   * it arrive means watching the scaffolding get built and then swapped for the
   * building. Holding costs the ordinary case nothing because the ordinary case
   * never holds. */
  private holding(): boolean {
    return this.callbacks.structured();
  }

  private appendDelta(blockId: string, text: string): void {
    const next = (this.blockText.get(blockId) ?? '') + text;
    this.blockText.set(blockId, next);
    if (this.holding()) {
      // Accumulate only. Nothing reaches the column until the block finalizes,
      // and the working indicator is what says the turn is alive meanwhile.
      this.heldBlockId = blockId;
      this.showWorking('writing');
      return;
    }
    const el = this.ensureBlock(blockId, 'aic-assistant');
    el.setText(next);
    // Visible streaming text is its own liveness signal; the indicator would
    // just sit under it repeating what the caret already says.
    this.hideWorking();
  }

  /* THE ESCAPE HATCH, and it is the reason holding is safe.
   *
   * A turn that ends without a `text-final` - interrupted, errored, or a
   * provider that simply stopped - would otherwise leave every withheld
   * character in a Map with no element to put it in, and the user would see a
   * turn that produced nothing. Whatever was held is rendered on the way out,
   * as the text it is. Silence is never the failure mode of a feature whose
   * whole job is to stay quiet for a while. */
  private flushHeld(): void {
    for (const [blockId, text] of this.blockText) {
      if (this.blocks.has(blockId)) continue;
      if (!text.trim()) continue;
      void this.finalizeMarkdown(blockId, text);
    }
  }

  private async finalizeMarkdown(blockId: string, text: string): Promise<void> {
    const source = text || this.blockText.get(blockId) || '';
    if (!source.trim()) {
      // An interrupted turn keeps whatever text it received; an empty final
      // block is dropped rather than left as a blank paragraph.
      if (!this.blockText.get(blockId)) {
        this.blocks.get(blockId)?.remove();
        this.blocks.delete(blockId);
      }
      return;
    }
    const el = this.ensureBlock(blockId, 'aic-assistant');
    this.blockText.set(blockId, source);
    el.empty();

    if (this.callbacks.structured()) {
      const doc = parseStructured(source);
      if (doc.structured) {
        // The block stops being prose entirely: the card is the container now.
        el.removeClass('aic-assistant', 'is-rendered');
        el.addClass('aic-structured');
        el.dataset.blockId = blockId;
        renderStructured(el, doc, this.callbacks.renderHost, (host, text) => {
          void MarkdownRenderer.render(this.app, text, host, this.sourcePath, this.owner);
        });
        this.callbacks.onDecisions(decisionsOf(doc), blockId);
        return;
      }
      // Not in the format is the common case and must render as ordinary chat.
    }

    el.addClass('is-rendered');
    await MarkdownRenderer.render(this.app, source, el, this.sourcePath, this.owner);
  }

  /* ------------------------------------------------- the working indicator */

  /**
   * Show it, or relabel the one already up.
   *
   * The label is a FACT about what is happening and not a mood: "thinking"
   * while reasoning tokens are arriving, "writing" while a reply is being held
   * back. It is always the last thing in the column, because it is the only
   * element that describes the present.
   */
  private showWorking(label: string): void {
    this.clearEmptyState();
    if (!this.working) {
      const el = this.column.createDiv({ cls: 'aic-thinking' });
      const head = el.createDiv({ cls: 'aic-thinking-head' });
      const labelEl = head.createSpan({ cls: 'aic-thinking-label' });
      const dots = head.createSpan({ cls: 'aic-thinking-dots' });
      for (let i = 0; i < 3; i += 1) dots.createSpan({ cls: 'aic-thinking-dot', text: '.' });
      const body = el.createDiv({ cls: 'aic-thinking-body' });
      const toggle = (): void => {
        if (!this.readableText().trim()) return;
        this.thinkingOpen = !this.thinkingOpen;
        this.paintWorking();
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        toggle();
      });
      this.working = { el, head, labelEl, body, label };
    }
    this.working.label = label;
    /* Always the LAST child. A tool call that lands while the indicator is up
       would otherwise append below it, leaving "thinking..." floating above
       work that has visibly moved on.

       Guarded, because this runs on every delta: reparenting an element that is
       already last is a layout invalidation per token for no change on screen. */
    if (this.column.lastElementChild !== this.working.el) {
      this.column.appendChild(this.working.el);
    }
    this.paintWorking();
  }

  private hideWorking(): void {
    this.working?.el.remove();
    this.working = null;
  }

  /* WHAT THE BOX CAN ACTUALLY SHOW, and it is not always the reasoning.
   *
   * Measured against the real CLI on 2026-08-31, on claude-opus-5 at high
   * effort: a thinking block starts, two `thinking_delta` frames arrive, and
   * both carry `thinking: ""`. The finished block is `{thinking: "", signature:
   * "CAISqAIK..."}` - the reasoning is ENCRYPTED by the provider and the plugin
   * is never sent the words. A disclosure wired only to that text would be a
   * control that opens onto nothing, every time, on the default model.
   *
   * So the box falls back to the thing that IS available and is arguably the
   * better answer to "what is it working on": the live draft. In structured
   * mode the reply is being withheld, and the text being withheld is sitting
   * right here in `blockText`. Opening the box gives back exactly what the
   * hold took away, on demand instead of by force.
   *
   * Reasoning first when there is any, because when a model DOES expose it, it
   * is the more informative of the two. */
  private readableText(): string {
    if (this.thinkingText.trim()) return this.thinkingText;
    if (this.heldBlockId === null) return '';
    return this.blockText.get(this.heldBlockId) ?? '';
  }

  /** Repaint label, disclosure state and body. Cheap enough for every delta. */
  private paintWorking(): void {
    const w = this.working;
    if (!w) return;
    // Also on the per-delta path, so it only writes when the word changed.
    if (w.labelEl.getText() !== w.label) w.labelEl.setText(w.label);
    const text = this.readableText();
    const readable = text.trim().length > 0;
    /* THE CONTROL EXISTS ONLY WHEN THERE IS SOMETHING TO OPEN. A row that
       announces itself as a button and reveals nothing is the same empty
       promise as an expand affordance on a row that is not cut - and this
       plugin already refuses that one, by measurement, for tool rows. */
    w.el.toggleClass('is-readable', readable);
    if (readable) {
      w.head.setAttr('role', 'button');
      w.head.setAttr('tabindex', '0');
      w.head.setAttr('aria-expanded', this.thinkingOpen ? 'true' : 'false');
      w.head.setAttr(
        'aria-label',
        this.thinkingOpen ? 'Hide what the team is working on' : 'Show what the team is working on',
      );
    } else {
      w.head.removeAttribute('role');
      w.head.removeAttribute('tabindex');
      w.head.removeAttribute('aria-expanded');
      w.head.removeAttribute('aria-label');
    }
    const open = readable && this.thinkingOpen;
    w.el.toggleClass('is-open', open);
    if (open) {
      w.body.setText(text);
      /* The newest reasoning is the part worth reading, and it is at the
         bottom. An open box that stayed scrolled to the top would show the
         oldest paragraph for the whole turn. */
      w.body.scrollTop = w.body.scrollHeight;
    } else {
      w.body.empty();
    }
  }

  private appendThinking(text: string): void {
    if (!text) return;
    this.thinkingText += text;
    this.showWorking(this.working?.label ?? 'thinking');
  }

  /** The provider's own finished block, which supersedes the deltas it sent. */
  private setThinking(text: string): void {
    if (text.trim().length >= this.thinkingText.trim().length) this.thinkingText = text;
    if (this.working) this.paintWorking();
  }

  /**
   * Move this turn's reasoning out of the live box and into the transcript.
   *
   * The record is the same collapsed fold it always was, so a finished
   * conversation reads the same as before; what changed is that the text was
   * also readable WHILE it was being produced. Idempotent by clearing the
   * buffer, because both `text-final` and `turn-end` call it on a normal turn.
   */
  private commitThinking(): void {
    const text = this.thinkingText;
    this.thinkingText = '';
    this.heldBlockId = null;
    this.thinkingOpen = false;
    if (!text.trim()) return;
    const details = this.column.createEl('details', { cls: 'aic-fold' });
    const summary = details.createEl('summary', { cls: 'aic-fold-summary' });
    summary.createSpan({ cls: 'aic-kicker', text: 'THINKING' });
    details.createDiv({ cls: 'aic-fold-body', text });
  }

  private appendCompactBoundary(): void {
    this.closeToolGroup();
    const el = this.column.createDiv({ cls: 'aic-boundary' });
    kicker(el, 'CONTEXT COMPACTED');
  }

  private appendError(message: string): void {
    this.closeToolGroup();
    const el = this.column.createDiv({ cls: 'aic-error' });
    el.createSpan({ cls: 'aic-error-glyph', text: '×' });
    el.createSpan({ cls: 'aic-error-text', text: message });
  }

  /* ---------------------------------------------------------------- tools */

  private ensureGroup(): ToolGroup {
    if (this.group) return this.group;
    this.clearEmptyState();
    const el = this.column.createDiv({ cls: 'aic-toolgroup' });
    const summary = el.createDiv({ cls: 'aic-tool-summary' });
    summary.setAttr('role', 'button');
    summary.setAttr('tabindex', '0');
    const chevron = summary.createSpan({ cls: 'aic-chevron' });
    setIcon(chevron, 'chevron-right');
    const summaryGutter = summary.createSpan({ cls: 'aic-tool-summary-gutter' });
    const summaryLabel = summary.createSpan({ cls: 'aic-kicker aic-tool-summary-label' });
    const rowsEl = el.createDiv({ cls: 'aic-tool-rows' });
    const group: ToolGroup = {
      el,
      summary,
      summaryLabel,
      summaryGutter,
      rowsEl,
      rows: [],
      expanded: true,
      forcedOpen: false,
    };
    const toggle = (): void => {
      group.expanded = !group.expanded;
      this.paintGroup(group);
    };
    summary.addEventListener('click', toggle);
    summary.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });
    this.group = group;
    return group;
  }

  private closeToolGroup(): void {
    this.group = null;
  }

  private upsertTool(toolUseId: string, name: string, target: string, purpose: string): ToolRow {
    const existing = this.tools.get(toolUseId);
    if (existing) {
      // A result names its row with the placeholder name and no argument;
      // only a real call is allowed to overwrite what the row already knows.
      if (name !== 'tool') {
        existing.name = name;
        if (target) existing.target = target;
        if (purpose) existing.purpose = purpose;
        this.paintHead(existing);
      }
      return existing;
    }
    const group = this.ensureGroup();
    const el = group.rowsEl.createDiv({ cls: 'aic-tool' });
    const gutter = el.createSpan({ cls: 'aic-tool-gutter' });
    const main = el.createSpan({ cls: 'aic-tool-main' });
    const iconEl = main.createSpan({ cls: 'aic-tool-icon' });
    const purposeEl = main.createSpan({ cls: 'aic-tool-purpose' });
    const rightEl = el.createSpan({ cls: 'aic-tool-right' });
    const bodyEl = el.createDiv({ cls: 'aic-tool-body' });
    const row: ToolRow = {
      el,
      gutter,
      iconEl,
      purposeEl,
      rightEl,
      bodyEl,
      name,
      purpose,
      target,
      output: '',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      group,
      expanded: false,
    };
    group.rows.push(row);
    this.tools.set(toolUseId, row);
    this.paintHead(row);
    this.wireExpand(row);
    this.paintGroup(group);
    this.paintExpand(row);
    return row;
  }

  /* THE ROW SAYS WHAT WAS DONE, and opens onto how.
   *
   * The closed row is an icon for the tool family and one sentence: "Read 04
   * Inner World/Contacts/People/bernd-martin.md", "Ran Open the demo note in
   * Obsidian". It used to be the tool's NAME in a kicker and the raw argument
   * beside it, which for Bash is the shell command - every row in a session
   * began with the same cd and the part that differed was the part the pane
   * cut off, so a reader learned what the agent typed and never what it meant.
   *
   * The WHOLE ROW is the control. The right cell carries the duration, the
   * verdict mark, and a chevron that exists only when there is a body to open:
   * a row that carried no argument and produced no output has nothing behind
   * it, and an affordance with nothing behind it is the same shape as a guard
   * that cannot fail. Opened, the body shows the command (or the input) and
   * the result, wrapping rather than scrolling sideways: a horizontal scrollbar
   * inside a chat row hides the end of the string behind a gesture. */
  private paintHead(row: ToolRow): void {
    row.iconEl.empty();
    setIcon(row.iconEl, toolIcon(row.name));
    row.purposeEl.setText(row.purpose || row.name);
    setTooltip(row.purposeEl, row.purpose || row.name);
  }

  private wireExpand(row: ToolRow): void {
    const toggle = (): void => {
      if (!this.hasBody(row)) return;
      row.expanded = !row.expanded;
      this.paintExpand(row);
    };
    row.el.addEventListener('click', (ev: MouseEvent) => {
      // A row carries approval buttons in its right cell. A click that landed
      // on one of those is an answer to a permission prompt, not a request to
      // read the command, and swallowing it would open the row instead. A
      // click INSIDE the opened body is a reader selecting text, not a toggle.
      const target = ev.target as HTMLElement | null;
      if (target?.closest('button')) return;
      if (target?.closest('.aic-tool-body')) return;
      toggle();
    });
    row.el.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if ((ev.target as HTMLElement | null)?.closest('button')) return;
      ev.preventDefault();
      toggle();
    });
  }

  /** A row opens when it has something to show: a raw argument, or a result. */
  private hasBody(row: ToolRow): boolean {
    return row.target !== '' || row.output !== '';
  }

  private paintExpand(row: ToolRow): void {
    const openable = this.hasBody(row);
    if (!openable) row.expanded = false;
    row.el.toggleClass('is-expandable', openable);
    row.el.toggleClass('is-expanded', openable && row.expanded);
    if (!openable) {
      row.el.removeAttribute('role');
      row.el.removeAttribute('tabindex');
      row.el.removeAttribute('aria-expanded');
      row.el.removeAttribute('aria-label');
      row.bodyEl.empty();
      return;
    }
    row.el.setAttr('role', 'button');
    row.el.setAttr('tabindex', '0');
    row.el.setAttr('aria-expanded', row.expanded ? 'true' : 'false');
    /* An explicit name, because a role="button" takes its name from its own
       contents and the contents are the purpose sentence plus a duration. The
       NAME says what the control does. */
    const what = row.purpose || row.name;
    row.el.setAttr('aria-label', row.expanded ? `Collapse ${what}` : `Show what happened: ${what}`);
    this.paintBody(row);
  }

  /* The body is BUILT when the row opens and emptied when it closes. A closed
     row that kept a 4000-character result in the DOM would be paying layout
     for text nobody can see, on every row, for the whole conversation. */
  private paintBody(row: ToolRow): void {
    row.bodyEl.empty();
    if (!row.expanded) return;
    if (row.target) {
      kicker(row.bodyEl, row.name === 'Bash' ? 'COMMAND' : 'INPUT', 'aic-tool-body-kicker');
      row.bodyEl.createEl('pre', { cls: 'aic-tool-target', text: row.target });
    }
    if (row.output) {
      kicker(row.bodyEl, 'RESULT', 'aic-tool-body-kicker');
      row.bodyEl.createEl('pre', { cls: 'aic-tool-body-pre', text: row.output });
      /* MEASURED, not estimated. A line count is a fact about the text on
         screen; a token figure would be a guess wearing a number's clothes. */
      const lines = row.output.split('\n').length;
      row.bodyEl.createDiv({ cls: 'aic-tool-lines', text: `${lines} ${lines === 1 ? 'line' : 'lines'}` });
    }
  }

  /**
   * Kept as the name the resize path used to call. Whether a row opens is a
   * property of its content now, so there is nothing to re-take on resize.
   */
  remeasureTools(): void {
    for (const row of this.tools.values()) this.paintExpand(row);
  }

  private paintTool(toolUseId: string): void {
    const row = this.tools.get(toolUseId);
    if (!row) return;
    row.el.removeClass('is-running', 'is-done', 'is-failed', 'is-approval');
    row.gutter.empty();
    switch (row.status) {
      case 'running':
        row.el.addClass('is-running');
        dot(row.gutter, 'marker');
        break;
      case 'awaiting-approval':
        row.el.addClass('is-approval');
        dot(row.gutter, 'warning');
        break;
      case 'failed':
        row.el.addClass('is-failed');
        row.gutter.createSpan({ cls: 'aic-glyph-fail', text: '×' });
        break;
      case 'done':
      default:
        row.el.addClass('is-done');
        break;
    }
    this.paintRight(row);
    this.paintExpand(row);
    this.paintGroup(row.group);
  }

  /* The right cell, repainted whole: duration once finished, the verdict mark,
     then the disclosure chevron. The approval buttons are added by
     `renderApprovalControls` AFTER this, into the same cell, so a repaint
     never wipes a pending prompt: the awaiting state paints no mark and the
     buttons are the cell's whole content. */
  private paintRight(row: ToolRow): void {
    row.rightEl.empty();
    if (row.finishedAt !== null && row.status !== 'awaiting-approval') {
      row.rightEl.createSpan({ cls: 'aic-tool-time', text: shortDuration(row.finishedAt - row.startedAt) });
    }
    if (row.status === 'done') {
      const mark = row.rightEl.createSpan({ cls: 'aic-tool-mark is-ok' });
      setIcon(mark, 'check');
      mark.setAttr('aria-label', 'done');
    } else if (row.status === 'failed') {
      row.rightEl.createSpan({ cls: 'aic-tool-mark is-fail aic-glyph-fail', text: '×' });
    }
    if (this.hasBody(row)) {
      const chevron = row.rightEl.createSpan({ cls: 'aic-chevron aic-tool-chevron' });
      setIcon(chevron, 'chevron-right');
    }
  }

  private paintGroup(group: ToolGroup): void {
    const count = group.rows.length;
    const anyApproval = group.rows.some((r) => r.status === 'awaiting-approval');
    const anyRunning = group.rows.some((r) => r.status === 'running');
    const anyFailed = group.rows.some((r) => r.status === 'failed');
    const collapsible = count > COLLAPSE_AFTER && !anyApproval && !group.forcedOpen;
    group.el.toggleClass('has-summary', collapsible);
    const open = collapsible ? group.expanded && group.rows.length <= COLLAPSE_AFTER : true;
    // A group that is collapsible starts closed; a request for a human never
    // hides behind a chevron, which is what forcedOpen guarantees.
    const showRows = collapsible ? group.expanded : true;
    group.el.toggleClass('is-collapsed', collapsible && !showRows);
    group.summary.toggleClass('is-open', showRows);
    // No inline display: `.aic-toolgroup:not(.has-summary) .aic-tool-summary`
    // hides it in the stylesheet, so visibility has ONE driver - the class set
    // three lines up - instead of a class and an inline style that can split.
    group.summaryLabel.setText(`${count} TOOL CALLS`);
    group.summaryGutter.empty();
    if (anyRunning) dot(group.summaryGutter, 'marker');
    else if (anyApproval) dot(group.summaryGutter, 'warning');
    else if (anyFailed) group.summaryGutter.createSpan({ cls: 'aic-glyph-fail', text: '×' });
    void open;
  }

  private renderApprovalControls(toolUseId: string): void {
    const row = this.tools.get(toolUseId);
    if (!row) return;
    // The buttons go FIRST in the cell, ahead of the chevron the repaint left.
    const controls = row.rightEl.createSpan({ cls: 'aic-approval' });
    row.rightEl.prepend(controls);
    const choose = (choice: ApprovalChoice): void => {
      controls.remove();
      this.callbacks.onApproval(toolUseId, choice);
    };
    const deny = controls.createEl('button', { cls: 'aic-approve-deny', text: 'Deny', type: 'button' });
    const once = controls.createEl('button', { cls: 'aic-approve-once', text: 'Allow once', type: 'button' });
    const always = controls.createEl('button', {
      cls: 'aic-approve-always',
      text: 'Always allow',
      type: 'button',
    });
    deny.addEventListener('click', () => choose('deny'));
    once.addEventListener('click', () => choose('allow-once'));
    always.addEventListener('click', () => choose('allow-always'));
  }

  private settleRunningRows(): void {
    for (const [id, row] of this.tools) {
      if (row.status === 'running') {
        // No result ever arrived, so there is no duration to print: the
        // finish is not stamped and the right cell carries the mark alone.
        row.status = 'done';
        this.paintTool(id);
      }
    }
    if (this.group) this.paintGroup(this.group);
  }

  /* CLOSE OUT A REPLAYED TRANSCRIPT.
   *
   * The subagent view replays a stored event log, and a stored log has no
   * turn-end: the bus records what was forwarded and the lifecycle arrives as
   * a separate close signal, not as an event in the log. Under held-back
   * structured replies that combination rendered NOTHING - every delta was
   * accumulated waiting for a final or a turn-end that would never come, and
   * the user opened a finished subagent onto a blank pane. This is the same
   * escape hatch the live stream runs at turn-end, callable by a replayer
   * that knows the run is over. */
  settleReplay(): void {
    this.hideWorking();
    this.commitThinking();
    this.flushHeld();
    this.settleRunningRows();
  }

  /* QUEUED, said on the well itself.
   *
   * A follow-up sent mid-turn lands in the stream at once, because it was
   * sent, but the CLI will not read it until the running turn ends. Without a
   * mark the well reads as a message the team is answering right now, which is
   * exactly the misreading the old Stop-on-Enter behaviour came from. The mark
   * is a kicker in the well's corner and it leaves when the queued turn begins. */
  markLastWellQueued(): void {
    const wells = this.column.querySelectorAll('.aic-user');
    const last = wells[wells.length - 1];
    if (!last || !last.instanceOf(HTMLElement) || last.hasClass('is-queued')) return;
    last.addClass('is-queued');
    const mark = last.createSpan({ cls: 'aic-kicker aic-user-queued', text: 'QUEUED' });
    mark.setAttr('aria-label', 'Queued for the next turn');
  }

  /** The oldest queued well is being answered now: its mark comes off. */
  clearQueued(): void {
    const first = this.column.querySelector('.aic-user.is-queued');
    if (!first || !first.instanceOf(HTMLElement)) return;
    first.removeClass('is-queued');
    first.querySelector('.aic-user-queued')?.remove();
  }

  /** A quiet line of plugin-voice narration. Never styled as the team talking. */
  note(text: string): void {
    this.clearEmptyState();
    this.column.createDiv({ cls: 'aic-note', text });
  }

  /**
   * Close the replayed history off from what follows. A resumed conversation
   * has a real seam in it - everything above happened in another sitting - and
   * hiding that seam would make the two look like one continuous turn.
   */
  sealReplay(): void {
    this.group = null;
    this.hideWorking();
    this.thinkingText = '';
    const seam = this.column.createDiv({ cls: 'aic-seam' });
    seam.createSpan({ cls: 'aic-kicker', text: 'RESUMED' });
  }

  /* ------------------------------------------------------------ pins */

  /** Repaint one well's pinned state. A key the column never saw is a no-op. */
  setPinned(key: string, pinned: boolean): void {
    const well = this.wells.get(key);
    if (!well) return;
    well.el.toggleClass('is-pinned', pinned);
    /* The button is held, not queried: a realm check on a found node is the
       kind of thing a popout window gets wrong, and the well already knows
       which button it built. */
    const label = pinned ? 'Unpin this prompt' : 'Pin this prompt';
    well.pin.setAttr('aria-label', label);
    setTooltip(well.pin, label);
  }

  /** Bring a user well into view, with the same flash the decision badge uses. */
  scrollToWell(key: string): void {
    const well = this.wells.get(key)?.el;
    if (!well) return;
    well.scrollIntoView({ behavior: 'smooth', block: 'center' });
    well.addClass('is-flash');
    window.setTimeout(() => well.removeClass('is-flash'), 600);
  }

  destroy(): void {
    this.wells.clear();
    this.lightbox.close();
    this.resize?.disconnect();
    this.resize = null;
    this.blocks.clear();
    this.blockText.clear();
    this.tools.clear();
    this.group = null;
    this.working = null;
    this.thinkingText = '';
    this.heldBlockId = null;
  }
}

/* One glyph per tool FAMILY, never per tool: the icon says what kind of thing
   happened (a file was read, a command ran, a search was made) and the
   sentence beside it says which. A new tool the table does not know gets the
   wrench rather than nothing, so the column of icons never has a hole. */
function toolIcon(name: string): string {
  switch (name) {
    case 'Read':
      return 'file-text';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'pencil';
    case 'Bash':
      return 'terminal';
    case 'Glob':
    case 'Grep':
      return 'search';
    case 'WebFetch':
    case 'WebSearch':
      return 'globe';
    case 'Task':
    case 'Agent':
      return 'bot';
    case 'TodoWrite':
      return 'list-checks';
    default:
      return 'wrench';
  }
}
