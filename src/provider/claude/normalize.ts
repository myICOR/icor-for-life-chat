/* The one translator between the Agent SDK's wire types and the plugin's own
 * ChatEvent union. An SDK upgrade touches this file and nothing else.
 *
 * Two rules hold everywhere below:
 *   - An unrecognised message shape yields no events. It never throws. The SDK
 *     is pre-1.0 and adds message types between patch releases; a chat that
 *     dies on an unknown frame is a chat that dies on a Tuesday.
 *   - Tool calls are read from the completed assistant message, never from
 *     partial stream events. A tool whose input arrives in fragments therefore
 *     renders once, complete, instead of repeatedly half-formed. */

import type { ChatEvent, PermissionModeName, RateLimitFacts, TurnUsage } from '../../model/types';
import { resultDetail, resultOutput, toolPurpose, toolTarget } from '../tooling';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function usageFrom(msg: Record<string, unknown>): TurnUsage {
  const u = isRecord(msg.usage) ? msg.usage : {};
  const input = num(u.input_tokens);
  const output = num(u.output_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheCreate = num(u.cache_creation_input_tokens);
  return {
    inputTokens: input + cacheCreate,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    totalTokens: input + cacheCreate + cacheRead + output,
    costUsd: num(msg.total_cost_usd),
  };
}

function rateLimitFrom(info: Record<string, unknown>): RateLimitFacts {
  const window = str(info.rateLimitType);
  const allowed: RateLimitFacts['window'][] = [
    'five_hour',
    'seven_day',
    'seven_day_opus',
    'seven_day_sonnet',
    'overage',
  ];
  const status = str(info.status);
  return {
    window: allowed.includes(window as RateLimitFacts['window'])
      ? (window as RateLimitFacts['window'])
      : 'unknown',
    utilization: typeof info.utilization === 'number' ? info.utilization : null,
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : null,
    status:
      status === 'allowed_warning' || status === 'rejected' || status === 'allowed'
        ? status
        : 'allowed',
  };
}

const PERMISSION_MODES: PermissionModeName[] = [
  'default',
  'plan',
  'acceptEdits',
  'bypassPermissions',
];

export class Normalizer {
  /** Message id of the assistant turn currently streaming, for block keys. */
  private streamingMessageId: string | null = null;
  /** The session's own model, so modelUsage can be read for the main loop. */
  private sessionModel: string | null = null;
  /** The working directory, so a purpose line can show a vault-relative path. */
  private cwd = '';
  /** Tool-use ids known to be Task spawns, so their results close a subagent. */
  private readonly taskSpawns = new Set<string>();
  /**
   * How many content blocks of a given assistant message have already arrived.
   *
   * The CLI does not deliver one assistant message as one frame. Measured on
   * 2.1.x: a message whose content is [thinking, text] arrives as TWO frames of
   * one block each, both carrying the same `message.id`, and each frame's own
   * `content` array restarts at 0. The array position inside a frame is
   * therefore NOT the block's identity, while the stream's `content_block`
   * index - which is message-wide - is. Without this cursor the text block was
   * `msg:1` on the streaming path and `msg:0` on the final path, the streamed
   * node never received its own `text-final`, and the reply rendered twice:
   * once raw, once as a card. Frames are disjoint slices of one message, in
   * order, which is what makes a running count the right cursor; a CLI that
   * ever re-sent a block already delivered would need a different rule here.
   */
  private readonly blocksSeen = new Map<string, number>();

  /** Translate one SDK message. Never throws; unknown shapes return []. */
  normalize(raw: unknown): ChatEvent[] {
    try {
      return this.dispatch(raw);
    } catch {
      return [];
    }
  }

  private dispatch(raw: unknown): ChatEvent[] {
    if (!isRecord(raw)) return [];
    const stream = str(raw.parent_tool_use_id);
    switch (raw.type) {
      case 'system':
        return this.system(raw, stream);
      case 'stream_event':
        return this.partial(raw, stream);
      case 'assistant':
        return this.assistant(raw, stream);
      case 'user':
        return this.user(raw, stream);
      case 'result':
        return this.result(raw);
      case 'rate_limit_event': {
        const info = isRecord(raw.rate_limit_info) ? raw.rate_limit_info : null;
        return info ? [{ kind: 'rate-limit', facts: rateLimitFrom(info), stream: null }] : [];
      }
      default:
        return [];
    }
  }

  private system(raw: Record<string, unknown>, stream: string | null): ChatEvent[] {
    if (raw.subtype === 'init') {
      const mode = str(raw.permissionMode);
      this.sessionModel = str(raw.model);
      this.cwd = str(raw.cwd) ?? '';
      return [
        {
          kind: 'session',
          provider: 'claude',
          sessionId: str(raw.session_id) ?? '',
          model: str(raw.model) ?? '',
          cwd: str(raw.cwd) ?? '',
          permissionMode: PERMISSION_MODES.includes(mode as PermissionModeName)
            ? (mode as PermissionModeName)
            : 'default',
          slashCommands: Array.isArray(raw.slash_commands)
            ? raw.slash_commands.filter((c): c is string => typeof c === 'string')
            : [],
          contextWindow: null,
          stream: null,
        },
      ];
    }
    // The CLI publishes the subagent lifecycle first-party, so nothing here
    // infers it from a tool name. Measured on 2.1.251: the spawn tool is called
    // `Agent`, not `Task`, which is exactly the kind of thing a name-sniffing
    // implementation gets wrong one release later.
    if (raw.subtype === 'task_started') {
      const agentId = str(raw.tool_use_id) ?? str(raw.task_id);
      if (!agentId) return [];
      // The spawn tool_use arrives FIRST and already carries subagent_type,
      // description and prompt, so whichever signal lands first owns the open
      // and the other is dropped. Measured: without this the same agent opened
      // twice, once per signal.
      if (this.taskSpawns.has(agentId)) return [];
      this.taskSpawns.add(agentId);
      return [
        {
          kind: 'subagent-start',
          agentId,
          agentType: str(raw.subagent_type) ?? 'agent',
          description: str(raw.description) ?? '',
          task: str(raw.prompt) ?? '',
          stream,
        },
      ];
    }
    if (raw.subtype === 'task_notification') {
      const agentId = str(raw.tool_use_id) ?? str(raw.task_id);
      if (!agentId) return [];
      this.taskSpawns.delete(agentId);
      return [{ kind: 'subagent-end', agentId, ok: raw.status === 'completed', stream }];
    }
    if (raw.subtype === 'compact_boundary') {
      const meta = isRecord(raw.compact_metadata) ? raw.compact_metadata : {};
      return [
        {
          kind: 'compact-boundary',
          preTokens: num(meta.pre_tokens),
          postTokens: typeof meta.post_tokens === 'number' ? meta.post_tokens : null,
          stream,
        },
      ];
    }
    return [];
  }

  private partial(raw: Record<string, unknown>, stream: string | null): ChatEvent[] {
    const event = isRecord(raw.event) ? raw.event : null;
    if (!event) return [];
    switch (event.type) {
      case 'message_start': {
        const message = isRecord(event.message) ? event.message : null;
        this.streamingMessageId = message ? str(message.id) : null;
        return [];
      }
      case 'content_block_start': {
        const block = isRecord(event.content_block) ? event.content_block : null;
        const id = this.blockId(num(event.index));
        if (!block || !id) return [];
        if (block.type === 'text') return [{ kind: 'text-open', blockId: id, stream }];
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          return [{ kind: 'thinking-open', blockId: id, stream }];
        }
        return [];
      }
      case 'content_block_delta': {
        const delta = isRecord(event.delta) ? event.delta : null;
        const id = this.blockId(num(event.index));
        if (!delta || !id) return [];
        if (delta.type === 'text_delta') {
          const text = str(delta.text);
          return text ? [{ kind: 'text-delta', blockId: id, text, stream }] : [];
        }
        if (delta.type === 'thinking_delta') {
          const text = str(delta.thinking);
          return text ? [{ kind: 'thinking-delta', blockId: id, text, stream }] : [];
        }
        return [];
      }
      default:
        return [];
    }
  }

  private blockId(index: number): string | null {
    return this.streamingMessageId ? `${this.streamingMessageId}:${index}` : null;
  }

  private assistant(raw: Record<string, unknown>, stream: string | null): ChatEvent[] {
    const message = isRecord(raw.message) ? raw.message : null;
    if (!message) return [];
    const messageId = str(message.id) ?? this.streamingMessageId ?? '';
    const content = Array.isArray(message.content) ? message.content : [];
    // Where this frame's blocks sit in the MESSAGE, not in the frame.
    const offset = this.blocksSeen.get(messageId) ?? 0;
    this.blocksSeen.set(messageId, offset + content.length);
    const out: ChatEvent[] = [];
    content.forEach((blockRaw, index) => {
      if (!isRecord(blockRaw)) return;
      const blockId = `${messageId}:${offset + index}`;
      if (blockRaw.type === 'text') {
        out.push({ kind: 'text-final', blockId, text: str(blockRaw.text) ?? '', stream });
      } else if (blockRaw.type === 'thinking') {
        out.push({ kind: 'thinking-final', blockId, text: str(blockRaw.thinking) ?? '', stream });
      } else if (blockRaw.type === 'tool_use') {
        const id = str(blockRaw.id);
        const name = str(blockRaw.name) ?? 'tool';
        if (!id) return;
        const input = isRecord(blockRaw.input) ? blockRaw.input : {};
        out.push({
          kind: 'tool-call',
          toolUseId: id,
          name,
          target: toolTarget(name, input),
          purpose: toolPurpose(name, input, this.cwd),
          input,
          stream,
        });
        // Fallback for a CLI that does not publish task_started: open the
        // subagent from the spawn tool itself. Guarded so the first-party
        // event, when it arrives, does not open a second one.
        if ((name === 'Task' || name === 'Agent') && !this.taskSpawns.has(id)) {
          this.taskSpawns.add(id);
          out.push({
            kind: 'subagent-start',
            agentId: id,
            agentType: str(input.subagent_type) ?? 'agent',
            description: str(input.description) ?? '',
            task: str(input.prompt) ?? '',
            stream,
          });
        }
      }
    });
    return out;
  }

  private user(raw: Record<string, unknown>, stream: string | null): ChatEvent[] {
    const message = isRecord(raw.message) ? raw.message : null;
    if (!message) return [];
    const content = message.content;
    if (!Array.isArray(content)) return [];
    const out: ChatEvent[] = [];
    for (const blockRaw of content) {
      if (!isRecord(blockRaw) || blockRaw.type !== 'tool_result') continue;
      const id = str(blockRaw.tool_use_id);
      if (!id) continue;
      const ok = blockRaw.is_error !== true;
      out.push({
        kind: 'tool-result',
        toolUseId: id,
        ok,
        detail: resultDetail(blockRaw.content),
        output: resultOutput(blockRaw.content),
        stream,
      });
      if (this.taskSpawns.has(id)) {
        this.taskSpawns.delete(id);
        out.push({ kind: 'subagent-end', agentId: id, ok, stream });
      }
    }
    return out;
  }

  private result(raw: Record<string, unknown>): ChatEvent[] {
    // A message never spans a turn boundary, so the cursors die with the turn.
    this.blocksSeen.clear();
    return [
      {
        kind: 'turn-end',
        usage: usageFrom(raw),
        contextWindow: contextWindowFor(raw.modelUsage, this.sessionModel),
        durationMs: num(raw.duration_ms),
        isError: raw.is_error === true,
        text: str(raw.result) ?? '',
        stream: null,
      },
    ];
  }
}

