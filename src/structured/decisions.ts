/* The decision lifecycle, derived and never stored.
 *
 * A decision is RESOLVED when a LATER USER message contains its code. That is
 * the whole rule, and it is recomputed on every render rather than written down
 * anywhere, so the transcript is always the record and there is no flag to fall
 * out of sync. An assistant repeating a code is a re-surface, never a
 * resolution: only the user's own pen closes a decision. */

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

/** Word-boundary match, so `4a3fk` inside `x4a3fk9` is not a mention. */
export function mentionsCode(text: string, code: string): boolean {
  if (!isCode(code)) return false;
  const pattern = new RegExp(`(?<![a-z0-9])${code}(?![a-z0-9])`, 'i');
  return pattern.test(text);
}

export interface SurfacedDecision {
  decision: DecisionBlock;
  index: number;
  at: number;
}

/**
 * Fold the transcript and every decision surfaced in it into current state.
 * A `cleared` block is a record of a gate that was already closed, so it starts
 * resolved without needing a user mention.
 */
export function trackDecisions(
  surfaced: SurfacedDecision[],
  transcript: TranscriptEntry[],
): TrackedDecision[] {
  const byCode = new Map<string, TrackedDecision>();
  for (const item of surfaced) {
    const existing = byCode.get(item.decision.code);
    if (existing) {
      // A re-surfaced decision keeps its original age and title.
      if (!existing.title && item.decision.title) existing.title = item.decision.title;
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
    for (const entry of transcript) {
      if (!mentionsCode(entry.text, tracked.code)) continue;
      tracked.mentions.push(entry.index);
      if (entry.role === 'user' && entry.index > tracked.index) tracked.resolved = true;
    }
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
