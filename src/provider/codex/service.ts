/* One shared, lazily started `codex app-server` for everything that is not a
 * conversation: the session list, a stored thread's turns, the model
 * catalogue, sign-in status.
 *
 * A conversation owns its own process (session.ts), because a process is the
 * unit of interrupt and teardown. The store calls are different: they are
 * short, they come from the settings tab and the launcher menu at odd
 * moments, and starting a server for each (about a second on 2026-09-04)
 * would make the launcher menu open a second late every time. So they share
 * one process that starts on first use and goes away after a quiet minute.
 *
 * Launch facts (where the binary is, what environment it inherits) are
 * handed in by whoever resolved them last, the provider's `detect` or
 * `open`; until then the service resolves against the process environment
 * with the plugin's own PATH repair, which is what a fresh install has. */

import { CodexRpc } from './rpc';
import type { RpcLaunch } from './rpc';
import { buildChildEnv, resolveExecutable } from '../cli';
import type { PathEnvironment } from '../cli';
import { CODEX_INSTALL_HINT, hostPathEnvironment } from './host';

const IDLE_MS = 60_000;

interface Client {
  rpc: CodexRpc;
  ready: Promise<void>;
}

let launch: RpcLaunch | null = null;
let client: Client | null = null;
let idle: number | null = null;

/** Remember how to launch, from a detect or an open. */
export function configureLaunch(next: RpcLaunch): void {
  if (launch && launch.cliPath === next.cliPath && launch.cwd === next.cwd) return;
  launch = next;
  // A changed binary or cwd invalidates the running service.
  stopService();
}

function resolveLaunch(cwd: string): RpcLaunch {
  if (launch) return { ...launch, cwd };
  const env: PathEnvironment = hostPathEnvironment();
  const cliPath = resolveExecutable('codex', '', env, undefined, CODEX_INSTALL_HINT);
  return { cliPath, cwd, env: buildChildEnv(process.env, env) };
}

function touch(): void {
  if (idle !== null) window.clearTimeout(idle);
  idle = window.setTimeout(stopService, IDLE_MS);
}

async function ensure(cwd: string): Promise<CodexRpc> {
  if (client && client.rpc.alive) {
    touch();
    await client.ready;
    return client.rpc;
  }
  const rpc = new CodexRpc({
    onNotification: () => undefined,
    onServerRequest: (id) => rpc.respondError(id, -32601, 'the service connection answers no approvals'),
    onExit: () => {
      if (client?.rpc === rpc) client = null;
    },
  });
  rpc.start(resolveLaunch(cwd));
  const ready = rpc
    .request('initialize', {
      clientInfo: { name: 'icor-for-life-chat', title: 'ICOR for Life - AI Chat', version: PLUGIN_VERSION_FOR_INIT },
      capabilities: { experimentalApi: false },
    })
    .then(() => rpc.notify('initialized', {}));
  client = { rpc, ready };
  touch();
  await ready;
  return rpc;
}

/** The plugin version the handshake reports; set by the provider at install. */
let PLUGIN_VERSION_FOR_INIT = '0.0.0';
export function setHandshakeVersion(version: string): void {
  PLUGIN_VERSION_FOR_INIT = version;
}

/** Run one request against the shared server. Starts it when needed. */
export async function withService<T>(cwd: string, fn: (rpc: CodexRpc) => Promise<T>): Promise<T> {
  const rpc = await ensure(cwd);
  return fn(rpc);
}

/** Stop the shared server. Called on plugin unload and on a changed launch. */
export function stopService(): void {
  if (idle !== null) window.clearTimeout(idle);
  idle = null;
  client?.rpc.kill();
  client = null;
}
