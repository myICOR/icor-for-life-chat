/* The Codex App Server, as a JSON-RPC process: `codex app-server` over stdio.
 * The client itself lives in `provider/jsonrpc.ts`, shared with the ACP
 * runtimes since 2026-09-04; this file only names the arguments. */

import { JsonRpcProcess } from '../jsonrpc';
import type { RpcLaunch } from '../jsonrpc';

export { RpcError } from '../jsonrpc';
export type { RpcFrame, RpcHooks, RpcLaunch } from '../jsonrpc';

export class CodexRpc extends JsonRpcProcess {
  override start(launch: RpcLaunch): void {
    super.start({ ...launch, args: ['app-server'], label: 'codex app-server' });
  }
}
