/* The one translator between Agent Client Protocol session updates and the
 * plugin's own ChatEvent union. A spec change touches this file and nothing
 * else.
 *
 * MEASURED 2026-09-04 with `tools/acp-probe.mjs` against Gemini CLI 0.58.0
 * (`test/fixtures/acp-gemini-recorded.json`): `initialize` answers
 * `{protocolVersion: 1, agentInfo, agentCapabilities: {loadSession: true,
 * promptCapabilities: {image, audio, embeddedContext}, mcpCapabilities},
 * authMethods: [...]}`; `session/new {cwd, mcpServers}` was refused with
 * `-32000 Gemini API key is missing or not configured` because the probe
 * signs nothing in. No `session/update` was therefore seen on this machine,
 * and everything below the handshake is written from the protocol
 * specification (https://agentclientprotocol.com/protocol/v1/, schema v1):
 *
 *   session/update {sessionId, update: {sessionUpdate, ...}} with
 *     agent_message_chunk {content: {type: 'text', text}}
 *     agent_thought_chunk {content: {type: 'text', text}}
 *     user_message_chunk (the agent echoing the prompt; ignored)
 *     tool_call {toolCallId, title, kind, status, content?, locations?, rawInput?}
 *     tool_call_update {toolCallId, status?, title?, content?, rawOutput?}
 *     plan {entries: [{content, priority, status}]}
 *     available_commands_update, current_mode_update (no event)
 *   session/request_permission {sessionId, toolCall, options: [{optionId, name, kind}]}
 *     answered with {outcome: {outcome: 'selected', optionId}} or {outcome: 'cancelled'}
 *   session/prompt -> {stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests'
 *     | 'refusal' | 'cancelled'}
 *
 * USAGE IS NOT IN THE PROTOCOL. ACP v1 standardises no token count, and
 * neither Gemini CLI's handshake nor the specification names one; adapters
 * that publish it do so in `_meta`, each differently. So a turn end from this
 * translator carries a usage of zeros, and zeros here mean UNMEASURED: the
 * statusline prints no token digit for a total of zero (`model/facts.ts`),
 * the context ring stays absent because no window was reported, and no
 * cached-token subtraction is applied because no cached count arrives. The
 * day an agent publishes usage in a standard field, this is the place.
 *
 * Two rules hold everywhere, the same two every translator keeps:
 *   - An unrecognised update yields no events. It never throws.
 *   - A tool row is keyed by the agent's own `toolCallId`, so the permission
 *     request (which names the call before it runs) and the later updates
 *     land on one row. */

import type { ChatEvent, PermissionModeName } from '../../model/types';
import type { ProviderId } from '../types';
import { relativeTo, resultOutput, toolPurpose } from '../tooling';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/** The text inside a content block, or the joined text of a content list. */
export function contentText(content: unknown): string {
  // An array is an object too; the list case has to be asked first.
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join('\n');
  if (isRecord(content)) {
    if (content.type === 'text') return str(content.text) ?? '';
    if (content.type === 'content' && isRecord(content.content)) return contentText(content.content);
    if (content.type === 'diff') {
      const path = str(content.path) ?? '';
      const oldText = str(content.oldText) ?? '';
      const newText = str(content.newText) ?? '';
      return `${path}\n--- old\n${oldText}\n+++ new\n${newText}`;
    }
    return '';
  }
  return '';
}

/** The plugin's tool name for an ACP tool kind, so the rows read like Claude's. */
export function acpToolName(kind: unknown): string {
  switch (kind) {
    case 'read':
      return 'Read';
    case 'edit':
      return 'Edit';
    case 'delete':
    case 'move':
    case 'execute':
      return 'Bash';
    case 'search':
      return 'Grep';
    case 'fetch':
      return 'WebFetch';
    case 'think':
      return 'TodoWrite';
    default:
      return 'tool';
  }
}

