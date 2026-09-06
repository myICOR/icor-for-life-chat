/* THE ANTHROPIC DIRECT ADAPTER. `chat-mobile-engine-spec-v1.md` section 2:
 * "Messages API, streaming, tool use... `claude-sonnet-5` (Opus selectable)".
 * Section 1 names the header this needs for a browser-origin call:
 * `anthropic-dangerous-direct-browser-access: true`.
 *
 * Streaming shape (Anthropic's own SSE event names, unchanged since the
 * Messages API's 2024 streaming release and assumed stable here):
 * `message_start` (opening usage), `content_block_start` /
 * `content_block_delta` (`text_delta` | `input_json_delta`) /
 * `content_block_stop` per block, `message_delta` (stop_reason, closing
 * usage), `message_stop`. A tool call's `input_json_delta` fragments are
 * buffered per block index and parsed once, at `content_block_stop`, so
 * exactly one `tool-call` delta reaches the engine per call - never a
 * fragment. Not measured against a live call in this build (no key in this
 * environment); `test/engine-anthropic.test.mjs` replays a fixture built from
 * Anthropic's own documented examples, and Vex's gate before release is the
 * place a live call should confirm it once a member key is available. */

import type { EngineContentPart, EngineDelta, EngineMessage, ModelProvider, SendParams, Transports } from '../types';
import { isDoneSentinel, parseSseBuffer } from '../sse';
import { toAnthropicTools } from '../tools/definitions';
import { estimateAnthropicCost } from '../cost';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `Array.isArray` narrows to `any[]` in its own lib type, which taints
 * anything assigned from it; this keeps the same check but returns the
 * honestly-typed `unknown[]`. */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toAnthropicContent(content: EngineMessage['content']): unknown {
  if (typeof content === 'string') return content;
  return content.map((part: EngineContentPart) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'tool_use') return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
    return { type: 'tool_result', tool_use_id: part.toolUseId, content: part.content, is_error: part.isError };
  });
}

function buildBody(params: SendParams, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    messages: params.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
    stream,
  };
  if (params.system) body.system = params.system;
  if (params.tools.length > 0) body.tools = toAnthropicTools(params.tools);
  return body;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    // Required for a browser-origin fetch, per the spec's own research
    // (code.claude.com auth pages, 2026-09-06). Anthropic's own opt-in
    // acknowledgement that the key is exposed client-side - true here on
    // purpose: the member's own key, on their own device, is exactly the
    // case this header exists for.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function stopReasonOf(raw: unknown): 'end_turn' | 'tool_use' | 'max_tokens' | 'other' {
  if (raw === 'end_turn' || raw === 'stop_sequence') return 'end_turn';
  if (raw === 'tool_use') return 'tool_use';
  if (raw === 'max_tokens') return 'max_tokens';
  return 'other';
}

interface RunningUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

function usageFrom(raw: unknown, into: RunningUsage): void {
  if (!isRecord(raw)) return;
  if (typeof raw.input_tokens === 'number') into.inputTokens = raw.input_tokens;
  if (typeof raw.output_tokens === 'number') into.outputTokens = raw.output_tokens;
  if (typeof raw.cache_read_input_tokens === 'number') into.cacheReadTokens = raw.cache_read_input_tokens;
}

/** One tool_use content block being streamed: its id/name arrive at
 * `content_block_start`, its `input` arrives as `input_json_delta` fragments. */
interface PendingToolBlock {
  id: string;
  name: string;
  partialJson: string;
}

class StreamState {
  usage: RunningUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other' = 'other';
  readonly toolBlocks = new Map<number, PendingToolBlock>();
  emittedAny = false;
}

