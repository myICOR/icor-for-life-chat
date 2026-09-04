/* ICOR for Life - AI Chat - the ICOR AI team inside the vault.
 *
 * The plugin is a window, not a second brain: it hosts an agent runtime's
 * session (Claude Code today, behind the Provider seam) whose working
 * directory is the vault, so the vault's own CLAUDE.md, AGENTS.md and .claude/
 * are what the team reads. The plugin contributes no system prompt
 * of its own beyond one opt-in, plugin-owned format instruction.
 *
 * Independent implementation from a behavioural specification; no code is
 * inherited from any other repository. */

import { FileSystemAdapter, Menu, Notice, Plugin, TFile, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { homedir } from 'node:os';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME, VIEW_TYPE_CHAT, VIEW_TYPE_INSIGHTS, VIEW_TYPE_SUBAGENT } from './constants';
import { SubagentView } from './view/SubagentView';
import { InsightsView } from './view/InsightsView';
import { detectTeam } from './team/detect';
import type { TeamRoster } from './team/detect';
import { SubagentBus } from './state/subagents';
import { ReplyActionRegistry } from './view/actions';
import type { RenderHost } from './structured/render';
import type { ItemView } from 'obsidian';
import { availableProviders, providerFor } from './provider/registry';
import { providerFromFrontmatter, resumableSessionId } from './archive/resume';
import { shortAge } from './view/dom';
import { ChatView } from './view/ChatView';
import { ReplyActionRegistry } from './view/actions';
import { captureTaskAction, startDeliverableAction } from './wip/actions';
import { openTaskCount } from './team/load';
import { routeChatLeaf } from './view/leafRoute';
import { ChatSettingsTab } from './settings/SettingsTab';
import { DEFAULT_SETTINGS, archiveRoot } from './model/settings';
import type { ChatSettings } from './model/settings';
import type { ModelChoice } from './model/types';
import type { ProviderId } from './provider/types';
import { ReplyActionRegistry } from './view/actions';
import { installMemory } from './team/memory';

/* The file-explorer BLOCK this plugin used to inject above the file tree - a
 * whole panel section, not an icon. It is gone for good; the name survives
 * only so an upgrade that happens while Obsidian is running can sweep the node
 * the previous build left behind, which would otherwise sit there unstyled -
 * its CSS went with it. The toolbar launcher below is a different element with
 * a different class ON PURPOSE, or this sweep would delete it at load. */
const RETIRED_LAUNCHER_CLASS = 'aic-launcher';

/** The icon-only entry in the file explorer's tool-button row. */
const TREE_LAUNCHER_CLASS = 'aic-tree-launcher';

/** Recent conversations offered in the launcher menu. */
const RIBBON_SESSION_LIMIT = 6;

/** The launcher's tooltip and its menu's token-carrier class. */
const INK_RIBBON_TOOLTIP = 'AI Team';
const RIBBON_MENU_CLASS = 'aic-menu';

export default class IcorChatPlugin extends Plugin {
  override settings: ChatSettings = { ...DEFAULT_SETTINGS };
  /** One bus per vault: a subagent transcript outlives the chip that opened it. */
  readonly subagents = new SubagentBus();
  /* EVERY ACTION A REPLY OFFERS, from one list. The view registers the
     built-ins (copy, insert, save, edit and resend, regenerate); the rooms
     (WiP, tasks, memory) register theirs here and the bar draws them all alike. */
  readonly replyActions = new ReplyActionRegistry();

  /* THE PROVIDER'S OWN MODEL CATALOGUE, cached the first time a session
   * reports it, and empty until then.
   *
   * It lives on the plugin rather than on the view because the SETTINGS TAB
   * needs it and has no session to ask. The settings tab used to carry a
   * hand-typed list - Haiku, Sonnet, Opus - which is exactly the invented
   * catalogue the composer's own header forbids, and it aged the way an
   * invented list always ages: the day Fable shipped, the picker could not
   * offer it and nothing in the build could notice. Empty stays EMPTY and the
   * tab says so; it is never backfilled with a guess. */
  modelCatalog: ModelChoice[] = [];
  /** Actions any reply offers; streams register theirs here at load. */
  readonly replyActions = new ReplyActionRegistry();

