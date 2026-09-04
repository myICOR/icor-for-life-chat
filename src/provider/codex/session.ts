/* One live Codex conversation: one `codex app-server` process, one thread, for
 * the life of the tab.
 *
 * The App Server is a request and notification protocol rather than a stream
 * of frames, so the shape here differs from the Claude session in one way that
 * matters: the SERVER asks questions. An approval arrives as a JSON-RPC
 * request with an id, and the answer goes back on the same pipe. The broker
 * below holds those ids until the view answers, and resolves every open one
 * as a decline when the session is torn down, so an abort during an approval
 * is a closed promise and never a hung server.
 *
 * What was measured and what was not (2026-09-04, codex-cli 0.143.0): the
 * handshake, thread start, turn start, the failure path and every store call
 * ran for real; the model-output path (deltas, tool items, approvals, token
 * usage) is written from the server's own schema because the ChatGPT sign-in
 * on this machine was revoked and every turn failed 401 before the model was
 * reached. The first signed-in turn is the first live measurement of that
 * path, and `hooks.onRawMessage` records it. */

import { CodexRpc, RpcError } from './rpc';
import type { RpcLaunch } from './rpc';
import { CodexNormalizer, codexToolInput } from './normalize';
import { codexMode } from './modes';
import type { CodexMode } from './modes';
import { configureLaunch } from './service';
import { toolPurpose } from '../tooling';
import type {
  ApprovalChoice, PendingApproval, ProviderSession, SessionConfig, SessionHooks, SessionImage,
} from '../types';
import type { EffortName, ModelChoice, PermissionModeName } from '../../model/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The App Server's word for the plugin's answer. */
function decisionOf(choice: ApprovalChoice): 'accept' | 'acceptForSession' | 'decline' {
  switch (choice) {
    case 'allow-always':
      return 'acceptForSession';
    case 'allow-once':
      return 'accept';
    default:
      return 'decline';
  }
}

/** The plugin's four effort names are a subset of the server's; anything else is dropped. */
function effortsOf(row: Record<string, unknown>): EffortName[] | null {
  const raw = Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts : null;
  if (!raw) return null;
  const out: EffortName[] = [];
  for (const entry of raw) {
    const name = isRecord(entry) ? str(entry.reasoningEffort) : str(entry);
    if (name === 'low' || name === 'medium' || name === 'high' || name === 'xhigh') out.push(name);
  }
  return out;
}

/** The server's catalogue in the plugin's shape. Hidden rows stay hidden. */
export function modelChoicesOf(result: unknown): ModelChoice[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  const out: ModelChoice[] = [];
  for (const row of result.data) {
    if (!isRecord(row) || row.hidden === true) continue;
    const value = str(row.model) ?? str(row.id);
    if (!value) continue;
    out.push({
      value,
      displayName: str(row.displayName) ?? value,
      description: str(row.description) ?? '',
      supportedEffortLevels: effortsOf(row),
    });
  }
  return out;
}

export class CodexSession implements ProviderSession {
  private readonly rpc: CodexRpc;
  private readonly normalizer: CodexNormalizer;
  private readonly pending = new Map<string, { id: number | string; resolve: (choice: ApprovalChoice) => void }>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private mode: CodexMode;
  private modeName: PermissionModeName;
  private model: string;
  private readonly effort: EffortName;
  private started = false;
  private disposed = false;
  private starting: Promise<void> | null = null;
  private readonly queued: Array<{ text: string; images: SessionImage[] }> = [];
  private abortedFlag = false;

