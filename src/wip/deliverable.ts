/* STARTING A DELIVERABLE FROM A REPLY (R1).
 *
 * A reply the user wants to keep becomes a folder in the WiP room: the
 * `03 WiP/YYYY-MM-DD-<slug>/` shape every deliverable in the vault already
 * has, with the reply as `00-brief.md` and a README that names the sessions
 * behind it. Nothing here decides what is worth keeping; the user did, by
 * clicking. This file only puts it where the vault expects it. */

import { TFile, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import {
  WIP_FOLDER, deliverableFolderName, localDate, uniqueName, withSessionLine,
} from './naming';

export interface Deliverable {
  /** Vault-relative folder, `03 WiP/YYYY-MM-DD-<slug>`. */
  folder: string;
  briefPath: string;
  readmePath: string;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) await app.vault.createFolder(current);
  }
}

function briefFrontmatter(title: string, date: string, sessionIds: readonly string[]): string {
  return [
    '---',
    'type: deliverable',
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    'source: icor-chat',
    'status: draft',
    `session_ids: [${sessionIds.map((id) => JSON.stringify(id)).join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

/**
 * Create the folder, the brief and the README. The folder name is unique
 * among the WiP room's existing folders, so a second deliverable with the
 * same title on the same day becomes `-2`, never an overwrite.
 */
export async function startDeliverable(
  app: App,
  title: string,
  body: string,
  sessionIds: readonly string[],
  now = Date.now(),
): Promise<Deliverable> {
  const date = localDate(now);
  const root = app.vault.getAbstractFileByPath(WIP_FOLDER);
  const taken = new Set<string>();
  if (root instanceof TFolder) for (const child of root.children) taken.add(child.name);
  const name = uniqueName(deliverableFolderName(date, title), taken);
  const folder = `${WIP_FOLDER}/${name}`;
  await ensureFolder(app, folder);

  const briefPath = `${folder}/00-brief.md`;
  const readmePath = `${folder}/README.md`;
  const brief = `${briefFrontmatter(title, date, sessionIds)}# ${title}\n\n${body.trim()}\n`;
  await app.vault.create(briefPath, brief);
  const readme = withSessionLine(null, title, `- started from the AI Chat on ${date}`);
  await app.vault.create(readmePath, readme);
  return { folder, briefPath, readmePath };
}

/** The brief if it exists, else the README, else null. What a click on a folder opens. */
export function deliverableEntry(app: App, folder: string): TFile | null {
  for (const name of ['00-brief.md', 'README.md']) {
    const file = app.vault.getAbstractFileByPath(`${folder}/${name}`);
    if (file instanceof TFile) return file;
  }
  const dir = app.vault.getAbstractFileByPath(folder);
  if (dir instanceof TFolder) {
    for (const child of dir.children) if (child instanceof TFile && child.extension === 'md') return child;
  }
  return null;
}
