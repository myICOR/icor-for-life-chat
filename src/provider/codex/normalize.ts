/* The one translator between the Codex App Server's frames and the plugin's
 * own ChatEvent union. A Codex upgrade touches this file and nothing else.
 *
 * MEASURED 2026-09-04 against codex-cli 0.143.0 with `tools/codex-probe.mjs`
 * (recording in test/fixtures/codex-recorded-turn.json) and the server's own
 * schema (`codex app-server generate-json-schema`). What was seen:
 *
 *   client -> server, requests that exist and answered:
 *     initialize {clientInfo, capabilities}     -> {userAgent, codexHome, platformOs}
 *     initialized                               (notification, sent once after)
 *     thread/start {cwd, approvalPolicy, sandbox} -> {thread, model, modelProvider, ...}
 *     thread/resume {threadId, cwd, ...}        (schema; same response shape)
 *     turn/start {threadId, input:[{type:'text',text}], approvalPolicy, sandboxPolicy}
 *                                               -> {turn:{id, status:'inProgress'}}
 *     turn/steer {threadId, expectedTurnId, input}  (schema)
 *     turn/interrupt {threadId, turnId}         -> error -32600 "no active turn to interrupt"
 *                                                  when the turn already ended (seen)
 *     thread/list {cwd, limit, sortKey}         -> {data:[thread...], nextCursor}
 *     thread/read {threadId, includeTurns}      -> {thread:{turns:[{id, items:[...]}]}}
 *     thread/fork {threadId}                    -> {thread:{id, forkedFromId}}
 *     thread/name/set {threadId, name}          -> {}
 *     model/list {limit}                        -> {data:[{id, model, displayName, description,
 *                                                  supportedReasoningEfforts:[{reasoningEffort}],
 *                                                  defaultReasoningEffort, isDefault, hidden}]}
 *                                                  (served from cache while signed OUT)
 *     account/read {}                           -> {account: null, requiresOpenaiAuth: true}
 *                                                  when signed out; {account:{type:'chatgpt',
 *                                                  planType, email}} per schema when in
 *     account/rateLimits/read {}                -> error -32603 with the HTTP 401 text when
 *                                                  signed out; {rateLimits:{primary:{usedPercent,
 *                                                  resetsAt, windowDurationMins}, secondary,
 *                                                  planType}} per schema when in
 *
 *   server -> client, notifications seen on a turn:
 *     thread/started {thread}
 *     thread/status/changed {threadId, status:{type:'active'|'idle'|'systemError'}}
 *     turn/started {threadId, turn:{id}}
 *     item/started {item:{type:'userMessage', content:[{type:'text', text}]}, turnId}
 *     item/completed {item, turnId, completedAtMs}
 *     error {error:{message, codexErrorInfo}, threadId, turnId, willRetry}
 *     turn/completed {threadId, turn:{id, status:'completed'|'failed'|'interrupted',
 *                     error:{message}|null, durationMs}}
 *     mcpServer/startupStatus/updated, remoteControl/status/changed (ignored)
 *   and per the schema for a turn with model output (not reachable on this
 *   machine on 2026-09-04: the ChatGPT refresh token was revoked, every turn
 *   failed 401 before the model was reached; `codex login` is Tom's to run):
 *     item/started {item:{type:'agentMessage'|'reasoning'|'commandExecution'|
 *                  'fileChange'|'mcpToolCall'|'dynamicToolCall'|'plan', id}}
 *     item/agentMessage/delta {itemId, delta}
 *     item/reasoning/textDelta | item/reasoning/summaryTextDelta {itemId, delta}
 *     item/commandExecution/outputDelta {itemId, delta}   (ignored; the result
 *                  comes whole on item/completed)
 *     thread/tokenUsage/updated {threadId, turnId, tokenUsage:{total:{inputTokens,
 *                  cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens},
 *                  last, modelContextWindow}}
 *     account/rateLimits/updated {rateLimits}
 *
 *   server -> client, REQUESTS (carry an id, need an answer):
 *     item/commandExecution/requestApproval {itemId, threadId, turnId, command,
 *                  commandActions, cwd, reason}   -> {decision:'accept'|'acceptForSession'|'decline'}
 *     item/fileChange/requestApproval {itemId, threadId, turnId, reason, grantRoot}
 *                                                  -> {decision: same}
 *     item/permissions/requestApproval {itemId, permissions, reason}
 *                                                  -> {permissions, scope:'turn'|'session'}
 *
 * Methods Axon's study named that 0.143.0 does NOT have: none of the ones the
 * provider uses. `thread/tokenUsage/updated` and `account/rateLimits/read`
 * exist as named. There is no per-thread mode setter; modes ride each turn.
 *
 * Two rules hold everywhere below, the same two the Claude translator keeps:
 *   - An unrecognised frame yields no events. It never throws.
 *   - Tool calls are rendered from ITEMS, keyed by the item id, so an approval
 *     request (which names the item before it starts) and the later item
 *     frames land on one row. */

