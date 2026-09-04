/* THE WIP ROOM'S NAMING RULES, and no DOM or vault under them.
 *
 * A deliverable folder is `03 WiP/YYYY-MM-DD-<slug>/`, a task file is
 * `tsk-YYYY-MM-DD-NNN-<slug>.md`: both are stated in GL-001 and both have
 * exactly one right answer for a given title and day, so both are scripts.
 * The same goes for which WiP folders a session touched (a fact of its tool
 * calls), which folder is newest (a fact of its name), and what a README
 * looks like after a session line is added to it. Everything here is
 * asserted in test/wip.test.mjs without a workspace. */

import type { ChatEvent } from '../model/types';

export const WIP_FOLDER = '03 WiP';
export const WIP_ARCHIVE = '_archive';

/** GL-001 kebab: lowercase, ascii, hyphens, bounded. Never empty. */
export function slugForTitle(title: string, max = 48): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'deliverable';
}

/** `YYYY-MM-DD` in the machine's own day, the way the vault dates everything. */
export function localDate(now = Date.now()): string {
  const d = new Date(now);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * The title a reply carries: its first heading, else its first non-empty
 * line, markdown marks stripped and bounded. A reply is the body of the
 * deliverable it starts, so the reply names it.
 */
export function titleFromReply(text: string, max = 80): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l));
  const raw = heading ?? lines[0] ?? '';
  const clean = raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`~>]/g, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = clean.length > max ? `${clean.slice(0, max).trimEnd()}` : clean;
  return cut || 'Deliverable';
}

/** `03 WiP/YYYY-MM-DD-<slug>`, before the uniqueness check. */
export function deliverableFolderName(date: string, title: string): string {
  return `${date}-${slugForTitle(title)}`;
}

/** The first of `name`, `name-2`, `name-3`, ... not already taken. */
export function uniqueName(name: string, taken: ReadonlySet<string> | readonly string[]): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(name)) return name;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${name}-${Date.now()}`;
}

const TASK_NAME = /^tsk-(\d{4}-\d{2}-\d{2})-(\d{3})-/;

/** The next free `NNN` for a day, read off the existing task file names. */
export function nextTaskNumber(existingNames: readonly string[], date: string): number {
  let max = 0;
  for (const name of existingNames) {
    const m = TASK_NAME.exec(name);
    if (!m || m[1] !== date) continue;
    max = Math.max(max, Number(m[2]));
  }
  return max + 1;
}

export function taskFileName(date: string, n: number, title: string): string {
  return `tsk-${date}-${String(n).padStart(3, '0')}-${slugForTitle(title, 60)}.md`;
}

export function taskId(date: string, n: number): string {
  return `tsk-${date}-${String(n).padStart(3, '0')}`;
}

/* -------------------------------------------------------- folder ordering */

export interface WipFolderInfo {
  /** Vault-relative, `03 WiP/<name>`. */
  path: string;
  name: string;
  /** Modification time of the folder's newest note, or 0. */
  mtime: number;
  notes: number;
}

const DATED = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Newest first: by the `YYYY-MM-DD` prefix when both carry one, else the
 * dated folder outranks the undated, else by mtime. The archive folder never
 * appears at all: a WiP folder that has been archived is finished work.
 */
export function sortWipFolders(folders: readonly WipFolderInfo[]): WipFolderInfo[] {
  return folders
    .filter((f) => f.name !== WIP_ARCHIVE && !f.name.startsWith('_'))
    .slice()
    .sort((a, b) => {
      const da = DATED.exec(a.name)?.[1] ?? null;
      const db = DATED.exec(b.name)?.[1] ?? null;
      if (da && db && da !== db) return db.localeCompare(da);
      if (da && !db) return -1;
      if (!da && db) return 1;
      return b.mtime - a.mtime || a.name.localeCompare(b.name);
    });
}

/* ------------------------------------------------- which folders a turn hit */

const WIP_PATH = /03 WiP\/([^/"'`\s\\]+)/g;

function wipFolderOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIP_PATH)) {
    const name = m[1];
    if (!name || name === WIP_ARCHIVE || name.startsWith('_')) continue;
    out.push(`${WIP_FOLDER}/${name}`);
  }
  return out;
}

const WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The WiP folders a session touched: every folder a writing tool targeted,
 * every folder a Bash command named, plus the ones the user attached as
 * context. Read calls are not touches - a session that read a brief did not
 * work on it. Sorted and deduped, so the manifest is stable across rewrites.
 */
export function wipFoldersTouched(events: readonly ChatEvent[], attached: readonly string[] = []): string[] {
  const seen = new Set<string>();
  for (const path of attached) {
    for (const f of wipFolderOf(`${path}/`)) seen.add(f);
    if (path.startsWith(`${WIP_FOLDER}/`)) {
      const name = path.slice(WIP_FOLDER.length + 1).split('/')[0] ?? '';
      if (name && name !== WIP_ARCHIVE && !name.startsWith('_')) seen.add(`${WIP_FOLDER}/${name}`);
    }
  }
  for (const event of events) {
    if (event.kind !== 'tool-call') continue;
    if (WRITING_TOOLS.has(event.name)) {
      for (const f of wipFolderOf(event.target)) seen.add(f);
    } else if (event.name === 'Bash') {
      const command = typeof event.input.command === 'string' ? event.input.command : event.target;
      for (const f of wipFolderOf(command)) seen.add(f);
    }
  }
  return Array.from(seen).sort();
}

/* ----------------------------------------------------- the README's sessions */

export const SESSIONS_HEADING = '## Sessions';

/**
 * A README with one more session line under its `## Sessions` heading.
 * The heading is created once, at the end; a line already present is not
 * added twice; an absent README starts with one title line. Returns the
 * text unchanged when nothing had to change, so a caller can skip the write.
 */
export function withSessionLine(readme: string | null, folderTitle: string, line: string): string {
  const base = readme ?? `# ${folderTitle}\n`;
  if (base.split('\n').some((l) => l.trim() === line.trim())) return base;
  const trimmed = base.replace(/\s+$/, '');
  const at = trimmed.indexOf(SESSIONS_HEADING);
  if (at === -1) return `${trimmed}\n\n${SESSIONS_HEADING}\n\n${line}\n`;
  // Append at the end of the heading's block: the next heading, or the end.
  const after = trimmed.indexOf('\n#', at + SESSIONS_HEADING.length);
  if (after === -1) return `${trimmed}\n${line}\n`;
  return `${trimmed.slice(0, after).replace(/\s+$/, '')}\n${line}\n${trimmed.slice(after)}\n`;
}

/** The link line the archive writes into a WiP README. */
export function sessionLine(archiveFolder: string, title: string): string {
  return `- [[${archiveFolder}/conversation|${title}]]`;
}
