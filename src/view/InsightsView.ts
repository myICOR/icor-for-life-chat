/* The AI team insights tab. One per vault, in the main area: it is a page
 * to read, not a companion to a conversation, so it does not ride the right
 * sidebar the chat lives in.
 *
 * The view holds the UI state (range, filters), loads the archives once per
 * open, and re-aggregates in memory on every filter change. A vault change
 * under the archive root reloads, debounced, so a conversation finishing in
 * another tab shows up without reopening. */

import { ItemView, Notice, TFile } from 'obsidian';
import { ItemView, TFile } from 'obsidian';
import { recentJournals } from '../team/memory';
import type { WorkspaceLeaf } from 'obsidian';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME, VIEW_TYPE_INSIGHTS } from '../constants';
import { archiveRoot } from '../model/settings';
import { aggregate } from '../team/insights';
import type { Filters, RangeKey } from '../team/insights';
import { loadInsights } from '../team/load';
import type { InsightsData } from '../team/load';
import { avatarUrl, detectTeam } from '../team/detect';
import type { TeamRoster } from '../team/detect';
import { renderInsights } from './InsightsRender';
import type IcorChatPlugin from '../main';
import { deliverableEntry } from '../wip/deliverable';

export class InsightsView extends ItemView {
  private body: HTMLElement | null = null;
  private data: InsightsData | null = null;
  private roster: TeamRoster | null = null;
  private range: RangeKey = '30d';
  private filters: Filters = { agent: null, model: null };
  private reloadTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: IcorChatPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_INSIGHTS;
  }

  override getDisplayText(): string {
    return 'AI team insights';
  }

  override getIcon(): string {
    return 'bar-chart-3';
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('aic-root', 'aic-insights');
    root.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    const scroller = root.createDiv({ cls: 'aic-stream' });
    this.body = scroller.createDiv({ cls: 'aic-column aic-ins-column' });
    this.body.createDiv({ cls: 'aic-note', text: 'Reading the archives.' });
    await this.reload();
    const root2 = archiveRoot(this.plugin.settings, this.plugin.scaffoldDetected);
    const touches = (path: string): boolean => path.startsWith(`${root2}/`) || path.startsWith('06 AI Team/');
    const schedule = (path: string): void => {
      if (!touches(path)) return;
      if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => {
        this.reloadTimer = null;
        void this.reload();
      }, 800);
    };
    this.registerEvent(this.app.vault.on('create', (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on('modify', (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on('delete', (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { schedule(f.path); schedule(old); }));
  }

  override async onClose(): Promise<void> {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  private async reload(): Promise<void> {
    this.roster = detectTeam(this.app);
    const root = archiveRoot(this.plugin.settings, this.plugin.scaffoldDetected);
    this.data = await loadInsights(this.app, root, this.roster ? this.roster.agents.length : null);
    this.paint();
  }

  private paint(): void {
    if (!this.body || !this.data) return;
    const rosterRefs = this.roster ? this.roster.agents.map((a) => ({ name: a.name, slug: a.slug })) : null;
    const agg = aggregate(this.data.sessions, this.range, this.filters, rosterRefs);
    renderInsights(
      this.body,
      { agg, vault: this.data.vault, totalSessions: this.data.sessions.length, archiveRoot: this.data.archiveRoot },
      { range: this.range, filters: this.filters },
      {
        resolveAvatar: (path) => avatarUrl(this.app, path),
        avatarFor: (key) => this.roster?.agents.find((a) => a.slug === key)?.avatarPath ?? null,
        openSession: (folder) => void this.openConversation(folder),
        openWip: (folder) => void this.openWip(folder),
        onRange: (range) => { this.range = range; this.paint(); },
        onAgent: (key) => { this.filters = { ...this.filters, agent: key }; this.paint(); },
        onModel: (model) => { this.filters = { ...this.filters, model }; this.paint(); },
        journalsFor: (key) => {
          const agent = this.roster?.agents.find((a) => a.slug === key);
          return agent ? recentJournals(this.app, agent.folder) : Promise.resolve(null);
        },
      },
    );
  }

  private async openWip(folder: string): Promise<void> {
    const file = deliverableEntry(this.app, folder);
    if (file) await this.app.workspace.getLeaf('tab').openFile(file);
    else new Notice(`${folder} holds no note to open.`);
  }

  private async openConversation(folder: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(`${folder}/conversation.md`);
    if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file);
  }
}