import type { ChatEvent, RateLimitFacts, TurnUsage } from '../../model/types';
import { relativeTo, resultOutput, toolPurpose } from '../tooling';
import type { CodexMode } from './modes';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/** The plugin's vocabulary for a Codex item, so the rows read like Claude's. */
export function codexToolName(item: Record<string, unknown>): string {
  switch (item.type) {
    case 'commandExecution':
      return 'Bash';
    case 'fileChange':
      return 'Edit';
    case 'mcpToolCall':
      return str(item.tool) ?? 'tool';
    case 'dynamicToolCall':
      return str(item.tool) ?? 'tool';
    case 'plan':
      return 'TodoWrite';
    default:
      return 'tool';
  }
}

/**
 * The input record the plugin's `toolPurpose` reads, built from a Codex item.
 * `commandActions` is the App Server's own classification of a shell command
 * (read a file, list files, search); when it names one, the row reads
 * `Read <path>` rather than `Ran a command`, which is the sentence the plugin's
 * tool vocabulary already prints for Claude's Read.
 */
export function codexToolInput(item: Record<string, unknown>, cwd: string): { name: string; input: Record<string, unknown>; target: string; purpose: string } {
  const type = item.type;
  if (type === 'commandExecution') {
    const command = str(item.command) ?? '';
    const actions = Array.isArray(item.commandActions) ? item.commandActions.filter(isRecord) : [];
    const first = actions[0];
    if (first && actions.length === 1) {
      const path = str(first.path);
      if (first.type === 'read' && path) {
        return { name: 'Read', input: { file_path: path }, target: command, purpose: toolPurpose('Read', { file_path: path }, cwd) };
      }
      if (first.type === 'listFiles') {
        const where = path ? relativeTo(path, cwd) : '';
        return { name: 'Bash', input: { command, description: where ? `List files in ${where}` : 'List files' }, target: command, purpose: where ? `Listed files in ${where}` : 'Listed files' };
      }
      if (first.type === 'search') {
        const query = str(first.query) ?? str(first.pattern) ?? '';
        return { name: 'Grep', input: { pattern: query, ...(path ? { path } : {}) }, target: command, purpose: toolPurpose('Grep', { pattern: query, ...(path ? { path } : {}) }, cwd) };
      }
    }
    return { name: 'Bash', input: { command }, target: command, purpose: toolPurpose('Bash', { command }, cwd) };
  }
  if (type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
    const paths = changes.map((c) => str(c.path) ?? '').filter(Boolean);
    const kinds = new Set(changes.map((c) => str(c.kind) ?? ''));
    const first = paths[0] ?? '';
    const name = kinds.size === 1 && kinds.has('add') ? 'Write' : 'Edit';
    const purpose = paths.length <= 1
      ? toolPurpose(name, { file_path: first }, cwd)
      : `Edited ${paths.length} files`;
    return { name, input: { file_path: first, paths }, target: paths.map((p) => relativeTo(p, cwd)).join(', '), purpose };
  }
  if (type === 'mcpToolCall' || type === 'dynamicToolCall') {
    const tool = str(item.tool) ?? 'tool';
    const server = str(item.server);
    const args = isRecord(item.arguments) ? item.arguments : {};
    return {
      name: tool,
      input: args,
      target: server ? `${server}: ${tool}` : tool,
      purpose: server ? `Used ${tool} on ${server}` : `Used ${tool}`,
    };
  }
  if (type === 'plan') {
    return { name: 'TodoWrite', input: {}, target: '', purpose: 'Updated the plan' };
  }
  return { name: 'tool', input: {}, target: '', purpose: 'Used a tool' };
}

/** Whether a completed item is a tool item the stream shows as a row. */
function isToolItem(type: unknown): boolean {
  return type === 'commandExecution' || type === 'fileChange' || type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'plan';
}

