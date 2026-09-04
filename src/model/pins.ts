/* PINNED PROMPTS, the pure half.
 *
 * A long conversation scrolls its own question out of sight. The first prompt
 * is what the whole thread is FOR, so it is pinned above the stream from the
 * moment it is sent, and any later prompt can be pinned beside it. Pins stack,
 * each folded to its first line, and open on a click to the full text.
 *
 * Everything here is a function over plain data, and deliberately so: which
 * prompt counts as first, what a fold shows, and what survives a reload are
 * questions with one right answer each, which makes them a script's job and
 * assertable without a workspace. `PinTray.ts` owns the pixels. */

export interface PinnedPrompt {
  /** The transcript index as a string: the key the user well carries too. */
  key: string;
  /** The user's words as sent, without the context preamble. */
  text: string;
  index: number;
  /** True for the first prompt, which the plugin pins on its own. */
  auto: boolean;
}

/** What a prompt looks like before it is a pin. */
export interface PinCandidate {
  key: string;
  text: string;
  index: number;
}

/** How many characters of the first line a folded pin shows. */
export const FOLD_CHARS = 140;

/**
 * The first prompt of a conversation, pinned by the plugin, and only while
 * no pin exists yet. A tab that already carries pins (a reload, a resume
 * with a stored tray) keeps them exactly as they were: an automatic pin that
 * reappeared after the user removed it would be the plugin overruling a
 * choice it had watched being made.
 */
export function pinFirstPrompt(pins: readonly PinnedPrompt[], entry: PinCandidate): PinnedPrompt[] {
  if (pins.length > 0) return [...pins];
  if (!entry.text.trim()) return [...pins];
  return [{ ...entry, auto: true }];
}

/** Pin the prompt if it is not pinned, unpin it if it is. Order stays by index. */
export function togglePin(pins: readonly PinnedPrompt[], entry: PinCandidate): PinnedPrompt[] {
  if (pins.some((p) => p.key === entry.key)) return pins.filter((p) => p.key !== entry.key);
  return [...pins, { ...entry, auto: false }].sort((a, b) => a.index - b.index);
}

export function unpin(pins: readonly PinnedPrompt[], key: string): PinnedPrompt[] {
  return pins.filter((p) => p.key !== key);
}

export function isPinned(pins: readonly PinnedPrompt[], key: string): boolean {
  return pins.some((p) => p.key === key);
}

/**
 * The folded view: the first non-empty line, cut with an ellipsis when it is
 * longer than `max`. A prompt that opens with blank lines folds to its first
 * real line rather than to nothing.
 */
export function firstLine(text: string, max = FOLD_CHARS): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** True when the fold hides something: more lines, or a cut first line. */
export function isFolded(text: string, max = FOLD_CHARS): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 1) return true;
  return (lines[0]?.length ?? 0) > max;
}

/* THE LEAF STATE, defensively read.
 *
 * Obsidian hands `setState` whatever it stored, which after an upgrade may be
 * an older shape or nothing at all. A tray that threw on an unexpected value
 * would take the whole tab down with it, so every field is checked and an
 * entry that fails the check is dropped rather than guessed at. */

export function pinsToState(pins: readonly PinnedPrompt[]): unknown[] {
  return pins.map((p) => ({ key: p.key, text: p.text, index: p.index, auto: p.auto }));
}

export function pinsFromState(raw: unknown): PinnedPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: PinnedPrompt[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key : null;
    const text = typeof rec.text === 'string' ? rec.text : null;
    const index = typeof rec.index === 'number' && Number.isFinite(rec.index) ? rec.index : null;
    if (key === null || text === null || index === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text, index, auto: rec.auto === true });
  }
  return out.sort((a, b) => a.index - b.index);
}
