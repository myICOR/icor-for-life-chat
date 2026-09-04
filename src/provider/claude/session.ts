/* One live conversation: one query() in streaming-input mode, for the life of
 * the tab.
 *
 * Streaming input rather than a query per turn, because the control channel is
 * only open in that mode: interrupt(), setModel() and setPermissionMode() mid
 * turn all require it, and a queued message can be handed over without tearing
 * the process down and resuming it.
 *
 * WHAT A MID-TURN MESSAGE DOES, measured 2026-09-04 against SDK 0.3.226 and
 * the installed CLI with `tools/followup-entry.ts` (haiku, a 30-number counting
 * task, a second message pushed 1.5 s after the first text block opened):
 *
 *   sent #1 -> system/init -> thinking -> text-open
 *   sent #2 (mid-turn)
 *   ... the first turn runs to its end untouched ...
 *   assistant text (all 30 numbers) -> result/success  (turn-end #1)
 *   system/init (same session id) -> thinking -> assistant text "PINEAPPLE"
 *   -> result/success                                   (turn-end #2)
 *
 * So the CLI QUEUES a second user message and answers it as its own turn
 * after the running one ends. It is not merged into the running turn, it does
 * not interrupt it, and the queued message is not echoed back as a `user`
 * frame. The queued turn announces itself with a fresh `system/init`. The
 * composer therefore says "Queue" while a turn runs, Enter never stops
 * anything, and the view keeps the composer busy across the turn boundary
 * Before this the send pill BECAME the Stop control mid-turn, so Enter on a
 * follow-up interrupted the work the follow-up was about.
 *
 * SECOND MEASUREMENT, same day, in the live vault (opus, a turn running Bash
 * and Glob calls, the follow-up pushed while a tool was running): the running
 * turn ANSWERED the follow-up itself and exactly ONE result arrived. So the
 * CLI hands a queued message to the model at its next call when there is one,
 * and only opens a separate turn when the running turn had no further model
 * call to give it to. The plugin cannot tell the two apart at a turn boundary,
 * which is why model/followups.ts treats every turn end as idle and re-arms on
 * the first signal of a turn the CLI starts on its own. */

import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Normalizer } from './normalize';
import { toolPurpose, toolTarget } from '../tooling';
import { launchPermissions } from './launch';
import { ApprovalBroker, toPermissionAnswer } from './permissions';
import type {
  ApprovalChoice, ProviderSession, SessionConfig, SessionHooks, SessionImage,
} from '../types';
import type { EffortName, ModelChoice, PermissionModeName } from '../../model/types';

export type { SessionConfig, SessionHooks, SessionImage } from '../types';

/** The message body: a bare string without images, blocks with them. */
function userContent(text: string, images: SessionImage[]): unknown {
  if (!images.length) return text;
  const blocks: unknown[] = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data },
  }));
  if (text) blocks.push({ type: 'text', text });
  return blocks;
}
import { STRUCTURED_REPLY_PROMPT } from '../../constants';

/**
 * What the Claude session launches with: the executable the provider found
 * and the environment the child inherits. Resolved by `claudeProvider.open`
 * from the neutral `SessionConfig`, never by the view, because which file is
 * the runtime is a fact about THIS provider.
 */
export interface ClaudeLaunch {
  cliPath: string;
  env: Record<string, string>;
}

