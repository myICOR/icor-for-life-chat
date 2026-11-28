/* IS THIS AN ICOR FOR LIFE VAULT, and where is its Databases room.
 *
 * Asked for one reason: where a saved conversation goes when the settings
 * name no folder (Tom, 2026-11-26: "if ICOR for Life scaffold is installed,
 * it should be placed in the /databases folder as default").
 *
 * The marker is `_System/schema.json`, the file every ICOR for Life 3.0 vault
 * carries and the one the rest of this plugin already reads its structure
 * from (`vault/vaultContext.ts`). It sits in a visible folder on purpose, so
 * the answer is the same on a phone that got the vault through Obsidian Sync,
 * which never copies `.icor-for-life/`. A folder called "Databases" alone is
 * not proof: any vault may have one.
 *
 * The room is the vault-root folder named `NN Databases` (`11 Databases` in
 * 3.0). It is matched by its name, never by its number, because the number is
 * the room's place in the list and has moved between versions before.
 *
 * Read from the vault's own index, which is in memory and synchronous, and
 * never cached: the settings tab and the archive writer both ask at the moment
 * they need it, so a renamed room is found the next time. */

/* Types only: the pure half is imported by the headless suite, which has no
   Obsidian at runtime, so a folder is told from a file by its `children`. */
import type { App, TAbstractFile, TFolder } from 'obsidian';
import { SCHEMA_PATH } from './vaultContext';

/** `11 Databases`, `05 Databases`, `07 Databases`: two digits, a space, the room's name. */
const DATABASES_ROOM = /^\d{2} Databases$/;

/**
 * The Databases room among the vault root's folder names, or null.
 * `isScaffold` is the marker's answer; without it no folder name counts.
 * Two candidates (a vault mid-migration) resolve to the lowest number.
 */
export function databasesRoom(rootFolders: readonly string[], isScaffold: boolean): string | null {
  if (!isScaffold) return null;
  const rooms = rootFolders.filter((name) => DATABASES_ROOM.test(name)).sort();
  return rooms[0] ?? null;
}

function isFolder(file: TAbstractFile): file is TFolder {
  return 'children' in file;
}

/** True when the vault carries ICOR for Life's structure file. */
export function isIcorVault(app: App): boolean {
  const file = app.vault.getAbstractFileByPath(SCHEMA_PATH);
  return file !== null && !isFolder(file);
}

/** This vault's Databases room, or null when it is not an ICOR for Life vault or has none. */
export function detectDatabasesRoom(app: App): string | null {
  const root = app.vault.getRoot();
  const names = root.children.filter(isFolder).map((c) => c.name);
  return databasesRoom(names, isIcorVault(app));
}