/**
 * The model's context window, read from the provider's own per-model usage
 * record. Returns null rather than a guess: a context percentage with an
 * invented denominator is worse than no percentage at all.
 */
export function contextWindowFor(modelUsage: unknown, sessionModel: string | null): number | null {
  if (!isRecord(modelUsage)) return null;
  const entries = Object.entries(modelUsage).filter(
    (pair): pair is [string, Record<string, unknown>] => isRecord(pair[1]),
  );
  if (entries.length === 0) return null;
  const exact = sessionModel ? entries.find(([key]) => key === sessionModel) : undefined;
  const chosen = exact ?? entries[0];
  if (!chosen) return null;
  const window = chosen[1].contextWindow;
  return typeof window === 'number' && window > 0 ? window : null;
}

/**
 * The user's own words in a stored message, or null when there are none.
 *
 * Replay needs this and the live stream does not: live user turns are rendered
 * from the send that created them, so teaching the Normalizer to emit them
 * would double every well in a live conversation. Kept pure and separate for
 * exactly that reason.
 *
 * A user message carrying tool_result blocks is the transport answering a tool
 * call, not a person typing, and never produces a well.
 */
export function userTextOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  if (raw.type !== 'user') return null;
  if (str(raw.parent_tool_use_id) !== null) return null;
  const message = raw.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content === 'string') {
    const text = content.trim();
    return text.length > 0 ? text : null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    // The transport answering a tool call is not a person typing.
    if (block.type === 'tool_result') return null;
    if (block.type !== 'text') continue;
    const text = str(block.text);
    if (text) parts.push(text);
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}
