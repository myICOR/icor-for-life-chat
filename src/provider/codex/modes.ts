/* The plugin's four permission modes, in the App Server's two vocabularies.
 *
 * Codex has no single "mode": it has an approval policy (when to ask) and a
 * sandbox policy (what a command may touch), and every combination is legal.
 * The plugin's modes are the ones its composer offers, so the map below is
 * the whole translation, stated once, pure, and asserted in test/codex.test.mjs.
 *
 * Measured on 2026-09-04 against codex-cli 0.143.0 (tools/codex-probe.mjs):
 * `thread/start` accepts `approvalPolicy` as one of `untrusted | on-request |
 * never` and `sandbox` as a mode string (`read-only` was accepted); `turn/start`
 * takes the same `approvalPolicy` and a `sandboxPolicy` OBJECT
 * (`{type: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess'}`). Both are
 * per-call, so a mid-conversation switch is applied on the next turn rather
 * than through a separate method: there is no `thread/setMode` in 0.143.0.
 *
 * Bypass stays a per-conversation choice and never a saved default, on this
 * provider as on Claude (Vex's rule, restated by Lex as a compliance condition
 * on 2026-09-04): `dangerFullAccess` is the mode every provider's usage terms
 * are written against, and the plugin never launches into it unasked. */

import type { PermissionModeName } from '../../model/types';

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexSandboxPolicy =
  | { type: 'readOnly' }
  | { type: 'workspaceWrite' }
  | { type: 'dangerFullAccess' };

export interface CodexMode {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  sandboxPolicy: CodexSandboxPolicy;
}

const MODES: Record<PermissionModeName, CodexMode> = {
  default: { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } },
  plan: { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } },
  acceptEdits: { approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } },
  bypassPermissions: { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } },
};

export function codexMode(mode: PermissionModeName): CodexMode {
  return MODES[mode] ?? MODES.default;
}

/** The provider's own words for a mode, shown beside ours so the chip does not lie. */
export function codexModeLabel(mode: PermissionModeName): string {
  const m = codexMode(mode);
  return `${m.approvalPolicy}, ${m.sandbox}`;
}
