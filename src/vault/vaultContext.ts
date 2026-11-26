/* WHAT THE VAULT SAYS ABOUT ITSELF, and nothing else.
 *
 * The chat brings no instructions, agents or rules of its own. A vault that
 * wants an assistant to behave a certain way says so in three places, which
 * any AI that opens the folder reads the same way:
 *
 *   AGENTS.md                         the principles and where to look
 *                                     (CLAUDE.md when there is no AGENTS.md)
 *   _System/Skills/<name>/SKILL.md    how to do the work, one skill a folder
 *                                     (.agents/skills/ and .claude/skills/
 *                                     hold the same copies on each computer)
 *   _System/schema.json               every note type: its folder, fields,
 *                                     allowed values and link targets
 *
 * `_System/` is a visible folder on purpose (2026-11-20): Obsidian Sync never
 * copies a dot folder, so a phone would otherwise have no schema and no
 * skills. Vaults built before that keep them in `.icor-for-life/schema.json`
 * and `.agents/skills/`, which are read as fallbacks.
 *
 * The Claude Code and Codex engines read AGENTS.md / CLAUDE.md and their skill
 * folders themselves, because they run with the vault as their working
 * directory. The own-key engine has no runtime underneath it, so this file is
 * what tells its model the same things.
 *
 * Every read goes through `app.vault.adapter`: Obsidian does not index folders
 * whose name starts with a dot, so the Vault API cannot see the `.agents/` or
 * `.icor-for-life/` fallbacks, and one reader serves both kinds of path. The pure half
 * (parsing a skill, summarising the schema, writing the prompt) takes strings,
 * so it is tested without a vault. */

export const AGENTS_FILE = 'AGENTS.md';
export const CLAUDE_FILE = 'CLAUDE.md';
/** Searched in this order; a skill name found in an earlier root is not read again from a later one. */
export const SKILL_ROOTS = ['_System/Skills', '.agents/skills', '.claude/skills'] as const;
/** The schema's home, and where vaults built before 2026-11-20 keep it. The first that parses wins. */
export const SCHEMA_PATH = '_System/schema.json';
export const LEGACY_SCHEMA_PATH = '.icor-for-life/schema.json';
export const SCHEMA_PATHS = [SCHEMA_PATH, LEGACY_SCHEMA_PATH] as const;
/** The hidden skill folders, which only the adapter can read. */
const HIDDEN_SKILL_ROOTS = ['.agents/skills', '.claude/skills'] as const;

/** The longest AGENTS.md sent whole. A longer one is cut, and the cut is said. */
export const AGENTS_CAP = 24_000;

export interface VaultSkill {
  name: string;
  description: string;
  /** Vault-relative path of the SKILL.md. */
  path: string;
}

export interface VaultContext {
  /** AGENTS.md (or CLAUDE.md), or null when the vault has neither. */
  instructions: { path: string; text: string } | null;
  skills: VaultSkill[];
  /** The schema's own text and its parsed type count, or null when absent or unreadable. */
  schema: { path: string; text: string; types: number } | null;
}

export const EMPTY_VAULT_CONTEXT: VaultContext = { instructions: null, skills: [], schema: null };

/** The few adapter calls this needs, so a test can hand in a map. */
export interface AdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/* ------------------------------------------------------------- pure half */

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/**
 * A skill's name and description from its frontmatter. The folder name stands
 * in for a missing `name`; a skill with no description is still listed, with
 * an empty one, because the file is there to be read.
 */
export function parseSkill(source: string, path: string): VaultSkill {
  const folder = path.split('/').slice(-2, -1)[0] ?? path;
  let name = folder;
  let description = '';
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    const head = end === -1 ? '' : text.slice(4, end);
    for (const line of head.split('\n')) {
      const m = /^(name|description):\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = unquote(m[2] ?? '');
      if (m[1] === 'name' && value) name = value;
      if (m[1] === 'description') description = value;
    }
  }
  return { name, description, path };
}