  constructor(
    private readonly config: SessionConfig,
    private readonly launch: RpcLaunch,
    private readonly hooks: SessionHooks,
  ) {
    this.modeName = config.permissionMode;
    this.mode = codexMode(config.permissionMode);
    this.model = config.model;
    this.effort = config.effort;
    this.normalizer = new CodexNormalizer(config.cwd);
    this.rpc = new CodexRpc({
      onNotification: (method, params) => this.onNotification(method, params),
      onServerRequest: (id, method, params) => this.onServerRequest(id, method, params),
      onStderr: (line) => this.hooks.onStderr?.(line),
      onExit: (code) => {
        if (this.disposed) return;
        this.closeApprovals();
        this.hooks.onEvent({
          kind: 'error',
          message: `The Codex app server exited${code === null ? '' : ` with code ${code}`}.`,
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
      this.rpc.start(this.launch);
    } catch (error) {
      this.fail(error);
      return;
    }
    configureLaunch(this.launch);
    this.starting = this.handshake().catch((error) => this.fail(error));
  }

  /* Handshake, then start or resume the thread. The `session` event is
     emitted from the thread response: that is where the id and the model
     come from, so nothing here is stamped before the server said it. */
  private async handshake(): Promise<void> {
    await this.rpc.request('initialize', {
      // Lex, 2026-09-04: an honest client name, never a first-party one.
      clientInfo: { name: 'icor-for-life-chat', title: 'ICOR for Life - AI Chat', version: this.config.pluginVersion ?? '0.0.0' },
      capabilities: { experimentalApi: false },
    });
    this.rpc.notify('initialized', {});
    const params: Record<string, unknown> = {
      cwd: this.config.cwd,
      approvalPolicy: this.mode.approvalPolicy,
      sandbox: this.mode.sandbox,
    };
    if (this.model) params.model = this.model;
    const result = this.config.resumeSessionId
      ? await this.rpc.request('thread/resume', { ...params, threadId: this.config.resumeSessionId })
      : await this.rpc.request('thread/start', params);
    this.hooks.onRawMessage?.(result);
    const thread = isRecord(result) && isRecord(result.thread) ? result.thread : null;
    this.threadId = thread ? str(thread.id) : null;
    if (!this.threadId) throw new Error('Codex started no thread.');
    if (isRecord(result) && str(result.model)) this.model = str(result.model) ?? this.model;
    for (const event of this.normalizer.sessionEvent(result, this.mode)) this.hooks.onEvent(event);
    for (const item of this.queued.splice(0)) void this.turn(item.text, item.images);
  }

  send(text: string, images: SessionImage[] = []): void {
    if (this.disposed) return;
    this.start();
    if (!this.threadId) {
      // The thread is still being started; the message waits for it.
      this.queued.push({ text, images });
      return;
    }
    void this.turn(text, images);
  }

  private async turn(text: string, images: SessionImage[]): Promise<void> {
    if (!this.threadId) return;
    const input: unknown[] = images.map((img) => ({ type: 'image', url: `data:${img.mediaType};base64,${img.data}` }));
    if (text) input.push({ type: 'text', text });
    try {
      if (this.turnId) {
        /* A turn is running: the App Server has `turn/steer` for exactly this
           (schema, 0.143.0). It appends the input to the running turn, which is
           what a queued follow-up means. Not yet measured against a signed-in
           server; a refusal falls through to a fresh turn once the running
           one ends. */
        try {
          await this.rpc.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.turnId, input });
          return;
        } catch (error) {
          if (!(error instanceof RpcError)) throw error;
          this.queued.push({ text, images });
          return;
        }
      }
      const result = await this.rpc.request('turn/start', {
        threadId: this.threadId,
        input,
        approvalPolicy: this.mode.approvalPolicy,
        sandboxPolicy: this.mode.sandboxPolicy,
        ...(this.model ? { model: this.model } : {}),
        ...(this.effort ? { effort: this.effort } : {}),
      });
      this.hooks.onRawMessage?.(result);
      const turn = isRecord(result) && isRecord(result.turn) ? result.turn : null;
      this.turnId = turn ? str(turn.id) : null;
    } catch (error) {
      this.fail(error);
    }
  }

  private onNotification(method: string, params: unknown): void {
    if (this.disposed) return;
    this.hooks.onRawMessage?.({ method, params });
    if (method === 'turn/completed') {
      this.turnId = null;
    }
    for (const event of this.normalizer.notification(method, params)) this.hooks.onEvent(event);
    if (method === 'turn/completed' && this.queued.length > 0) {
      const next = this.queued.shift();
      if (next) void this.turn(next.text, next.images);
    }
  }

  /* THE SERVER ASKS. Every approval request carries the item it is about, so
     the row the approval lands on is the same row the item's frames will fill. */
  private onServerRequest(id: number | string, method: string, params: unknown): void {
    if (this.disposed) {
      this.rpc.respondError(id, -32000, 'the session is closed');
      return;
    }
    const p = isRecord(params) ? params : {};
    const itemId = str(p.itemId) ?? `${method}:${String(id)}`;
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const item = method === 'item/commandExecution/requestApproval'
        ? { type: 'commandExecution', command: str(p.command) ?? '', commandActions: p.commandActions }
        : { type: 'fileChange', changes: Array.isArray(p.changes) ? p.changes : [] };
      const shaped = codexToolInput(item, this.config.cwd);
      const reason = str(p.reason);
      this.ask(id, itemId, shaped.name, shaped.target, shaped.purpose, reason ? `Codex asks: ${reason}` : `Codex wants to run ${shaped.name}`);
      return;
    }
    if (method === 'item/permissions/requestApproval') {
      const reason = str(p.reason) ?? 'wider permissions for this turn';
      const request: Omit<PendingApproval, 'resolve'> = {
        toolUseId: itemId,
        toolName: 'Bash',
        target: reason,
        purpose: toolPurpose('Bash', { command: '', description: `Grant ${reason}` }, this.config.cwd),
        title: `Codex asks for ${reason}`,
      };
      this.request(request, (choice) => {
        if (choice === 'deny') this.rpc.respondError(id, -32000, 'declined by the user');
        else this.rpc.respond(id, { permissions: p.permissions ?? {}, scope: choice === 'allow-always' ? 'session' : 'turn' });
      });
      return;
    }
    // Anything else the server asks for (attestation, MCP elicitation) is
    // declined in words rather than left hanging.
    this.rpc.respondError(id, -32601, `${method} is not supported by this client`);
  }

  private ask(id: number | string, itemId: string, toolName: string, target: string, purpose: string, title: string): void {
    this.request({ toolUseId: itemId, toolName, target, purpose, title }, (choice) => {
      this.rpc.respond(id, { decision: decisionOf(choice) });
    });
  }

  private request(input: Omit<PendingApproval, 'resolve'>, answer: (choice: ApprovalChoice) => void): void {
    const settle = (choice: ApprovalChoice): void => {
      if (!this.pending.has(input.toolUseId)) return;
      this.pending.delete(input.toolUseId);
      answer(choice);
      this.hooks.onApprovalSettled(input.toolUseId, choice);
    };
    this.pending.set(input.toolUseId, { id: 0, resolve: settle });
    this.hooks.onApprovalRequest({ ...input, resolve: settle });
  }

  answerApproval(toolUseId: string, choice: ApprovalChoice): void {
    this.pending.get(toolUseId)?.resolve(choice);
  }

  /** Decline everything outstanding. The server never waits on a closed tab. */
  private closeApprovals(): void {
    for (const [, entry] of Array.from(this.pending)) entry.resolve('deny');
    this.pending.clear();
  }

  async interrupt(): Promise<void> {
    this.closeApprovals();
    if (!this.threadId || !this.turnId) return;
    try {
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
    } catch {
      // "no active turn to interrupt" (measured): the turn ended on its own.
    }
  }

  /**
   * The mode is applied on the next turn, which is how the App Server takes
   * it (no thread-level setter in 0.143.0). True, because the next turn WILL
   * carry it; the composer's label shows the provider's own words beside ours.
   */
  async setPermissionMode(mode: PermissionModeName): Promise<boolean> {
    this.modeName = mode;
    this.mode = codexMode(mode);
    return true;
  }

  get permissionMode(): PermissionModeName {
    return this.modeName;
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
  }

  async supportedModels(): Promise<ModelChoice[]> {
    try {
      await this.starting;
      const result = await this.rpc.request('model/list', { limit: 50 });
      return modelChoicesOf(result);
    } catch {
      return [];
    }
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
