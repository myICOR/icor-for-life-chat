/* THE SIX MOBILE TOOLS, implemented. `chat-mobile-engine-spec-v1.md` section
 * 5: "Vault-scoped, all through the Obsidian Vault and MetadataCache APIs,
 * which work on mobile ... No shell, no filesystem outside the vault, no MCP
 * on mobile."
 *
 * Every function here takes a `VaultToolsContext` rather than an Obsidian
 * `App`, and every shape it reads (`VaultLike`, `NoteLike`, `FolderLike`) is a
 * structural subset of Obsidian's real `Vault`/`TFile`/`TFolder` - a real
 * `app.vault` satisfies `VaultLike` without a cast. That is deliberate, not
 * an abstraction for its own sake: it means this file imports nothing from
 * `obsidian` at the VALUE level (no `instanceof TFile`, no `Vault` class
 * reference), which keeps it in the pure test bundle (`test/entry.ts`) and
 * testable with plain object fixtures - no headless Obsidian, no mock app,
 * the way the rest of this plugin's pure logic already is. */

import { RESULT_OUTPUT_CAP } from '../../provider/tooling';

export interface NoteLike {
  path: string;
  basename: string;
  extension: string;
}

export interface FolderLike {
  path: string;
  name: string;
  children: ReadonlyArray<NoteLike | FolderLike>;
}

export function isFolderLike(x: NoteLike | FolderLike): x is FolderLike {
  return Array.isArray((x as FolderLike).children);
}

export interface VaultLike {
  getFileByPath(path: string): NoteLike | null;
  getFolderByPath(path: string): FolderLike | null;
  getRoot(): FolderLike;
  getMarkdownFiles(): NoteLike[];
  read(file: NoteLike): Promise<string>;
  create(path: string, data: string): Promise<NoteLike>;
  append(file: NoteLike, data: string): Promise<void>;
}

export interface VaultToolsContext {
  vault: VaultLike;
  /** The note the member currently has open, or null when none is. */
  activeNote: () => NoteLike | null;
  /** The member's current text selection, or '' when nothing is selected. */
  selection: () => string;
}

export interface ToolOutcome {
  ok: boolean;
  /** One line, for the row's tooltip / the approval-denial message. */
  detail: string;
  /** The full result body, capped at RESULT_OUTPUT_CAP like every other tool. */
  output: string;
}

function cap(text: string): string {
  if (text.length <= RESULT_OUTPUT_CAP) return text;
  const more = text.length - RESULT_OUTPUT_CAP;
  return `${text.slice(0, RESULT_OUTPUT_CAP)}\n[... ${more} more characters]`;
}

function normalizePath(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  // A leading slash is how a model asks for the root; the Vault API's own
  // paths never carry one.
  return s.replace(/^\/+/, '');
}

function fail(detail: string): ToolOutcome {
  return { ok: false, detail, output: '' };
}

/* ------------------------------------------------------------- read_note */

