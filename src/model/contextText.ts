/* The text half of context awareness: pure, so the preamble the model actually
 * receives can be asserted without an Obsidian workspace. */

export interface NoteContext {
  path: string;
  basename: string;
  selection: string | null;
  fromLine: number | null;
  toLine: number | null;
}

export const MAX_SELECTION_CHARS = 12_000;

export function selectionRangeLabel(ctx: NoteContext): string | null {
  if (ctx.fromLine === null || ctx.toLine === null) return null;
  return ctx.fromLine === ctx.toLine ? `L${ctx.fromLine}` : `L${ctx.fromLine}-${ctx.toLine}`;
}

/**
 * The context preamble prepended to a message. Plain, bounded, and visible in
 * the transcript, so what the model saw is always recoverable from the record.
 */
export function contextPreamble(ctx: NoteContext | null): string {
  if (!ctx) return '';
  const lines = [`Open note: ${ctx.path}`];
  if (ctx.selection) {
    const range = selectionRangeLabel(ctx);
    lines.push(`Selected text${range ? ` (${range})` : ''}:`);
    lines.push('---');
    lines.push(
      ctx.selection.length > MAX_SELECTION_CHARS
        ? `${ctx.selection.slice(0, MAX_SELECTION_CHARS)}\n[truncated]`
        : ctx.selection,
    );
    lines.push('---');
  }
  return lines.join('\n');
}

export function withContext(message: string, ctx: NoteContext | null): string {
  const preamble = contextPreamble(ctx);
  return preamble ? `${preamble}\n\n${message}` : message;
}
