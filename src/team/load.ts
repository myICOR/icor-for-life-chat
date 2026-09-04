/* Reading the insights' inputs out of the vault. The one Obsidian-bound half
 * of the insights model; everything it hands back goes through the pure
 * `aggregate` in insights.ts.
 *
 * Every archive folder under the root is read through the writer's own
 * manifest reader, so the rule that decides what is ours (name shape AND our
 * manifest) is the same rule the retention sweep uses. A 0.5.x folder with no
 * per-agent counts gets them derived from its transcript, once, here. */

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { ArchiveWriter } from '../archive/writer';
import { looksLikeOurArchive } from '../archive/naming';
import type { ArchiveManifest } from '../archive/naming';
import type { ChatEvent } from '../model/types';
import { deriveFromEvents } from './insights';
import type { SessionRecord } from './insights';
import { TEAM_KNOWLEDGE_FOLDER } from './detect';

export interface VaultCounts {
  /** Null when the vault has no team folder, never zero standing in for it. */
  agents: number | null;
  sessionLogs: number | null;
  tasksOpen: number | null;
  tasksInProgress: number | null;
  tasksDone: number | null;
}

export interface InsightsData {
  sessions: SessionRecord[];
  vault: VaultCounts;
  /** The archive root that was read, for the empty-state sentence. */
  archiveRoot: string;
}

const SESSION_LOGS = `${TEAM_KNOWLEDGE_FOLDER}/Session Logs`;
const TASKS = `${TEAM_KNOWLEDGE_FOLDER}/Tasks`;

/** Markdown notes under a folder, recursively; null when the folder is absent. */
function countNotes(app: App, folder: string): number | null {
  const root = app.vault.getAbstractFileByPath(folder);
  if (!(root instanceof TFolder)) return null;
  let n = 0;
  const walk = (f: TFolder): void => {
    for (const child of f.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === 'md' && !child.basename.startsWith('_')) n += 1;
    }
  };
  walk(root);
  return n;
}

async function readEvents(app: App, folder: string, file: string): Promise<ChatEvent[]> {
  const path = `${folder}/${file}`;
  try {
    if (!(await app.vault.adapter.exists(path))) return [];
    const parsed: unknown = JSON.parse(await app.vault.adapter.read(path));
    const events = (parsed as { events?: unknown }).events;
    return Array.isArray(events) ? (events as ChatEvent[]) : [];
  } catch {
    return [];
  }
}

async function recordOf(app: App, folder: string, manifest: ArchiveManifest): Promise<SessionRecord> {
  const startedAt = Date.parse(manifest.startedAt) || 0;
  const endedAt = Date.parse(manifest.endedAt) || startedAt;
  const tokens = typeof manifest.counts?.tokens === 'number' && manifest.counts.tokens > 0 ? manifest.counts.tokens : null;
  let counts = {
    agents: manifest.agents ?? [],
    tools: manifest.tools ?? {},
    mainToolCalls: manifest.mainToolCalls ?? 0,
    mainTextBlocks: manifest.mainTextBlocks ?? 0,
  };
  // A pre-0.6.0 folder: the same function the writer uses, over its transcript.
  if (manifest.agents === undefined) {
    counts = deriveFromEvents(await readEvents(app, folder, manifest.files?.transcript ?? 'transcript.json'));
  }
  return {
    folder,
    title: manifest.title || 'Conversation',
    startedAt,
    endedAt,
    tokens,
    model: manifest.resume?.model ?? null,
    wip: Array.isArray(manifest.wip) ? manifest.wip.filter((w): w is string => typeof w === 'string') : [],
    ...counts,
  };
}

/** The open and in-progress task counts, or null per folder when the room is absent. */
export function openTaskCount(app: App): { open: number | null; inProgress: number | null } {
  return { open: countNotes(app, `${TASKS}/open`), inProgress: countNotes(app, `${TASKS}/in-progress`) };
}

export async function loadInsights(app: App, archiveRoot: string, rosterCount: number | null): Promise<InsightsData> {
  const sessions: SessionRecord[] = [];
  const adapter = app.vault.adapter;
  if (archiveRoot && (await adapter.exists(archiveRoot))) {
    const writer = new ArchiveWriter(app, archiveRoot);
    const listing = await adapter.list(archiveRoot);
    for (const folder of listing.folders) {
      const name = folder.split('/').pop() ?? '';
      if (!looksLikeOurArchive(name)) continue;
      const manifest = await writer.readManifest(folder);
      if (!manifest) continue;
      sessions.push(await recordOf(app, folder, manifest));
    }
  }
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return {
    sessions,
    archiveRoot,
    vault: {
      agents: rosterCount,
      sessionLogs: countNotes(app, SESSION_LOGS),
      tasksOpen: countNotes(app, `${TASKS}/open`),
      tasksInProgress: countNotes(app, `${TASKS}/in-progress`),
      tasksDone: countNotes(app, `${TASKS}/done`),
    },
  };
}
