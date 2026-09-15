/* The approval port. The SDK asks; the view answers; this file is the wire.
 *
 * Security posture, fixed here rather than in the UI so it cannot drift: the
 * plugin never grants a permission the user did not grant. There is no
 * auto-allow list, no "just this once for convenience" default, and no path
 * where a pending request resolves itself. When the query is aborted every
 * pending request resolves to a denial, so an abort during approval is a
 * closed promise, never a hung one. */

import type { ToolQuestion } from '../../model/types';
import type { ApprovalChoice, PendingApproval, QuestionAnswer } from '../types';

export type { ApprovalChoice, PendingApproval, QuestionAnswer } from '../types';

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
  /* QUESTIONS ARE A SECOND LANE, not a third `ApprovalChoice`. A question is
   * settled by an ANSWER, and `null` is the only other outcome it has: no
   * answer. Keeping the two lanes apart is what lets `close()` settle both
   * without either one having to pretend to be the other. */
  private readonly questions = new Map<string, (answer: QuestionAnswer | null) => void>();
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

  /**
   * Ask the member a QUESTION. Resolves with the answer, or with `null` when
   * the turn was aborted or the broker closed before one arrived - which is
   * what keeps an unanswered question from hanging a turn past the CLI's own
   * park deadline, exactly as a pending approval cannot hang one.
   */
  requestQuestion(
    input: Omit<PendingApproval, 'resolve'> & { questions: ToolQuestion[] },
    signal: AbortSignal,
  ): Promise<QuestionAnswer | null> {
    if (this.closed || signal.aborted) return Promise.resolve(null);
    return new Promise<QuestionAnswer | null>((resolve) => {
      const settle = (answer: QuestionAnswer | null): void => {
        if (!this.questions.has(input.toolUseId)) return;
        this.questions.delete(input.toolUseId);
        signal.removeEventListener('abort', onAbort);
        // The settled signal the view already listens to. An answered question
        // reads as allowed and an unanswered one as denied, because that is
        // what the tool call itself goes on to be.
        this.onSettled(input.toolUseId, answer ? 'allow-once' : 'deny');
        resolve(answer);
      };
      const onAbort = (): void => settle(null);
      signal.addEventListener('abort', onAbort, { once: true });
      this.questions.set(input.toolUseId, settle);
      // A question has no allow and no deny, so whatever a caller hands the
      // approval resolver, an unanswered question is a cancelled one.
      this.onRequest({ ...input, resolve: () => settle(null) });
    });
  }

  answer(toolUseId: string, choice: ApprovalChoice): void {
    this.pending.get(toolUseId)?.resolve(choice);
  }

  answerQuestion(toolUseId: string, answer: QuestionAnswer): void {
    this.questions.get(toolUseId)?.(answer);
  }

  /** Resolve every outstanding request as a denial, and every question as
   *  unanswered. Idempotent. */
  close(): void {
    this.closed = true;
    for (const entry of Array.from(this.pending.values())) entry.resolve('deny');
    for (const settle of Array.from(this.questions.values())) settle(null);
  }

  get size(): number {
    return this.pending.size + this.questions.size;
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
