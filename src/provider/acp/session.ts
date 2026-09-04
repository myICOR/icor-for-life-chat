/* One live ACP conversation: one agent process, one session, for the life of
 * the tab.
 *
 * The protocol is request and notification, like the Codex App Server, with
 * the same two-way traffic: the AGENT asks for permission as a JSON-RPC
 * request with an id, and the answer goes back on the same pipe. The broker
 * below holds those ids until the view answers, and cancels every open one
 * when the session is torn down, so an abort during a permission request is
 * a closed promise and never a hung agent.
 *
 * What was measured and what was not (2026-09-04, Gemini CLI 0.58.0): the
 * handshake ran for real; `session/new` was refused for a missing key on the
 * probe machine, so prompts, updates, permissions and cancel are written from
 * the specification. `hooks.onRawMessage` records the first live one. */

import { JsonRpcProcess, RpcError } from '../jsonrpc';
import type { RpcLaunch } from '../jsonrpc';
import { AcpNormalizer, agentModeFor, approvalOf, optionFor } from './normalize';
import type { AcpRecipe } from './recipes';
import type {
  ApprovalChoice, PendingApproval, ProviderSession, SessionConfig, SessionHooks, SessionImage,
} from '../types';
import type { ModelChoice, PermissionModeName } from '../../model/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

interface Mode {
  id: string;
  name: string;
}

export class AcpSession implements ProviderSession {
  private readonly rpc: JsonRpcProcess;
  private readonly normalizer: AcpNormalizer;
  private readonly pending = new Map<string, { resolve: (choice: ApprovalChoice) => void }>();
  private sessionId: string | null = null;
  private modes: Mode[] = [];
  private currentModeId: string | null = null;
  private loadSession = false;
  private started = false;
  private disposed = false;
  private loading = false;
  private prompting = false;
  private starting: Promise<void> | null = null;
  private readonly queued: Array<{ text: string; images: SessionImage[] }> = [];
  private abortedFlag = false;
  private modeName: PermissionModeName;

  constructor(
    private readonly recipe: AcpRecipe,
    private readonly config: SessionConfig,
    private readonly launch: RpcLaunch,
    private readonly hooks: SessionHooks,
  ) {
    this.modeName = config.permissionMode;
    this.normalizer = new AcpNormalizer(config.cwd);
    this.rpc = new JsonRpcProcess({
      onNotification: (method, params) => this.onNotification(method, params),
      onServerRequest: (id, method, params) => this.onServerRequest(id, method, params),
      onStderr: (line) => this.hooks.onStderr?.(line),
      onExit: (code) => {
        if (this.disposed) return;
        this.closeApprovals();
        this.hooks.onEvent({
          kind: 'error',
          message: `${this.recipe.displayName} exited${code === null ? '' : ` with code ${code}`}.`,
          stream: null,
        });
      },
    });
  }

