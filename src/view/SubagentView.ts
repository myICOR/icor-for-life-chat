/* One subagent, one workspace tab.
 *
 * Never a same-pane swap and never a modal: Obsidian's own tab chrome carries
 * the wayfinding, and the header block below carries the identity. A view
 * restored after a reload has no live process behind it, so it reads REPLAY
 * with a static faint dot - a record is not a completion event, and never
 * wears the green one. */

import { ItemView, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME, VIEW_TYPE_SUBAGENT } from '../constants';
import { StreamRenderer } from './stream/StreamRenderer';
import { compactNumber, shortDuration } from '../model/format';
import type { SubagentStatus, SubagentTranscript } from '../state/subagents';
import type IcorChatPlugin from '../main';

const STATUS_WORD: Record<SubagentStatus, string> = {
  running: 'RUNNING',
  done: 'DONE',
  failed: 'FAILED',
  orphaned: 'ORPHANED',
  replay: 'REPLAY',
};

const STATUS_TONE: Record<SubagentStatus, string> = {
  running: 'marker',
  done: 'success',
  failed: 'destructive',
  orphaned: 'warning',
  replay: 'faint',
};

export class SubagentView extends ItemView {
  private agentId = '';
  private stream: StreamRenderer | null = null;
  private unsubscribe: (() => void) | null = null;
  private metaEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: IcorChatPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_SUBAGENT;
  }

  override getDisplayText(): string {
    const transcript = this.plugin.subagents.get(this.agentId);
    return transcript ? transcript.agentType : 'Subagent';
  }

  override getIcon(): string {
    return 'git-branch';
  }

  override getState(): Record<string, unknown> {
    return { agentId: this.agentId };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    if (state && typeof state === 'object' && 'agentId' in state) {
      const id = (state as { agentId?: unknown }).agentId;
      if (typeof id === 'string') this.agentId = id;
    }
    await super.setState(state, result as Parameters<ItemView['setState']>[1]);
    this.paint();
  }

  override async onOpen(): Promise<void> {
    this.paint();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stream?.destroy();
  }

  private paint(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('aic-root');
    root.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    const transcript = this.plugin.subagents.get(this.agentId);

    const header = root.createDiv({ cls: 'aic-sub-header' });
    const kickerRow = header.createDiv({ cls: 'aic-sub-kicker' });
    const back = kickerRow.createEl('button', { cls: 'aic-sub-back', type: 'button', text: '‹' });
    back.setAttr('aria-label', 'Back to the conversation');
    back.addEventListener('click', () => this.plugin.revealChat());
    kickerRow.createSpan({ cls: 'aic-kicker aic-kicker-wide', text: 'SUBAGENT' });
    kickerRow.createSpan({ cls: 'aic-middot', text: '·' });
    kickerRow.createSpan({ cls: 'aic-kicker aic-sub-type', text: transcript?.agentType ?? 'AGENT' });
    kickerRow.createSpan({ cls: 'aic-middot', text: '·' });
    this.statusEl = kickerRow.createSpan({ cls: 'aic-sub-status' });

    const title = header.createDiv({ cls: 'aic-sub-title' });
    title.setText(transcript?.description || 'Subagent transcript');
    this.metaEl = header.createDiv({ cls: 'aic-sub-meta' });

    const body = root.createDiv({ cls: 'aic-stream' });
    const column = body.createDiv({ cls: 'aic-column' });

    if (transcript?.task) {
      // Flat on the ink, never the user well: the well is the user's form, and
      // this prompt was written by the orchestrating agent.
      const task = column.createDiv({ cls: 'aic-task' });
      task.createDiv({ cls: 'aic-kicker', text: 'TASK' });
      task.createDiv({ cls: 'aic-task-body', text: transcript.task });
    }

    this.stream = new StreamRenderer(this.app, this, column, '', {
      onApproval: () => undefined,
      structured: () => this.plugin.settings.structuredReplies,
      renderHost: this.plugin.renderHostFor(this),
      onDecisions: () => undefined,
    });

    if (!transcript) {
      column.createDiv({
        cls: 'aic-error',
        text: 'This transcript is no longer in memory. Reopen it from the conversation.',
      });
      this.paintStatus('replay');
      return;
    }

    for (const event of transcript.events) this.stream.apply(event);
    this.paintStatus(transcript.status);
    this.paintMeta(transcript);

    this.unsubscribe?.();
    this.unsubscribe = this.plugin.subagents.subscribe(this.agentId, (event, current) => {
      if (event) this.stream?.apply(event);
      this.paintStatus(current.status);
      this.paintMeta(current);
    });
  }

  private paintStatus(status: SubagentStatus): void {
    const el = this.statusEl;
    if (!el) return;
    el.empty();
    const dot = el.createSpan({ cls: `aic-dot aic-dot-${STATUS_TONE[status]}` });
    // Only a live process pulses. A record holds still.
    if (status !== 'running') dot.addClass('aic-dot-static');
    el.createSpan({ cls: 'aic-kicker', text: STATUS_WORD[status] });
  }

  private paintMeta(transcript: SubagentTranscript): void {
    const el = this.metaEl;
    if (!el) return;
    el.empty();
    const end = transcript.endedAt ?? Date.now();
    const parts: string[] = [shortDuration(end - transcript.startedAt)];
    if (transcript.tokens > 0) parts.push(`${compactNumber(transcript.tokens)} TOK`);
    if (transcript.toolCalls > 0) parts.push(`${transcript.toolCalls} TOOLS`);
    parts.forEach((part, i) => {
      if (i > 0) el.createSpan({ cls: 'aic-middot', text: '·' });
      el.createSpan({ text: part });
    });
  }
}

/** The chip tray below the composer: active-only, zero height when empty. */
export function renderChipTray(
  el: HTMLElement,
  transcripts: SubagentTranscript[],
  onOpen: (agentId: string) => void,
): void {
  el.empty();
  el.toggleClass('is-empty', transcripts.length === 0);
  for (const transcript of transcripts) {
    const chip = el.createEl('button', { cls: 'aic-agent-chip', type: 'button' });
    const dot = chip.createSpan({ cls: `aic-dot aic-dot-${STATUS_TONE[transcript.status]}` });
    if (transcript.status !== 'running') dot.addClass('aic-dot-static');
    chip.createSpan({ cls: 'aic-agent-name', text: transcript.agentType });
    if (transcript.status === 'running') {
      chip.createSpan({
        cls: 'aic-agent-time',
        text: shortDuration(Date.now() - transcript.startedAt),
      });
    }
    chip.setAttr('aria-label', `Open the ${transcript.agentType} transcript, ${STATUS_WORD[transcript.status].toLowerCase()}`);
    chip.addEventListener('click', () => onOpen(transcript.agentId));
    void setIcon;
  }
}
