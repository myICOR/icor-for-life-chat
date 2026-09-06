/* THE OWN-KEY ENGINE'S OWN VOCABULARY. Pure: no Obsidian import, no vendor
 * SDK import. `chat-mobile-engine-spec-v1.md` sections 1 and 2 (Larry,
 * 2026-09-06, Tom decision m3a) name the shape directly: one provider
 * interface, `send({messages, tools, system, model, maxTokens, onDelta,
 * signal})`, with two adapters behind it (Anthropic direct, OpenRouter). This
 * file is that interface plus the neutral message/tool/delta shapes the two
 * adapters translate their own wire formats into and out of.
 *
 * This is a SEPARATE seam from `src/provider/types.ts`. That seam is agent
 * RUNTIMES: a child process or a JSON-RPC service with its own session
 * lifecycle, approval broker and mode switching. This one is a single model
 * API call with tool use, run in a loop inside `toolLoop.ts` until the model
 * stops asking for tools. Nothing here is added to `ProviderId` or the
 * registry in `src/provider/registry.ts` - the own-key engine is a third,
 * independent thing the mobile view opens instead of a `ProviderSession`, not
 * a fourth entry in that seam's picker. */

/** One block of a message's content. Mirrors the union every provider's wire
 * format reduces to and every provider's wire format can be built back from. */
export type EngineContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface EngineMessage {
  role: 'user' | 'assistant';
  /** A bare string for the common case; blocks once tool use enters the turn. */
  content: string | EngineContentPart[];
}

/** A tool definition in the plugin's own words. Each adapter converts this
 * into its vendor's own tool-schema shape (`toAnthropicTools`, `toOpenAiTools`
 * in `tools/definitions.ts`). */
export interface EngineToolDef {
  name: string;
  description: string;
  /** A JSON Schema object, the shape every current model API wants. */
  inputSchema: Record<string, unknown>;
}

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  /** Only ever set from a measured value on the wire (cache reads Anthropic
   * reports, or 0 when the API did not report any). Never guessed. */
  cacheReadTokens: number;
}

/* ONE DELTA VOCABULARY FOR BOTH ADAPTERS, so `toolLoop.ts` never learns a wire
 * format either. A tool call is delivered WHOLE, never as JSON fragments: both
 * adapters buffer a call's streamed argument fragments internally and emit
 * exactly one `tool-call` delta once the arguments parse, the same rule
 * `docs/architecture.md` states for the Claude Code provider ("a tool call is
 * read from the completed message, never from a partial stream"). */
export type EngineDelta =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'message-stop';
      /** Why the model stopped, in the plugin's own words. 'tool_use' means the
       * loop should run the calls and send another `send()`; anything else ends
       * the turn. */
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
      usage: EngineUsage;
      /** USD for this one call, when the wire reported one (OpenRouter) or the
       * price table could price it (Anthropic). Null, never estimated from
       * nothing: an unpriced model shows no cost rather than a wrong one. */
      costUsd: number | null;
    }
  | { type: 'error'; message: string };

export interface SendParams {
  messages: EngineMessage[];
  tools: EngineToolDef[];
  system: string;
  model: string;
  maxTokens: number;
  onDelta: (delta: EngineDelta) => void;
  signal: AbortSignal;
}

export type ModelProviderId = 'anthropic' | 'openrouter';

/** One live call to one vendor's model API. Stateless across calls: the tool
 * loop in `toolLoop.ts` owns the running message list and calls `send` again
 * for every round trip. */
export interface ModelProvider {
  readonly id: ModelProviderId;
  readonly displayName: string;
  send(params: SendParams): Promise<void>;
}

/** One raw HTTP request, transport-neutral. `body` is already the JSON text. */
export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

/**
 * Where an adapter gets its bytes. Two implementations exist: `transport.ts`
 * (real, `fetch` for `stream` and Obsidian's `requestUrl` for `requestFull`)
 * and a fixture-replaying fake in the test suite. Injected rather than
 * imported so the adapters stay Obsidian-free and their tests never touch a
 * network.
 *
 * `stream` may reject, or its returned iterable may throw on first pull -
 * both are the "streaming did not work here" signal the adapter catches and
 * falls back on. That is the runtime detection `chat-mobile-engine-spec-v1.md`
 * section 5 asks for: no `Platform.isMobile` check, just "did the attempt
 * work". */
export interface Transports {
  stream(req: TransportRequest): AsyncIterable<string>;
  requestFull(req: TransportRequest): Promise<{ status: number; bodyText: string }>;
}
