/* The vault's archive as a session index, for runtimes whose protocol has no
 * list of its own (the ACP agents).
 *
 * Reads only what the writer wrote: `session-manifest.json` for the ids, the
 * title and the times, `transcript.json` for the events. The events are
 * already in the plugin's own vocabulary, so a replay entry is a slice of
 * them starting at each `user-turn`; no provider translation runs here. */

import type { App } from 'obsidian';
import { ArchiveWriter } from './writer';
import { manifestProvider } from './naming';
import type { ChatEvent } from '../model/types';
import { entriesFromEvents } from './entries';
import type { ArchiveIndex, ArchivedSession, AcpProviderId } from '../provider/registry';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function archiveIndex(app: App, rootFor: () => string): ArchiveIndex {
  async function folders(): Promise<Array<{ folder: string; manifest: NonNullable<Awaited<ReturnType<ArchiveWriter['readManifest']>>> }>> {
    const root = rootFor();
    const writer = new ArchiveWriter(app, root);
    const adapter = app.vault.adapter;
    if (!root || !(await adapter.exists(root))) return [];
    const listing = await adapter.list(root);
    const out: Array<{ folder: string; manifest: NonNullable<Awaited<ReturnType<ArchiveWriter['readManifest']>>> }> = [];
    for (const folder of listing.folders) {
      const manifest = await writer.readManifest(folder);
      if (manifest) out.push({ folder, manifest });
    }
    return out;
  }

  async function events(folder: string, file: string): Promise<ChatEvent[]> {
    try {
      const parsed: unknown = JSON.parse(await app.vault.adapter.read(`${folder}/${file}`));
      const list = isRecord(parsed) && Array.isArray(parsed.events) ? parsed.events : [];
      return list.filter((e): e is ChatEvent => isRecord(e) && typeof e.kind === 'string');
    } catch {
      return [];
    }
  }

  return {
    async list(provider: AcpProviderId, cwd: string) {
      const rows: Array<Omit<ArchivedSession, 'entries'>> = [];
      for (const { manifest } of await folders()) {
        if (manifestProvider(manifest) !== provider) continue;
        if (manifest.vaultPath && cwd && manifest.vaultPath !== cwd) continue;
        const sessionId = manifest.sessionIds[manifest.sessionIds.length - 1];
        if (!sessionId) continue;
        rows.push({
          sessionId,
          title: manifest.title,
          startedAt: Date.parse(manifest.startedAt) || 0,
          endedAt: Date.parse(manifest.endedAt) || 0,
        });
      }
      return rows;
    },

    async read(provider: AcpProviderId, sessionId: string, cwd: string) {
      for (const { folder, manifest } of await folders()) {
        if (manifestProvider(manifest) !== provider) continue;
        if (manifest.vaultPath && cwd && manifest.vaultPath !== cwd) continue;
        if (!manifest.sessionIds.includes(sessionId)) continue;
        return {
          sessionId,
          title: manifest.title,
          startedAt: Date.parse(manifest.startedAt) || 0,
          endedAt: Date.parse(manifest.endedAt) || 0,
          entries: entriesFromEvents(await events(folder, manifest.files?.transcript ?? 'transcript.json')),
        };
      }
      return null;
    },
  };
}
