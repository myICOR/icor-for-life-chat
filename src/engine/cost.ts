/* THE COST LINE. `chat-mobile-engine-spec-v1.md` section 4 / settings section
 * 3: "an estimated cost line under every reply on mobile (OpenRouter reports
 * cost per call; for Anthropic the plugin computes it from a price table
 * that lives in code and is updated with releases)."
 *
 * OpenRouter prices itself: its response's `usage.cost` is read straight off
 * the wire in `providers/openrouter.ts` and never touched here. Anthropic
 * bills the API key directly and reports no price, only token counts, so
 * this file is the price table that turns those counts into a number.
 *
 * ============================================================================
 * UPDATE WITH RELEASES. Anthropic changes model prices at its own pace, not
 * this plugin's. Whenever a model is added to the composer's picker (or an
 * existing one's price changes), update ANTHROPIC_PRICES below from
 * https://docs.anthropic.com/en/docs/about-claude/pricing - the one source of
 * truth; do not trust a third-party tracker. Prices here were checked against
 * that page on 2026-09-06 (Sonnet 5, Opus 5, Haiku 4.5 rows).
 * ============================================================================
 *
 * A model this table has no row for prices as `null`, never a guess: the
 * plugin's own rule, stated in `model/types.ts`, is that a number nobody
 * measured is absent, not estimated. Matched by prefix rather than an exact
 * dated snapshot id (`claude-sonnet-5-20260914` still matches the
 * `claude-sonnet-5` row) so a dated release does not silently fall out of the
 * table the day it ships. */

export interface AnthropicPriceRow {
  /** Matched against the model id as a prefix, longest match wins. */
  prefix: string;
  displayName: string;
  /** USD per million INPUT tokens, base (non-cached) rate. */
  inputPerMTok: number;
  /** USD per million OUTPUT tokens. */
  outputPerMTok: number;
  /** USD per million CACHE-READ tokens ("cache hits & refreshes"). */
  cacheReadPerMTok: number;
}

export const ANTHROPIC_PRICES: readonly AnthropicPriceRow[] = [
  { prefix: 'claude-opus-5', displayName: 'Claude Opus 5', inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
  { prefix: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  { prefix: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1 },
  // Older generations, kept for a member who pins an older model explicitly.
  { prefix: 'claude-opus-4', displayName: 'Claude Opus 4', inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5 },
  { prefix: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
  { prefix: 'claude-haiku-4', displayName: 'Claude Haiku 4', inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08 },
];

function rowFor(model: string): AnthropicPriceRow | null {
  const m = model.trim().toLowerCase();
  let best: AnthropicPriceRow | null = null;
  for (const row of ANTHROPIC_PRICES) {
    if (m.startsWith(row.prefix) && (!best || row.prefix.length > best.prefix.length)) best = row;
  }
  return best;
}

/**
 * USD for one Anthropic call, or null when the model has no priced row. Cache
 * reads are billed at their own (lower) rate; a caller with no cache-read
 * figure passes 0, which is a fact ("this call used no cache"), not a guess.
 */
export function estimateAnthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): number | null {
  const row = rowFor(model);
  if (!row) return null;
  const input = (inputTokens / 1_000_000) * row.inputPerMTok;
  const output = (outputTokens / 1_000_000) * row.outputPerMTok;
  const cacheRead = (cacheReadTokens / 1_000_000) * row.cacheReadPerMTok;
  return input + output + cacheRead;
}

/** The display name for a model this table prices, or null when it does not. */
export function anthropicModelDisplayName(model: string): string | null {
  return rowFor(model)?.displayName ?? null;
}
