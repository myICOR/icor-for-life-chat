/* THE READOUT STRIP: chrome, never louder than the content above it.
 *
 * ONE LAW GOVERNS EVERY READOUT HERE, and it exists because the opposite
 * shipped. On 2026-08-29 this strip rendered plan-usage figures with no
 * measurement behind them, substituting a duplicated local token total in a
 * session where no rate-limit event had ever arrived. The fallback was DELETED
 * rather than corrected, and this is the rule that replaced it:
 *
 *   A readout without a measurement renders NO DIGITS. It is ABSENT. There is
 *   no zero, no dash, no placeholder, no greyed value, no estimate, no "not
 *   yet", and above all no substitution from a different source. A readout may
 *   never be computed from another readout's data.
 *
 * It is uniform across all eight readouts on purpose: a rule with an exception
 * is a rule somebody finds the exception to. An unmeasured fact contributes
 * zero elements and zero width; the strip does not reserve a slot for it and
 * does not mark that it is missing. The explanation of why a switched-on
 * readout is not there lives in its settings row, never in the strip - every
 * placeholder is chrome apologising for itself.
 *
 * The substitution clause names the defect that actually happened. Plan usage
 * comes from the provider's rate-limit events and from nothing else. A local
 * token total is not a plan figure that is merely imprecise; it is a different
 * quantity wearing the plan's label. `PLAN_WINDOWS` below carries the same
 * discipline one level down: a window this map does not know renders no fact,
 * because a label naming the wrong wall is confidently wrong, which is strictly
 * worse than absent.
 *
 * Three further rules decide the rest.
 *
 * AN ICON may replace a fact's LABEL only when it carries an accessible name in
 * words, no glyph is used twice, the glyph depicts the FACT rather than the
 * category the fact belongs to, and - on a percentage - it depicts DIRECTION as
 * well as subject. Exactly two survive: `timer` on ELAPSED and `bot` on AGENTS.
 * `gauge` retired from the context fact when the ring arrived, because a dial
 * glyph beside an actual dial is one glyph used twice. `clock` is banned
 * outright: three time facts ride this strip and a clock face cannot carry the
 * difference between any two of them.
 *
 * EVERY PERCENTAGE NAMES ITS DIRECTION. There is no default reading: DISK 42%
 * reads as used, BATTERY 42% reads as remaining, and this strip carries one of
 * each. The direction word joins the label cell in the faint voice, so a fact
 * renders [ring] LABEL [DIRECTION] value [STATE].
 *
 * COLOUR AND THE RING ARE BOTH PROPERTIES OF BUDGETS, and the same fence
 * carries both. A budget is a quantity depleting toward a wall the user will
 * hit: the context window, the plan allowance. A readout - a token count, an
 * agent count, a clock, a duration - has no wall, therefore no threshold, no
 * state, no colour, and no denominator for an arc to be a fraction OF. The
 * ceiling on each is DERIVED from the budget count rather than allowed as a
 * number, so a third budget would raise both together and that is correct.
 * `escalate` at the foot of `buildFacts` is where that stops being a
 * convention: a fact that is not a budget cannot leave `quiet` and cannot keep
 * a ring, whatever its author wrote. */

import type { ChatState, RateLimitFacts } from './types';
import { compactNumber, shortDuration } from './format';

export type FactTone = 'quiet' | 'warning' | 'danger';

export type FactId =
  | 'context'
  | 'plan'
  | 'tokensIn'
  | 'tokensOut'
  | 'elapsed'
  | 'agents'
  | 'sessionStart'
  | 'sessionUpdated';

/**
 * Left to right, always. It is not configurable and it does not reorder on
 * state: chrome that rearranges itself pulls the eye it exists to leave alone.
 */
export const RENDER_ORDER: readonly FactId[] = [
  'context', 'plan', 'tokensIn', 'tokensOut', 'elapsed', 'agents', 'sessionStart', 'sessionUpdated',
];

