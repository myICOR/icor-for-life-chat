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
import type { ChatEvent, ToolStatus } from '../../model/types';
import { dot, kicker, shortAge, shortDuration } from '../dom';
import type { ApprovalChoice } from '../../sdk/permissions';
import { parseStructured, decisionsOf } from '../../structured/parser';
import { renderStructured } from '../../structured/render';
import type { RenderHost } from '../../structured/render';
import type { DecisionBlock } from '../../structured/model';

const COLLAPSE_AFTER = 3;

interface ToolRow {
  el: HTMLElement;
  gutter: HTMLElement;
  nameEl: HTMLElement;
  /** The payload cell. Null when the call carried no target at all. */
  targetEl: HTMLElement | null;
  rightEl: HTMLElement;
  status: ToolStatus;
  startedAt: number;
  group: ToolGroup;
  /**
   * Survives every repaint, because a row is keyed by its tool-use id and
   * reused rather than rebuilt. A stream that collapsed a row the user had
   * opened, every time a later tool finished, would be unusable.
   */
  expanded: boolean;
  /** Measured, never assumed: true only while the payload is actually cut. */
  expandable: boolean;
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
  /** True while the opt-in structured-replies mode is on. */
  structured: () => boolean;
  renderHost: RenderHost;
  /** Every decision a finished assistant block surfaced, with its position. */
  onDecisions: (decisions: DecisionBlock[], blockId: string) => void;
}

export class StreamRenderer {
  private readonly blocks = new Map<string, HTMLElement>();
  private readonly blockText = new Map<string, string>();
  private readonly tools = new Map<string, ToolRow>();
  private group: ToolGroup | null = null;
  private thinkingEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;

