/* THE VAULT'S MEMORY, read back into the panel.
 *
 * Copilot keeps two markdown files for memory (a rolling summary file and an
 * explicit "saved memories" file). This vault already has the stronger
 * version of both: a session log per session under Team Knowledge, and a
 * journal per agent. What was missing was the surface that reads them, so a
 * new conversation started as if the last one had not happened. This file is
 * the Obsidian-bound half: it finds the files and reads the few that are
 * shown; every rule about what a row says lives in memoryParse.ts. */

import { MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { TEAM_KNOWLEDGE_FOLDER } from './detect';
import { dateFromName, journalTitle, parseSessionLog } from './memoryParse';
import type { ReplyAction } from '../view/actions';
import { VIEW_TYPE_CHAT } from '../constants';

export const SESSION_LOGS_FOLDER = `${TEAM_KNOWLEDGE_FOLDER}/Session Logs`;
export const TASKS_FOLDER = `${TEAM_KNOWLEDGE_FOLDER}/Tasks`;

/** The words the vault's own contract names as the ambient-capture trigger. */
export const REMEMBER_PREFIX = 'Keep this in mind: ';

export interface LogRow {
  path: string;
  title: string;
  date: string | null;
  agent: string | null;
  insight: string | null;
}

export interface JournalSummary {
  count: number;
  newest: { path: string; title: string; date: string | null } | null;
}

/** Markdown files under a folder, recursively, excluding `_template` style names. */
function notesUnder(app: App, folder: string): TFile[] {
  const root = app.vault.getAbstractFileByPath(folder);
  if (!(root instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (f: TFolder): void => {
    for (const child of f.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === 'md' && !child.basename.startsWith('_')) out.push(child);
    }
  };
  walk(root);
  return out;
}

/**
 * The newest session logs, by file name. The name starts with the date and
 * the time (`2026-09-04-12-50_larry_...`), so a plain descending sort is the
 * chronological one and no file has to be opened to order them.
 */
export async function recentSessionLogs(app: App, limit = 3): Promise<LogRow[]> {
  const files = notesUnder(app, SESSION_LOGS_FOLDER)
    .filter((f) => dateFromName(f.name) !== null)
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, Math.max(0, limit));
  const rows: LogRow[] = [];
  for (const file of files) {
    const frontmatter: Record<string, unknown> | null = app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    let source = '';
    try {
      source = await app.vault.cachedRead(file);
    } catch {
      source = '';
    }
    const parsed = parseSessionLog(file.name, source, frontmatter);
    rows.push({ path: file.path, ...parsed });
  }
  return rows;
}

/** An agent's journal: how many entries, and the newest one. Null when the folder is absent. */
export async function recentJournals(app: App, agentFolder: string): Promise<JournalSummary | null> {
  const folder = app.vault.getAbstractFileByPath(`${agentFolder}/Journal`);
  if (!(folder instanceof TFolder)) return null;
  const files = notesUnder(app, folder.path).sort((a, b) => b.name.localeCompare(a.name));
  const first = files[0];
  if (!first) return { count: 0, newest: null };
  let source = '';
  try {
    source = await app.vault.cachedRead(first);
  } catch {
    source = '';
  }
  return {
    count: files.length,
    newest: { path: first.path, title: journalTitle(first.name, source), date: dateFromName(first.name) },
  };
}

/** The newest task in `Tasks/open`, for the click on the task line. Null when there is none. */
export function newestOpenTask(app: App): TFile | null {
  const files = notesUnder(app, `${TASKS_FOLDER}/open`).sort((a, b) => b.name.localeCompare(a.name));
  return files[0] ?? null;
}

/** The selection the user can see in a markdown pane, or null. */
export function editorSelection(app: App): string | null {
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  const views = active ? [active] : [];
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    if (leaf.view instanceof MarkdownView && leaf.view !== active) views.push(leaf.view);
  }
  for (const view of views) {
    const text = view.editor.getSelection().trim();
    if (text) return text;
  }
  return null;
}

/** The text a user has selected inside one element, or null when the selection lies elsewhere. */
export function selectionInside(el: HTMLElement): string | null {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().trim();
  return text ? text : null;
}

/** What the view receives; the ChatView implements it as a public method. */
export interface Remembers {
  remember(text: string): void;
}

/**
 * The `Remember this` reply action. It sends the vault's own trigger phrase
 * as a new turn in the same conversation, so Penn's ambient capture files it
 * and answers with the `noted` receipt. Nothing is written by the plugin: the
 * team owns the filing, exactly as it does when the phrase is typed.
 */
export function rememberAction(): ReplyAction {
  return {
    id: 'remember',
    icon: 'brain',
    label: 'Remember this',
    section: 'primary',
    run: (ctx) => {
      const chosen = selectionInside(ctx.el) ?? ctx.text.trim();
      if (!chosen) return;
      (ctx.view as unknown as Remembers).remember(chosen);
    },
  };
}

/** The plugin surface this module needs; kept narrow so main.ts stays a one-line caller. */
export interface MemoryHost extends Plugin {
  replyActions: { register(action: ReplyAction): () => void };
  openChat(): Promise<void>;
}

/**
 * One call from `main.ts`: the reply action and the `Remember the selection`
 * command. The command reads the selection from any markdown pane, opens (or
 * reveals) a conversation, and sends the phrase there.
 */
export function installMemory(plugin: MemoryHost): void {
  plugin.replyActions.register(rememberAction());
  plugin.addCommand({
    id: 'remember-selection',
    name: 'Remember the selection',
    checkCallback: (checking) => {
      const text = editorSelection(plugin.app);
      if (!text) return false;
      if (!checking) void rememberInChat(plugin, text);
      return true;
    },
  });
}

async function rememberInChat(plugin: MemoryHost, text: string): Promise<void> {
  await plugin.openChat();
  const leaf = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).find((l) => 'remember' in l.view);
  const view = leaf?.view as unknown as Remembers | undefined;
  if (!view) {
    new Notice('Open a conversation with the AI team first.');
    return;
  }
  view.remember(text);
}
