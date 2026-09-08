/* THE OWN-KEY ENGINE'S TURN LOOP. "Tool-call loops handled inside the engine
 * so the view sees one stream of deltas and tool events, the same event
 * shape the Claude Code engine emits today" (task brief, matching
 * `docs/architecture.md`'s event spine). This file is where the two adapters'
 * `EngineDelta`s become `ChatEvent`s: it calls `ModelProvider.send()` in a
 * loop, running the six mobile tools between calls, until the model stops
 * asking for one.
 *
 * `user-turn` is NOT emitted here. On the desktop engine that event is built
 * by `ChatView.ts` when the composer sends, not by the session
 * (`grep 'user-turn' src/view/ChatView.ts`) - the same split holds here, so
 * this loop starts at `text-open` / `tool-call` and ends at `turn-end`.
 *
 * The hooks are `Pick<SessionHooks, ...>`, the exact shape
 * `ChatView.ensureSession()` already builds for the Claude session's
 * `onApprovalRequest` / `onApprovalSettled` (both already convert a
 * `PendingApproval` into a `tool-approval` ChatEvent themselves - this loop
 * never builds that event, it just calls the hook, same as the desktop
 * engine does). */

import type { ChatEvent, TurnUsage } from '../model/types';
import type { SessionHooks } from '../provider/types';
import { OwnKeyApprovalBroker, WriteApprovalGate } from './approval';
import { MOBILE_TOOLS, WRITE_TOOL_NAMES } from './tools/definitions';
import { mobileToolPurpose, mobileToolTarget } from './tools/purpose';
import { runVaultTool } from './tools/vaultTools';
import type { VaultToolsContext } from './tools/vaultTools';
import type { EngineContentPart, EngineDelta, EngineMessage, EngineUsage, ModelProvider } from './types';

export interface OwnKeyEngineConfig {
  provider: ModelProvider;
  toolCtx: VaultToolsContext;
  system: string;
  model: string;
  maxTokens: number;
}

export type OwnKeyHooks = Pick<SessionHooks, 'onEvent' | 'onApprovalRequest' | 'onApprovalSettled'>;

export interface TurnCost {
  inputTokens: number;
  outputTokens: number;
  /** Section 4's literal ask: `{inputTokens, outputTokens, estimatedUsd}`. Null
   * when nothing in the turn priced (an unpriced Anthropic model, or a
   * provider round that reported no usage at all - never a guess.) */
  estimatedUsd: number | null;
}

export interface TurnResult {
  /** The full message list, ready to hand back in as `priorHistory` on the
   * member's next message. */
  history: EngineMessage[];
  cost: TurnCost;
}

/* A guard against a runaway tool loop, not a limit the spec set: an own-key
 * conversation is billed per call, so a model that keeps calling tools
 * forever is a member's money, not just the plugin's CPU. Twelve round trips
 * is generous for anything the six-tool set can legitimately need and cheap
 * to raise later if a real conversation hits it. */
const MAX_TOOL_ROUNDS = 12;

function emptyUsage(): EngineUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

/**
 * Run one member turn: append their message to the running history, loop the
 * model against the six mobile tools until it stops asking for one, and
 * return the updated history plus the turn's token/cost totals.
 *
 * `writeGate` is owned by the CALLER (one per open conversation, not one per
 * turn) so "ask once per session" actually means the session, not the turn.
 */