function toolResultOf(item: Record<string, unknown>): { ok: boolean; detail: string; output: string } {
  const status = str(item.status);
  switch (item.type) {
    case 'commandExecution': {
      const out = str(item.aggregatedOutput) ?? '';
      const exit = typeof item.exitCode === 'number' ? item.exitCode : null;
      const ok = status === 'completed' && (exit === null || exit === 0);
      return { ok, detail: firstLine(out) || (exit !== null ? `exit ${exit}` : ''), output: resultOutput(out) };
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
      const diff = changes.map((c) => `${str(c.kind) ?? 'change'} ${str(c.path) ?? ''}\n${str(c.diff) ?? ''}`).join('\n');
      return { ok: status === 'completed', detail: `${changes.length} file${changes.length === 1 ? '' : 's'} changed`, output: resultOutput(diff) };
    }
    case 'mcpToolCall': {
      const error = isRecord(item.error) ? str(item.error.message) ?? 'error' : null;
      const result = item.result === undefined || item.result === null ? '' : JSON.stringify(item.result, null, 2);
      return { ok: status === 'completed' && !error, detail: error ?? firstLine(result), output: resultOutput(error ?? result) };
    }
    case 'dynamicToolCall': {
      const ok = status === 'completed' && item.success !== false;
      const content = Array.isArray(item.contentItems) ? JSON.stringify(item.contentItems, null, 2) : '';
      return { ok, detail: firstLine(content), output: resultOutput(content) };
    }
    case 'plan': {
      const text = str(item.text) ?? '';
      return { ok: true, detail: firstLine(text), output: resultOutput(text) };
    }
    default:
      return { ok: status !== 'failed', detail: '', output: '' };
  }
}

function usageFrom(tokenUsage: Record<string, unknown> | null): TurnUsage {
  const total = tokenUsage && isRecord(tokenUsage.total) ? tokenUsage.total : {};
  const input = num(total.inputTokens);
  const cached = num(total.cachedInputTokens);
  const output = num(total.outputTokens);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cached,
    totalTokens: num(total.totalTokens) || input + cached + output,
    // The App Server publishes no cost. Zero is not a measurement; the
    // statusline never prints a cost for this provider.
    costUsd: 0,
  };
}

/** The App Server's usage windows in the plugin's rate-limit vocabulary. Nothing invented. */
export function rateLimitFrom(rateLimits: Record<string, unknown>): RateLimitFacts | null {
  const primary = isRecord(rateLimits.primary) ? rateLimits.primary : isRecord(rateLimits.secondary) ? rateLimits.secondary : null;
  if (!primary) return null;
  const used = num(primary.usedPercent);
  const mins = typeof primary.windowDurationMins === 'number' ? primary.windowDurationMins : null;
  const window: RateLimitFacts['window'] = mins === 300 ? 'five_hour' : mins === 10080 ? 'seven_day' : 'unknown';
  const resetsAt = typeof primary.resetsAt === 'number' ? primary.resetsAt * 1000 : null;
  return {
    window,
    utilization: used / 100,
    resetsAt,
    status: used >= 100 ? 'rejected' : used >= 80 ? 'allowed_warning' : 'allowed',
  };
}

export interface CodexSessionFacts {
  threadId: string;
  model: string;
  cwd: string;
}

export class CodexNormalizer {
  private tokenUsage: Record<string, unknown> | null = null;
  private lastAgentText = '';
  /** Item ids already shown as a tool row, so `item/completed` finds its call. */
  private readonly toolItems = new Set<string>();

  constructor(private readonly cwd: string) {}

  /** The `session` event, from a thread/start or thread/resume response. */
  sessionEvent(result: unknown, mode: CodexMode): ChatEvent[] {
    if (!isRecord(result)) return [];
    const thread = isRecord(result.thread) ? result.thread : null;
    const threadId = thread ? str(thread.id) : null;
    if (!threadId) return [];
    return [{
      kind: 'session',
      sessionId: threadId,
      model: str(result.model) ?? '',
      cwd: str(thread?.cwd) ?? this.cwd,
      permissionMode: mode.approvalPolicy === 'never'
        ? (mode.sandbox === 'danger-full-access' ? 'bypassPermissions' : 'acceptEdits')
        : (mode.sandbox === 'read-only' ? 'plan' : 'default'),
      slashCommands: [],
      contextWindow: null,
      provider: 'codex',
      stream: null,
    }];
  }

  /** Translate one server notification. Never throws; unknown shapes return []. */
  notification(method: string, params: unknown): ChatEvent[] {
    try {
      return this.dispatch(method, isRecord(params) ? params : {});
    } catch {
      return [];
    }
  }

  private dispatch(method: string, p: Record<string, unknown>): ChatEvent[] {
    switch (method) {
      case 'item/started':
        return this.itemStarted(isRecord(p.item) ? p.item : null);
      case 'item/agentMessage/delta': {
        const id = str(p.itemId);
        const text = str(p.delta);
        return id && text ? [{ kind: 'text-delta', blockId: id, text, stream: null }] : [];
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const id = str(p.itemId);
        const text = str(p.delta);
        return id && text ? [{ kind: 'thinking-delta', blockId: id, text, stream: null }] : [];
      }
      case 'item/completed':
        return this.itemCompleted(isRecord(p.item) ? p.item : null);
      case 'thread/tokenUsage/updated':
        this.tokenUsage = isRecord(p.tokenUsage) ? p.tokenUsage : this.tokenUsage;
        return [];
      case 'account/rateLimits/updated': {
        const facts = isRecord(p.rateLimits) ? rateLimitFrom(p.rateLimits) : null;
        return facts ? [{ kind: 'rate-limit', facts, stream: null }] : [];
      }
      case 'error': {
        if (p.willRetry === true) return [];
        const error = isRecord(p.error) ? p.error : null;
        const message = str(error?.message) ?? 'Codex reported an error.';
        return [{ kind: 'error', message, stream: null }];
      }
      case 'turn/completed':
        return this.turnCompleted(isRecord(p.turn) ? p.turn : null);
      default:
        return [];
    }
  }

