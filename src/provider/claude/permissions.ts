/* The approval port. The SDK asks; the view answers; this file is the wire.
 *
 * Security posture, fixed here rather than in the UI so it cannot drift: the
 * plugin never grants a permission the user did not grant. There is no
 * auto-allow list, no "just this once for convenience" default, and no path
 * where a pending request resolves itself. When the query is aborted every
 * pending request resolves to a denial, so an abort during approval is a
 * closed promise, never a hung one. */

import type { ApprovalChoice, PendingApproval } from '../types';

export type { ApprovalChoice, PendingApproval } from '../types';

export interface PermissionResultAllow<S> {
  behavior: 'allow';
  updatedInput: Record<string, unknown>;
  updatedPermissions?: S[];
}

export interface PermissionResultDeny {
  behavior: 'deny';
  message: string;
  interrupt?: boolean;
}

export type PermissionAnswer<S> = PermissionResultAllow<S> | PermissionResultDeny;

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private closed = false;

  constructor(
    private readonly onRequest: (request: PendingApproval) => void,
    private readonly onSettled: (toolUseId: string, choice: ApprovalChoice) => void,
  ) {}

  /** Ask the user. Resolves when the view answers, or on abort/close. */
  request(input: Omit<PendingApproval, 'resolve'>, signal: AbortSignal): Promise<ApprovalChoice> {
    if (this.closed || signal.aborted) return Promise.resolve('deny');
    return new Promise<ApprovalChoice>((resolve) => {
      const settle = (choice: ApprovalChoice): void => {
        if (!this.pending.has(input.toolUseId)) return;
        this.pending.delete(input.toolUseId);
        signal.removeEventListener('abort', onAbort);
        this.onSettled(input.toolUseId, choice);
        resolve(choice);
      };
      const onAbort = (): void => settle('deny');
      signal.addEventListener('abort', onAbort, { once: true });
      const entry: PendingApproval = { ...input, resolve: settle };
      this.pending.set(input.toolUseId, entry);
      this.onRequest(entry);
    });
  }

  answer(toolUseId: string, choice: ApprovalChoice): void {
    this.pending.get(toolUseId)?.resolve(choice);
  }

  /** Resolve every outstanding request as a denial. Idempotent. */
  close(): void {
    this.closed = true;
    for (const entry of Array.from(this.pending.values())) entry.resolve('deny');
  }

  get size(): number {
    return this.pending.size;
  }
}

export function toPermissionAnswer<S>(
  choice: ApprovalChoice,
  input: Record<string, unknown>,
  suggestions: S[] | undefined,
): PermissionAnswer<S> {
  if (choice === 'deny') {
    return { behavior: 'deny', message: 'The user denied this tool call.' };
  }
  if (choice === 'allow-always' && suggestions && suggestions.length > 0) {
    return { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions };
  }
  return { behavior: 'allow', updatedInput: input };
}
