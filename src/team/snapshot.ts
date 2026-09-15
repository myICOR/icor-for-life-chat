/* THE LIFE SNAPSHOT, the Obsidian-bound half. Everything that decides what a
 * line SAYS lives in snapshotParse.ts; this file only fetches the bytes.
 *
 * GL-1008, "Access, for plugin authors": `.icor-for-life/` is hidden, so
 * `Vault` never sees it and the adapter is the only door. `exists` runs
 * FIRST, every time, because a vault built by hand or arrived through
 * Obsidian Sync (which excludes dot folders) simply has no machine layer,
 * and `read` on a missing path throws where `exists` answers false.
 *
 * The plugin never writes here and never creates the folder: `scripts/`
 * belongs to the vault's own scripts, and this plugin is a reader. */

import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { SNAPSHOT_PATH, parseSnapshot } from './snapshotParse';
import type { SnapshotRead } from './snapshotParse';

export * from './snapshotParse';

/**
 * The snapshot as it is on this device, right now.
 *
 * No vault event fires for a file in a hidden folder (GL-1008 again), so
 * there is nothing to subscribe to: the caller reads when it needs the
 * answer. Every failure resolves to a `SnapshotRead` and none of them throws,
 * because a chat that cannot open must still open.
 */
export async function readLifeSnapshot(app: App): Promise<SnapshotRead> {
  const path = normalizePath(SNAPSHOT_PATH);
  const adapter = app.vault.adapter;
  try {
    if (!(await adapter.exists(path))) return { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
  let text: string;
  try {
    text = await adapter.read(path);
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: error instanceof Error ? error.message : 'the file could not be read',
    };
  }
  return parseSnapshot(text);
}
