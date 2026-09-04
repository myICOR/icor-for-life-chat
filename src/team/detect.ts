/* Is there an AI team in this vault, and who is on it.
 *
 * The team folder is the ICOR for Life Scaffold's `06 AI Team/Agents`. An
 * agent is a direct subfolder holding an `AGENT.md`; that file is the agent's
 * contract and the one thing every agent folder has. Folders starting with an
 * underscore are archives (`_retired`), and `Agent 01` is the hiring template
 * the scaffold's SOP-1007 copies, so neither is a person on the team.
 *
 * Nothing here is cached across calls. Detection walks the folder tree the
 * vault already holds in memory, which is cheap at fifty agents, and a cache
 * is one more thing that can be stale when a folder is renamed under it. */

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';

export const TEAM_ROOT = '06 AI Team';
export const TEAM_AGENTS_FOLDER = `${TEAM_ROOT}/Agents`;
export const TEAM_AVATARS_FOLDER = `${TEAM_ROOT}/AI Team Knowledge/Avatars`;
export const TEAM_KNOWLEDGE_FOLDER = `${TEAM_ROOT}/AI Team Knowledge`;

export interface TeamAgent {
  name: string;
  /** Lowercased name. What a `subagent_type` is matched against. */
  slug: string;
  /** Vault-relative folder. */
  folder: string;
  role: string | null;
  /** `<folder>/<Name>.md` when it exists: the user-facing bio. */
  bioPath: string | null;
  /** The first avatar found, or null. Never a placeholder path. */
  avatarPath: string | null;
}

export interface TeamRoster {
  folder: string;
  agents: TeamAgent[];
}

function isTemplateOrArchive(name: string): boolean {
  return name.startsWith('_') || name === 'Agent 01';
}

function fileAt(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

function roleOf(app: App, contract: TFile): string | null {
  const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(contract)?.frontmatter;
  const role: unknown = frontmatter?.role;
  return typeof role === 'string' && role.trim() ? role.trim() : null;
}

/** The roster, or null when the vault has no team folder at all. */
export function detectTeam(app: App): TeamRoster | null {
  const root = app.vault.getAbstractFileByPath(TEAM_AGENTS_FOLDER);
  if (!(root instanceof TFolder)) return null;
  const agents: TeamAgent[] = [];
  for (const child of root.children) {
    if (!(child instanceof TFolder) || isTemplateOrArchive(child.name)) continue;
    const contract = fileAt(app, `${child.path}/AGENT.md`);
    if (!contract) continue;
    const name = child.name;
    const slug = name.toLowerCase();
    const bio = fileAt(app, `${child.path}/${name}.md`);
    const avatar =
      fileAt(app, `${child.path}/avatar.png`) ?? fileAt(app, `${TEAM_AVATARS_FOLDER}/${slug}.png`);
    agents.push({
      name,
      slug,
      folder: child.path,
      role: roleOf(app, contract),
      bioPath: bio ? bio.path : null,
      avatarPath: avatar ? avatar.path : null,
    });
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { folder: root.path, agents };
}

/** A URL the renderer can put in an <img>. */
export function avatarUrl(app: App, path: string): string {
  return app.vault.adapter.getResourcePath(path);
}

/** True when a vault change can have changed the roster. */
export function isTeamPath(path: string): boolean {
  return path === TEAM_ROOT || path.startsWith(`${TEAM_ROOT}/`);
}
