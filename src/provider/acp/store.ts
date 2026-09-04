/* The session record for an ACP runtime, and it is the PLUGIN'S archive.
 *
 * The Agent Client Protocol has no list and no read: a client can `load` a
 * session it already knows the id of, and nothing else (measured on the
 * Gemini handshake: `loadSession: true`, no session enumeration anywhere in
 * v1). So the record of what was said is the archive this plugin writes into
 * the vault after every turn, filtered to the runtime that had the session.
 * Every field here is read from a manifest or a transcript on disk; nothing
 * is asked of the agent, and a runtime that never archived a session lists
 * none.
 *
 * The index itself is Obsidian-side (`archive/index.ts`, it reads the vault)
 * and is handed in at plugin load, so this file stays free of Obsidian and
 * assertable headless with a fake index. */

import type { ReplayEntry, SessionReplay, SessionStore, SessionSummary } from '../types';
import type { AcpProviderId } from './recipes';

export interface ArchivedSession {
  sessionId: string;
  title: string;
  startedAt: number;
  endedAt: number;
  entries: ReplayEntry[];
}

/** What the vault knows about a runtime's past sessions. */
export interface ArchiveIndex {
  list(provider: AcpProviderId, cwd: string): Promise<Array<Omit<ArchivedSession, 'entries'>>>;
  read(provider: AcpProviderId, sessionId: string, cwd: string): Promise<ArchivedSession | null>;
}

let index: ArchiveIndex | null = null;

/** Installed once by main.ts. Before that every read answers "nothing". */
export function configureArchiveIndex(next: ArchiveIndex | null): void {
  index = next;
}

export function archiveStoreFor(provider: AcpProviderId): SessionStore {
  return {
    async list(cwd: string, limit: number): Promise<SessionSummary[]> {
      if (!index || !cwd) return [];
      try {
        const rows = await index.list(provider, cwd);
        return rows
          .map((r) => ({ sessionId: r.sessionId, title: r.title, lastModified: r.endedAt || r.startedAt, createdAt: r.startedAt || null }))
          .sort((a, b) => b.lastModified - a.lastModified)
          .slice(0, limit);
      } catch {
        return [];
      }
    },

    async createdAt(sessionId: string, cwd: string): Promise<number | null> {
      const row = await index?.read(provider, sessionId, cwd);
      return row?.startedAt || null;
    },

    async exists(sessionId: string, cwd: string): Promise<boolean> {
      return (await index?.read(provider, sessionId, cwd)) !== null && index !== null;
    },

    async read(sessionId: string, cwd: string, cap: number): Promise<SessionReplay> {
      const row = await index?.read(provider, sessionId, cwd);
      if (!row) return { entries: [], omitted: 0 };
      const entries = row.entries;
      if (entries.length <= cap) return { entries, omitted: 0 };
      return { entries: entries.slice(entries.length - cap), omitted: entries.length - cap };
    },
  };
}