  constructor(
    private readonly app: App,
    private readonly owner: Component,
    private readonly column: HTMLElement,
    private readonly sourcePath: string,
    private readonly callbacks: StreamCallbacks,
  ) {
    /* Whether a payload is CUT is a function of the pane's width, so the answer
       has to be re-taken when the pane changes width and not only when a tool
       call arrives. Without this, narrowing a leaf leaves rows that are now
       truncated with no way to open them, and widening it leaves rows carrying
       a tab stop that reveals nothing. */
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.remeasureTools());
      this.resize.observe(this.column);
    }
  }

  private resize: ResizeObserver | null = null;

  get isEmpty(): boolean {
    return this.blocks.size === 0 && this.tools.size === 0;
  }

  /** The empty state is typography: kicker, display line, one hand note. */
  renderEmptyState(): void {
    if (this.emptyEl) return;
    const wrap = this.column.createDiv({ cls: 'aic-empty' });
    const k = wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide' });
    k.createSpan({ text: 'AI TEAM' });
    k.createSpan({ cls: 'aic-middot', text: '·' });
    k.createSpan({ text: 'ICOR FOR LIFE' });
    wrap.createDiv({ cls: 'aic-empty-display', text: 'What are we working on?' });
    wrap.createDiv({ cls: 'aic-empty-hand', text: 'the team reads this vault' });
    this.emptyEl = wrap;
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
        this.appendUserWell(event.text, event.contextNote);
        break;
      case 'text-open':
        this.closeToolGroup();
        this.ensureBlock(event.blockId, 'aic-assistant');
        break;
      case 'text-delta':
        this.appendDelta(event.blockId, event.text);
        break;
      case 'text-final':
        void this.finalizeMarkdown(event.blockId, event.text);
        break;
      case 'thinking-open':
        this.showThinking();
        break;
      case 'thinking-delta':
        break;
      case 'thinking-final':
        this.hideThinking();
        this.appendThinkingRecord(event.text);
        break;
      case 'tool-call':
        this.hideThinking();
        this.upsertTool(event.toolUseId, event.name, event.target).status = 'running';
        this.paintTool(event.toolUseId);
        break;
      case 'tool-approval': {
        const row = this.upsertTool(event.toolUseId, event.name, event.target);
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
        const row = this.upsertTool(event.toolUseId, 'tool', '');
        row.status = event.ok ? 'done' : 'failed';
        row.rightEl.setText(shortDuration(Date.now() - row.startedAt));
        if (!event.ok && event.detail) setTooltip(row.el, event.detail);
        this.paintTool(event.toolUseId);
        break;
      }
      case 'compact-boundary':
        this.appendCompactBoundary();
        break;
      case 'turn-end':
      case 'aborted':
        this.hideThinking();
        this.settleRunningRows();
        break;
      case 'error':
        this.hideThinking();
        this.settleRunningRows();
        this.appendError(event.message);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------- messages */

  appendUserWell(text: string, contextNote: string | null): void {
    this.clearEmptyState();
    this.closeToolGroup();
    const well = this.column.createDiv({ cls: 'aic-user' });
    well.dataset.userText = text;
    well.createDiv({ cls: 'aic-user-text', text });
    if (contextNote) {
      const row = well.createDiv({ cls: 'aic-user-context' });
      const chip = row.createSpan({ cls: 'aic-chip' });
      const glyph = chip.createSpan({ cls: 'aic-chip-icon' });
      setIcon(glyph, 'eye');
      chip.createSpan({ text: contextNote });
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

  private appendDelta(blockId: string, text: string): void {
    const el = this.ensureBlock(blockId, 'aic-assistant');
    const next = (this.blockText.get(blockId) ?? '') + text;
    this.blockText.set(blockId, next);
    el.setText(next);
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

  private showThinking(): void {
    if (this.thinkingEl) return;
    this.clearEmptyState();
    const el = this.column.createDiv({ cls: 'aic-thinking' });
    el.createSpan({ text: 'thinking' });
    const dots = el.createSpan({ cls: 'aic-thinking-dots' });
    for (let i = 0; i < 3; i += 1) dots.createSpan({ cls: 'aic-thinking-dot', text: '.' });
    this.thinkingEl = el;
  }

  private hideThinking(): void {
    this.thinkingEl?.remove();
    this.thinkingEl = null;
  }

  private appendThinkingRecord(text: string): void {
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

  private upsertTool(toolUseId: string, name: string, target: string): ToolRow {
    const existing = this.tools.get(toolUseId);
    if (existing) {
      if (name !== 'tool' && existing.nameEl.getText() !== name) existing.nameEl.setText(name);
      this.measureRow(existing);
      return existing;
    }
    const group = this.ensureGroup();
    const el = group.rowsEl.createDiv({ cls: 'aic-tool' });
    const gutter = el.createSpan({ cls: 'aic-tool-gutter' });
    const main = el.createSpan({ cls: 'aic-tool-main' });
    const nameEl = main.createSpan({ cls: 'aic-kicker aic-tool-name', text: name });
    const targetEl = target ? main.createSpan({ cls: 'aic-tool-target', text: target }) : null;
    const rightEl = el.createSpan({ cls: 'aic-tool-right' });
    const row: ToolRow = {
      el,
      gutter,
      nameEl,
      targetEl,
      rightEl,
      status: 'running',
      startedAt: Date.now(),
      group,
      expanded: false,
      expandable: false,
    };
    group.rows.push(row);
    this.tools.set(toolUseId, row);
    this.wireExpand(row);
    this.paintGroup(group);
    this.measureRow(row);
    return row;
  }

  /* THE ROW OPENS. A Bash payload is cut at the width of the pane, and the cut
   * lands after the `cd`, so every row in a session reads identically for its
   * first sixty characters and the part that differs is always the part that
   * is gone. A user scanning what the agent actually ran learns nothing.
   *
   * The WHOLE ROW is the control, and there is no disclosure glyph: the
   * pickers just lost theirs, and a stream that grows an arrow per row is
   * chrome in the one region that is meant to be content. The affordance is the
   * cursor and the hover ground.
   *
   * It wraps rather than scrolls. A horizontal scrollbar inside a chat row is
   * the worse of the two: it hides the end of the string behind a gesture and
   * takes the row out of the column's own reading rhythm. */
  private wireExpand(row: ToolRow): void {
    const toggle = (): void => {
      if (!row.expandable) return;
      row.expanded = !row.expanded;
      this.paintExpand(row);
    };
    row.el.addEventListener('click', (ev: MouseEvent) => {
      // A row carries approval buttons in its right cell. A click that landed
      // on one of those is an answer to a permission prompt, not a request to
      // read the command, and swallowing it would open the row instead.
      if ((ev.target as HTMLElement | null)?.closest('button')) return;
      toggle();
    });
    row.el.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if ((ev.target as HTMLElement | null)?.closest('button')) return;
      ev.preventDefault();
      toggle();
    });
  }

  /**
   * MEASURED, never assumed. A row whose payload fits gets no tab stop and no
   * pointer, because an expand affordance on a row with nothing to reveal is
   * an empty promise - the same shape as a guard that cannot fail. Deterministic,
   * therefore a script rather than a judgement.
   */
  private measureRow(row: ToolRow): void {
    const el = row.targetEl;
    if (!el) return;
    // Measured in the COLLAPSED state, which is the only state the question
    // means anything in: an expanded row wraps, so it never overflows.
    const wasExpanded = row.el.hasClass('is-expanded');
    if (wasExpanded) row.el.removeClass('is-expanded');
    const cut = el.scrollWidth > el.clientWidth + 1;
    if (wasExpanded) row.el.addClass('is-expanded');
    // A row that has not been laid out yet measures zero and answers "not
    // cut". It is re-measured on the next resize rather than guessed at here.
    if (el.clientWidth === 0) return;
    row.expandable = cut;
    if (!cut) row.expanded = false;
    this.paintExpand(row);
  }

  private paintExpand(row: ToolRow): void {
    row.el.toggleClass('is-expandable', row.expandable);
    row.el.toggleClass('is-expanded', row.expandable && row.expanded);
    if (!row.expandable) {
      row.el.removeAttribute('role');
      row.el.removeAttribute('tabindex');
      row.el.removeAttribute('aria-expanded');
      row.el.removeAttribute('aria-label');
      return;
    }
    row.el.setAttr('role', 'button');
    row.el.setAttr('tabindex', '0');
    row.el.setAttr('aria-expanded', row.expanded ? 'true' : 'false');
    /* An explicit name, because a role="button" takes its name from its own
       contents and the contents here are a 300-character shell command. The
       command stays readable as the row's content; the NAME says what the
       control does. */
    const what = row.nameEl.getText() || 'tool';
    row.el.setAttr('aria-label', row.expanded ? `Collapse the ${what} call` : `Show the full ${what} call`);
  }

  /** Re-measure every row. The cut is a function of the pane's width. */
  remeasureTools(): void {
    for (const row of this.tools.values()) this.measureRow(row);
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
    this.paintGroup(row.group);
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
    row.rightEl.empty();
    const controls = row.rightEl.createSpan({ cls: 'aic-approval' });
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
    for (const [, row] of this.tools) {
      if (row.status === 'running') {
        row.status = 'done';
        row.el.removeClass('is-running');
        row.el.addClass('is-done');
        row.gutter.empty();
      }
    }
    if (this.group) this.paintGroup(this.group);
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
    this.thinkingEl = null;
    const seam = this.column.createDiv({ cls: 'aic-seam' });
    seam.createSpan({ cls: 'aic-kicker', text: 'RESUMED' });
  }

  destroy(): void {
    this.resize?.disconnect();
    this.resize = null;
    this.blocks.clear();
    this.blockText.clear();
    this.tools.clear();
    this.group = null;
    this.thinkingEl = null;
  }
}