/** The first file the call names, from `locations` or `rawInput`, or null. */
function locationOf(call: Record<string, unknown>): string | null {
  const locations = Array.isArray(call.locations) ? call.locations.filter(isRecord) : [];
  const first = locations[0];
  if (first && str(first.path)) return str(first.path);
  const raw = isRecord(call.rawInput) ? call.rawInput : null;
  if (raw) {
    for (const key of ['file_path', 'path', 'filePath', 'absolute_path']) {
      const v = str(raw[key]);
      if (v) return v;
    }
  }
  return null;
}

/**
 * The tool vocabulary for an ACP tool call: name, the input record
 * `toolPurpose` reads, the raw target the row opens onto, and the sentence.
 * The agent's own `title` is a sentence already ("Run `ls -la`", "Read
 * notes/x.md"), so it is the purpose whenever the kind carries no path of
 * its own; a path-shaped kind prints the plugin's own sentence so a Read
 * from Gemini reads exactly like a Read from Claude.
 */
export function acpToolInput(call: Record<string, unknown>, cwd: string): { name: string; input: Record<string, unknown>; target: string; purpose: string } {
  const name = acpToolName(call.kind);
  const title = str(call.title) ?? '';
  const path = locationOf(call);
  const raw = isRecord(call.rawInput) ? call.rawInput : {};
  if ((name === 'Read' || name === 'Edit') && path) {
    const input = { ...raw, file_path: path };
    return { name, input, target: relativeTo(path, cwd), purpose: toolPurpose(name, input, cwd) };
  }
  if (name === 'Bash') {
    const command = str(raw.command) ?? str(raw.cmd) ?? title;
    const input = { ...raw, command, ...(title ? { description: title } : {}) };
    return { name, input, target: command, purpose: title || toolPurpose('Bash', input, cwd) };
  }
  if (name === 'Grep') {
    const pattern = str(raw.pattern) ?? str(raw.query) ?? title;
    const input = { ...raw, pattern, ...(path ? { path } : {}) };
    return { name, input, target: pattern, purpose: title || toolPurpose('Grep', input, cwd) };
  }
  if (name === 'WebFetch') {
    const url = str(raw.url) ?? title;
    const input = { ...raw, url };
    return { name, input, target: url, purpose: title || toolPurpose('WebFetch', input, cwd) };
  }
  if (name === 'TodoWrite') {
    return { name, input: raw, target: '', purpose: title || 'Updated the plan' };
  }
  return { name: title ? 'tool' : name, input: raw, target: title, purpose: title || 'Used a tool' };
}

/** The plugin's mode that an agent mode id most plausibly means, by name. */
export function pluginModeFor(modeId: string): PermissionModeName | null {
  const id = modeId.toLowerCase();
  if (/plan|read/.test(id)) return 'plan';
  if (/yolo|bypass|full|danger|auto[-_]?approve/.test(id)) return 'bypassPermissions';
  if (/auto[-_]?edit|accept/.test(id)) return 'acceptEdits';
  if (/default|ask|normal|standard|interactive/.test(id)) return 'default';
  return null;
}

/**
 * The agent's mode id for one of the plugin's four, chosen from the modes the
 * agent advertised, or null when the agent has no such mode. Null is the
 * honest answer the session reports; it never picks a neighbour.
 */
export function agentModeFor(mode: PermissionModeName, available: ReadonlyArray<{ id: string }>): string | null {
  for (const m of available) {
    if (pluginModeFor(m.id) === mode) return m.id;
  }
  return null;
}

export interface AcpSessionFacts {
  sessionId: string;
  cwd: string;
  currentModeId: string | null;
  availableModes: Array<{ id: string; name: string }>;
  provider: ProviderId;
}

export class AcpNormalizer {
  private textBlock: { id: string; text: string } | null = null;
  private thoughtBlock: { id: string; text: string } | null = null;
  private readonly tools = new Set<string>();
  private lastText = '';
  private seq = 0;
  private turnStartedAt = 0;

  constructor(private readonly cwd: string) {}

  /** The `session` event, from a session/new or session/load answer. */
  sessionEvent(facts: AcpSessionFacts, requested: PermissionModeName): ChatEvent[] {
    const current = facts.currentModeId ? pluginModeFor(facts.currentModeId) : null;
    return [{
      kind: 'session',
      sessionId: facts.sessionId,
      // ACP publishes no model name on the handshake; an empty string is the
      // plugin's word for "not reported", and the trigger then reads the
      // runtime's name with "default model".
      model: '',
      cwd: facts.cwd,
      permissionMode: current ?? requested,
      slashCommands: [],
      contextWindow: null,
      provider: facts.provider,
      stream: null,
    }];
  }

