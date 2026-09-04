/* The text half of context awareness: pure, so the preamble the model actually
 * receives can be asserted without an Obsidian workspace. */

import { contextRefsBlock } from './context';
import type { ContextRef } from './context';

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
export function contextPreamble(ctx: NoteContext | null, refs: readonly ContextRef[] = []): string {
  /* The refs block is appended AFTER the open-note block and only when there
     are refs, so a message with no refs produces exactly the text it always
     did - the existing assertions on this function are the proof. */
  const extra = contextRefsBlock(refs, ctx?.path ?? null);
  if (!ctx) return extra;
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
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

export function withContext(
  message: string,
  ctx: NoteContext | null,
  refs: readonly ContextRef[] = [],
): string {
  const preamble = contextPreamble(ctx, refs);
  return preamble ? `${preamble}\n\n${message}` : message;
}
