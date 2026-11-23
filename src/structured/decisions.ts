/* The decision lifecycle, derived and never stored.
 *
 * A decision is RESOLVED when a LATER USER message contains its code, or when
 * the assistant surfaces the code again as CLEARED. A later DECISION or BLOCKED
 * surfacing of the same code opens it again: the latest word on a code wins.
 * That is the whole rule, and it is recomputed on every render rather than
 * written down anywhere, so the transcript is always the record and there is
 * no flag to fall out of sync. An assistant naming a code in prose is a
 * mention, never a resolution. */

import type { DecisionBlock } from './model';
import { isCode } from './model';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  /** Monotonic position in the conversation. */
  index: number;
  at: number;
}

export interface TrackedDecision {
  code: string;
  title: string;
  variant: DecisionBlock['variant'];
  /** Where it was first surfaced. */
  index: number;
  at: number;
  resolved: boolean;
  /** Every message index that names the code, the origin included. */
  mentions: number[];
}

/** Word-boundary match, so `4a3fk` inside `x4a3fk9` is not a mention.
 * The left boundary is `(^|[^a-z0-9])`, not a lookbehind: the `RegExp`
 * constructor throws on `(?<` on iOS before 16.4, and 0.13.0 is the first
 * mobile release (Flint, 2026-09-09). A string-built pattern slips past
 * `obsidianmd/regex-lookbehind`, which reads literals only; the hygiene
 * gate in `test/hygiene.test.mjs` greps both forms. Only `.test()` is
 * used, so the extra group changes no match index anyone reads. */
export function mentionsCode(text: string, code: string): boolean {
  if (!isCode(code)) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${code}(?![a-z0-9])`, 'i');
  return pattern.test(text);
}

export interface SurfacedDecision {
  decision: DecisionBlock;
  index: number;
  at: number;
}

/**
 * Record what one rendered block surfaced. Every block counts, so a later
 * CLEARED or DECISION for a code already known reaches `trackDecisions`; a
 * block that renders twice is recorded once.
 */
export function recordSurfaced(
  surfaced: SurfacedDecision[],
  decisions: DecisionBlock[],
  index: number,
  at: number,
): void {
  for (const decision of decisions) {
    if (surfaced.some((s) => s.decision.code === decision.code && s.index === index)) continue;
    surfaced.push({ decision, index, at });
  }
}

/**
 * Fold the transcript and every decision surfaced in it into current state.
 * A `cleared` block is a record of a gate that was already closed, so it
 * resolves without needing a user mention.
 */
export function trackDecisions(
  surfaced: SurfacedDecision[],
  transcript: TranscriptEntry[],
): TrackedDecision[] {
  const byCode = new Map<string, TrackedDecision>();
  const ordered = [...surfaced].sort((a, b) => a.index - b.index);
  for (const item of ordered) {
    const existing = byCode.get(item.decision.code);
    if (existing) {
      // A re-surfaced decision keeps its original age and takes the newer words.
      if (item.decision.title) existing.title = item.decision.title;
      existing.variant = item.decision.variant;
      continue;
    }
    byCode.set(item.decision.code, {
      code: item.decision.code,
      title: item.decision.title,
      variant: item.decision.variant,
      index: item.index,
      at: item.at,
      resolved: item.decision.variant === 'cleared',
      mentions: [],
    });
  }

  for (const tracked of byCode.values()) {
    // The latest word on the code decides: each surfacing opens or clears it,
    // and a later user message naming it resolves it.
    const words = ordered
      .filter((s) => s.decision.code === tracked.code)
      .map((s) => ({ index: s.index, resolved: s.decision.variant === 'cleared' }));
    for (const entry of transcript) {
      if (!mentionsCode(entry.text, tracked.code)) continue;
      tracked.mentions.push(entry.index);
      if (entry.role === 'user' && entry.index > tracked.index) words.push({ index: entry.index, resolved: true });
    }
    words.sort((a, b) => a.index - b.index);
    tracked.resolved = words[words.length - 1]?.resolved ?? false;
    tracked.mentions.sort((a, b) => a - b);
  }

  return Array.from(byCode.values()).sort((a, b) => a.index - b.index);
}

export function openDecisions(tracked: TrackedDecision[]): TrackedDecision[] {
  return tracked.filter((d) => !d.resolved);
}

/** `3 OPEN DECISIONS`, `1 OPEN DECISION`, or nothing at all. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 OPEN DECISION' : `${count} OPEN DECISIONS`;
}
