/* One tab, one conversation. The view owns its DOM and its session and nothing
 * else; it never imports the Agent SDK, only the ChatSession that wraps it. */

import { ItemView, MarkdownView, Notice, Platform, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_CHAT } from '../constants';
import { ChatStore } from '../state/store';
import { StreamRenderer } from './stream/StreamRenderer';
import type { Composer } from './composer/Composer';
import type { Statusline } from './composer/Statusline';
import { listVaultSessions, readSessionMessages, resolvedDefaultModel, sessionCreatedAt, sessionExists } from '../sdk/sessions';
import type { DecisionBadge } from './composer/DecisionBadge';
import { buildPane } from './pane';
import { trackDecisions, openDecisions, mentionsCode } from '../structured/decisions';
import type { SurfacedDecision, TranscriptEntry, TrackedDecision } from '../structured/decisions';
import { repaintDecisions } from '../structured/render';
import { renderChipTray } from './SubagentView';
import { ArchiveWriter } from '../archive/writer';
import { archiveRoot, factVisibility } from '../model/settings';
import { SDK_VERSION } from '../constants';
import {
  listFolders, listProperties, listTags, readContext, resolveFolder, resolveProperty, resolveTag,
  resolveWikilink, selectionRangeLabel, withContext,
} from './context';
import type { NoteContext } from './context';
import { baseOf, contextPickId, folderOf, previewText } from '../model/context';
import type { ContextPick, ContextRef } from '../model/context';
import { wikilinksIn } from './composer/mention';
import { ContextModal, contextIcon } from './ContextModal';
import { renderPinTray } from './PinTray';
import { isPinned, pinFirstPrompt, pinsFromState, pinsToState, togglePin, unpin } from '../model/pins';
import type { PinnedPrompt } from '../model/pins';
import type { TrayChip } from './composer/Composer';
import { ChatSession } from '../sdk/session';
import { Normalizer, userTextOf } from '../sdk/normalize';
import { buildChildEnv, resolveCliPath, splitExtraPath } from '../sdk/cli';
import type { PathEnvironment } from '../sdk/cli';
import type { ChatEvent, EffortName, PermissionModeName, TurnContext, TurnImage } from '../model/types';
import { NO_FOLLOW_UPS, followUpSent, queuedTurnBegan, turnAborted, turnEnded } from '../model/followups';
import type { FollowUpState } from '../model/followups';
import { applyStatusBarClearance } from './statusbar';
import type { Attachment } from './composer/Composer';
import type IcorChatPlugin from '../main';
import { avatarUrl, detectTeam, isTeamPath } from '../team/detect';
import type { TeamRoster } from '../team/detect';
import { agentShares } from '../team/usage';
import type { AgentShare } from '../team/usage';
import { renderTeamStrip } from './TeamStrip';
import { setupSummary, setupTeam } from '../team/setup';
import type { EmptyTeamBlock } from './stream/StreamRenderer';