  private itemStarted(item: Record<string, unknown> | null): ChatEvent[] {
    if (!item) return [];
    const id = str(item.id);
    if (!id) return [];
    switch (item.type) {
      case 'agentMessage':
        return [{ kind: 'text-open', blockId: id, stream: null }];
      case 'reasoning':
        return [{ kind: 'thinking-open', blockId: id, stream: null }];
      default:
        if (!isToolItem(item.type)) return [];
        return [this.toolCall(id, item)];
    }
  }

  private toolCall(id: string, item: Record<string, unknown>): ChatEvent {
    this.toolItems.add(id);
    const { name, input, target, purpose } = codexToolInput(item, this.cwd);
    return { kind: 'tool-call', toolUseId: id, name, target, input, purpose, stream: null };
  }

  /** A completed item's events. Public because a stored thread replays through it. */
  completedItem(item: Record<string, unknown>): ChatEvent[] {
    return this.itemCompleted(item);
  }

  private itemCompleted(item: Record<string, unknown> | null): ChatEvent[] {
    if (!item) return [];
    const id = str(item.id);
    if (!id) return [];
    switch (item.type) {
      case 'agentMessage': {
        const text = str(item.text) ?? '';
        this.lastAgentText = text;
        return [{ kind: 'text-final', blockId: id, text, stream: null }];
      }
      case 'reasoning': {
        const summary = Array.isArray(item.summary) ? item.summary.filter((s): s is string => typeof s === 'string') : [];
        const content = Array.isArray(item.content) ? item.content.filter((s): s is string => typeof s === 'string') : [];
        return [{ kind: 'thinking-final', blockId: id, text: [...summary, ...content].join('\n\n'), stream: null }];
      }
      case 'userMessage':
        return [];
      default: {
        if (!isToolItem(item.type)) return [];
        const out: ChatEvent[] = [];
        // A tool that completed without ever starting (a replay, or a server
        // that skipped item/started) still gets its row.
        if (!this.toolItems.has(id)) out.push(this.toolCall(id, item));
        const result = toolResultOf(item);
        out.push({ kind: 'tool-result', toolUseId: id, ok: result.ok, detail: result.detail, output: result.output, stream: null });
        return out;
      }
    }
  }

  private turnCompleted(turn: Record<string, unknown> | null): ChatEvent[] {
    if (!turn) return [];
    const status = str(turn.status);
    const usage = usageFrom(this.tokenUsage);
    const contextWindow = this.tokenUsage && typeof this.tokenUsage.modelContextWindow === 'number'
      ? this.tokenUsage.modelContextWindow
      : null;
    const text = this.lastAgentText;
    this.lastAgentText = '';
    this.toolItems.clear();
    if (status === 'interrupted') return [{ kind: 'aborted', stream: null }];
    return [{
      kind: 'turn-end',
      usage,
      contextWindow,
      durationMs: num(turn.durationMs),
      isError: status === 'failed',
      text,
      stream: null,
    }];
  }
}

/**
 * A stored thread's turns, as replay entries: the user's words per turn, and
 * the completed items as the events a live turn would have produced. Pure, so
 * `thread/read` output recorded in a fixture can be asserted headless.
 */
export function replayFromThread(thread: unknown, cwd: string): Array<{ spoken: string | null; messageId: string | null; events: ChatEvent[] }> {
  if (!isRecord(thread)) return [];
  const turns = Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];
  const out: Array<{ spoken: string | null; messageId: string | null; events: ChatEvent[] }> = [];
  for (const turn of turns) {
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    const normalizer = new CodexNormalizer(cwd);
    let spoken: string | null = null;
    let messageId: string | null = null;
    let events: ChatEvent[] = [];
    for (const item of items) {
      if (item.type === 'userMessage') {
        const parts = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
        const text = parts.map((c) => (c.type === 'text' ? str(c.text) ?? '' : '')).join('\n').trim();
        if (text) {
          if (spoken !== null || events.length > 0) {
            out.push({ spoken, messageId, events });
            events = [];
          }
          spoken = text;
          // The user message's own item id, so a fork "up to here" can name it.
          messageId = str(item.id);
          continue;
        }
      }
      for (const event of normalizer.completedItem(item)) events.push(event);
    }
    if (spoken !== null || events.length > 0) out.push({ spoken, messageId, events });
  }
  return out;
}