interface SchemaType {
  label?: unknown;
  description?: unknown;
  folder?: unknown;
  path?: unknown;
  required?: unknown;
  fields?: unknown;
  values?: unknown;
  links?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** How many note types the schema declares, or null when it is not a schema. */
export function schemaTypeCount(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { types?: unknown };
    if (typeof parsed.types !== 'object' || parsed.types === null) return null;
    return Object.keys(parsed.types).length;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The schema's top folders, name to one line. `folders` since ICOR for Life
 * 3.0; a schema written before it calls the same map `rooms`, which is read
 * the same way.
 */
export function schemaFolders(parsed: { folders?: unknown; rooms?: unknown }): Record<string, unknown> | null {
  return record(parsed.folders ?? parsed.rooms);
}

/**
 * The folders as lines: grouped under their stage when the schema has
 * `stages` (a stage with no folder says what it is instead), any folder no
 * stage names after them, and a flat list when there are no stages.
 */
function folderLines(folders: Record<string, unknown> | null, stages: Record<string, unknown> | null): string[] {
  const about = (name: string): string => {
    const what = folders?.[name];
    return `- ${name}: ${typeof what === 'string' ? what : ''}`.trimEnd();
  };
  if (!stages) return folders ? ['Folders:', ...Object.keys(folders).map(about)] : [];
  const lines = ['Folders, grouped by stage:'];
  const placed = new Set<string>();
  for (const [id, raw] of Object.entries(stages)) {
    const stage = record(raw) ?? {};
    const label = typeof stage.label === 'string' && stage.label ? stage.label : id;
    const own = strings(stage.folders);
    if (!own.length) {
      lines.push(`${label}: ${typeof stage.about === 'string' && stage.about ? stage.about : 'no folder'}`);
      continue;
    }
    lines.push(`${label}:`);
    for (const name of own) {
      placed.add(name);
      lines.push(about(name));
    }
  }
  const rest = Object.keys(folders ?? {}).filter((name) => !placed.has(name));
  if (rest.length) lines.push('Other folders:', ...rest.map(about));
  return lines;
}

/**
 * The schema as a short list a model can work from: the folders by stage,
 * then one line per note type with its folder, then its required fields,
 * other fields, allowed values and link targets. Returns null for text that
 * is not a schema.
 */
export function schemaSummary(text: string): string | null {
  let parsed: { types?: unknown; folders?: unknown; rooms?: unknown; stages?: unknown; common?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed.types !== 'object' || parsed.types === null) return null;
  const lines: string[] = [];
  const common = strings(parsed.common);
  if (common.length) lines.push(`Every note carries: ${common.join(', ')}.`);
  lines.push(...folderLines(schemaFolders(parsed), record(parsed.stages)));
  lines.push('Note types (type: folder):');
  for (const [id, raw] of Object.entries(parsed.types as Record<string, SchemaType>)) {
    const t = raw ?? {};
    const folder = typeof t.folder === 'string' ? t.folder : '';
    const path = typeof t.path === 'string' ? `/${t.path}` : '';
    const desc = typeof t.description === 'string' ? ` ${t.description}` : '';
    lines.push(`- ${id}: ${folder}${path}.${desc}`);
    const required = strings(t.required);
    const fields = strings(t.fields).filter((f) => !required.includes(f) && !common.includes(f));
    if (required.length) lines.push(`  required: ${required.join(', ')}`);
    if (fields.length) lines.push(`  fields: ${fields.join(', ')}`);
    if (typeof t.values === 'object' && t.values !== null) {
      for (const [field, allowed] of Object.entries(t.values as Record<string, unknown>)) {
        const list = strings(allowed);
        if (list.length) lines.push(`  ${field} is one of: ${list.join(', ')}`);
      }
    }
    if (typeof t.links === 'object' && t.links !== null) {
      const links: string[] = [];
      for (const [field, link] of Object.entries(t.links as Record<string, unknown>)) {
        const to = typeof link === 'object' && link !== null ? (link as { to?: unknown; many?: unknown }) : {};
        if (typeof to.to !== 'string') continue;
        links.push(`${field} -> ${to.to}${to.many === true ? ' (many)' : ''}`);
      }
      if (links.length) lines.push(`  links: ${links.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** What the empty state says the chat found, in the order a reader looks for it. */
export function vaultContextParts(ctx: VaultContext): string[] {
  const parts: string[] = [];
  if (ctx.instructions) parts.push(ctx.instructions.path);
  if (ctx.skills.length) parts.push(`${ctx.skills.length} ${ctx.skills.length === 1 ? 'skill' : 'skills'}`);
  if (ctx.schema) parts.push(`schema, ${ctx.schema.types} ${ctx.schema.types === 1 ? 'type' : 'types'}`);
  return parts;
}

/**
 * The own-key engine's system prompt: where the model is and what it can do,
 * then the vault's own words. AGENTS.md travels whole (up to the cap), the
 * skills as a list to read on demand, the schema as its summary.
 */
export function vaultSystemPrompt(ctx: VaultContext, tools: readonly string[]): string {
  const out: string[] = [
    `You are a chat assistant inside the person's Obsidian vault. You can use these tools, scoped to this vault: ${tools.join(', ')}. There is no shell and nothing outside the vault.`,
  ];
  if (ctx.instructions) {
    const text = ctx.instructions.text.trim();
    const cut = text.length > AGENTS_CAP;
    out.push(
      `The vault's own instructions, from ${ctx.instructions.path}. Follow them:\n\n${cut ? text.slice(0, AGENTS_CAP) : text}` +
        (cut ? `\n\n[${ctx.instructions.path} continues; read it with read_note for the rest.]` : ''),
    );
  }
  if (ctx.skills.length) {
    const rows = ctx.skills.map((s) => `- ${s.name} (${s.path})${s.description ? `: ${s.description}` : ''}`);
    out.push(
      'Skills in this vault. When a request matches one, read its SKILL.md with read_note first and follow it step by step:\n' +
        rows.join('\n'),
    );
  }
  if (ctx.schema) {
    const summary = schemaSummary(ctx.schema.text);
    if (summary) {
      out.push(
        `The vault's structure, from ${ctx.schema.path}. Use only these types, folders, fields and values; read the file with read_note for every detail:\n${summary}`,
      );
    }
  }
  return out.join('\n\n');
}

/**
 * True for a hidden path the own-key engine's `read_note` may read through the
 * adapter: the skill copies, and the schema and templates of a vault built
 * before `_System/` existed. Never an env file or anything else in a dot
 * folder, and never a path that climbs. (`_System/` itself is a visible
 * folder, so the Vault API reads it like any note.)
 */
export function isReadableVaultFile(path: string): boolean {
  if (!path || path.split('/').some((part) => part === '..' || part === '')) return false;
  if (/(^|\/)\.env(\.|$)/.test(path)) return false;
  if (path === LEGACY_SCHEMA_PATH) return true;
  if (path.startsWith('.icor-for-life/templates/') && path.endsWith('.md')) return true;
  return HIDDEN_SKILL_ROOTS.some((root) => path.startsWith(`${root}/`));
}

/* ------------------------------------------------------- the adapter half */

async function readIfThere(adapter: AdapterLike, path: string): Promise<string | null> {
  try {
    return (await adapter.exists(path)) ? await adapter.read(path) : null;
  } catch {
    return null;
  }
}

async function readSkills(adapter: AdapterLike): Promise<VaultSkill[]> {
  const seen = new Set<string>();
  const out: VaultSkill[] = [];
  for (const root of SKILL_ROOTS) {
    let folders: string[] = [];
    try {
      if (!(await adapter.exists(root))) continue;
      folders = (await adapter.list(root)).folders;
    } catch {
      continue;
    }
    for (const folder of [...folders].sort()) {
      const path = `${folder}/SKILL.md`;
      const source = await readIfThere(adapter, path);
      if (source === null) continue;
      const skill = parseSkill(source, path);
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
  }
  return out;
}

/** Read what the vault says about itself. Never throws; a missing part is null or empty. */
async function readSchema(adapter: AdapterLike): Promise<VaultContext['schema']> {
  for (const path of SCHEMA_PATHS) {
    const text = await readIfThere(adapter, path);
    const types = text === null ? null : schemaTypeCount(text);
    if (text !== null && types !== null) return { path, text, types };
  }
  return null;
}

export async function readVaultContext(adapter: AdapterLike): Promise<VaultContext> {
  const [agents, claude, skills, schema] = await Promise.all([
    readIfThere(adapter, AGENTS_FILE),
    readIfThere(adapter, CLAUDE_FILE),
    readSkills(adapter),
    readSchema(adapter),
  ]);
  const instructions =
    agents !== null && agents.trim()
      ? { path: AGENTS_FILE, text: agents }
      : claude !== null && claude.trim()
        ? { path: CLAUDE_FILE, text: claude }
        : null;
  return { instructions, skills, schema };
}