export interface Fact {
  id: FactId;
  /** A lucide name, or null when the fact keeps its text label. */
  icon: string | null;
  label: string;
  value: string;
  /** The fact named in words. Mandatory, icon or not. Short: one clause. */
  accessibleName: string;
  /**
   * The tooltip, and the settings-row description, from ONE string. Three lines
   * in a fixed shape - what it counts / what it excludes / where it comes from -
   * plus a fourth on the plan fact at CRIT, where the only thing that changes a
   * decision is when the wall lifts.
   */
  longForm: string[];
  tone: FactTone;
  /**
   * `USED` or `LEFT`, in the label cell's faint voice, for any value whose
   * reading depends on which way it runs. Null where nothing is left to have a
   * direction (the overage window) or where the value is not a proportion.
   */
  direction: string | null;
  /**
   * A quantity depleting toward a wall. ONLY a budget may escalate and only a
   * budget may wear a ring, and the strip's ceiling on each is DERIVED from
   * this count rather than allowed as a number.
   */
  budget: boolean;
  /**
   * The fraction of the budget CONSUMED, 0 to 1, or null on every readout.
   *
   * The arc depicts consumption on EVERY ring, always, and it is never a
   * picture of the printed digits: `7D LEFT 21%` prints 21 and draws 79. Under
   * "arc = printed number" a fuller context ring would be worse and a fuller
   * plan ring better - two dials on one strip inverting each other, and a dial
   * is read before its label is. Under "arc = consumption" a fuller arc always
   * means less headroom, on every ring, forever.
   */
  ring: number | null;
}

/** The state word that rides beside an escalated fact. */
export function stateWord(tone: FactTone): string | null {
  return tone === 'danger' ? 'CRIT' : tone === 'warning' ? 'WARN' : null;
}

/**
 * The accessible name, with the escalation named in words. A sighted user gets
 * a coloured arc plus `WARN`; a screen-reader user must get the same two facts,
 * or hue is the sole carrier of a state (SC 1.4.1).
 */
export function factAriaLabel(fact: Fact): string {
  if (fact.tone === 'quiet') return fact.accessibleName;
  return `${fact.accessibleName}. ${fact.tone === 'danger' ? 'Critical' : 'Warning'}.`;
}

/* THE LONG FORMS, authored once and consumed twice: by the tooltip and,
 * verbatim, by the readout's settings-row description. Two copies of the string
 * would be two things to keep true.
 *
 * The subagent asymmetry is stated on BOTH token faces and on the context face,
 * because it looks inconsistent until you know why and a user will not guess
 * it: tokens are SPEND and spend is pooled, context is ROOM and room is
 * per-window. Every subagent turn costs the same account and so joins the
 * total; no subagent turn takes a line out of THIS conversation's window, so
 * none joins the percentage. */
export const FACT_TOOLTIPS: Record<FactId, readonly string[]> = {
  context: [
    "How much of the model's context window this conversation is using.",
    'Counts this conversation only. Subagents run in their own context windows and do not shorten this one.',
    "From the provider's own context-window figure. No figure, no readout.",
  ],
  plan: [
    "How much of your plan's allowance is left in the window the provider is currently reporting.",
    'Shows one window at a time, the nearest wall. Never computed from local token counts.',
    "From the provider's rate-limit events only. No event, no readout, which is why this can be blank for a whole session.",
  ],
  tokensIn: [
    'Fresh input tokens sent to the model in this session.',
    'Includes every subagent session. Excludes cache reads.',
    "From the provider's own usage totals.",
  ],
  tokensOut: [
    'Output tokens the model produced in this session.',
    'Includes every subagent session.',
    "From the provider's own usage totals.",
  ],
  elapsed: [
    'How long the current turn has been running.',
    "Resets each turn. Not the session's total time.",
    "Counted from the turn's first event.",
  ],
  agents: [
    'Subagent sessions running right now.',
    'Excludes finished and failed ones. The chips above the composer carry those.',
    "Counted from this session's own subagent events.",
  ],
  sessionStart: [
    'When this session began.',
    'On a resumed session this is the original start, not the time you reopened it.',
    'From the session event. Never the time the plugin loaded.',
  ],
  sessionUpdated: [
    'When this session last changed.',
    'Any event counts, not only your messages.',
    'From the last event received.',
  ],
};