export class ChatView extends ItemView {
  private readonly store = new ChatStore();
  private stream: StreamRenderer | null = null;
  private composer: Composer | null = null;
  private session: ChatSession | null = null;
  private column: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private statusline: Statusline | null = null;
  private context: NoteContext | null = null;
  private contextPinned = true;
  /* WHAT THE NEXT MESSAGE CARRIES besides the open note: notes and groups
   * picked from the `+` menu. Per message, like the images - sent once and
   * cleared. Notes named with `[[` in the text are added at send time, so
   * typing a link and picking a note from the menu end in the same place. */
  private refs: ContextRef[] = [];
  /** The last sent turn's group refs, so a chip in the transcript can open its list. */
  private readonly sentGroups = new Map<string, ContextRef>();
  private lastMarkdownView: MarkdownView | null = null;
  private resumeSessionId: string | null = null;
  private tick: number | null = null;
  private badge: DecisionBadge | null = null;
  /* The decision lifecycle is DERIVED from these two lists on every render and
   * stored nowhere: the transcript is the record, so there is no flag to drift. */
  private readonly transcript: TranscriptEntry[] = [];
  private readonly surfaced: SurfacedDecision[] = [];
  /* THE PINS. The first prompt is pinned by the plugin, the rest by the user,
   * and the list lives on the leaf state so a reopened tab keeps it. `pinsEl`
   * is rung 0; `openPins` is which rows are unfolded, owned here so a repaint
   * never folds a pin the user just opened. */
  private pins: PinnedPrompt[] = [];
  private readonly openPins = new Set<string>();
  private pinsEl: HTMLElement | null = null;
  private readonly blockIndex = new Map<string, number>();
  private turnCounter = 0;
  /** One catalogue fetch per session; a resumed tab re-asks on its own init. */
  private modelCatalogLoaded = false;
  private readonly taskPrompts = new Map<string, string>();
  private chipTray: HTMLElement | null = null;
  private startedAt = Date.now();
  /** Every provider session id this tab has held, oldest first. */
  private readonly sessionIds: string[] = [];
  private readonly events: ChatEvent[] = [];
  private archiving = false;
  /* THE MODE THIS TAB IS IN, which is not the same thing as the mode SETTINGS
   * start new tabs in.
   *
   * `ensureSession` used to launch with `settings.defaultPermissionMode`
   * directly, so a mode picked in the composer BEFORE the first message was
   * dropped on the floor: the picker called `setPermissionMode` on a session
   * that did not exist yet, nothing remembered the choice, and the session then
   * launched in the settings mode. Combined with the CLI's refusal to enter
   * bypass at runtime without the launch flag, that is the whole of "clicking
   * Bypass does not bypass". The picker writes here; the launcher reads here. */
  private permissionMode: PermissionModeName;
  /* FOLLOW-UPS the CLI is holding. Pure bookkeeping in model/followups.ts,
     measured behaviour at the top of sdk/session.ts. */
  private followUps: FollowUpState = NO_FOLLOW_UPS;
  /** Repaints the status-bar clearance when the window or the bar changes size. */
  private clearanceObserver: ResizeObserver | null = null;
  /* THE TEAM, as this vault has it. Null in a bare vault. Re-detected when
   * anything under `06 AI Team/` changes, so a one-click setup or a hire shows
   * up in the strip and the empty state without reopening the tab. */
  private roster: TeamRoster | null = null;
  private teamStripEl: HTMLElement | null = null;
  /** The main thread's own activity, counted from this tab's event stream. */
  private mainToolCalls = 0;
  private mainTextBlocks = 0;
  /** True once a turn has ended: the strip has nothing honest to say before. */
  private turnEnded = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: IcorChatPlugin) {
    super(leaf);
    this.permissionMode = plugin.settings.defaultPermissionMode;
  }

  override getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  override getDisplayText(): string {
    return 'AI team';
  }

  override getIcon(): string {
    return 'messages-square';
  }

  override async onOpen(): Promise<void> {
    /* The pane skeleton comes from `buildPane`, which the computed-style
       fixture calls too. This method used to build the tree while the fixture
       built a replica, so the census assertion that guards rung order and the
       statusline's nesting could not fail against THIS file: undoing that
       nesting here left the suite 144/144 green. One function, one tree. */
    const pane = buildPane(this.contentEl, {
      composer: {
        streaming: false,
        mode: this.permissionMode,
        model: this.plugin.settings.model,
        effort: this.plugin.settings.effort,
      },
      callbacks: {
        onSubmit: (text, attachments) => void this.submit(text, attachments),
        onStop: () => void this.stop(),
        onModeChange: (mode) => void this.changeMode(mode),
        onModelChange: (model) => void this.changeModel(model),
        onEffortChange: (effort) => this.changeEffort(effort),
        onNotice: (message) => new Notice(message),
        readPreview: (path) => this.readPreview(path),
        onAddContext: (pick) => this.addPick(pick),
      },
      badge: {
        navigate: (code, mention) => this.navigateToMention(code, mention),
      },
      /* Read on every render rather than captured once: a toggle flipped in
         settings must reach the strip without reopening the tab. */
      facts: () => factVisibility(this.plugin.settings),
    });
    this.scroller = pane.scroller;
    this.column = pane.column;
    this.pinsEl = pane.pins;
    this.chipTray = pane.chipTray;
    this.teamStripEl = pane.teamStrip;
    this.composer = pane.composer;
    this.badge = pane.badge;
    this.statusline = pane.statusline;

    this.stream = new StreamRenderer(this.app, this, this.column, '', {
      onApproval: (toolUseId, choice) => {
        this.session?.answerApproval(toolUseId, choice);
      },
      structured: () => this.plugin.settings.structuredReplies,
      onOpenContextGroup: (label) => {
        const ref = this.sentGroups.get(label);
        if (ref) new ContextModal(this.app, ref).open();
      },
      onTogglePin: (key, text) => this.togglePinFor(key, text),
      renderHost: {
        home: this.plugin.homeDir,
        insertCode: (code) => this.composer?.insert(`${code} `),
        openFile: (path) => void this.openPath(path),
        revealFile: (path) => this.revealPath(path),
        openUrl: (url) => window.open(url, '_blank'),
        copy: (text) => void navigator.clipboard.writeText(text),
        decisionState: (code) => this.decisionState(code),
      },
      onDecisions: (decisions, blockId) => this.recordDecisions(decisions, blockId),
    });
    this.roster = detectTeam(this.app);
    this.stream.renderEmptyState(this.emptyTeamBlock());
    this.renderPins();
    void this.fillResumeRows();
    this.addAction('bar-chart-3', 'Open AI team insights', () => void this.plugin.openInsights());
    /* The trigger shows the ACTUAL model from pane open. With no plugin
       override, the name comes from the CLI's own settings cascade - the same
       files the session will read - so the face and the behaviour cannot
       disagree. The composer applies it only while nothing truer is known. */
    if (!this.plugin.settings.model) {
      void resolvedDefaultModel(this.plugin.vaultPath).then((model) => {
        if (model) this.composer?.presetModel(model);
      });
    }

    this.store.subscribe((event) => this.onEvent(event));
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView) this.lastMarkdownView = view;
        this.refreshContext();
      }),
    );
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshContext()));
    this.registerDomEvent(document, 'selectionchange', () => this.refreshContext());
    const current = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (current) this.lastMarkdownView = current;
    this.refreshContext();
    this.trackStatusBar();
    this.loadMentionFiles();
    this.composer?.setContextSources({
      notes: () => this.mentionFiles(),
      folders: () => listFolders(this.app),
      tags: () => listTags(this.app),
      properties: () => listProperties(this.app),
    });
    /* The vault changes under an open chat: a note created while the pane is
       up must be mentionable without reopening it. Rename and delete matter for
       the same reason, and a stale path in the list is a mention that resolves
       to nothing. */
    this.registerEvent(this.app.vault.on('create', () => this.loadMentionFiles()));
    this.registerEvent(this.app.vault.on('delete', () => this.loadMentionFiles()));
    this.registerEvent(this.app.vault.on('rename', () => this.loadMentionFiles()));
    this.registerEvent(this.app.vault.on('create', (f) => this.onTeamChange(f.path)));
    this.registerEvent(this.app.vault.on('delete', (f) => this.onTeamChange(f.path)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { this.onTeamChange(f.path); this.onTeamChange(old); }));
    this.focusComposer();
  }

  /* ------------------------------------------------------------- the team */

  private onTeamChange(path: string): void {
    if (!isTeamPath(path)) return;
    this.roster = detectTeam(this.app);
    this.stream?.renderEmptyTeam(this.emptyTeamBlock());
    this.paintTeamStrip();
  }

  private emptyTeamBlock(): EmptyTeamBlock {
    return {
      detected: this.roster
        ? { count: this.roster.agents.length, onInsights: () => void this.plugin.openInsights() }
        : null,
      onSetup: () => this.runSetup(),
    };
  }

  private async runSetup(): Promise<void> {
    try {
      const report = await setupTeam(this.app);
      new Notice(setupSummary(report));
    } catch (error) {
      new Notice(`Could not set up the team: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Whatever happened, the block is redrawn from the vault as it is now.
    this.roster = detectTeam(this.app);
    this.stream?.renderEmptyTeam(this.emptyTeamBlock());
  }

  /** The strip, from what this tab has measured. Absent until a turn has ended. */
  private paintTeamStrip(): void {
    const el = this.teamStripEl;
    if (!el) return;
    const roster = this.roster;
    if (!roster || !this.turnEnded || !this.plugin.settings.factTeamStrip) {
      renderTeamStrip(el, [], null, () => '', () => undefined);
      return;
    }
    const now = Date.now();
    const shares = agentShares({
      main: { toolCalls: this.mainToolCalls, textBlocks: this.mainTextBlocks },
      subagents: this.plugin.subagents.all()
        .filter((t) => t.sessionId === null || t.sessionId === this.store.state.sessionId)
        .map((t) => ({
          agentType: t.agentType,
          toolCalls: t.toolCalls,
          textBlocks: t.textBlocks,
          durationMs: (t.endedAt ?? now) - t.startedAt,
          status: t.status,
        })),
      roster: roster.agents.map((a) => ({ name: a.name, slug: a.slug })),
    });
    renderTeamStrip(el, shares, roster.agents, (path) => avatarUrl(this.app, path), (share) => this.openParticipant(share));
  }

  /** A roster agent opens its bio; anyone else opens their newest transcript. */
  private openParticipant(share: AgentShare): void {
    const agent = this.roster?.agents.find((a) => a.slug === share.slug);
    if (agent?.bioPath) {
      void this.openPath(agent.bioPath);
      return;
    }
    const newest = this.plugin.subagents.all()
      .filter((t) => t.agentType.toLowerCase() === share.slug)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (newest) void this.plugin.openSubagent(newest.agentId);
    else if (agent) void this.openPath(agent.folder);
  }

  /* OBSIDIAN'S STATUS BAR IS MEASURED, never assumed away.
   *
   * It is painted over the bottom-right of the window, so in a right sidebar it
   * covers the bottom of this pane. The clearance is the real overlap between
   * the two rectangles and it is re-taken whenever either can have changed: the
   * pane resizing, and the workspace relaying out. Zero is a real answer - a
   * main-area tab that the bar does not reach pays nothing. */
  private trackStatusBar(): void {
    const measure = (): void => { applyStatusBarClearance(this.contentEl, this.app.workspace.containerEl.doc); };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.clearanceObserver = new ResizeObserver(() => measure());
      this.clearanceObserver.observe(this.contentEl);
    }
    this.registerEvent(this.app.workspace.on('resize', measure));
    this.registerEvent(this.app.workspace.on('layout-change', measure));
  }

  /**
   * Put the caret where the user is about to type. onOpen runs during
   * setViewState, and revealing the leaf afterwards takes focus back, so the
   * focus has to land after the reveal - opening a chat and finding the caret
   * nowhere is the difference between a usable surface and a broken one.
   */
  focusComposer(): void {
    this.composer?.focus();
    window.setTimeout(() => this.composer?.focus(), 0);
  }

  /**
   * The view's own claim that a conversation lives here. The leaf router reads
   * it to decide reveal-vs-reuse-vs-create: a pane the user has merely typed
   * into is unoccupied (reuse only reveals or resumes, never clears), but a
   * pane whose session object exists is busy becoming a conversation even
   * before the session event names it.
   */
  /** The session this pane holds or is resuming, for the leaf router. */
  get heldSessionId(): string | null {
    return this.store.state.sessionId ?? this.resumeSessionId;
  }

  get occupied(): boolean {
    return this.session !== null || this.store.state.sessionId !== null || this.resumeSessionId !== null;
  }

  /** The leaf carries the session id, so a reopened tab resumes its own thread. */
  override getState(): Record<string, unknown> {
    return {
      resumeSessionId: this.store.state.sessionId ?? this.resumeSessionId,
      pins: pinsToState(this.pins),
    };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    if (state && typeof state === 'object' && 'resumeSessionId' in state) {
      const id = (state as { resumeSessionId?: unknown }).resumeSessionId;
      if (typeof id === 'string' && id) this.resumeSessionId = id;
    }
    if (state && typeof state === 'object' && 'pins' in state) {
      /* Read back before the replay runs, so the replay finds pins already
         there and leaves the first-prompt rule alone: the stored tray is the
         user's, including a first prompt they chose to unpin. */
      this.pins = pinsFromState((state as { pins?: unknown }).pins);
      this.renderPins();
    }
    await super.setState(state, result as Parameters<ItemView['setState']>[1]);
  }

  override async onClose(): Promise<void> {
    this.stopTicking();
    this.clearanceObserver?.disconnect();
    this.clearanceObserver = null;
    this.statusline?.dispose();
    this.composer?.dispose();
    this.pinsEl?.empty();
    this.pinsEl = null;
    this.badge?.destroy();
    this.session?.dispose();
    this.session = null;
    this.stream?.destroy();
    this.store.dispose();
  }

  /* THE VAULT'S OWN NOTES, for the @ picker. Markdown only: the reference is
   * handed to the CLI to read, and offering a PNG would be offering a mention
   * that cannot be read back as text. */
  private loadMentionFiles(): void {
    this.composer?.setMentionFiles(this.mentionFiles());
  }

  /* Each note with the link text Obsidian itself would write for it, so a
     `[[` pick types the shortest unambiguous form and not a full path where a
     name would do. Read from the cache; this runs on every vault change. */
  private mentionFiles(): Array<{ path: string; basename: string; linktext: string; folder: string }> {
    return this.app.vault.getMarkdownFiles().map((f) => ({
      path: f.path,
      basename: f.basename,
      linktext: this.app.metadataCache.fileToLinktext(f, ''),
      folder: folderOf(f.path),
    }));
  }

  /** The opening of a note for the picker's glance. Cached read, frontmatter off. */
  private async readPreview(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return '';
    return previewText(await this.app.vault.cachedRead(file));
  }

  /* ------------------------------------------------------ context refs */

  /** A `+` menu pick, resolved into the notes it stands for. */
  private addPick(pick: ContextPick): void {
    if (pick.kind === 'active') {
      const ctx = readContext(this.app, this.lastMarkdownView);
      if (!ctx) {
        new Notice('No note is open.');
        return;
      }
      /* The open note is already the tray's first chip while it is pinned;
         re-pinning it is the whole answer when it was dismissed. When it is
         pinned, the pick is a no-op that says so rather than a second chip. */
      if (this.contextPinned && this.plugin.settings.contextAwareness) {
        new Notice(`${ctx.basename} is already in context.`);
        return;
      }
      this.contextPinned = true;
      this.refreshContext();
      return;
    }
    const ref = this.resolvePick(pick);
    if (!ref) return;
    if (this.refs.some((r) => r.id === ref.id)) {
      new Notice(`${ref.label} is already in context.`);
      return;
    }
    if (ref.paths.length === 0) {
      new Notice(`${ref.label} holds no notes.`);
      return;
    }
    this.refs.push(ref);
    this.refreshContext();
  }

  /** The ref for a pick, paths resolved NOW. Null only for a pick that resolves to nothing. */
  private resolvePick(pick: ContextPick): ContextRef | null {
    const id = contextPickId(pick);
    switch (pick.kind) {
      case 'active':
        return null;
      case 'note':
        return { kind: 'note', id, label: baseOf(pick.path), detail: folderOf(pick.path), paths: [pick.path] };
      case 'folder':
        return { kind: 'folder', id, label: baseOf(pick.path), detail: pick.path, paths: resolveFolder(this.app, pick.path) };
      case 'tag':
        return { kind: 'tag', id, label: id, detail: '', paths: resolveTag(this.app, pick.tag) };
      case 'property':
        return { kind: 'property', id, label: id, detail: pick.key, paths: resolveProperty(this.app, pick.key, pick.value) };
    }
  }

  /** A group re-resolved at send time: a note created since the pick is in. */
  private refreshRef(ref: ContextRef): ContextRef {
    switch (ref.kind) {
      case 'folder':
        return { ...ref, paths: resolveFolder(this.app, ref.id) };
      case 'tag':
        return { ...ref, paths: resolveTag(this.app, ref.id) };
      case 'property': {
        const colon = ref.id.indexOf(': ');
        if (colon === -1) return ref;
        return { ...ref, paths: resolveProperty(this.app, ref.id.slice(0, colon), ref.id.slice(colon + 2)) };
      }
      default:
        return ref;
    }
  }

  /** The notes a message names with `[[...]]`, as refs, deduped against the list. */
  private linkedRefs(text: string): ContextRef[] {
    const out: ContextRef[] = [];
    const seen = new Set(this.refs.map((r) => r.id));
    for (const target of wikilinksIn(text)) {
      const file = resolveWikilink(this.app, target, '');
      if (!file || seen.has(file.path)) continue;
      seen.add(file.path);
      out.push({ kind: 'note', id: file.path, label: file.basename, detail: folderOf(file.path), paths: [file.path] });
    }
    return out;
  }

  private removeRef(id: string): void {
    this.refs = this.refs.filter((r) => r.id !== id);
    this.refreshContext();
  }

  private chipFor(ref: ContextRef): TrayChip {
    const group = ref.kind !== 'note';
    return {
      icon: contextIcon(ref.kind),
      label: ref.label,
      ...(group ? { count: ref.paths.length } : {}),
      onOpen: () => {
        if (group) new ContextModal(this.app, ref).open();
        else void this.openPath(ref.id);
      },
      onDismiss: () => this.removeRef(ref.id),
    };
  }

  /** Recent conversations for THIS vault only. Never machine-wide. */
  private async fillResumeRows(): Promise<void> {
    const sessions = await listVaultSessions(this.plugin.vaultPath, 6);
    if (!this.stream || !this.stream.isEmpty) return;
    this.stream.renderResumeRows(sessions, (sessionId) => void this.resume(sessionId));
  }

  /** Resume a prior session. A session id that no longer exists says so. */
  async resume(sessionId: string): Promise<void> {
    if (this.session) {
      new Notice('This tab already has a conversation. Open a new tab to resume another.');
      return;
    }
    if (!(await sessionExists(sessionId, this.plugin.vaultPath))) {
      this.store.apply({
        kind: 'error',
        message: 'That conversation is no longer on disk. It may have been deleted or archived.',
        stream: null,
      });
      return;
    }
    this.resumeSessionId = sessionId;
    /* The ORIGINAL start, read back from the stored record, BEFORE the live
       session event arrives. A resumed thread that stamped its start at the
       moment it was reopened would print a plausible number with no event
       behind it, which is the 2026-08-29 defect in a different costume. A
       record that carries no creation time leaves the readout absent. */
    this.store.apply({
      kind: 'session-restored',
      startedAt: await sessionCreatedAt(sessionId, this.plugin.vaultPath),
      stream: null,
    });
    await this.replay(sessionId);
    const session = this.ensureSession();
    if (session) {
      session.start();
    }
  }

  /**
   * Paint a resumed conversation's own history before the live session opens.
   *
   * The stored messages arrive in the same shape the live stream uses, so they
   * run through the same Normalizer and the same renderer: one grammar, one
   * code path, no second implementation to drift. A separate Normalizer is used
   * so the replay's tool pairing and subagent bookkeeping cannot collide with
   * the live one that takes over afterwards.
   */
  private async replay(sessionId: string): Promise<void> {
    const { messages, omitted } = await readSessionMessages(sessionId, this.plugin.vaultPath);
    if (messages.length === 0) {
      this.stream?.note('This conversation has no stored history. Send a message to continue it.');
      return;
    }
    if (omitted > 0) {
      this.stream?.note(`Showing the last ${messages.length} messages. ${omitted} earlier ones are in the session file.`);
    }
    const normalizer = new Normalizer();
    for (const raw of messages) {
      const spoken = userTextOf(raw);
      if (spoken !== null) {
        const key = String(this.turnCounter);
        this.stream?.appendUserWell(spoken, null, [], null, [], key);
        this.transcript.push({ role: 'user', text: spoken, index: this.turnCounter, at: Date.now() });
        // The first replayed prompt is the conversation's first prompt, and
        // it is pinned by the same rule a live one is: only into an empty tray.
        this.pins = pinFirstPrompt(this.pins, { key, text: spoken, index: this.turnCounter });
        this.turnCounter += 1;
      }
      for (const event of normalizer.normalize(raw)) {
        this.events.push(event);
        this.routeSubagent(event);
        if (event.kind === 'text-final' && event.stream === null && event.text.trim()) {
          this.transcript.push({
            role: 'assistant',
            text: event.text,
            index: this.indexForBlock(event.blockId),
            at: Date.now(),
          });
        }
        if (event.stream === null) this.stream?.apply(event);
      }
    }
    // Nothing in a replay is live: a subagent that was running when the
    // transcript was written is not running now.
    this.plugin.subagents.orphanRunning();
    this.renderChips();
    this.refreshDecisions();
    // The wells exist now, so the stored pins can light their controls.
    this.renderPins();
    this.stream?.sealReplay();
    this.scrollToEnd();
  }

  /* ----------------------------------------------------------------- pins */

  /** The user clicked a well's pin control: pin it, or unpin it. */
  private togglePinFor(key: string, text: string): void {
    const index = Number(key);
    if (!Number.isFinite(index)) return;
    this.pins = togglePin(this.pins, { key, text, index });
    this.renderPins();
  }

  /**
   * Repaint rung 0 and every well's pinned state from the one list. Also
   * asks the workspace to persist the leaf, because the pins ride the leaf
   * state and Obsidian only writes that when told a view's state changed.
   */
  private renderPins(): void {
    if (this.pinsEl) {
      renderPinTray(this.pinsEl, this.pins, {
        open: this.openPins,
        onToggleOpen: (key) => {
          if (this.openPins.has(key)) this.openPins.delete(key);
          else this.openPins.add(key);
          this.renderPins();
        },
        onUnpin: (key) => {
          this.pins = unpin(this.pins, key);
          this.openPins.delete(key);
          this.renderPins();
        },
        onJump: (key) => this.stream?.scrollToWell(key),
      });
    }
    for (const entry of this.transcript) {
      if (entry.role !== 'user') continue;
      const key = String(entry.index);
      this.stream?.setPinned(key, isPinned(this.pins, key));
    }
    this.app.workspace.requestSaveLayout();
  }

  /* -------------------------------------------------------------- context */

  private refreshContext(): void {
    const refChips = this.refs.map((ref) => this.chipFor(ref));
    if (!this.plugin.settings.contextAwareness || !this.contextPinned) {
      this.composer?.renderTray(refChips);
      this.context = null;
      return;
    }
    const next = readContext(this.app, this.lastMarkdownView);
    this.context = next;
    if (!next) {
      this.composer?.renderTray(refChips);
      return;
    }
    const range = selectionRangeLabel(next);
    this.composer?.renderTray([
      {
        icon: 'eye',
        label: next.basename,
        ...(next.selection && range ? { detail: range } : {}),
        onDismiss: () => {
          this.contextPinned = false;
          this.refreshContext();
        },
      },
      ...refChips,
    ]);
  }

  /* ---------------------------------------------------- decision lifecycle */

  /** One monotonic position per rendered block, assigned once. */
  private indexForBlock(blockId: string): number {
    const existing = this.blockIndex.get(blockId);
    if (existing !== undefined) return existing;
    const index = this.turnCounter;
    this.turnCounter += 1;
    this.blockIndex.set(blockId, index);
    return index;
  }

  private recordDecisions(decisions: Array<{ code: string; title: string; body: string; variant: 'decision' | 'blocked' | 'cleared' }>, blockId: string): void {
    if (decisions.length === 0) return;
    const index = this.indexForBlock(blockId);
    const at = Date.now();
    for (const decision of decisions) {
      if (this.surfaced.some((s) => s.decision.code === decision.code)) continue;
      this.surfaced.push({ decision, index, at });
    }
    this.refreshDecisions();
  }

  private tracked(): TrackedDecision[] {
    return trackDecisions(this.surfaced, this.transcript);
  }

  private decisionState(code: string): TrackedDecision | null {
    return this.tracked().find((d) => d.code === code) ?? null;
  }

  private refreshDecisions(): void {
    const tracked = this.tracked();
    this.badge?.render(openDecisions(tracked));
    if (this.column) repaintDecisions(this.column);
  }

  /** Every element in the stream that names this code, in document order. */
  private mentionElements(code: string): HTMLElement[] {
    if (!this.column) return [];
    const out: HTMLElement[] = [];
    for (const el of Array.from(this.column.children)) {
      // Obsidian's cross-window check: a plain instanceof fails against an
      // element born in a popout window's realm.
      if (!el.instanceOf(HTMLElement)) continue;
      const userText = el.dataset.userText;
      if (userText && mentionsCode(userText, code)) {
        out.push(el);
        continue;
      }
      for (const block of Array.from(el.querySelectorAll('.aic-decision'))) {
        if (block.instanceOf(HTMLElement) && block.dataset.code === code) out.push(block);
      }
    }
    return out;
  }

  private navigateToMention(code: string, mention: number): void {
    const elements = this.mentionElements(code);
    if (elements.length === 0) return;
    const target = elements[Math.min(mention, elements.length - 1)];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.addClass('is-flash');
    window.setTimeout(() => target.removeClass('is-flash'), 600);
  }

  private async openPath(path: string): Promise<void> {
    const vault = this.plugin.vaultPath;
    const relative = path.startsWith(vault) ? path.slice(vault.length + 1) : path;
    const file = this.app.vault.getAbstractFileByPath(relative);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    this.revealPath(path);
  }

  private revealPath(path: string): void {
    // Electron only; the plugin is desktop-only for exactly this class of reason.
    const shell = (window as unknown as { require?: (m: string) => { shell?: { showItemInFolder?: (p: string) => void } } })
      .require?.('electron')?.shell;
    if (shell?.showItemInFolder) shell.showItemInFolder(path);
    else new Notice(`Could not reveal ${path}`);
  }

  /* -------------------------------------------------------------- turning */

  private ensureSession(): ChatSession | null {
    if (this.session) return this.session;
    const settings = this.plugin.settings;
    // Typed at the declaration, so the platform ternary is checked against
    // the union instead of being widened to string and cast back.
    const env: PathEnvironment = {
      platform: Platform.isWin ? 'win32' : Platform.isMacOS ? 'darwin' : 'linux',
      home: this.plugin.homeDir,
      path: process.env.PATH ?? '',
      extra: splitExtraPath(settings.extraPath),
    };
    let cliPath: string;
    try {
      cliPath = resolveCliPath(settings.cliPath, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.apply({ kind: 'error', message, stream: null });
      return null;
    }
    this.session = new ChatSession(
      {
        cliPath,
        cwd: this.plugin.vaultPath,
        env: buildChildEnv(process.env, env),
        model: settings.model,
        effort: settings.effort,
        // This tab's mode, which the composer may already have changed.
        permissionMode: this.permissionMode,
        structuredReplies: settings.structuredReplies,
        resumeSessionId: this.resumeSessionId,
      },
      {
        onEvent: (event) => this.store.apply(event),
        onApprovalRequest: (request) =>
          this.store.apply({
            kind: 'tool-approval',
            toolUseId: request.toolUseId,
            name: request.toolName,
            target: request.target,
            purpose: request.purpose,
            stream: null,
          }),
        onApprovalSettled: (toolUseId, choice) =>
          this.store.apply({
            kind: 'tool-approval-resolved',
            toolUseId,
            allowed: choice !== 'deny',
            stream: null,
          }),
        onModeRefused: (mode, message) => {
          // The provider's own words. A refusal the user cannot see is a
          // control that lies, which is what this replaced.
          new Notice(`Could not switch to ${mode}: ${message}`);
        },
      },
    );
    return this.session;
  }

  private async submit(text: string, attachments: Attachment[] = []): Promise<void> {
    const session = this.ensureSession();
    if (!session) {
      this.composer?.setStreaming(false);
      return;
    }
    const ctx = this.plugin.settings.contextAwareness && this.contextPinned ? this.context : null;
    const index = this.turnCounter;
    this.turnCounter += 1;
    this.transcript.push({ role: 'user', text, index, at: Date.now() });
    // The toolbar dismisses on the next send, and so do finished chips.
    this.badge?.dismissToolbar();
    this.plugin.subagents.retireFinished();
    this.renderChips();
    const images: TurnImage[] = attachments.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      data: a.data,
    }));
    /* THE MESSAGE'S CONTEXT, assembled once. Groups are re-resolved so the
       count the chip shows is the count the model gets; links in the text
       become note refs; the open note stays first because it always was. */
    const refs = [...this.refs.map((r) => this.refreshRef(r)), ...this.linkedRefs(text)];
    this.refs = [];
    const contexts: TurnContext[] = [];
    if (ctx) contexts.push({ kind: 'active', label: ctx.basename, count: 1, path: ctx.path });
    for (const ref of refs) {
      if (ref.kind !== 'note') this.sentGroups.set(ref.label, ref);
      contexts.push({
        kind: ref.kind,
        label: ref.label,
        count: ref.paths.length,
        path: ref.kind === 'note' ? ref.id : null,
      });
    }
    /* A SEND WHILE A TURN RUNS IS A FOLLOW-UP, never a stop (Tom, 2026-09-04).
       The CLI queues it and answers it as the next turn, so it enters the
       stream now, marked QUEUED, and the mark leaves when its turn begins. */
    const queued = this.store.state.status === 'streaming';
    if (queued) this.followUps = followUpSent(this.followUps);
    this.store.apply({
      kind: 'user-turn',
      text,
      contextNote: ctx ? ctx.basename : null,
      contextPath: ctx ? ctx.path : null,
      images,
      contexts,
      queued,
      key: String(index),
      stream: null,
    });
    /* The first prompt of a fresh conversation is pinned on send. The pin
       carries the words as typed, never the preamble the model receives: the
       tray answers "what did I ask", and the open note was not asked. */
    this.pins = pinFirstPrompt(this.pins, { key: String(index), text, index });
    this.renderPins();
    this.refreshDecisions();
    this.refreshContext();
    session.send(withContext(text, ctx, refs), images);
    this.scrollToBottom();
  }

  private async stop(): Promise<void> {
    await this.session?.interrupt();
  }

  /** Ask the SDK what it can run, once per session. Empty stays empty. */
  private async loadModelCatalog(): Promise<void> {
    if (this.modelCatalogLoaded) return;
    this.modelCatalogLoaded = true;
    const models = await this.session?.supportedModels();
    if (models && models.length) {
      this.composer?.setModelCatalog(models);
      // The settings tab has no session to ask, so the plugin holds the answer.
      this.plugin.modelCatalog = models;
    }
  }

  /**
   * The tab's mode. Remembered whether or not a session exists yet.
   *
   * With no session this is the whole job: the choice is stored and the session
   * launches in it. With one running the provider is asked, and a refusal is
   * put back on screen - the composer chip returns to the mode that is actually
   * live, because a chip reading BYPASS over an ask-mode session is the defect
   * this method used to have.
   */
  private async changeMode(mode: PermissionModeName): Promise<void> {
    const previous = this.permissionMode;
    this.permissionMode = mode;
    if (!this.session) return;
    const ok = await this.session.setPermissionMode(mode);
    if (ok) return;
    this.permissionMode = previous;
    this.composer?.setMode(previous);
  }

  private async changeModel(model: string): Promise<void> {
    await this.session?.setModel(model);
  }

  private changeEffort(effort: EffortName): void {
    // Effort is a launch option; it applies to the next session in this tab.
    this.plugin.settings.effort = effort;
    void this.plugin.saveSettings();
  }

  /* ------------------------------------------------------------ rendering */

  private onEvent(event: ChatEvent): void {
    this.events.push(event);
    this.routeSubagent(event);
    if (event.stream === null && event.kind === 'tool-call') this.mainToolCalls += 1;
    if (event.stream === null && event.kind === 'text-final' && event.text.trim()) this.mainTextBlocks += 1;
    if (event.kind === 'turn-end') this.turnEnded = true;
    if (event.kind === 'turn-end' || event.kind === 'subagent-end' || event.kind === 'aborted') this.paintTeamStrip();
    // The assistant's own words enter the transcript BEFORE the block renders,
    // so the decision recorded from that block lands on the same index.
    if (event.kind === 'text-final' && event.stream === null && event.text.trim()) {
      this.transcript.push({
        role: 'assistant',
        text: event.text,
        index: this.indexForBlock(event.blockId),
        at: Date.now(),
      });
    }
    if (event.stream === null) this.stream?.apply(event);
    if (event.kind === 'user-turn') this.composer?.setStreaming(true);
    /* THE TURN BOUNDARY IS NOT ALWAYS IDLE. With a follow-up pending the CLI
       is about to start the next turn, and a composer that read Send for that
       gap would let Enter mint a third message the user believed was a second. */
    if (event.kind === 'turn-end') this.composer?.setStreaming(this.settleTurn());
    if (event.kind === 'aborted' || event.kind === 'error') {
      this.followUps = turnAborted();
      this.composer?.setStreaming(false);
    }
    if (event.kind === 'session' || event.kind === 'thinking-open' || event.kind === 'text-open' || event.kind === 'tool-call') {
      this.queuedTurnBegins();
    }
    if (event.kind === 'session') {
      // The provider's own command list. The composer's placeholder has always
      // promised "/ runs commands"; this is what finally keeps the promise.
      this.composer?.setSlashCommands(event.slashCommands);
    }
    if (event.kind === 'session' && event.model) {
      this.composer?.setModel(event.model);
      /* The catalogue is asked for ONCE the session has answered, because the
         control channel does not exist before that. It is fetched here rather
         than at construction for the same reason the model label is: no
         session, no catalogue, and no invented list in the meantime. */
      void this.loadModelCatalog();
    }
    if (event.kind === 'user-turn') this.startTicking();
    if (event.kind === 'aborted' || event.kind === 'error') this.stopTicking();
    // A turn end with a follow-up pending keeps the clock: the session is still at work.
    if (event.kind === 'turn-end' && this.followUps.pending === 0 && !this.followUps.awaitingNext) {
      this.stopTicking();
    }
    if (event.kind === 'session' && event.sessionId && !this.sessionIds.includes(event.sessionId)) {
      this.sessionIds.push(event.sessionId);
    }
    if (event.kind === 'turn-end' || event.kind === 'aborted' || event.kind === 'error') {
      this.plugin.subagents.orphanRunning();
      this.renderChips();
      void this.archive();
    }
    this.statusline?.render(this.store.state);
    this.scrollToBottom();
  }

  /* ----------------------------------------------------------- follow-ups */

  /** A turn ended. True when a queued follow-up keeps the session busy. */
  private settleTurn(): boolean {
    const next = turnEnded(this.followUps);
    this.followUps = next.state;
    return next.stillBusy;
  }

  /** The first signal of a turn: if it answers a queued message, the mark comes off. */
  private queuedTurnBegins(): void {
    const next = queuedTurnBegan(this.followUps);
    this.followUps = next.state;
    if (next.clearOne) this.stream?.clearQueued();
  }

  /* --------------------------------------------------------- subagents */

  /** Subagent traffic is tagged with the tool-use id that spawned it. */
  private routeSubagent(event: ChatEvent): void {
    if (event.kind === 'subagent-start') {
      this.plugin.subagents.open({
        agentId: event.agentId,
        agentType: event.agentType,
        description: event.description,
        task: event.task || this.taskPrompts.get(event.agentId) || '',
        sessionId: this.store.state.sessionId,
      });
      this.renderChips();
      return;
    }
    if (event.kind === 'subagent-end') {
      this.plugin.subagents.close(event.agentId, event.ok);
      this.renderChips();
      return;
    }
    if (event.kind === 'tool-call' && (event.name === 'Task' || event.name === 'Agent')) {
      const prompt = event.input.prompt;
      if (typeof prompt === 'string') this.taskPrompts.set(event.toolUseId, prompt);
    }
    if (event.stream !== null) {
      this.plugin.subagents.append(event.stream, event);
      this.renderChips();
    }
  }

  private renderChips(): void {
    if (!this.chipTray) return;
    renderChipTray(this.chipTray, this.plugin.subagents.active(), (agentId) => {
      this.plugin.subagents.markOpened(agentId);
      this.renderChips();
      void this.plugin.openSubagent(agentId);
    });
  }

  /* ----------------------------------------------------------- archive */

  /**
   * The whole conversation as the session file has it, falling back to what
   * this tab saw if the file cannot be read. Built with its own Normalizer so
   * it never disturbs the live one.
   */
  private async sessionRecord(): Promise<{
    turns: Array<{ role: 'user' | 'assistant'; text: string; at: number }>;
    events: ChatEvent[];
  }> {
    const sessionId = this.sessionIds[this.sessionIds.length - 1];
    if (!sessionId) return { turns: [], events: [] };
    const { messages } = await readSessionMessages(sessionId, this.plugin.vaultPath, 5000);
    if (messages.length === 0) {
      return {
        turns: this.transcript.map((t) => ({ role: t.role, text: t.text, at: t.at })),
        events: this.events,
      };
    }
    const normalizer = new Normalizer();
    const turns: Array<{ role: 'user' | 'assistant'; text: string; at: number }> = [];
    const events: ChatEvent[] = [];
    const at = Date.now();
    for (const raw of messages) {
      const spoken = userTextOf(raw);
      if (spoken !== null) turns.push({ role: 'user', text: spoken, at });
      for (const event of normalizer.normalize(raw)) {
        events.push(event);
        if (event.kind === 'text-final' && event.stream === null && event.text.trim()) {
          turns.push({ role: 'assistant', text: event.text, at });
        }
      }
    }
    return { turns, events };
  }

  /** Rewritten in full after every completed turn: idempotent and cheap. */
  private async archive(): Promise<void> {
    if (!this.plugin.settings.archiveEnabled || this.archiving) return;
    if (this.transcript.length === 0 || this.sessionIds.length === 0) return;
    this.archiving = true;
    try {
      const root = archiveRoot(this.plugin.settings, this.plugin.scaffoldDetected);
      const writer = new ArchiveWriter(this.app, root);
      // Read the session back rather than archiving this tab's own slice: a
      // second tab on the same conversation sees only its own half, and an
      // archive that records half a conversation is worse than none.
      const record = await this.sessionRecord();
      const first = record.turns.find((t) => t.role === 'user');
      await writer.write({
        title: (first?.text ?? 'Conversation').split('\n')[0]?.slice(0, 72) ?? 'Conversation',
        startedAt: this.startedAt,
        sessionIds: this.sessionIds,
        cwd: this.plugin.vaultPath,
        model: this.store.state.model,
        permissionMode: this.store.state.permissionMode,
        turns: record.turns,
        events: record.events,
        subagents: this.plugin.subagents.all(),
        tokens: this.store.state.usage?.totalTokens ?? 0,
        pluginVersion: this.plugin.manifest.version,
        sdkVersion: SDK_VERSION,
      });
      await writer.sweep(this.plugin.settings.archiveRetentionDays);
    } catch (error) {
      new Notice(`Could not archive this session: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.archiving = false;
    }
  }

  /** Repaint rung 4 alone. The settings tab calls this when a switch flips. */
  repaintFacts(): void {
    this.statusline?.render(this.store.state);
  }

  /* The elapsed fact is the only thing on screen that changes without an
   * event, so it gets the only interval in the plugin, and only while a turn
   * is actually running. */
  private startTicking(): void {
    if (this.tick !== null) return;
    this.tick = window.setInterval(() => this.statusline?.render(this.store.state), 1000);
    this.registerInterval(this.tick);
  }

  private stopTicking(): void {
    if (this.tick === null) return;
    window.clearInterval(this.tick);
    this.tick = null;
  }

  /**
   * Follow the stream, but never yank a user who has scrolled up to read.
   * The guard is what makes it polite, and it is also why replay cannot use
   * this: after painting a whole history the scroller sits at the top, nowhere
   * near the bottom, so the guard would suppress exactly the scroll that is
   * wanted.
   */
  private scrollToBottom(): void {
    const el = this.scroller;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) window.requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  /** Land at the end of a resumed conversation: the newest turn is the point. */
  private scrollToEnd(): void {
    const el = this.scroller;
    if (!el) return;
    // Two frames: the first lets the replayed blocks lay out, the second
    // measures a scrollHeight that is finally true.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    });
  }
}
