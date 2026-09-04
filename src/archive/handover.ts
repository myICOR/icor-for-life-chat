/* The words of an archived conversation, shaped as the first message of a
 * new session on another runtime.
 *
 * Pure, so the shape can be asserted from a fixture. What travels is what the
 * archive holds as prose: the user's turns and the assistant's replies from
 * `conversation.md`. What does not travel, and the opening line says so to
 * the model: full tool results, thinking, approvals, images, the session id.
 * A continuation is a new conversation that has read the old one, never the
 * old one resumed (Axon, 2026-09-04, section e). */

/** The note body without its YAML frontmatter. */
function stripFrontmatter(source: string): string {
  if (!source.startsWith('---')) return source;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return source;
  return source.slice(end + 4).replace(/^\s*\n/, '');
}

export const HANDOVER_CAP = 60_000;

/**
 * The handover message, or an empty string when the note carries no turns.
 * Capped so a long thread does not blow the first prompt; the cut is stated
 * in the message itself rather than silent.
 */
export function handoverText(source: string, title: string): string {
  const body = stripFrontmatter(source).trim();
  if (!body || !/^## (You|The team)$/m.test(body)) return '';
  const cut = body.length > HANDOVER_CAP;
  const kept = cut ? body.slice(body.length - HANDOVER_CAP) : body;
  return [
    `This is the transcript of an earlier conversation ("${title}") that ran on a different AI runtime. Read it as context, then continue the work from where it stopped. Only the words below travelled: the earlier runtime's tool results, reasoning, approvals and images did not.`,
    cut ? `The transcript was longer than ${HANDOVER_CAP} characters; only its last part is included.` : '',
    '',
    '---',
    kept,
    '---',
    '',
    'Confirm in one line what the earlier conversation was working on, then wait for my next instruction.',
  ].filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
}