/** The name each readout wears in settings, in words. */
export const FACT_NAMES: Record<FactId, string> = {
  context: 'Context used',
  plan: 'Plan allowance',
  tokensIn: 'Tokens in',
  tokensOut: 'Tokens out',
  elapsed: 'Turn elapsed',
  agents: 'Running agents',
  sessionStart: 'Session started',
  sessionUpdated: 'Session updated',
};

/**
 * The window a plan fact measures, named for the label and for the ear.
 *
 * EXHAUSTIVE on purpose. The provider's field admits `seven_day_opus` and
 * `seven_day_sonnet` alongside `seven_day`, and a map that collapsed all three
 * to `7D` would put a label on the wrong window - a readout that is confidently
 * wrong, which is worse than one that is absent. A window this map does not
 * know renders NO fact at all: nothing measured, nothing marked.
 */
const PLAN_WINDOWS: Partial<Record<RateLimitFacts['window'], { label: string; spoken: string }>> = {
  five_hour: { label: '5H', spoken: '5 hour' },
  seven_day: { label: '7D', spoken: '7 day' },
  seven_day_opus: { label: '7D OPUS', spoken: '7 day Opus' },
  seven_day_sonnet: { label: '7D SONNET', spoken: '7 day Sonnet' },
  overage: { label: 'OVER', spoken: 'overage' },
};

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * A start time on a previous day carries the DATE. `START 09:14` on a session
 * resumed from yesterday is legible and wrong, which is strictly worse than
 * absent. `UPD` needs no such case: a session updated on a previous day is a
 * session nothing is happening in.
 */