/** A push queue the SDK can consume as the prompt stream. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffer: SDKUserMessage[] = [];
  private waiting: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
    const waiter = this.waiting;
    if (waiter) {
      this.waiting = null;
      waiter({ value: message, done: false });
      return;
    }
    this.buffer.push(message);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const waiter = this.waiting;
    if (waiter) {
      this.waiting = null;
      // A done:true result's value is never read; the iterator contract
      // types it optional, so no cast is needed to hand back undefined.
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.buffer.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.ended) {
          return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

export class ChatSession implements ProviderSession {
  /* Deliberately NOT an Options.abortController.
   *
   * Obsidian runs the plugin in a renderer, where AbortController is the DOM
   * one. Handing that signal to the SDK puts it in front of Node's `events`,
   * which rejects a cross-realm signal outright:
   *   TypeError: The "eventTargets" argument must be an instance of
   *   EventEmitter or EventTarget. Received an instance of AbortSignal
   * The SDK builds its own controller when the option is omitted, so the stop
   * path here is interrupt() plus closing the generator, and this signal is
   * only ever used for our own listeners. Found by driving the real plugin;
   * every headless test passed with the option set. */
  private readonly abortController = new AbortController();
  private readonly input = new InputQueue();
  private readonly normalizer = new Normalizer();
  private readonly broker: ApprovalBroker;
  private handle: Query | null = null;
  private pump: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly config: SessionConfig,
    private readonly launch: ClaudeLaunch,
    private readonly hooks: SessionHooks,
  ) {
    this.broker = new ApprovalBroker(hooks.onApprovalRequest, hooks.onApprovalSettled);
  }

  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  start(): void {
    if (this.handle || this.disposed) return;
    try {
      this.handle = query({ prompt: this.input, options: this.buildOptions() });
    } catch (error) {
      // A launch that throws must reach the user. Before this the view sat on
      // Stop forever with the reason only in the developer console.
      this.fail(error);
      return;
    }
    this.pump = this.consume(this.handle);
  }

  /* One user turn, with any images the composer collected.
   *
   * A message with no images keeps the plain STRING content it always had.
   * That is not tidiness: the string and the single-text-block array are not
   * interchangeable everywhere downstream, and the string form is the one this
   * plugin's whole transcript path has been exercised against. Images switch
   * it to the block array, which is the only form that can carry them, and the
   * text block goes LAST so the question reads after the picture it is about. */
  send(text: string, images: SessionImage[] = []): void {
    if (this.disposed) return;
    this.start();
    if (!this.handle) return;
    try {
      this.input.push({
        type: 'user',
        message: { role: 'user', content: userContent(text, images) },
        parent_tool_use_id: null,
      } as SDKUserMessage);
    } catch (error) {
      this.fail(error);
    }
  }

  /* The provider's own model catalogue, or an empty list when the CLI is too
   * old to answer. Empty is reported as empty and never backfilled with a
   * guess: a picker offering models this build cannot actually select is
   * worse than a picker that says it has nothing to offer yet. */
  async supportedModels(): Promise<ModelChoice[]> {
    try {
      const rows = await this.handle?.supportedModels();
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => ({
        value: String(row.value ?? ''),
        displayName: String(row.displayName ?? row.value ?? ''),
        description: String(row.description ?? ''),
        supportedEffortLevels: Array.isArray(row.supportedEffortLevels)
          ? row.supportedEffortLevels.filter((l): l is EffortName =>
              l === 'low' || l === 'medium' || l === 'high' || l === 'xhigh')
          : null,
      })).filter((row) => row.value !== '');
    } catch {
      return [];
    }
  }

  private fail(error: unknown): void {
    this.hooks.onEvent({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
      stream: null,
    });
  }

  answerApproval(toolUseId: string, choice: ApprovalChoice): void {
    this.broker.answer(toolUseId, choice);
  }

  /** Stop the turn without tearing the session down. */
  async interrupt(): Promise<void> {
    this.broker.close();
    try {
      await this.handle?.interrupt();
    } catch {
      // An interrupt on a process that already exited is not an error here.
    }
  }

  /** Close the stream so the SDK runs its own teardown and kills the child. */
  private async endStream(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    try {
      await handle?.return(undefined);
    } catch {
      // Returning an already-finished generator is not an error here.
    }
  }

  /* Switch the running session's mode, and REPORT a refusal rather than eat it.
   *
   * This used to be a bare try/empty-catch, and the empty catch was the whole
   * bug behind "Bypass does not bypass". The CLI refuses the switch outright
   * with `Cannot set permission mode to bypassPermissions because the session
   * was not launched with --dangerously-skip-permissions`, the catch swallowed
   * it, and the composer went on showing BYPASS over a session still running in
   * ask mode - a control that lies, which is worse than a control that is
   * missing. Measured against the real CLI on 2026-08-31: switching into bypass
   * from a session launched without the flag throws every time; the same switch
   * on a session launched WITH it succeeds and the tool then actually runs.
   *
   * Resolves true when the mode is live, false when the provider refused. The
   * caller owns what the user is told; this function owns only the truth. */
  async setPermissionMode(mode: PermissionModeName): Promise<boolean> {
    if (!this.handle) return false;
    try {
      await this.handle.setPermissionMode(mode);
      return true;
    } catch (error) {
      this.hooks.onModeRefused?.(
        mode,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async setModel(model: string): Promise<void> {
    try {
      await this.handle?.setModel(model || undefined);
    } catch {
      // Same.
    }
  }

  /** Tear everything down: no orphaned process, no pending promise, no listener. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.broker.close();
    this.input.end();
    if (!this.abortController.signal.aborted) this.abortController.abort();
    void this.endStream();
  }

  /** Resolves when the message pump has finished. Used by tests and unload. */
  async drain(): Promise<void> {
    await this.pump?.catch(() => undefined);
  }

  private async consume(handle: Query): Promise<void> {
    try {
      for await (const message of handle) {
        if (this.disposed) break;
        this.hooks.onRawMessage?.(message);
        for (const event of this.normalizer.normalize(message)) {
          this.hooks.onEvent(event);
        }
      }
    } catch (error) {
      // Teardown is not an event. dispose() aborts the controller on purpose,
      // and a view that is already gone must not be told its turn was stopped.
      if (this.disposed) {
        return;
      }
      if (error instanceof AbortError || this.abortController.signal.aborted) {
        this.hooks.onEvent({ kind: 'aborted', stream: null });
      } else {
        this.hooks.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          stream: null,
        });
      }
    } finally {
      this.broker.close();
    }
  }

  private buildOptions(): Options {
    const { config, launch } = this;
    const options: Options = {
      cwd: config.cwd,
      env: launch.env,
      pathToClaudeCodeExecutable: launch.cliPath,
      includePartialMessages: true,
      forwardSubagentText: true,
      // No system prompt of our own. The CLI preset plus the vault's own
      // CLAUDE.md (loaded because settingSources is left at its default, which
      // includes 'project') is the entire instruction surface.
      systemPrompt: config.structuredReplies
        ? { type: 'preset', preset: 'claude_code', append: STRUCTURED_REPLY_PROMPT }
        : { type: 'preset', preset: 'claude_code' },
      canUseTool: async (toolName, input, ctx) => {
        const choice = await this.broker.request(
          {
            toolUseId: ctx.toolUseID ?? `${toolName}:${ctx.requestId}`,
            toolName,
            target: toolTarget(toolName, input),
            purpose: toolPurpose(toolName, input, config.cwd),
            title: ctx.title ?? `Claude wants to run ${toolName}`,
          },
          ctx.signal,
        );
        return toPermissionAnswer(choice, input, ctx.suggestions);
      },
    };
    if (config.model) options.model = config.model;
    if (config.effort) options.effort = config.effort;
    if (config.resumeSessionId) options.resume = config.resumeSessionId;
    if (this.hooks.onStderr) options.stderr = this.hooks.onStderr;
    // The launch permissions are decided in one pure place; see launch.ts for
    // why the flag is armed regardless of the mode, and what it does not do.
    const guards = launchPermissions(config.permissionMode);
    options.permissionMode = guards.permissionMode;
    options.allowDangerouslySkipPermissions = guards.allowDangerouslySkipPermissions;
    return options;
  }
}
