/* The SDK's usage report, translated into the plugin's own rate-limit events.
 * Pure: no SDK import, so the test bundle can feed it a shape. The reasons it
 * exists and its limits are at the head of session.ts (2026-09-06). */

import type { ChatEvent, RateLimitFacts } from '../../model/types';

/** The usage report's windows as rate-limit events. Pure, so a test can feed it a shape. */
export function usageEvents(
  report: unknown,
  wireStatus: ReadonlyMap<RateLimitFacts['window'], RateLimitFacts['status']> = new Map(),
): ChatEvent[] {
  if (typeof report !== 'object' || report === null) return [];
  const limits = (report as Record<string, unknown>).rate_limits;
  if (typeof limits !== 'object' || limits === null) return [];
  const out: ChatEvent[] = [];
  const windows: RateLimitFacts['window'][] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
  for (const window of windows) {
    const row = (limits as Record<string, unknown>)[window];
    if (typeof row !== 'object' || row === null) continue;
    const pct = (row as Record<string, unknown>).utilization;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    const resets = (row as Record<string, unknown>).resets_at;
    const resetsAt = typeof resets === 'string' ? Date.parse(resets) : NaN;
    out.push({
      kind: 'rate-limit',
      facts: {
        window,
        // A percent on the report, a fraction on the wire: one shape leaves here.
        utilization: Math.min(1, Math.max(0, pct / 100)),
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
        status: wireStatus.get(window) ?? 'allowed',
      },
      stream: null,
    });
  }
  return out;
}

