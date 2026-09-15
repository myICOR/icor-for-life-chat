/* AskUserQuestion: how it actually reaches a host, measured, not inferred.
 *
 * MEASURED 2026-09-15 against the installed CLI 2.1.272 and SDK 0.3.226 with
 * `tools/question-entry.ts`. The harness declared
 * `supportedDialogKinds: ['ask_user_question']` and wired `onUserDialog`, so a
 * dialog of that kind would have been logged if one existed.
 *
 *   wire assistant tool_use:AskUserQuestion
 *   canUseTool AskUserQuestion
 *     input {"questions":[{"question":"Which colour do you prefer?",
 *            "header":"Colour","options":[{"label":"Red","description":"..."},
 *            {"label":"Blue","description":"..."}],"multiSelect":false}]}
 *     answering {...input, "answers":{"Which colour do you prefer?":"Red"}}
 *   wire user tool_result "Your questions have been answered:
 *            \"Which colour do you prefer?\"=\"Red\". You can now continue
 *            with these answers in mind."
 *   dialogCalls=0
 *
 * So there is NO `ask_user_question` dialog kind and `onUserDialog` is the
 * wrong door. The CLI carries exactly two `request_user_dialog` kinds at this
 * version, `refusal_fallback_prompt` and `auto_mode_outside_reads`, and
 * neither is this. AskUserQuestion is a TOOL whose `checkPermissions` always
 * answers `ask`, so the question arrives as an ordinary permission request
 * with the questions in its input, and the tool's own `call` then reads
 * `answers`, `response` and `annotations` OUT OF ITS OWN INPUT. The host
 * answers by allowing the call with those fields added.
 *
 * THE ANSWER IS BOUNDED, and the bound is the CLI's, not ours. A permission
 * answer that changes the call is normally refused outright ("The permission
 * answer changed the tool call, and this session runs a call only as it was
 * asked. Nothing ran."). AskUserQuestion is exempt through its own admitter,
 * which admits exactly four added fields - `answers`, `annotations`,
 * `response`, `followUp` - only when the shown input does not already carry
 * them, refuses `afkTimeoutMs` outright as a host-only field, and requires
 * every other field to come back deep-equal to what was shown. Hence
 * `answeredInput` spreads the input untouched and adds nothing else.
 *
 * Caps, read from the same admitter: 8192 characters per answer string and
 * per `response`, 32768 across all answer text. A multi-select answer is ONE
 * string, the labels joined with ", " and any label containing `", "` or a
 * double quote JSON-quoted. That is what `joinChoices` does. */

import type { ChatEvent, ToolQuestion, ToolQuestionOption } from '../model/types';
import type { PendingApproval, QuestionAnswer } from './types';

/** The one tool that asks rather than acts. */
export const QUESTION_TOOL = 'AskUserQuestion';

/** Every string the answer carries is bounded by the CLI's own admitter. */
export const ANSWER_CAP = 8192;

/**
 * The questions in a tool call, or null when this call is not one.
 *
 * Read defensively: an unknown shape yields null and never throws, which is
 * the same rule every normaliser in this plugin follows. A call that parses
 * to no question at all is not a question card either - it falls through to
 * the ordinary approval path rather than drawing an empty card.
 */
export function parseQuestions(toolName: string, input: unknown): ToolQuestion[] | null {
  if (toolName !== QUESTION_TOOL) return null;
  if (typeof input !== 'object' || input === null) return null;
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return null;
  const questions: ToolQuestion[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!question) continue;
    const options: ToolQuestionOption[] = [];
    if (Array.isArray(row.options)) {
      for (const candidate of row.options) {
        if (typeof candidate !== 'object' || candidate === null) continue;
        const option = candidate as Record<string, unknown>;
        const label = typeof option.label === 'string' ? option.label : '';
        if (!label) continue;
        options.push({
          label,
          description: typeof option.description === 'string' ? option.description : '',
        });
      }
    }
    questions.push({
      question,
      header: typeof row.header === 'string' ? row.header : '',
      multiSelect: row.multiSelect === true,
      options,
    });
  }
  return questions.length > 0 ? questions : null;
}

/**
 * One multi-select answer as the one string the CLI expects: the labels joined
 * with ", ", and a label that could be mistaken for that separator quoted so
 * the CLI's own splitter puts it back together whole.
 */
export function joinChoices(labels: string[]): string {
  return labels
    .map((label) => (label.includes(', ') || label.includes('"') ? JSON.stringify(label) : label))
    .join(', ');
}

/**
 * The `updatedInput` an answered question is allowed back with: the shown
 * input, byte for byte, plus `answers` and - only when the member typed one -
 * `response`. Nothing else, for the reason in this file's header. An empty or
 * whitespace-only free text is not a `response`: an empty string would read to
 * the model as an answer the member gave.
 */
export function answeredInput(
  input: Record<string, unknown>,
  answer: QuestionAnswer,
): Record<string, unknown> {
  const answers: Record<string, string> = {};
  for (const [question, value] of Object.entries(answer.answers)) {
    if (!value) continue;
    answers[question] = value.slice(0, ANSWER_CAP);
  }
  const next: Record<string, unknown> = { ...input, answers };
  const response = (answer.response ?? '').trim();
  if (response) next.response = response.slice(0, ANSWER_CAP);
  return next;
}

/** Did the member actually answer anything? An empty answer is not an answer. */
export function isAnswered(answer: QuestionAnswer): boolean {
  if ((answer.response ?? '').trim() !== '') return true;
  return Object.values(answer.answers).some((value) => value !== '');
}

/**
 * The one place a pending request becomes an event.
 *
 * A request that carries questions is a QUESTION, and it is the only thing
 * that distinguishes the two: both arrive on the same hook, from the same
 * broker. Keeping the decision here rather than in the view is what lets it be
 * tested without a DOM, and what keeps a second surface from deciding it
 * differently.
 */
export function approvalEvent(request: PendingApproval): ChatEvent {
  if (request.questions && request.questions.length > 0) {
    return {
      kind: 'tool-question',
      toolUseId: request.toolUseId,
      questions: request.questions,
      stream: null,
    };
  }
  return {
    kind: 'tool-approval',
    toolUseId: request.toolUseId,
    name: request.toolName,
    target: request.target,
    purpose: request.purpose,
    stream: null,
  };
}
