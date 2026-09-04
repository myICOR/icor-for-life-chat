/* What the team can see without being told: the note that is open, and the
 * text that is selected in it. Tom calls this a core function, so it is
 * tracked continuously and shown before it is sent - the tray is the consent
 * surface. Nothing is attached that the user cannot see in the composer.
 *
 * The text assembly lives in model/contextText.ts, which has no Obsidian
 * import, so what the model receives can be asserted headless. */

import { MarkdownView, TFile, TFolder, getAllTags } from 'obsidian';
import type { App, CachedMetadata } from 'obsidian';
import type { NoteContext } from '../model/contextText';

export { selectionRangeLabel, contextPreamble, withContext } from '../model/contextText';
export type { NoteContext } from '../model/contextText';

/**
 * The chat view is itself the active view whenever the user is typing in it,
 * so `getActiveViewOfType` returns nothing exactly when the tray matters most.
 * The caller remembers the last markdown view it saw and passes it here; found
 * by driving the real plugin, where the tray was empty in every state a user
 * would actually be in.
 */
/** Any open markdown view, so a fresh window still has context to show. */
function firstMarkdownView(app: App): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    if (leaf.view instanceof MarkdownView) return leaf.view;
  }
  return null;
}

export function readContext(app: App, remembered?: MarkdownView | null): NoteContext | null {
  const active =
    app.workspace.getActiveViewOfType(MarkdownView) ?? remembered ?? firstMarkdownView(app);
  const file = active?.file ?? app.workspace.getActiveFile();
  if (!file) return null;
  const base: NoteContext = {
    path: file.path,
    basename: file.basename,
    selection: null,
    fromLine: null,
    toLine: null,
  };
  const editor = active?.editor;
  if (!editor) return base;
  const selected = editor.getSelection();
  if (!selected) return base;
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  return { ...base, selection: selected, fromLine: from.line + 1, toLine: to.line + 1 };
}

/* ------------------------------------------------ the vault as context */

/* THE RESOLVERS, every one of them a read of the metadata cache and nothing
 * else. No file is opened here: a tag scan that read every note would take
 * seconds on a large vault and would be run every time the `+` menu opened.
 * The cache already holds tags, frontmatter and the folder tree, and it is
 * what Obsidian's own search reads. */

function markdownFilesUnder(folder: TFolder): TFile[] {
  const out: TFile[] = [];
  const walk = (f: TFolder): void => {
    for (const child of f.children) {
      if (child instanceof TFile) {
        if (child.extension === 'md') out.push(child);
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  };
  walk(folder);
  return out;
}

/** Every markdown note under a folder, recursively. Empty for a bad path. */
export function resolveFolder(app: App, folderPath: string): string[] {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return markdownFilesUnder(folder).map((f) => f.path).sort();
}

function normalizeTag(tag: string): string {
  const bare = tag.trim().replace(/^#+/, '');
  return `#${bare.toLowerCase()}`;
}

function tagsOf(cache: CachedMetadata | null): string[] {
  if (!cache) return [];
  return (getAllTags(cache) ?? []).map(normalizeTag);
}

/** Every note carrying the tag, in either `#tag` or `tag` form, any case. */
export function resolveTag(app: App, tag: string): string[] {
  const wanted = normalizeTag(tag);
  const out: string[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (tagsOf(app.metadataCache.getFileCache(file)).includes(wanted)) out.push(file.path);
  }
  return out.sort();
}

/** A frontmatter value as the strings a user would type to match it. */
function valueStrings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return [];
}

/** Every note whose frontmatter has `key` with `value` (arrays match any element). */
export function resolveProperty(app: App, key: string, value: string): string[] {
  const out: string[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !(key in fm)) continue;
    if (valueStrings(fm[key]).includes(value)) out.push(file.path);
  }
  return out.sort();
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Every tag in the vault with how many notes carry it, most common first. */
export function listTags(app: App): TagCount[] {
  const counts = new Map<string, number>();
  for (const file of app.vault.getMarkdownFiles()) {
    const seen = new Set(tagsOf(app.metadataCache.getFileCache(file)));
    for (const tag of seen) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface PropertyValues {
  key: string;
  values: Array<{ value: string; count: number }>;
}

/** Distinct values per key, capped so a key like `date` cannot list a thousand rows. */
export const PROPERTY_VALUE_CAP = 200;

/** Every frontmatter key with its distinct values and counts, most used key first. */
export function listProperties(app: App): PropertyValues[] {
  const keys = new Map<string, Map<string, number>>();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;
    for (const [key, raw] of Object.entries(fm)) {
      if (key === 'position') continue;
      const values = keys.get(key) ?? new Map<string, number>();
      keys.set(key, values);
      for (const v of new Set(valueStrings(raw))) values.set(v, (values.get(v) ?? 0) + 1);
    }
  }
  return Array.from(keys, ([key, values]) => ({
    key,
    values: Array.from(values, ([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, PROPERTY_VALUE_CAP),
  })).sort((a, b) => {
    const an = a.values.reduce((n, v) => n + v.count, 0);
    const bn = b.values.reduce((n, v) => n + v.count, 0);
    return bn - an || a.key.localeCompare(b.key);
  });
}

export interface FolderCount {
  path: string;
  count: number;
}

/** Every folder holding at least one note (recursively), with its note count. */
export function listFolders(app: App): FolderCount[] {
  const out: FolderCount[] = [];
  const walk = (folder: TFolder): number => {
    let count = 0;
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.extension === 'md') count += 1;
      } else if (child instanceof TFolder) {
        count += walk(child);
      }
    }
    if (count > 0 && !folder.isRoot()) out.push({ path: folder.path, count });
    return count;
  };
  walk(app.vault.getRoot());
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The note a `[[target]]` points at from `sourcePath`, or null. */
export function resolveWikilink(app: App, target: string, sourcePath: string): TFile | null {
  const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return file instanceof TFile ? file : null;
}
