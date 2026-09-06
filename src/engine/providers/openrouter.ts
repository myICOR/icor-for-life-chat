/* THE OPENROUTER ADAPTER. `chat-mobile-engine-spec-v1.md` section 2:
 * "OpenAI-compatible chat completions with tools, streaming ... `HTTP-Referer`
 * and `X-Title` headers naming the plugin ... one key, prepaid credits, a
 * spend cap in their dashboard, Claude models available, other models as
 * fallback." Section 4 / the settings spec: "OpenRouter reports cost per
 * call" - read straight off `usage.cost` in the response, never computed here
 * (that is what `cost.ts`'s Anthropic price table is for; OpenRouter needs
 * no price table because it already prices itself).
 *
 * Research 2026-09-06 (perplexity, OpenRouter's own docs): usage (including
 * `cost`) is now returned automatically on every response and on the final
 * streaming chunk; the older `usage: {include: true}` request flag is
 * deprecated and a no-op, so it is not sent. Streaming tool calls follow
 * OpenAI's own incremental shape: `choices[0].delta.tool_calls[]`, each entry
 * carrying an `index` (which fragment belongs to which call), an `id` on its
 * first fragment, and `function.arguments` streamed as a JSON string across
 * however many fragments the model split it into. Not measured against a
 * live call in this build (no key here); `test/engine-openrouter.test.mjs`
 * replays a fixture built from OpenRouter's own documented examples. */

import type { EngineContentPart, EngineDelta, EngineMessage, ModelProvider, SendParams, Transports } from '../types';
import { isDoneSentinel, parseSseBuffer } from '../sse';
import { toOpenAiTools } from '../tools/definitions';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Named once so `HTTP-Referer` / `X-Title` and the settings copy never drift
 * apart from each other. Not a live myICOR URL: OpenRouter's own docs treat
 * this purely as an attribution label, and the plugin has no hosted page to
 * point it at. */
const APP_REFERRER = 'https://myicor.com';
const APP_TITLE = 'ICOR for Life - AI Chat';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `Array.isArray` narrows to `any[]` in its own lib type, which taints
 * anything assigned from it; this keeps the same check but returns the
 * honestly-typed `unknown[]`. */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * `EngineMessage[]` mixes tool_use / tool_result INTO a message's content
 * (Anthropic's shape, which `toolLoop.ts` builds in). OpenAI's shape wants
 * tool calls as a field on the assistant message and each tool result as its
 * OWN `role: 'tool'` message, so one `EngineMessage` can become several
 * OpenAI messages.
 */
function toOpenAiMessages(messages: EngineMessage[], system: string): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const textParts: string[] = [];
    const toolCalls: unknown[] = [];
    const toolResults: EngineContentPart[] = [];
    for (const part of m.content) {
      if (part.type === 'text') textParts.push(part.text);
      else if (part.type === 'tool_use') {
        toolCalls.push({
          id: part.id,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        });
      } else {
        toolResults.push(part);
      }
    }
    if (textParts.length > 0 || toolCalls.length > 0) {
      const msg: Record<string, unknown> = { role: m.role, content: textParts.join('\n') || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
    }
    for (const result of toolResults) {
      if (result.type !== 'tool_result') continue;
      out.push({ role: 'tool', tool_call_id: result.toolUseId, content: result.content });
    }
  }
  return out;
}

function buildBody(params: SendParams, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: toOpenAiMessages(params.messages, params.system),
    max_tokens: params.maxTokens,
    stream,
  };
  if (params.tools.length > 0) body.tools = toOpenAiTools(params.tools);
  return body;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': APP_REFERRER,
    'X-Title': APP_TITLE,
  };
}

function stopReasonOf(raw: unknown): 'end_turn' | 'tool_use' | 'max_tokens' | 'other' {
  if (raw === 'stop') return 'end_turn';
  if (raw === 'tool_calls') return 'tool_use';
  if (raw === 'length') return 'max_tokens';
  return 'other';
}

interface RunningUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

function usageFrom(raw: unknown, into: RunningUsage): number | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.prompt_tokens === 'number') into.inputTokens = raw.prompt_tokens;
  if (typeof raw.completion_tokens === 'number') into.outputTokens = raw.completion_tokens;
  return typeof raw.cost === 'number' ? raw.cost : null;
}

interface PendingToolCall {
  id: string;
  name: string;
  argsText: string;
}

class StreamState {
  usage: RunningUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  costUsd: number | null = null;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other' = 'other';
  readonly toolCalls = new Map<number, PendingToolCall>();
  finished = false;
  emittedAny = false;
}

