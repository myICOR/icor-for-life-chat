/* The Codex App Server, as a JSON-RPC process: `codex app-server` over stdio.
 * The client itself lives in `provider/jsonrpc.ts` (it was shared with the
 * ACP runtimes while they were in the build, 2026-09-04 to 2026-09-06);
 * this file only names the arguments. */

import { JsonRpcProcess } from '../jsonrpc';
import type { RpcLaunch } from '../jsonrpc';

export { RpcError } from '../jsonrpc';
export type { RpcFrame, RpcHooks, RpcLaunch } from '../jsonrpc';

export class CodexRpc extends JsonRpcProcess {
  override start(launch: RpcLaunch): void {
    super.start({ ...launch, args: ['app-server'], label: 'codex app-server' });
  }
}