  get aborted(): boolean {
    return this.abortedFlag;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      this.rpc.start({ ...this.launch, args: this.recipe.args, label: `${this.recipe.command} ${this.recipe.args.join(' ')}`.trim() });
    } catch (error) {
      this.fail(error);
      return;
    }
    this.starting = this.handshake().catch((error) => this.fail(error));
  }

  /* Handshake, then open or load the session. The `session` event is emitted
     from the agent's answer, so nothing is stamped before the agent said it. */
  private async handshake(): Promise<void> {
    const init = await this.rpc.request('initialize', {
      protocolVersion: 1,
      // The agent already has the filesystem through its own tools; the plugin
      // advertises no fs or terminal capability (Lex and Vex, 2026-09-04).
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'icor-for-life-chat', title: 'ICOR for Life - AI Chat', version: this.config.pluginVersion ?? '0.0.0' },
    });
    this.hooks.onRawMessage?.(init);
    const caps = isRecord(init) && isRecord(init.agentCapabilities) ? init.agentCapabilities : {};
    this.loadSession = caps.loadSession === true;
    let result: unknown;
    if (this.config.resumeSessionId) {
      if (!this.loadSession) {
        throw new Error(`${this.recipe.displayName} cannot load a past session; start a new conversation and continue from the transcript instead.`);
      }
      /* The load REPLAYS the whole history as session/update notifications.
         The view has already painted that history from the archive, so the
         replay is swallowed here rather than rendered twice. */
      this.loading = true;
      try {
        result = await this.rpc.request('session/load', { sessionId: this.config.resumeSessionId, cwd: this.config.cwd, mcpServers: [] });
      } finally {
        this.loading = false;
      }
      this.sessionId = this.config.resumeSessionId;
    } else {
      result = await this.rpc.request('session/new', { cwd: this.config.cwd, mcpServers: [] });
      this.sessionId = isRecord(result) ? str(result.sessionId) : null;
    }
    this.hooks.onRawMessage?.(result);
    if (!this.sessionId) throw new Error(`${this.recipe.displayName} opened no session.`);
    const modes = isRecord(result) && isRecord(result.modes) ? result.modes : null;
    this.currentModeId = modes ? str(modes.currentModeId) : null;
    this.modes = modes && Array.isArray(modes.availableModes)
      ? modes.availableModes.filter(isRecord).map((m) => ({ id: str(m.id) ?? '', name: str(m.name) ?? str(m.id) ?? '' })).filter((m) => m.id)
      : [];
    for (const event of this.normalizer.sessionEvent({
      sessionId: this.sessionId,
      cwd: this.config.cwd,
      currentModeId: this.currentModeId,
      availableModes: this.modes,
      provider: this.recipe.id,
    }, this.modeName)) this.hooks.onEvent(event);
    // The requested mode, applied once the agent has said which modes exist.
    await this.applyMode(this.modeName, false);
    for (const item of this.queued.splice(0)) void this.prompt(item.text, item.images);
  }

  send(text: string, images: SessionImage[] = []): void {
    if (this.disposed) return;
    this.start();
    if (!this.sessionId || this.prompting) {
      // The session is still opening, or a prompt is running: ACP takes one
      // prompt at a time per session, so the message waits its turn.
      this.queued.push({ text, images });
      return;
    }
    void this.prompt(text, images);
  }

  private async prompt(text: string, images: SessionImage[]): Promise<void> {
    if (!this.sessionId) return;
    this.prompting = true;
    this.normalizer.promptStarted();
    const prompt: unknown[] = images.map((img) => ({ type: 'image', mimeType: img.mediaType, data: img.data }));
    if (text) prompt.push({ type: 'text', text });
    try {
      const result = await this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt });
      this.hooks.onRawMessage?.(result);
      const stop = isRecord(result) ? str(result.stopReason) : null;
      for (const event of this.normalizer.promptDone(stop)) this.hooks.onEvent(event);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof RpcError ? error.message : error instanceof Error ? error.message : String(error);
      for (const event of this.normalizer.promptFailed(message)) this.hooks.onEvent(event);
    } finally {
      this.prompting = false;
      const next = this.queued.shift();
      if (next && !this.disposed) void this.prompt(next.text, next.images);
    }
  }

  private onNotification(method: string, params: unknown): void {
    if (this.disposed) return;
    this.hooks.onRawMessage?.({ method, params });
    if (method !== 'session/update' || this.loading) return;
    const p = isRecord(params) ? params : {};
    const update = isRecord(p.update) ? p.update : null;
    if (!update) return;
    if (update.sessionUpdate === 'current_mode_update') {
      this.currentModeId = str(update.currentModeId);
      return;
    }
    for (const event of this.normalizer.update(update)) this.hooks.onEvent(event);
  }

  /* THE AGENT ASKS. A permission request names the tool call it is about, so
     the row the approval lands on is the row the call's updates will fill. */
  private onServerRequest(id: number | string, method: string, params: unknown): void {
    if (this.disposed) {
      this.rpc.respond(id, { outcome: { outcome: 'cancelled' } });
      return;
    }
    if (method === 'session/request_permission') {
      const shaped = approvalOf(params, this.config.cwd);
      const options = isRecord(params) ? params.options : [];
      if (!shaped) {
        this.rpc.respond(id, { outcome: { outcome: 'cancelled' } });
        return;
      }
      this.request(shaped, (choice) => {
        const optionId = optionFor(choice, options);
        this.rpc.respond(id, optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
      });
      return;
    }
    // fs/* and terminal/* are never advertised, so a request for them is a
    // protocol error on the agent's side; it is declined in words.
    this.rpc.respondError(id, -32601, `${method} is not supported by this client`);
  }

  private request(input: Omit<PendingApproval, 'resolve'>, answer: (choice: ApprovalChoice) => void): void {
    const settle = (choice: ApprovalChoice): void => {
      if (!this.pending.has(input.toolUseId)) return;
      this.pending.delete(input.toolUseId);
      answer(choice);
      this.hooks.onApprovalSettled(input.toolUseId, choice);
    };
    this.pending.set(input.toolUseId, { resolve: settle });
    this.hooks.onApprovalRequest({ ...input, resolve: settle });
  }

  answerApproval(toolUseId: string, choice: ApprovalChoice): void {
    this.pending.get(toolUseId)?.resolve(choice);
  }

  private closeApprovals(): void {
    for (const [, entry] of Array.from(this.pending)) entry.resolve('deny');
    this.pending.clear();
  }

  /** `session/cancel` is a notification; the running prompt answers `cancelled`. */
  async interrupt(): Promise<void> {
    this.closeApprovals();
    if (!this.sessionId || !this.prompting) return;
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
  }

  /**
   * The plugin's mode onto the agent's own modes, by name, and an honest
   * refusal when the agent advertises no such mode: the chip then keeps the
   * mode the process is really in, and the refusal names the agent.
   */
  async setPermissionMode(mode: PermissionModeName): Promise<boolean> {
    return this.applyMode(mode, true);
  }

  private async applyMode(mode: PermissionModeName, report: boolean): Promise<boolean> {
    if (!this.sessionId) {
      this.modeName = mode;
      return true;
    }
    const target = agentModeFor(mode, this.modes);
    if (!target) {
      if (report) this.hooks.onModeRefused?.(mode, `${this.recipe.displayName} has no mode for this; it stays in ${this.currentModeId ?? 'its own mode'}.`);
      return false;
    }
    if (target === this.currentModeId) {
      this.modeName = mode;
      return true;
    }
    try {
      await this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId: target });
      this.currentModeId = target;
      this.modeName = mode;
      return true;
    } catch (error) {
      if (report) this.hooks.onModeRefused?.(mode, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  get permissionMode(): PermissionModeName {
    return this.modeName;
  }

  /* Model selection is the one thing the protocol left to each agent (a
     stabilised config option, Gemini's `unstable_setSessionModel`, OpenCode's
     `session/set_model`). The recipe names the method; a refusal is swallowed
     here because the composer never offered a catalogue for these runtimes
     in the first place (`supportedModels` is empty), so nothing on screen
     claims the switch happened. */
  async setModel(model: string): Promise<void> {
    if (!this.sessionId || !model) return;
    try {
      if (this.recipe.modelQuirk === 'unstable_setSessionModel') {
        await this.rpc.request('unstable_setSessionModel', { sessionId: this.sessionId, modelId: model });
      } else if (this.recipe.modelQuirk === 'session/set_model') {
        await this.rpc.request('session/set_model', { sessionId: this.sessionId, modelId: model });
      } else {
        await this.rpc.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: model });
      }
    } catch {
      // No catalogue was offered, so no control claimed the switch.
    }
  }

  /** ACP v1 publishes no catalogue on the handshake; empty stays empty. */
  async supportedModels(): Promise<ModelChoice[]> {
    return [];
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    this.hooks.onEvent({ kind: 'error', message, stream: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortedFlag = true;
    this.closeApprovals();
    this.rpc.kill();
  }

  async drain(): Promise<void> {
    await this.starting?.catch(() => undefined);
  }
}