export async function runReadNote(ctx: VaultToolsContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const path = normalizePath(input.path);
  if (!path) return fail('No path given.');
  const file = ctx.vault.getFileByPath(path);
  if (!file) return fail(`No note at ${path}.`);
  try {
    const text = await ctx.vault.read(file);
    return { ok: true, detail: `Read ${path} (${text.length} characters)`, output: cap(text) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Could not read ${path}.`);
  }
}

/* ----------------------------------------------------------- search_notes */

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;
const SNIPPET_RADIUS = 80;

function snippetAround(text: string, index: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export async function runSearchNotes(ctx: VaultToolsContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return fail('No query given.');
  const rawLimit = typeof input.limit === 'number' ? Math.trunc(input.limit) : SEARCH_LIMIT_DEFAULT;
  const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, rawLimit));
  const needle = query.toLowerCase();

  const titleHits: string[] = [];
  const contentHits: string[] = [];
  for (const file of ctx.vault.getMarkdownFiles()) {
    if (titleHits.length + contentHits.length >= limit) break;
    const titleMatch = file.basename.toLowerCase().includes(needle);
    if (titleMatch) {
      titleHits.push(`${file.path} - title match`);
      continue;
    }
    let text: string;
    try {
      text = await ctx.vault.read(file);
    } catch {
      continue;
    }
    const at = text.toLowerCase().indexOf(needle);
    if (at >= 0) contentHits.push(`${file.path} - ${snippetAround(text, at)}`);
  }

  const rows = [...titleHits, ...contentHits].slice(0, limit);
  if (rows.length === 0) return { ok: true, detail: `No notes matched "${query}".`, output: '' };
  return {
    ok: true,
    detail: `${rows.length} note${rows.length === 1 ? '' : 's'} matched "${query}"`,
    output: cap(rows.join('\n')),
  };
}

/* ------------------------------------------------------------ list_folder */

export function runListFolder(ctx: VaultToolsContext, input: Record<string, unknown>): ToolOutcome {
  const path = normalizePath(input.path);
  const folder = path ? ctx.vault.getFolderByPath(path) : ctx.vault.getRoot();
  if (!folder) return fail(`No folder at ${path || '/'}.`);
  const rows = folder.children
    .map((child) => (isFolderLike(child) ? `${child.path}/` : child.path))
    .sort((a, b) => a.localeCompare(b));
  if (rows.length === 0) return { ok: true, detail: `${path || '/'} is empty.`, output: '' };
  return { ok: true, detail: `${rows.length} item${rows.length === 1 ? '' : 's'} in ${path || '/'}`, output: cap(rows.join('\n')) };
}

/* ------------------------------------------------------------ current_note */

export async function runCurrentNote(ctx: VaultToolsContext): Promise<ToolOutcome> {
  const file = ctx.activeNote();
  if (!file) return { ok: true, detail: 'No note is currently open.', output: '' };
  let text = '';
  try {
    text = await ctx.vault.read(file);
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Could not read ${file.path}.`);
  }
  const selection = ctx.selection();
  const body = selection
    ? `# ${file.path}\n\n${text}\n\n---\nSelected text:\n${selection}`
    : `# ${file.path}\n\n${text}`;
  return { ok: true, detail: `The open note: ${file.path}`, output: cap(body) };
}

/* -------------------------------------------------------- append_to_note */

export async function runAppendToNote(ctx: VaultToolsContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const path = normalizePath(input.path);
  const text = typeof input.text === 'string' ? input.text : '';
  if (!path) return fail('No path given.');
  if (!text) return fail('No text given.');
  const file = ctx.vault.getFileByPath(path);
  if (!file) return fail(`No note at ${path}. Use create_note to make a new one.`);
  try {
    await ctx.vault.append(file, text);
    return { ok: true, detail: `Appended to ${path}`, output: `Appended ${text.length} characters to ${path}.` };
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Could not append to ${path}.`);
  }
}

/* ---------------------------------------------------------- create_note */

export async function runCreateNote(ctx: VaultToolsContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const path = normalizePath(input.path);
  const content = typeof input.content === 'string' ? input.content : '';
  if (!path) return fail('No path given.');
  if (ctx.vault.getFileByPath(path)) return fail(`A note already exists at ${path}.`);
  try {
    await ctx.vault.create(path, content);
    return { ok: true, detail: `Created ${path}`, output: `Created ${path} (${content.length} characters).` };
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Could not create ${path}.`);
  }
}

/* -------------------------------------------------------------- dispatch */

export async function runVaultTool(
  name: string,
  input: Record<string, unknown>,
  ctx: VaultToolsContext,
): Promise<ToolOutcome> {
  switch (name) {
    case 'read_note': return runReadNote(ctx, input);
    case 'search_notes': return runSearchNotes(ctx, input);
    case 'list_folder': return runListFolder(ctx, input);
    case 'current_note': return runCurrentNote(ctx);
    case 'append_to_note': return runAppendToNote(ctx, input);
    case 'create_note': return runCreateNote(ctx, input);
    default: return fail(`Unknown tool: ${name}`);
  }
}
