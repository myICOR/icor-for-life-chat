/* One `codex app-server` process and the JSON-RPC 2.0 conversation over its
 * stdio, framed as one JSON object per line.
 *
 * Nothing here knows what a thread or a turn is. It knows ids, pending
 * promises, notifications, and the one thing the App Server does that a plain
 * client library does not expect: the SERVER sends requests too (approvals),
 * which need an answer on the same pipe with the same id. `onServerRequest`
 * is that door, and `respond` is the answer.
 *
 * Backpressure is real on a pipe: a burst of writes when stdin is full is
 * buffered by Node until `drain`, and a caller that writes faster than the
 * child reads sees `write` return false. The queue below keeps write order and
 * waits for `drain` rather than piling up in Node's own buffer without a
 * bound. Measured need on 2026-09-04: none (the plugin writes a few frames per
 * turn), but a client that assumes the pipe is infinite is a client that
 * hangs the day a large image is attached. */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RpcFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface RpcLaunch {
  cliPath: string;
  cwd: string;
  env: Record<string, string>;
}

export interface RpcHooks {
  onNotification: (method: string, params: unknown) => void;
  /** A request FROM the server. The handler must eventually `respond` or `respondError`. */
  onServerRequest: (id: number | string, method: string, params: unknown) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
    readonly data: unknown = undefined,
  ) {
    super(`${method}: ${message}`);
    this.name = 'RpcError';
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function isFrame(v: unknown): v is RpcFrame {
  return typeof v === 'object' && v !== null;
}

export class CodexRpc {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly queue: string[] = [];
  private draining = false;
  private exited = false;

  constructor(private readonly hooks: RpcHooks) {}

  get alive(): boolean {
    return this.child !== null && !this.exited;
  }

  /** Spawn `codex app-server`. Throws synchronously when the spawn itself fails. */
  start(launch: RpcLaunch): void {
    if (this.child) return;
    const child = spawn(launch.cliPath, ['app-server'], {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.on('error', (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('exit', (code, signal) => {
      this.exited = true;
      this.failAll(new Error(`codex app-server exited (${code ?? signal ?? 'unknown'})`));
      this.hooks.onExit?.(code, signal);
    });
    child.stdout.on('error', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.on('drain', () => this.flush());
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.receive(line));
    const errLines = createInterface({ input: child.stderr });
    errLines.on('line', (line) => this.hooks.onStderr?.(line));
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.child || this.exited) {
      return Promise.reject(new RpcError(method, null, 'the app server is not running'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  /** Terminate the child. Every pending promise rejects. Idempotent. */
  kill(): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.failAll(new Error('the app server was closed'));
    try {
      child.stdin.end();
    } catch {
      // Already closed.
    }
    if (!this.exited) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone.
      }
    }
  }

  private write(frame: RpcFrame): void {
    this.queue.push(`${JSON.stringify(frame)}\n`);
    this.flush();
  }

  private flush(): void {
    const child = this.child;
    if (!child || this.exited || this.draining) return;
    while (this.queue.length > 0) {
      const line = this.queue.shift() as string;
      const ok = child.stdin.write(line);
      if (!ok) {
        // Wait for 'drain'; the remaining lines keep their order in the queue.
        this.draining = true;
        child.stdin.once('drain', () => {
          this.draining = false;
          this.flush();
        });
        return;
      }
    }
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // The server wrote something that is not JSON on its JSON pipe. Not ours to interpret.
      this.hooks.onStderr?.(line);
      return;
    }
    if (!isFrame(parsed)) return;
    const hasId = parsed.id !== undefined && parsed.id !== null;
    if (hasId && parsed.method === undefined) {
      const id = typeof parsed.id === 'number' ? parsed.id : Number(parsed.id);
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (parsed.error) {
        entry.reject(new RpcError(entry.method, parsed.error.code ?? null, parsed.error.message ?? 'error', parsed.error.data));
      } else {
        entry.resolve(parsed.result);
      }
      return;
    }
    if (hasId && parsed.method !== undefined) {
      this.hooks.onServerRequest(parsed.id as number | string, parsed.method, parsed.params);
      return;
    }
    if (parsed.method !== undefined) this.hooks.onNotification(parsed.method, parsed.params);
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(new RpcError(entry.method, null, error.message));
    this.pending.clear();
  }
}
