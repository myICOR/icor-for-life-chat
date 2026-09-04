/* One click, one team. Writes the bundled scaffold agents into a vault that
 * has no `06 AI Team` yet.
 *
 * NEVER OVERWRITES. Every path is checked before it is written and an existing
 * file is reported as skipped, so running this in a vault that already has a
 * partial team adds what is missing and touches nothing that is there. The
 * report is counts and paths, both measured, so the notice the user sees after
 * the click is what happened and not what was intended. */

import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { TEAM_BUNDLE } from './bundle';
import { TEAM_AGENTS_FOLDER, TEAM_AVATARS_FOLDER, TEAM_KNOWLEDGE_FOLDER, TEAM_ROOT } from './detect';

export interface SetupReport {
  /** Agents the bundle carries, whether or not their files were new. */
  agents: number;
  created: string[];
  skipped: string[];
  /** False when the bundle itself was partial; the notice says so. */
  complete: boolean;
}

/** The folders every scaffold team needs around it. */
export const TEAM_FOLDERS: readonly string[] = [
  TEAM_AGENTS_FOLDER,
  TEAM_KNOWLEDGE_FOLDER,
  `${TEAM_KNOWLEDGE_FOLDER}/SOPs`,
  `${TEAM_KNOWLEDGE_FOLDER}/Guidelines`,
  `${TEAM_KNOWLEDGE_FOLDER}/Session Logs`,
  `${TEAM_KNOWLEDGE_FOLDER}/Tasks/open`,
  `${TEAM_KNOWLEDGE_FOLDER}/Tasks/in-progress`,
  `${TEAM_KNOWLEDGE_FOLDER}/Tasks/done`,
  TEAM_AVATARS_FOLDER,
  `${TEAM_ROOT}/AI Sessions`,
];

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function setupTeam(app: App): Promise<SetupReport> {
  const report: SetupReport = { agents: TEAM_BUNDLE.agents.length, created: [], skipped: [], complete: TEAM_BUNDLE.complete };
  const vault = app.vault;

  const ensureFolder = async (path: string): Promise<void> => {
    const parts = normalizePath(path).split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (vault.getAbstractFileByPath(current)) continue;
      await vault.createFolder(current);
    }
  };
  const writeText = async (path: string, text: string): Promise<void> => {
    const p = normalizePath(path);
    if (vault.getAbstractFileByPath(p)) {
      report.skipped.push(p);
      return;
    }
    await vault.create(p, text);
    report.created.push(p);
  };
  const writeBinary = async (path: string, base64: string): Promise<void> => {
    const p = normalizePath(path);
    if (vault.getAbstractFileByPath(p)) {
      report.skipped.push(p);
      return;
    }
    await vault.createBinary(p, bytesOf(base64));
    report.created.push(p);
  };

  for (const folder of TEAM_FOLDERS) await ensureFolder(folder);

  for (const agent of TEAM_BUNDLE.agents) {
    const folder = `${TEAM_AGENTS_FOLDER}/${agent.name}`;
    await ensureFolder(folder);
    await writeText(`${folder}/AGENT.md`, agent.agent);
    await writeText(`${folder}/${agent.name}.md`, agent.bio);
    await writeBinary(`${folder}/avatar.png`, agent.avatarBase64);
    // The bios embed `![[<slug>.png|240]]`, which resolves through this folder.
    await writeBinary(`${TEAM_AVATARS_FOLDER}/${agent.slug}.png`, agent.avatarBase64);
  }
  await writeText(`${TEAM_AGENTS_FOLDER}/agent-index.md`, TEAM_BUNDLE.agentIndex);

  return report;
}

/** The one line the notice says. Counts only, all measured. */
export function setupSummary(report: SetupReport): string {
  const head = `${report.agents} agents, ${report.created.length} files created, ${report.skipped.length} skipped.`;
  return report.complete ? head : `${head} This build carries a partial team bundle.`;
}
