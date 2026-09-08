/* THE OWN-KEY ENGINE'S VAULT ADAPTER. `src/engine/tools/vaultTools.ts` takes
 * a `VaultLike` / `NoteLike` / `FolderLike` - structural subsets of
 * Obsidian's real `Vault` / `TFile` / `TFolder` chosen so the engine's own
 * test suite never needs a headless Obsidian. A real `Vault` is close to
 * that shape but not a drop-in: `TFolder.children` is `TAbstractFile[]`,
 * whose base class carries neither `TFile`'s `basename` / `extension` nor
 * `TFolder`'s own `children`, so it does not itself satisfy
 * `NoteLike | FolderLike` and needs converting, recursively, not casting.
 * This file is that conversion, the one place `src/engine/`'s pure shapes
 * meet the real `App`. */

import { MarkdownView, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { readContext } from './context';
import type { VaultToolsContext } from '../engine';
/* `VaultLike` is not re-exported from `src/engine/index.ts`'s facade (only
 * `NoteLike` / `FolderLike` / `VaultToolsContext` / `ToolOutcome` are) - this
 * file needs it to type the adapter's own `vault` property, so it reaches
 * one level past the facade rather than widening every method here to
 * `unknown`. Named to Mack/Larry as a facade gap in the session report;
 * not a hygiene-gated seam, so this is safe, just a rough edge. */
import type { FolderLike, NoteLike, VaultLike } from '../engine/tools/vaultTools';

function noteLikeOf(file: TFile): NoteLike {
  return { path: file.path, basename: file.basename, extension: file.extension };
}

function folderLikeOf(folder: TFolder): FolderLike {
  return {
    path: folder.path,
    name: folder.name,
    children: folder.children.map((child) => {
      // Real `instanceof` checks, never a cast: `TAbstractFile` is a base
      // class rather than a two-member union, so TypeScript cannot narrow
      // the second branch on its own the way it would for a discriminated
      // union - and a third subtype nobody has written yet is a clear error
      // here rather than a `TFile` that silently has no `extension`.
      if (child instanceof TFolder) return folderLikeOf(child);
      if (child instanceof TFile) return noteLikeOf(child);
      throw new Error(`Unexpected vault entry at ${child.path}: neither a note nor a folder.`);
    }),
  };
}

/**
 * `VaultToolsContext` over a real `App`. Every method that hands a `NoteLike`
 * BACK to the engine (`read`, `append`) receives one when called, since that
 * is what `getFileByPath` above just returned - so it re-resolves the real
 * `TFile` by path before touching the real vault, rather than trying to keep
 * the two objects in lock-step.
 */
export function vaultToolsContextFor(app: App, activeMarkdownView: () => MarkdownView | null): VaultToolsContext {
  const vault = app.vault;

  function realFile(note: NoteLike): TFile {
    const real = vault.getFileByPath(note.path);
    if (!real) throw new Error(`No note at ${note.path}.`);
    return real;
  }

  const vaultLike: VaultLike = {
    getFileByPath(path) {
      const f = vault.getFileByPath(path);
      return f ? noteLikeOf(f) : null;
    },
    getFolderByPath(path) {
      const f = vault.getFolderByPath(path);
      return f ? folderLikeOf(f) : null;
    },
    getRoot() {
      return folderLikeOf(vault.getRoot());
    },
    getMarkdownFiles() {
      return vault.getMarkdownFiles().map(noteLikeOf);
    },
    read(file) {
      return vault.read(realFile(file));
    },
    async create(path, data) {
      return noteLikeOf(await vault.create(path, data));
    },
    append(file, data) {
      return vault.append(realFile(file), data);
    },
  };

  return {
    vault: vaultLike,
    activeNote: () => {
      const file = app.workspace.getActiveFile();
      return file ? noteLikeOf(file) : null;
    },
    /* The same selection `readContext` already reads for the Claude Code
     * engine's context awareness (`ChatView.refreshContext`), so the
     * `current_note` tool and the "open note" context chip never disagree
     * about what counts as selected text. */
    selection: () => readContext(app, activeMarkdownView())?.selection ?? '',
  };
}
