/* THE CONFIRM HOOK for the two write tools (append to a note, create a note).
 * "Write tools call a confirm hook the view will implement"
 * (`chat-mobile-engine-spec-v1.md` section 5). This is that hook's broker:
 * the engine asks, the mobile view answers, and this file is the wire between
 * them - the same shape as `provider/claude/permissions.ts`'s
 * `ApprovalBroker`, duplicated here (renamed to avoid colliding with that
 * class in the pure test bundle, which star-exports both) rather than
 * imported from it, so the own-key engine has no cross-import into a
 * specific runtime's folder (it
 * imports only the neutral `ApprovalChoice` / `PendingApproval` types from
 * `provider/types.ts`, the same seam `model/settings.ts` already reads
 * `ProviderId` from).
 *
 * "Write tools ask once per session": `allow-always` is the existing
 * three-way vocabulary's own answer to that, not a new mode. Once the user
 * picks it for one write call, `WriteApprovalGate` below remembers and skips
 * the prompt for every later write call in the same engine turn sequence. */

import type { ApprovalChoice, PendingApproval } from '../provider/types';

export type { ApprovalChoice, PendingApproval } from '../provider/types';

export class OwnKeyApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private closed = false;

  constructor(
    private readonly onRequest: (request: PendingApproval) => void,
    private readonly onSettled: (toolUseId: string, choice: ApprovalChoice) => void,
  ) {}

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

  close(): void {
    this.closed = true;
    for (const entry of Array.from(this.pending.values())) entry.resolve('deny');
  }
}

/**
 * Once-per-session memory for write-tool approval. A single flag, not one per
 * tool: the spec's "write tools ask once per session" reads as one trust
 * decision covering both append and create, not two separate ones a member
 * would have to grant back to back on their first save.
 */
export class WriteApprovalGate {
  private granted = false;

  /** True when this call needs no prompt: already granted this session. */
  get isOpen(): boolean {
    return this.granted;
  }

  /** Record the user's answer. `allow-always` opens the gate for the rest of
   * the session; `allow-once` and `deny` leave it closed for next time. */
  record(choice: ApprovalChoice): void {
    if (choice === 'allow-always') this.granted = true;
  }
}