export async function runOwnKeyTurn(
  priorHistory: readonly EngineMessage[],
  userText: string,
  config: OwnKeyEngineConfig,
  hooks: OwnKeyHooks,
  writeGate: WriteApprovalGate,
  signal: AbortSignal,
): Promise<TurnResult> {
  const history: EngineMessage[] = [...priorHistory, { role: 'user', content: userText }];
  const broker = new OwnKeyApprovalBroker(hooks.onApprovalRequest, hooks.onApprovalSettled);
  const startedAt = Date.now();

  let blockCounter = 0;
  let toolCounter = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCostUsd: number | null = null;
  let lastAssistantText = '';
  let erred = false;
  let turnEnded = false;

  const emit = (event: ChatEvent): void => hooks.onEvent(event);

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS && !turnEnded; round++) {
      if (signal.aborted) {
        emit({ kind: 'aborted', stream: null });
        broker.close();
        return { history, cost: { inputTokens: totalInput, outputTokens: totalOutput, estimatedUsd: totalCostUsd } };
      }

      let textBlockId: string | null = null;
      let textBuffer = '';
      const toolCalls: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }> = [];
      /* An object, not a bare `let`: TS keeps a closure-reassigned `let`
         narrowed to its LAST-SEEN literal at the declaration site rather than
         its declared union once the reassignment lives inside a callback
         `await`-ed elsewhere, which read `stopReason !== 'tool_use'` below as
         comparing two literals with no overlap. A property read carries no
         such narrowing. */
      const round: { stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other'; usage: EngineUsage; costUsd: number | null } = {
        stopReason: 'other',
        usage: emptyUsage(),
        costUsd: null,
      };

      await config.provider.send({
        messages: history,
        tools: [...MOBILE_TOOLS],
        system: config.system,
        model: config.model,
        maxTokens: config.maxTokens,
        signal,
        onDelta: (delta: EngineDelta) => {
          if (delta.type === 'text-delta') {
            if (textBlockId === null) {
              textBlockId = `ownkey-text-${++blockCounter}`;
              emit({ kind: 'text-open', blockId: textBlockId, stream: null });
            }
            textBuffer += delta.text;
            emit({ kind: 'text-delta', blockId: textBlockId, text: delta.text, stream: null });
          } else if (delta.type === 'tool-call') {
            const toolUseId = delta.id || `ownkey-tool-${++toolCounter}`;
            toolCalls.push({ toolUseId, name: delta.name, input: delta.input });
            emit({
              kind: 'tool-call',
              toolUseId,
              name: delta.name,
              target: mobileToolTarget(delta.name, delta.input),
              purpose: mobileToolPurpose(delta.name, delta.input),
              input: delta.input,
              stream: null,
            });
          } else if (delta.type === 'message-stop') {
            round.stopReason = delta.stopReason;
            round.usage = delta.usage;
            round.costUsd = delta.costUsd;
          } else if (delta.type === 'error') {
            erred = true;
            emit({ kind: 'error', message: delta.message, stream: null });
          }
        },
      });

      if (textBlockId !== null) {
        emit({ kind: 'text-final', blockId: textBlockId, text: textBuffer, stream: null });
        lastAssistantText = textBuffer;
      }
      totalInput += round.usage.inputTokens;
      totalOutput += round.usage.outputTokens;
      totalCacheRead += round.usage.cacheReadTokens;
      if (round.costUsd !== null) totalCostUsd = (totalCostUsd ?? 0) + round.costUsd;

      // The assistant's turn, as the model produced it: text (if any) then
      // every tool_use block, in call order - the shape both adapters expect
      // back on a LATER round so the model sees its own prior turn. Recorded
      // regardless of whether this round called a tool: a plain text reply
      // with nothing pushed here would vanish from the member's next
      // message's history, which is not a hypothetical - it was the first
      // shape of this loop, caught only by this test suite's own multi-turn
      // case, never by a single-turn one.
      const assistantParts: EngineContentPart[] = [];
      if (textBuffer) assistantParts.push({ type: 'text', text: textBuffer });
      for (const call of toolCalls) assistantParts.push({ type: 'tool_use', id: call.toolUseId, name: call.name, input: call.input });
      if (assistantParts.length > 0) history.push({ role: 'assistant', content: assistantParts });

      if (toolCalls.length === 0) {
        turnEnded = true;
        break;
      }

      const resultParts: EngineContentPart[] = [];
      for (const call of toolCalls) {
        if (signal.aborted) break;
        const needsConfirm = WRITE_TOOL_NAMES.has(call.name) && !writeGate.isOpen;
        if (needsConfirm) {
          const choice = await broker.request(
            {
              toolUseId: call.toolUseId,
              toolName: call.name,
              target: mobileToolTarget(call.name, call.input),
              purpose: mobileToolPurpose(call.name, call.input),
              title: `Let the AI ${mobileToolPurpose(call.name, call.input).toLowerCase()}?`,
            },
            signal,
          );
          writeGate.record(choice);
          if (choice === 'deny') {
            emit({ kind: 'tool-result', toolUseId: call.toolUseId, ok: false, detail: 'Denied by the user', output: '', stream: null });
            resultParts.push({ type: 'tool_result', toolUseId: call.toolUseId, content: 'Denied by the user.', isError: true });
            continue;
          }
        }
        const outcome = await runVaultTool(call.name, call.input, config.toolCtx);
        emit({ kind: 'tool-result', toolUseId: call.toolUseId, ok: outcome.ok, detail: outcome.detail, output: outcome.output, stream: null });
        resultParts.push({ type: 'tool_result', toolUseId: call.toolUseId, content: outcome.output || outcome.detail, isError: !outcome.ok });
      }
      history.push({ role: 'user', content: resultParts });

      if (round.stopReason !== 'tool_use') turnEnded = true;
    }
    if (!turnEnded) {
      // The `for` loop exhausted MAX_TOOL_ROUNDS without the model ever
      // stopping on its own - reported, not silently truncated.
      erred = true;
      emit({ kind: 'error', message: `Stopped after ${MAX_TOOL_ROUNDS} tool calls in one turn without a final answer.`, stream: null });
    }
  } catch (error) {
    broker.close();
    if (isAbortError(error) || signal.aborted) {
      emit({ kind: 'aborted', stream: null });
    } else {
      erred = true;
      emit({ kind: 'error', message: error instanceof Error ? error.message : String(error), stream: null });
    }
    return {
      history,
      cost: { inputTokens: totalInput, outputTokens: totalOutput, estimatedUsd: totalCostUsd },
    };
  }
  broker.close();

  const usage: TurnUsage = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    totalTokens: totalInput + totalOutput,
    costUsd: totalCostUsd ?? 0,
  };
  emit({
    kind: 'turn-end',
    usage,
    contextWindow: null,
    durationMs: Date.now() - startedAt,
    isError: erred,
    text: lastAssistantText,
    stream: null,
  });

  return { history, cost: { inputTokens: totalInput, outputTokens: totalOutput, estimatedUsd: totalCostUsd } };
}