function handleFrameData(data: string, state: StreamState, model: string, onDelta: (d: EngineDelta) => void): void {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return; // A frame that is not JSON carries nothing this adapter reads.
  }
  if (!isRecord(msg)) return;
  const type = msg.type;

  if (type === 'message_start' && isRecord(msg.message)) {
    usageFrom(msg.message.usage, state.usage);
    return;
  }
  if (type === 'content_block_start' && isRecord(msg.content_block) && typeof msg.index === 'number') {
    const block = msg.content_block;
    if (block.type === 'tool_use') {
      state.toolBlocks.set(msg.index, {
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        partialJson: '',
      });
    }
    return;
  }
  if (type === 'content_block_delta' && isRecord(msg.delta) && typeof msg.index === 'number') {
    const delta = msg.delta;
    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      state.emittedAny = true;
      onDelta({ type: 'text-delta', text: delta.text });
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const block = state.toolBlocks.get(msg.index);
      if (block) block.partialJson += delta.partial_json;
    }
    return;
  }
  if (type === 'content_block_stop' && typeof msg.index === 'number') {
    const block = state.toolBlocks.get(msg.index);
    if (block) {
      state.toolBlocks.delete(msg.index);
      let input: Record<string, unknown> = {};
      if (block.partialJson.trim()) {
        try {
          const parsed: unknown = JSON.parse(block.partialJson);
          if (isRecord(parsed)) input = parsed;
        } catch {
          // An unparseable tool call is reported as a call with empty input
          // rather than dropped silently; the tool's own validation reports
          // the missing argument back to the model.
        }
      }
      state.emittedAny = true;
      onDelta({ type: 'tool-call', id: block.id, name: block.name, input });
    }
    return;
  }
  if (type === 'message_delta') {
    if (isRecord(msg.delta) && 'stop_reason' in msg.delta) state.stopReason = stopReasonOf(msg.delta.stop_reason);
    usageFrom(msg.usage, state.usage);
    return;
  }
  if (type === 'message_stop') {
    state.emittedAny = true;
    onDelta({
      type: 'message-stop',
      stopReason: state.stopReason,
      usage: { ...state.usage },
      costUsd: estimateAnthropicCost(model, state.usage.inputTokens, state.usage.outputTokens, state.usage.cacheReadTokens),
    });
    return;
  }
  if (type === 'error' && isRecord(msg.error)) {
    state.emittedAny = true;
    onDelta({ type: 'error', message: typeof msg.error.message === 'string' ? msg.error.message : 'Anthropic reported an error.' });
  }
}

function apiErrorMessage(status: number, bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return `Anthropic (${status}): ${parsed.error.message}`;
    }
  } catch {
    // Fall through to the raw body below.
  }
  return `Anthropic returned ${status}.${bodyText ? ` ${bodyText.slice(0, 300)}` : ''}`;
}

function parseFullResponse(bodyText: string, model: string): EngineDelta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return [{ type: 'error', message: 'Anthropic returned a response this adapter could not parse.' }];
  }
  if (!isRecord(parsed)) return [{ type: 'error', message: 'Anthropic returned an unexpected response shape.' }];

  const deltas: EngineDelta[] = [];
  const content = asArray(parsed.content);
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      deltas.push({ type: 'text-delta', text: block.text });
    } else if (block.type === 'tool_use') {
      deltas.push({
        type: 'tool-call',
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        input: isRecord(block.input) ? block.input : {},
      });
    }
  }
  const usage: RunningUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  usageFrom(parsed.usage, usage);
  deltas.push({
    type: 'message-stop',
    stopReason: stopReasonOf(parsed.stop_reason),
    usage,
    costUsd: estimateAnthropicCost(model, usage.inputTokens, usage.outputTokens, usage.cacheReadTokens),
  });
  return deltas;
}

export function createAnthropicProvider(apiKey: string, transports: Transports): ModelProvider {
  return {
    id: 'anthropic',
    displayName: 'Anthropic',
    async send(params: SendParams): Promise<void> {
      const state = new StreamState();
      try {
        let buffer = '';
        for await (const chunk of transports.stream({
          url: API_URL,
          headers: headers(apiKey),
          body: JSON.stringify(buildBody(params, true)),
          signal: params.signal,
        })) {
          buffer += chunk;
          const { frames, remainder } = parseSseBuffer(buffer);
          buffer = remainder;
          for (const frame of frames) {
            if (isDoneSentinel(frame.data)) continue;
            handleFrameData(frame.data, state, params.model, params.onDelta);
          }
        }
        if (state.emittedAny) return; // Streamed cleanly to the end.
      } catch {
        if (state.emittedAny) {
          // Partial work already reached the view; a fresh non-streaming
          // retry would duplicate it and double the bill. Report the cut
          // rather than silently losing or repeating it.
          params.onDelta({ type: 'error', message: 'The connection to Anthropic was interrupted mid-reply.' });
          return;
        }
        // Nothing streamed yet: safe to fall back to a clean request.
      }

      // FALLBACK: requestUrl, non-streaming. Also the path a stream that ended
      // with no message_stop (closed early, zero frames) falls through to.
      // Wrapped like the streaming attempt above it: a network failure here
      // (there is nowhere further to fall back to) is still an `error` delta,
      // never an unhandled rejection out of `send()`.
      try {
        const result = await transports.requestFull({
          url: API_URL,
          headers: headers(apiKey),
          body: JSON.stringify(buildBody(params, false)),
          signal: params.signal,
        });
        if (result.status < 200 || result.status >= 300) {
          params.onDelta({ type: 'error', message: apiErrorMessage(result.status, result.bodyText) });
          return;
        }
        for (const delta of parseFullResponse(result.bodyText, params.model)) params.onDelta(delta);
      } catch (error) {
        params.onDelta({ type: 'error', message: error instanceof Error ? error.message : 'Could not reach Anthropic.' });
      }
    },
  };
}