  /** A prompt began: the clock the turn end measures from. */
  promptStarted(now = Date.now()): void {
    this.turnStartedAt = now;
  }

  /** Translate one `session/update`. Never throws; unknown shapes return []. */
  update(update: unknown): ChatEvent[] {
    try {
      return this.dispatch(isRecord(update) ? update : {});
    } catch {
      return [];
    }
  }

  private dispatch(u: Record<string, unknown>): ChatEvent[] {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        return this.textChunk(contentText(u.content));
      case 'agent_thought_chunk':
        return this.thoughtChunk(contentText(u.content));
      case 'tool_call':
        return this.toolCall(u);
      case 'tool_call_update':
        return this.toolUpdate(u);
      case 'plan':
        return this.plan(u);
      default:
        return [];
    }
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}:${this.seq}`;
  }

  private textChunk(text: string): ChatEvent[] {
    if (!text) return [];
    const out: ChatEvent[] = this.closeThought();
    if (!this.textBlock) {
      this.textBlock = { id: this.nextId('acp-text'), text: '' };
      out.push({ kind: 'text-open', blockId: this.textBlock.id, stream: null });
    }
    this.textBlock.text += text;
    out.push({ kind: 'text-delta', blockId: this.textBlock.id, text, stream: null });
    return out;
  }

  private thoughtChunk(text: string): ChatEvent[] {
    if (!text) return [];
    const out: ChatEvent[] = this.closeText();
    if (!this.thoughtBlock) {
      this.thoughtBlock = { id: this.nextId('acp-thought'), text: '' };
      out.push({ kind: 'thinking-open', blockId: this.thoughtBlock.id, stream: null });
    }
    this.thoughtBlock.text += text;
    out.push({ kind: 'thinking-delta', blockId: this.thoughtBlock.id, text, stream: null });
    return out;
  }

  /* A tool call between two runs of text is a paragraph boundary: the text so
     far is final, and the next chunk opens a new block. Holding one block open
     across a tool row would put the tool row above text that came before it. */
  private closeText(): ChatEvent[] {
    const block = this.textBlock;
    if (!block) return [];
    this.textBlock = null;
    this.lastText = block.text;
    return [{ kind: 'text-final', blockId: block.id, text: block.text, stream: null }];
  }

  private closeThought(): ChatEvent[] {
    const block = this.thoughtBlock;
    if (!block) return [];
    this.thoughtBlock = null;
    return [{ kind: 'thinking-final', blockId: block.id, text: block.text, stream: null }];
  }

  private toolCall(u: Record<string, unknown>): ChatEvent[] {
    const id = str(u.toolCallId);
    if (!id) return [];
    const out: ChatEvent[] = [...this.closeText(), ...this.closeThought()];
    if (!this.tools.has(id)) {
      this.tools.add(id);
      const { name, input, target, purpose } = acpToolInput(u, this.cwd);
      out.push({ kind: 'tool-call', toolUseId: id, name, target, input, purpose, stream: null });
    }
    const status = str(u.status);
    if (status === 'completed' || status === 'failed') out.push(this.toolResult(id, u, status));
    return out;
  }

  private toolUpdate(u: Record<string, unknown>): ChatEvent[] {
    const id = str(u.toolCallId);
    if (!id) return [];
    const out: ChatEvent[] = [];
    // An update for a call the agent never announced (a replay, or an agent
    // that skips the first frame) still gets its row.
    if (!this.tools.has(id)) out.push(...this.toolCall({ ...u, status: 'in_progress' }));
    const status = str(u.status);
    if (status === 'completed' || status === 'failed') out.push(this.toolResult(id, u, status));
    return out;
  }

  private toolResult(id: string, u: Record<string, unknown>, status: 'completed' | 'failed'): ChatEvent {
    const raw = u.rawOutput;
    const text = contentText(u.content) || (typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : JSON.stringify(raw, null, 2));
    return { kind: 'tool-result', toolUseId: id, ok: status === 'completed', detail: firstLine(text), output: resultOutput(text), stream: null };
  }

  /* The agent's plan is a tool row of its own, the same row TodoWrite gets
     from Claude: one call, one result holding the entries, no prose. */
  private plan(u: Record<string, unknown>): ChatEvent[] {
    const entries = Array.isArray(u.entries) ? u.entries.filter(isRecord) : [];
    const text = entries
      .map((e) => `[${str(e.status) ?? 'pending'}] ${str(e.content) ?? ''}`)
      .join('\n');
    const id = this.nextId('acp-plan');
    return [
      ...this.closeText(),
      { kind: 'tool-call', toolUseId: id, name: 'TodoWrite', target: '', input: { entries }, purpose: 'Updated the plan', stream: null },
      { kind: 'tool-result', toolUseId: id, ok: true, detail: `${entries.length} step${entries.length === 1 ? '' : 's'}`, output: resultOutput(text), stream: null },
    ];
  }

  /**
   * The prompt answered. `cancelled` is the plugin's aborted; anything else
   * is a turn end whose text is the last block and whose usage is zeros,
   * which the statusline reads as unmeasured (see the header).
   */
  promptDone(stopReason: string | null, now = Date.now()): ChatEvent[] {
    const out: ChatEvent[] = [...this.closeThought(), ...this.closeText()];
    const text = this.lastText;
    this.lastText = '';
    this.tools.clear();
    const durationMs = this.turnStartedAt > 0 ? Math.max(0, now - this.turnStartedAt) : 0;
    this.turnStartedAt = 0;
    if (stopReason === 'cancelled') {
      out.push({ kind: 'aborted', stream: null });
      return out;
    }
    if (stopReason === 'refusal') {
      out.push({ kind: 'error', message: 'The agent refused this prompt.', stream: null });
    }
    out.push({
      kind: 'turn-end',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUsd: 0 },
      contextWindow: null,
      durationMs,
      isError: stopReason === 'refusal',
      text,
      stream: null,
    });
    return out;
  }

  /** A failed prompt request: the agent's own words, then a closed turn. */
  promptFailed(message: string, now = Date.now()): ChatEvent[] {
    const out: ChatEvent[] = [...this.closeThought(), ...this.closeText()];
    const durationMs = this.turnStartedAt > 0 ? Math.max(0, now - this.turnStartedAt) : 0;
    this.turnStartedAt = 0;
    this.lastText = '';
    this.tools.clear();
    out.push({ kind: 'error', message, stream: null });
    out.push({
      kind: 'turn-end',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUsd: 0 },
      contextWindow: null,
      durationMs,
      isError: true,
      text: '',
      stream: null,
    });
    return out;
  }
}

/** The permission request's tool call as the plugin's approval vocabulary. */
export function approvalOf(params: unknown, cwd: string): { toolUseId: string; toolName: string; target: string; purpose: string; title: string } | null {
  if (!isRecord(params)) return null;
  const call = isRecord(params.toolCall) ? params.toolCall : null;
  if (!call) return null;
  const id = str(call.toolCallId);
  if (!id) return null;
  const shaped = acpToolInput(call, cwd);
  return { toolUseId: id, toolName: shaped.name, target: shaped.target, purpose: shaped.purpose, title: str(call.title) ?? `The agent wants to run ${shaped.name}` };
}

/** The option id the agent offered for the plugin's answer, or null for a cancel. */
export function optionFor(choice: 'deny' | 'allow-once' | 'allow-always', options: unknown): string | null {
  const rows = Array.isArray(options) ? options.filter(isRecord) : [];
  const byKind = (kind: string): string | null => {
    const row = rows.find((r) => r.kind === kind);
    return row ? str(row.optionId) : null;
  };
  switch (choice) {
    case 'allow-always':
      return byKind('allow_always') ?? byKind('allow_once');
    case 'allow-once':
      return byKind('allow_once') ?? byKind('allow_always');
    default:
      return byKind('reject_once') ?? byKind('reject_always');
  }
}