function flushToolCalls(state: StreamState, onDelta: (d: EngineDelta) => void): void {
  const indices = [...state.toolCalls.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const call = state.toolCalls.get(index);
    if (!call) continue;
    let input: Record<string, unknown> = {};
    if (call.argsText.trim()) {
      try {
        const parsed: unknown = JSON.parse(call.argsText);
        if (isRecord(parsed)) input = parsed;
      } catch {
        // Reported as a call with empty input; the tool's own validation
        // reports the missing argument back to the model.
      }
    }
    onDelta({ type: 'tool-call', id: call.id, name: call.name, input });
  }
  state.toolCalls.clear();
}

function handleFrameData(data: string, state: StreamState, onDelta: (d: EngineDelta) => void): void {
  if (isDoneSentinel(data)) return;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (!isRecord(msg)) return;

  const cost = usageFrom(msg.usage, state.usage);
  if (cost !== null) state.costUsd = cost;

  const choices = asArray(msg.choices);
  const choice = choices[0];
  if (isRecord(choice)) {
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string' && delta.content) {
      state.emittedAny = true;
      onDelta({ type: 'text-delta', text: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        if (!isRecord(raw) || typeof raw.index !== 'number') continue;
        const existing = state.toolCalls.get(raw.index) ?? { id: '', name: '', argsText: '' };
        if (typeof raw.id === 'string' && raw.id) existing.id = raw.id;
        const fn = isRecord(raw.function) ? raw.function : {};
        if (typeof fn.name === 'string' && fn.name) existing.name = fn.name;
        if (typeof fn.arguments === 'string') existing.argsText += fn.arguments;
        state.toolCalls.set(raw.index, existing);
      }
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      state.stopReason = stopReasonOf(choice.finish_reason);
      state.finished = true;
    }
  }

  // The terminal chunk carries `usage` and often an empty/absent `choices`
  // array; either signal ends the turn once a finish_reason has been seen.
  if (state.finished && (cost !== null || choices.length === 0)) {
    state.emittedAny = true;
    flushToolCalls(state, onDelta);
    onDelta({ type: 'message-stop', stopReason: state.stopReason, usage: { ...state.usage }, costUsd: state.costUsd });
    state.finished = false; // Guard against a stray extra terminal-looking chunk.
  }
}

function apiErrorMessage(status: number, bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return `OpenRouter (${status}): ${parsed.error.message}`;
    }
  } catch {
    // Fall through.
  }
  return `OpenRouter returned ${status}.${bodyText ? ` ${bodyText.slice(0, 300)}` : ''}`;
}

function parseFullResponse(bodyText: string): EngineDelta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return [{ type: 'error', message: 'OpenRouter returned a response this adapter could not parse.' }];
  }
  if (!isRecord(parsed)) return [{ type: 'error', message: 'OpenRouter returned an unexpected response shape.' }];

  const deltas: EngineDelta[] = [];
  const choice = asArray(parsed.choices)[0];
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
  if (typeof message.content === 'string' && message.content) {
    deltas.push({ type: 'text-delta', text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecord(call)) continue;
      const fn = isRecord(call.function) ? call.function : {};
      let input: Record<string, unknown> = {};
      if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
        try {
          const parsedArgs: unknown = JSON.parse(fn.arguments);
          if (isRecord(parsedArgs)) input = parsedArgs;
        } catch {
          // Empty input; see the streaming path's identical fallback.
        }
      }
      deltas.push({
        type: 'tool-call',
        id: typeof call.id === 'string' ? call.id : '',
        name: typeof fn.name === 'string' ? fn.name : '',
        input,
      });
    }
  }
  const usage: RunningUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const cost = usageFrom(parsed.usage, usage);
  const finishReason = isRecord(choice) ? choice.finish_reason : undefined;
  deltas.push({ type: 'message-stop', stopReason: stopReasonOf(finishReason), usage, costUsd: cost });
  return deltas;
}

export function createOpenRouterProvider(apiKey: string, transports: Transports): ModelProvider {
  return {
    id: 'openrouter',
    displayName: 'OpenRouter',
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
          for (const frame of frames) handleFrameData(frame.data, state, params.onDelta);
        }
        if (state.emittedAny) return;
      } catch {
        if (state.emittedAny) {
          params.onDelta({ type: 'error', message: 'The connection to OpenRouter was interrupted mid-reply.' });
          return;
        }
      }

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
        for (const delta of parseFullResponse(result.bodyText)) params.onDelta(delta);
      } catch (error) {
        params.onDelta({ type: 'error', message: error instanceof Error ? error.message : 'Could not reach OpenRouter.' });
      }
    },
  };
}
