/* CAPTURING A TASK FROM A REPLY (R5).
 *
 * The vault already has a task shape: `06 AI Team/AI Team Knowledge/Tasks/
 * open/tsk-YYYY-MM-DD-NNN-<slug>.md` with a frontmatter block every task in
 * the folder shares. Rather than carry a copy of that shape here (which would
 * age the day the vault's template changes), the newest task in the folder is
 * read and its KEYS are copied, with the values this capture knows filled in.
 * A vault with no task yet gets the scaffold's own minimal shape. */

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { TASKS_OPEN } from '../view/context';
import { localDate, nextTaskNumber, slugForTitle, taskFileName, taskId } from './naming';

export interface CapturedTask {
  path: string;
  id: string;
}

const FALLBACK_KEYS = [
  'id', 'title', 'status', 'owner', 'created', 'priority',
  'linked_sops', 'linked_workstreams', 'linked_guidelines', 'linked_my_life',
  'linked_session_logs', 'linked_journal_entries', 'tags',
];

/** The frontmatter keys of the newest task file, in their own order; or the fallback. */
async function templateKeys(app: App, folder: TFolder): Promise<string[]> {
  const tasks = folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === 'md' && c.basename.startsWith('tsk-'))
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  const newest = tasks[0];
  if (!newest) return FALLBACK_KEYS;
  const source = await app.vault.cachedRead(newest);
  if (!source.startsWith('---')) return FALLBACK_KEYS;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return FALLBACK_KEYS;
  const keys: string[] = [];
  for (const line of source.slice(4, end).split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (m && m[1] && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys.length > 0 ? keys : FALLBACK_KEYS;
}

function valueFor(key: string, id: string, title: string, owner: string, date: string, slug: string): string {
  switch (key) {
    case 'id': return id;
    case 'title': return JSON.stringify(title);
    case 'status': return 'open';
    case 'owner': case 'assignee': return owner;
    case 'created': return date;
    case 'updated': return date;
    case 'priority': return 'medium';
    case 'tags': return `[task, ${slug.split('-').slice(0, 2).join('-')}]`;
    case 'source': return 'icor-chat';
    case 'created_by': return 'larry';
    default:
      // Every other key (the linked_* lists, blocked_by, due, parent) starts empty.
      return key.startsWith('linked_') ? '[]' : 'null';
  }
}

/**
 * Write the task file. `NNN` is the next free number for today, so two
 * captures in one session never collide, and the body is the reply under a
 * title heading: the finding as it was stated, not a summary of it.
 */
export async function captureTask(app: App, title: string, body: string, owner = 'larry', now = Date.now()): Promise<CapturedTask> {
  const folder = app.vault.getAbstractFileByPath(TASKS_OPEN);
  if (!(folder instanceof TFolder)) throw new Error(`${TASKS_OPEN} is not a folder in this vault.`);
  const date = localDate(now);
  const names = folder.children.map((c) => c.name);
  const n = nextTaskNumber(names, date);
  const id = taskId(date, n);
  const slug = slugForTitle(title, 60);
  const keys = await templateKeys(app, folder);
  const lines = ['---', ...keys.map((k) => `${k}: ${valueFor(k, id, title, owner, date, slug)}`), '---', '', `# ${title}`, '', body.trim(), ''];
  const path = `${TASKS_OPEN}/${taskFileName(date, n, title)}`;
  await app.vault.create(path, lines.join('\n'));
  return { path, id };
}