function startStamp(startedAt: number, now: number): string {
  if (sameDay(startedAt, now)) return clockOf(startedAt);
  const d = new Date(startedAt);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${clockOf(startedAt)}`;
}

export function buildFacts(state: ChatState, now: number): Fact[] {
  const facts: Fact[] = [];

  /* 1 CONTEXT USED. A budget, so it wears a ring, and the arc agrees with the
     digits here because the printed number is already consumption. The `gauge`
     glyph retired when the ring arrived: the ring is the same picture in a
     better medium, and the fact reverts to words. */
  if (state.contextWindow && state.contextTokens !== null) {
    const pct = Math.min(999, Math.round((state.contextTokens / state.contextWindow) * 100));
    facts.push({
      id: 'context',
      icon: null,
      label: 'CTX',
      value: `${pct}%`,
      accessibleName: `Context used, ${pct} percent`,
      longForm: [...FACT_TOOLTIPS.context],
      direction: 'USED',
      tone: pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'quiet',
      budget: true,
      ring: Math.min(1, pct / 100),
    });
  }

  /* 2 PLAN ALLOWANCE. Exists only when the provider measured it: no event, no
     fact, and never a local-token substitute. The plan is ONE budget with
     several horizons and the strip carries exactly one fact for it, the nearest
     wall - which is structural rather than chosen, since `state.rateLimits`
     holds the provider's latest event and nothing else. */
  const limits = state.rateLimits;
  const win = limits ? PLAN_WINDOWS[limits.window] : undefined;
  if (limits && win && limits.utilization !== null) {
    const overage = limits.window === 'overage';
    const remaining = Math.max(0, Math.round((1 - limits.utilization) * 100));
    const used = Math.min(999, Math.round(limits.utilization * 100));
    const tone: FactTone = overage
      ? 'danger'
      : limits.status === 'rejected' ? 'danger' : limits.status === 'allowed_warning' ? 'warning' : 'quiet';
    const longForm = [...FACT_TOOLTIPS.plan];
    /* At the wall the only thing that changes a decision is WHEN it lifts, so
       it is the one piece of information the strip earns the right to add - and
       only when the provider sent one. Never estimated from the window name. */
    if (tone === 'danger' && limits.resetsAt !== null) longForm.push(`Resets at ${clockOf(limits.resetsAt)}.`);
    facts.push({
      id: 'plan',
      icon: null,
      label: win.label,
      // Overage takes no direction word: past the wall there is no allowance
      // left to have a direction, so the fact reads what has been spent, and
      // being there is itself the danger state.
      direction: overage ? null : 'LEFT',
      value: `${overage ? used : remaining}%`,
      accessibleName: overage
        ? `Plan overage used, ${used} percent`
        : `Plan allowance remaining in the ${win.spoken} window, ${remaining} percent`,
      longForm,
      tone,
      budget: true,
      // The complement of the printed remainder, derived from the PRINTED
      // percent so the picture and the digits can never visibly disagree. Past
      // the wall the arc is full, unconditionally.
      ring: overage ? 1 : Math.min(1, Math.max(0, 1 - remaining / 100)),
    });
  }

  /* 3 and 4 TOKENS IN and OUT, and they are a PAIR: adjacent, in that order,
     with no fact between them, appearing together off ONE measurement. `IN
     84.2K` standing alone reads as the total, so neither half is ever produced
     without the other. No glyph on either: `arrow-down` and `arrow-up` said
     aloud are "something incoming" and "something outgoing", which could
     introduce any transfer fact on any strip, and the words IN and OUT are
     shorter than a glyph plus its ambiguity. */
  if (state.usage && state.usage.totalTokens > 0) {
    facts.push({
      id: 'tokensIn',
      icon: null,
      label: 'IN',
      value: compactNumber(state.usage.inputTokens),
      accessibleName: `Input tokens this session, ${state.usage.inputTokens.toLocaleString('en-US')}`,
      longForm: [...FACT_TOOLTIPS.tokensIn],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
    facts.push({
      id: 'tokensOut',
      icon: null,
      label: 'OUT',
      value: compactNumber(state.usage.outputTokens),
      accessibleName: `Output tokens this session, ${state.usage.outputTokens.toLocaleString('en-US')}`,
      longForm: [...FACT_TOOLTIPS.tokensOut],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
  }

  /* 5 TURN ELAPSED. `timer` is a stopwatch, which depicts a DURATION
     specifically rather than a moment, so it cannot introduce START or UPD. */
  if (state.turnStartedAt !== null) {
    const elapsed = Math.max(0, now - state.turnStartedAt);
    facts.push({
      id: 'elapsed',
      icon: 'timer',
      label: 'ELAPSED',
      value: shortDuration(elapsed),
      accessibleName: `Elapsed this turn, ${shortDuration(elapsed).toLowerCase()}`,
      longForm: [...FACT_TOOLTIPS.elapsed],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
  }

  /* 6 RUNNING AGENTS. Zero renders nothing: a dropped fact, never a greyed one. */
  const running = Object.values(state.subagents).filter((s) => s.status === 'running').length;
  if (running > 0) {
    facts.push({
      id: 'agents',
      icon: 'bot',
      label: 'AGENTS',
      value: String(running),
      accessibleName: `Running agents, ${running}`,
      longForm: [...FACT_TOOLTIPS.agents],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
  }

  /* 7 SESSION STARTED. Text label, never a glyph: `clock` is banned on this
     strip because three time facts ride it. */
  if (state.sessionStartedAt !== null) {
    facts.push({
      id: 'sessionStart',
      icon: null,
      label: 'START',
      value: startStamp(state.sessionStartedAt, now),
      accessibleName: `Session started at ${startStamp(state.sessionStartedAt, now)}`,
      longForm: [...FACT_TOOLTIPS.sessionStart],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
  }

  /* 8 SESSION UPDATED. */
  if (state.lastUpdatedAt !== null) {
    facts.push({
      id: 'sessionUpdated',
      icon: null,
      label: 'UPD',
      value: clockOf(state.lastUpdatedAt),
      accessibleName: `Last update at ${clockOf(state.lastUpdatedAt)}`,
      longForm: [...FACT_TOOLTIPS.sessionUpdated],
      direction: null,
      tone: 'quiet',
      budget: false,
      ring: null,
    });
  }

  /* The gate on escalation AND on the ring, applied once, to everything. A
     readout that reaches this line carrying either is a bug upstream and loses
     both: no wall, no threshold, and no denominator for an arc to be part of. */
  return facts.map((fact) => (fact.budget ? fact : { ...fact, tone: 'quiet' as const, ring: null }));
}

/** The visible set, after the user's own eight switches. */
export function visibleFacts(facts: Fact[], enabled: Record<FactId, boolean>): Fact[] {
  return facts.filter((f) => enabled[f.id]);
}

/**
 * The review check, as a number rather than a judgement: how many facts
 * currently render an escalation. It must equal the number of budget facts past
 * their own threshold, in either direction.
 */
export function escalatedCount(facts: Fact[]): number {
  return facts.filter((f) => f.tone !== 'quiet').length;
}

/**
 * The ring's ceiling, DERIVED the same way. A ring on anything that is not a
 * budget is a defect whatever the count.
 */
export function ringCount(facts: Fact[]): number {
  return facts.filter((f) => f.ring !== null).length;
}

/** Reject a fact set that would use one glyph for two different facts. */
export function glyphsAreUnique(facts: Fact[]): boolean {
  const used = facts.map((f) => f.icon).filter((i): i is string => i !== null);
  return new Set(used).size === used.length;
}

/**
 * BELOW THIS the arc renders nothing and the track stands alone. A round cap at
 * a 1.5px stroke draws a visible lozenge at 1% consumption, which asserts a
 * magnitude the measurement does not have; an empty ring is the honest picture
 * of an empty budget and a drawn speck is not.
 */
export const RING_MIN_CONSUMED = 0.03;

/* Circumference of r=5.25 in a 12px box, to two decimals. The arc is a state
   indicator and not a chart, and two fences keep it one: never larger than
   12px, and never a number inside it. */
export const RING_CIRCUMFERENCE = 32.99;

export function ringDashOffset(consumed: number): number {
  return Math.round(RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, consumed))) * 100) / 100;
}

/**
 * WHAT DROPS IN A NARROW PANE, in order, and it is the reverse of the render
 * order with two clauses: the token pair goes as one, and neither budget is in
 * the list at all.
 *
 * The rule that generates it: a BUDGET never drops before a READOUT, and among
 * readouts the one whose absence costs least goes first. The strip answers "am
 * I about to hit a wall", so the two facts that answer it are the two that
 * survive.
 */
export const DROP_GROUPS: readonly (readonly FactId[])[] = [
  ['sessionUpdated'],
  ['sessionStart'],
  ['agents'],
  ['elapsed'],
  ['tokensOut', 'tokensIn'],
];

/**
 * MEASURED REMOVAL, never CSS clipping. An `overflow: hidden` strip clips a
 * fact mid-value, and `84.2K` clipped to `84` is a wrong number rendered with
 * full authority. A fact renders WHOLE or not at all.
 *
 * Deterministic, therefore a script and never a judgement: the caller measures
 * the pixels, this decides the set.
 */
export function fitFacts(
  facts: Fact[],
  width: (fact: Fact) => number,
  available: number,
  gap: number,
): Fact[] {
  const fits = (set: Fact[]): boolean =>
    set.length === 0 || set.reduce((n, f) => n + width(f), 0) + gap * (set.length - 1) <= available;
  let kept = facts;
  for (const group of DROP_GROUPS) {
    if (fits(kept)) return kept;
    kept = kept.filter((f) => !group.includes(f.id));
  }
  /* THE LADDER DOES NOT STOP AT THE BUDGETS. "A budget never drops" is a
     PRIORITY, not an exemption from fitting: a budget that will not fit whole
     means NO STRIP AT ALL, never a clipped one.
     `[ring] CTX USED 42%` cut off at `CTX USED 4` is a wrong number rendered
     with full authority, and the fact that it is the most important number on
     the strip makes that worse rather than better.
     It is also what makes the floor safe to state as a measured band rather
     than an exact width: a font whose advance is wider than the one the floor
     was measured against cannot violate the law, it can only empty the strip
     one pane-width earlier. A bound nobody can verify exactly must not be the
     thing standing between the user and a clipped number. */
  return fits(kept) ? kept : [];
}
