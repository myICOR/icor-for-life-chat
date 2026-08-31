/* WHAT THE SESSION IS LAUNCHED WITH, decided once and in one place.
 *
 * This is a pure function over the mode because the decision it encodes was
 * wrong for a subtle reason and must never drift back. It used to live inline
 * as `if (mode === 'bypassPermissions') allowDangerouslySkipPermissions = true`,
 * which reads like the careful thing to write and was the entire cause of
 * "clicking Bypass does not bypass":
 *
 *   - This plugin opens ONE long-lived session per tab. The mode picker in the
 *     composer therefore acts on a process that is already running.
 *   - The CLI refuses to enter bypass at runtime unless the process was started
 *     with the flag. Its own words, captured on 2026-08-31: "Cannot set
 *     permission mode to bypassPermissions because the session was not launched
 *     with --dangerously-skip-permissions".
 *   - So arming the flag only when the LAUNCH mode was already bypass armed it
 *     exactly when it was not needed, and withheld it in every case where it
 *     was. The picker showed BYPASS; the session stayed in ask mode; every tool
 *     call went to a permission prompt.
 *
 * THE FLAG ARMS THE CAPABILITY; THE MODE IS THE CONTROL. That split is measured
 * rather than argued. Launched with the flag and `permissionMode: 'default'`,
 * the CLI reports `permissionMode=default` in its own init frame, `canUseTool`
 * is still invoked for every tool call, and a denied call still does not run:
 * the flag on its own changes nothing about what executes. All four
 * combinations of (launch mode, flag) were driven to a real tool call against
 * the real CLI before this shape was chosen.
 */

import type { PermissionModeName } from '../model/types';

export interface LaunchPermissions {
  /** The mode the session starts in. Exactly what the user chose, never widened. */
  permissionMode: PermissionModeName;
  /** Whether the CLI will ALLOW the mode to reach bypass, now or later. */
  allowDangerouslySkipPermissions: boolean;
}

export function launchPermissions(mode: PermissionModeName): LaunchPermissions {
  return {
    // Never substituted, never defaulted, never softened. A launcher that
    // quietly downgrades the mode is the same class of lie as a picker that
    // shows a mode the session is not in.
    permissionMode: mode,
    /* Always armed. The one thing that widens privilege here is the user's own
       explicit Bypass selection, and this makes that selection reachable
       instead of pretending it is unavailable. */
    allowDangerouslySkipPermissions: true,
  };
}