  override async onload(): Promise<void> {
    await this.loadSettings();
    installMemory(this);
    // Each runtime prepares the host once, before anything can launch a query
    // (the Claude provider installs the renderer AbortSignal shim here).
    for (const provider of availableProviders()) provider.install?.();

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.registerView(VIEW_TYPE_SUBAGENT, (leaf) => new SubagentView(leaf, this));
    this.registerView(VIEW_TYPE_INSIGHTS, (leaf) => new InsightsView(leaf, this));

    this.addCommand({
      id: 'open-chat',
      name: 'New conversation with the AI team',
      callback: () => void this.openChat(),
    });

    this.addCommand({
      id: 'open-insights',
      name: 'Open AI team insights',
      callback: () => void this.openInsights(),
    });

    /* THE WIP ROOM'S TWO REPLY ACTIONS (R1, R5), registered rather than
       built into the bar, so the next room is a registration too. */
    this.replyActions.register(startDeliverableAction());
    this.replyActions.register(captureTaskAction());

    /* Closing a session is a slash command the CLI already exposes; this
       puts it in the composer of the active chat and hands over the caret,
       so the ritual is one command away from the palette (R5). */
    this.addCommand({
      id: 'close-session',
      name: 'Close session with the AI team',
      checkCallback: (checking) => {
        const view = this.activeChatView();
        if (!view) return false;
        if (!checking) view.insertIntoComposer('/close-session ');
        return true;
      },
    });

    /* Resuming from the archive. The conversation note carries every session id
     * the thread ever had, so the vault itself is a way back into a
     * conversation - not just this session's memory of one. */
    this.addCommand({
      id: 'resume-conversation',
      name: 'Resume this conversation with the AI team',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const archived = file ? this.archivedSession(file) : null;
        if (!archived) return false;
        if (!checking) void this.openChat(archived.sessionId, archived.provider);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) return;
        const archived = this.archivedSession(file);
        if (!archived) return;
        menu.addItem((item) =>
          item
            .setTitle('Resume this conversation with the AI team')
            .setIcon('bot')
            .onClick(() => void this.openChat(archived.sessionId, archived.provider)),
        );
      }),
    );

    this.addSettingTab(new ChatSettingsTab(this.app, this));

    /* TWO VISIBLE ENTRY POINTS, AND THE DIFFERENCE BETWEEN THEM IS THE HOST.
     *
     * The ribbon is Obsidian's own place for a plugin entry, and for a plain
     * Obsidian vault it is the right one and the only one this plugin should
     * need. But the ICOR for Life scaffold HIDES the left ribbon, and an icon
     * on a hidden surface is not an entry point - measured the hard way: the
     * robot was invisible in that vault for as long as the ribbon was its only
     * home. So the file-tree toolbar carries a second one, which is the only
     * visible route wherever the ribbon is hidden and a duplicate wherever it
     * is not.
     *
     * Both open the same menu. Neither is the only route: `open-chat` is a
     * command, so the palette and a hotkey always reach the same function. */
    this.addRibbonIcon('bot', INK_RIBBON_TOOLTIP, (evt) =>
      void this.openLauncherMenu({ x: evt.clientX, y: evt.clientY }));

    this.app.workspace.onLayoutReady(() => {
      // An in-place upgrade from a build that injected into the file tree
      // leaves its node behind, and its stylesheet is gone.
      this.sweepRetiredLauncher();
      this.mountTreeLauncher();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountTreeLauncher()));
  }

  override onunload(): void {
    this.sweepRetiredLauncher();
    for (const el of Array.from(document.querySelectorAll(`.${TREE_LAUNCHER_CLASS}`))) el.remove();
    this.subagents.clear();
  }

  private sweepRetiredLauncher(): void {
    for (const el of Array.from(document.querySelectorAll(`.${RETIRED_LAUNCHER_CLASS}`))) el.remove();
  }

  /* The icon-only launcher in the file explorer's tool-button row, under the
   * ICOR for Life mark. The suite's own pattern: ICOR for Life - Focus mounts its map
   * launcher in the same row the same way, and the INKLINE theme styles the
   * whole slot rather than any one plugin's button.
   *
   * The menu is anchored to the BUTTON rather than to the cursor, so a click
   * and a keypress put it in the same place. The role, the tabindex and the
   * key handler are deliberately more than Obsidian's own `addNavButton`,
   * which makes a bare div with a click listener and no tab stop: the INKLINE
   * theme already ships a `:focus-visible` ring for this slot, and a ring
   * nothing can ever focus is a rule that reads as enforced and never fires. */
  private mountTreeLauncher(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const row = leaf.view?.containerEl?.querySelector('.nav-buttons-container');
      if (!row || row.querySelector(`.${TREE_LAUNCHER_CLASS}`)) continue;
      const btn = row.createDiv({ cls: `clickable-icon nav-action-button ${TREE_LAUNCHER_CLASS}` });
      setIcon(btn, 'bot');
      btn.setAttr('aria-label', INK_RIBBON_TOOLTIP);
      btn.setAttr('role', 'button');
      btn.setAttr('tabindex', '0');
      const open = (): void => {
        const rect = btn.getBoundingClientRect();
        void this.openLauncherMenu({ x: rect.left, y: rect.bottom });
      };
      this.registerDomEvent(btn, 'click', open);
      this.registerDomEvent(btn, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        open();
      });
    }
  }

  /** The session AND the runtime that had it: an id only resumes in its own provider. */
  private archivedSession(file: TFile): { sessionId: string; provider: ProviderId } | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || frontmatter.source !== 'icor-chat') return null;
    const sessionId = resumableSessionId(frontmatter.session_ids);
    if (!sessionId) return null;
    return { sessionId, provider: providerFromFrontmatter(frontmatter.provider) };
  }

  /* The launcher menu: start a conversation, or pick up one of the recent
   * ones. Shared by both entry points, which is why it takes a POINT rather
   * than an event - a keypress has no cursor, and a menu that lands at 0,0 for
   * keyboard users is a menu that only works for a mouse.
   *
   * Obsidian's own Menu chrome, deliberately. The dropdown carries the plugin's
   * token block and its INKLINE declaration so a theme can skin it, and no
   * treatment of its own - a bespoke popover here would be a design decision
   * this file has no standing to make. */
  private async openLauncherMenu(at: { x: number; y: number }): Promise<void> {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle('Start new session')
        .setIcon('message-square-plus')
        .onClick(() => void this.openChat()),
    );

    // The default provider's own record; a protocol without a store offers nothing here.
    const store = providerFor(this.settings.defaultProvider).store;
    const sessions = (await store?.list(this.vaultPath, RIBBON_SESSION_LIMIT)) ?? [];
    for (const session of sessions) {
      menu.addItem((item) =>
        item
          .setTitle(`${session.title}  ·  ${shortAge(Date.now() - session.lastModified)}`)
          .setIcon('messages-square')
          .setSection('recent')
          .onClick(() => void this.openChat(session.sessionId)),
      );
    }

    const dom = (menu as unknown as { dom?: HTMLElement }).dom;
    if (dom) {
      dom.addClass(RIBBON_MENU_CLASS);
      dom.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    }
    menu.showAtPosition(at);
  }

  /** The AI team as the vault has it right now, or null in a bare vault. */
  teamRoster(): TeamRoster | null {
    return detectTeam(this.app);
  }

  /* THE INSIGHTS TAB: one per vault, in the main area. It is a page to read,
   * so it does not ride the right sidebar the chat lives in, and a second
   * click reveals the one that is open rather than minting another. */
  async openInsights(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSIGHTS)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_INSIGHTS, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open a subagent's transcript in its own tab. */
  async openSubagent(agentId: string): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBAGENT)) {
      const state = leaf.view.getState() as { agentId?: string };
      if (state.agentId === agentId) {
        await this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_SUBAGENT, active: true, state: { agentId } });
    await this.app.workspace.revealLeaf(leaf);
  }


  /** The affordances a structured block needs, shared by both view types. */
  renderHostFor(view: ItemView): RenderHost {
    return {
      home: this.homeDir,
      insertCode: () => undefined,
      openFile: (path) => void this.openPath(path),
      revealFile: (path) => this.revealPath(path),
      openUrl: (url) => window.open(url, '_blank'),
      copy: (text) => void navigator.clipboard.writeText(text),
      decisionState: () => null,
      ...(view ? {} : {}),
    };
  }

  async openPath(path: string): Promise<void> {
    const vault = this.vaultPath;
    const relative = path.startsWith(vault) ? path.slice(vault.length + 1) : path;
    const file = this.app.vault.getAbstractFileByPath(relative);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    this.revealPath(path);
  }

  revealPath(path: string): void {
    // Electron only; the plugin is desktop-only for exactly this class of reason.
    const shell = (window as unknown as {
      require?: (m: string) => { shell?: { showItemInFolder?: (p: string) => void } };
    }).require?.('electron')?.shell;
    if (shell?.showItemInFolder) shell.showItemInFolder(path);
    else new Notice(`Could not reveal ${path}`);
  }

  /** The chat view that is active, or the first open one. Null with none open. */
  activeChatView(): ChatView | null {
    const active = this.app.workspace.getActiveViewOfType(ChatView);
    if (active) return active;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      if (leaf.view instanceof ChatView) return leaf.view;
    }
    return null;
  }

  /** Open and in-progress task counts from the Tasks room, or null per folder when absent. */
  openTaskCount(): { open: number | null; inProgress: number | null } {
    return openTaskCount(this.app);
  }

  /** The vault's absolute path: the working directory every session runs in. */
  get vaultPath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }

  get homeDir(): string {
    try {
      return homedir();
    } catch {
      return '';
    }
  }

  /** True when this looks like an ICOR for Life vault rather than a bare one. */
  get scaffoldDetected(): boolean {
    return this.app.vault.getAbstractFileByPath('06 AI Team') !== null;
  }

  defaultArchiveFolder(): string {
    return archiveRoot({ ...this.settings, archiveFolder: '' }, this.scaffoldDetected);
  }

  /* THE CHAT OPENS IN THE RIGHT SIDEBAR, beside the planner tray - Tom,
     before his video: "a new ICOR chat session should open as a new tab in the
     right sidepanel, not in the center main area." The route itself (reveal an
     existing pane / resume into an unoccupied one / create on the right) is a
     pure function in view/leafRoute.ts, decided on the views' own facts, so
     pressing the robot twice reveals one pane instead of minting two. */
  async openChat(resumeSessionId?: string, provider?: ProviderId): Promise<void> {
    const leaves = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CHAT)
      .map((leaf) => {
        const view = leaf.view;
        const facts =
          view instanceof ChatView
            ? { sessionId: view.heldSessionId, occupied: view.occupied }
            : { sessionId: null, occupied: true };
        return { leaf, facts };
      });
    const route = routeChatLeaf(leaves, resumeSessionId ?? null);

    let leaf: WorkspaceLeaf | null;
    if (route.kind === 'create-right') {
      /* A new TAB in the right sidedock (split: false). getRightLeaf is typed
         nullable; the fallback is the old centre tab rather than a swallowed
         click, because an open that silently does nothing is worse than one
         that lands in the wrong place. */
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('split');
      /* The provider rides the state with the id: a stored session belongs to
         the runtime that minted it, and a fresh tab takes the settings default. */
      await leaf.setViewState({
        type: VIEW_TYPE_CHAT,
        active: true,
        state: resumeSessionId
          ? { resumeSessionId, provider: provider ?? this.settings.defaultProvider }
          : { provider: this.settings.defaultProvider },
      });
    } else {
      leaf = route.leaf;
    }
    /* Awaited twice over: revealLeaf's contract is that a deferred view is only
       fully loaded after it resolves, the next lines reach into that view, and
       reveal is also what EXPANDS a collapsed right sidebar - without it the
       open would land in a drawer nobody can see. */
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof ChatView) {
      // A revealed pane that already holds the thread needs no resume; an
      // unoccupied pane being resumed into does.
      /* 'reveal' during a resume only ever returns a pane whose heldSessionId
         already IS this thread, so it needs no resume call - the other two
         routes do: resume() is what replays the archive and starts the
         session, on a fresh pane and a reused one alike. */
      if (resumeSessionId && route.kind !== 'reveal') await view.resume(resumeSessionId);
      view.focusComposer();
    }
  }

  async loadSettings(): Promise<void> {
    // loadData returns untyped JSON; it is treated as a partial of our own
    // settings shape, and every missing field falls back to the default.
    const stored = (await this.loadData()) as Partial<ChatSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
    /* A stored Bypass default is HONOURED, and the silent rewrite that used to
       live here is gone.
     *
       It reset the stored mode back to Ask on every launch, on the reasoning
       that Bypass is a per-conversation choice. What it actually produced was a
       setting that could not be set: the user picked it, the tab saved it, and
       the next reload undid it with nothing on screen to say so. A default the
       product refuses to keep should not be offered as a default, and this one
       is worth offering - so it is kept. Ask is still what ships, still what
       `DEFAULT_SETTINGS` says, and still the recommendation in the tab. */
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    /* The readout strip is repainted only on an event and on the one-second
       tick, and the tick runs ONLY while a turn is streaming. Without this a
       readout switched on from settings would not appear until the next
       message, which reads exactly like the switch not working. */
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      const view = leaf.view;
      if (view instanceof ChatView) view.repaintFacts();
    }
  }

}
