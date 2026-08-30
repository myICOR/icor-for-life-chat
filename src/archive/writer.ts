/* Writing a session back into the vault.
 *
 * The archive is the part of this plugin that outlives the plugin: a folder a
 * human can read, and a manifest complete enough that the conversation can be
 * resumed from the folder alone. That is why the manifest carries EVERY session
 * id the conversation ever had rather than only the current one - a fork or a
 * resume mints a new id, and a folder that records only the latest becomes
 * unresumable the moment the thread was forked once.
 *
 * Rewritten in full after every completed turn. Cheap, idempotent, and a crash
 * costs the last turn instead of the session. */

import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { ChatEvent } from '../model/types';
import type { SubagentTranscript } from '../state/subagents';
import {
  ARCHIVE_SCHEMA, MANIFEST_FILE, LEGACY_MANIFEST_FILE, expiredFolders, folderName,
  isOurManifest, looksLikeOurArchive, shortId,
} from './naming';
import type { ArchiveManifest } from './naming';

export interface ArchiveInput {
  title: string;
  startedAt: number;
  sessionIds: string[];
  cwd: string;
  model: string | null;
  permissionMode: string;
  turns: Array<{ role: 'user' | 'assistant'; text: string; at: number }>;
  events: ChatEvent[];
  subagents: SubagentTranscript[];
  tokens: number;
  pluginVersion: string;
  sdkVersion: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function subagentFileName(transcript: SubagentTranscript): string {
  const safe = transcript.agentType.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'agent';
  return `${safe}-${transcript.agentId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}.md`;
}

function renderConversation(input: ArchiveInput, folder: string): string {
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(input.title)}`,
    `date: ${iso(input.startedAt).slice(0, 10)}`,
    'source: icor-for-life-chat',
    `session_ids: [${input.sessionIds.map((id) => `"${id}"`).join(', ')}]`,
    '---',
    '',
    `# ${input.title}`,
    '',
  ];
  for (const turn of input.turns) {
    lines.push(turn.role === 'user' ? '## You' : '## The team');
    lines.push('');
    lines.push(turn.text.trim());
    lines.push('');
  }
  if (input.subagents.length > 0) {
    lines.push('## Subagents');
    lines.push('');
    for (const transcript of input.subagents) {
      const file = subagentFileName(transcript).replace(/\.md$/, '');
      lines.push(
        `- [[${folder}/subagents/${file}|${transcript.agentType}]] - ${transcript.description || 'task'} (${transcript.status})`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderSubagent(transcript: SubagentTranscript): string {
  const lines: string[] = [
    '---',
    `agent: ${JSON.stringify(transcript.agentType)}`,
    `status: ${transcript.status}`,
    `started: ${iso(transcript.startedAt)}`,
    '---',
    '',
    `# ${transcript.agentType}`,
    '',
    transcript.task ? `> ${transcript.task.replace(/\n/g, '\n> ')}` : '',
    '',
  ];
  for (const event of transcript.events) {
    if (event.kind === 'text-final' && event.text.trim()) {
      lines.push(event.text.trim(), '');
    } else if (event.kind === 'tool-call') {
      lines.push(`- \`${event.name}\` ${event.target}`.trimEnd());
    }
  }
  return lines.join('\n');
}

export class ArchiveWriter {
  constructor(
    private readonly app: App,
    private readonly root: string,
  ) {}

  private async ensureFolder(path: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const parts = normalizePath(path).split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
  }

  /**
   * The folder already holding this session, if there is one.
   *
   * A conversation's archive is identified by its SESSION, never by the tab
   * that happened to write it. Two tabs on one session used to mint two
   * folders, each holding only the slice that tab had seen: measured on disk as
   * three folders for one session id, two messages each. Reusing the existing
   * folder keeps one conversation in one place, and keeps its name stable even
   * though a later tab would have titled it differently.
   */
  private async folderForSession(sessionId: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.root))) return null;
    const suffix = `_${shortId(sessionId)}`;
    const listing = await adapter.list(this.root);
    for (const path of listing.folders) {
      const name = path.split('/').pop() ?? '';
      if (!looksLikeOurArchive(name) || !name.endsWith(suffix)) continue;
      // Name shape alone is not proof. Only a folder carrying our own manifest
      // for this same session is ours to overwrite.
      const manifest = await this.readManifest(path);
      if (manifest?.sessionIds.includes(sessionId)) return name;
    }
    return null;
  }

  /** Write (or rewrite) the whole session folder. Returns its vault path. */
  async write(input: ArchiveInput): Promise<string> {
    const primary = input.sessionIds[input.sessionIds.length - 1] ?? '';
    const name =
      (await this.folderForSession(primary)) ?? folderName(input.startedAt, input.title, primary);
    const folder = normalizePath(`${this.root}/${name}`);
    await this.ensureFolder(folder);
    const adapter = this.app.vault.adapter;

    const subagentFiles: string[] = [];
    if (input.subagents.length > 0) {
      await this.ensureFolder(`${folder}/subagents`);
      for (const transcript of input.subagents) {
        const file = subagentFileName(transcript);
        await adapter.write(`${folder}/subagents/${file}`, renderSubagent(transcript));
        subagentFiles.push(`subagents/${file}`);
      }
    }

    await adapter.write(`${folder}/conversation.md`, renderConversation(input, folder));
    await adapter.write(
      `${folder}/transcript.json`,
      JSON.stringify({ events: input.events }, null, 2),
    );

    const manifest: ArchiveManifest = {
      schema: ARCHIVE_SCHEMA,
      pluginVersion: input.pluginVersion,
      sdkVersion: input.sdkVersion,
      title: input.title,
      startedAt: iso(input.startedAt),
      endedAt: iso(Date.now()),
      vaultPath: input.cwd,
      sessionIds: input.sessionIds,
      resume: {
        sessionId: primary,
        cwd: input.cwd,
        model: input.model,
        permissionMode: input.permissionMode,
      },
      files: {
        transcript: 'transcript.json',
        conversation: 'conversation.md',
        subagents: subagentFiles,
      },
      counts: {
        messages: input.turns.length,
        subagents: input.subagents.length,
        tokens: input.tokens,
      },
    };
    await adapter.write(`${folder}/${MANIFEST_FILE}`, JSON.stringify(manifest, null, 2));
    return folder;
  }

  async readManifest(folder: string): Promise<ArchiveManifest | null> {
    const adapter = this.app.vault.adapter;
    // The current name first, then the legacy one, so an older folder still reads.
    for (const file of [MANIFEST_FILE, LEGACY_MANIFEST_FILE]) {
      const path = `${folder}/${file}`;
      if (!(await adapter.exists(path))) continue;
      try {
        const parsed: unknown = JSON.parse(await adapter.read(path));
        if (isOurManifest(parsed)) return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Delete only folders that match our own name shape AND carry our own
   * manifest. Anything a user parked in this folder is never touched.
   */
  async sweep(retentionDays: number, now = Date.now()): Promise<string[]> {
    if (retentionDays <= 0) return [];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.root))) return [];
    const listing = await adapter.list(this.root);
    const candidates: Array<{ name: string; endedAt: number }> = [];
    for (const folderPath of listing.folders) {
      const name = folderPath.split('/').pop() ?? '';
      if (!looksLikeOurArchive(name)) continue;
      const manifest = await this.readManifest(folderPath);
      if (!manifest) continue;
      candidates.push({ name, endedAt: Date.parse(manifest.endedAt) || 0 });
    }
    const doomed = expiredFolders(candidates, retentionDays, now);
    for (const name of doomed) {
      await adapter.rmdir(`${this.root}/${name}`, true);
    }
    return doomed;
  }
}
