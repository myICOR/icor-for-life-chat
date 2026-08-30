/* The statusline: a fact renders only when it was measured, and an icon only
 * when it can carry the label unambiguously. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFacts, glyphsAreUnique, emptyState, contextWindowFor, shortAge, shortDuration, compactNumber,
  escalatedCount, stateWord, factAriaLabel, reduce,
  RENDER_ORDER, DROP_GROUPS, RING_MIN_CONSUMED, RING_CIRCUMFERENCE,
  ringCount, ringDashOffset, fitFacts, visibleFacts,
  FACT_TOOLTIPS, FACT_NAMES, FACT_SETTING_KEYS, DEFAULT_SETTINGS, factVisibility,
  Normalizer,
} from './build/pure.mjs';

const NOW = 1_700_000_000_000;
const usage = (total) => ({
  inputTokens: total, outputTokens: 0, cacheReadTokens: 0, totalTokens: total, costUsd: 0,
});

test('a fresh view renders no facts at all, not a row of zeroes', () => {
  assert.deepEqual(buildFacts(emptyState(), NOW), []);
});

test('zero agents is dropped from the strip, never greyed', () => {
  const s = { ...emptyState(), lastUpdatedAt: NOW, subagents: {} };
  assert.equal(buildFacts(s, NOW).some((f) => f.label === 'AGENTS'), false);
  const running = {
    ...s,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
  };
  assert.equal(buildFacts(running, NOW).find((f) => f.label === 'AGENTS').value, '1');
});

test('no context percentage without a real context window', () => {
  const noWindow = { ...emptyState(), contextTokens: 50_000, contextWindow: null, lastUpdatedAt: NOW };
  assert.equal(buildFacts(noWindow, NOW).some((f) => f.label === 'CTX'), false);
  const withWindow = { ...noWindow, contextWindow: 200_000 };
  assert.equal(buildFacts(withWindow, NOW).find((f) => f.label === 'CTX').value, '25%');
});

test('the context fact escalates in exactly three steps', () => {
  const at = (tokens) => buildFacts(
    { ...emptyState(), contextTokens: tokens, contextWindow: 100, lastUpdatedAt: NOW }, NOW,
  ).find((f) => f.label === 'CTX').tone;
  assert.equal(at(50), 'quiet');
  assert.equal(at(69), 'quiet');
  assert.equal(at(70), 'warning');
  assert.equal(at(89), 'warning');
  assert.equal(at(90), 'danger');
});

test('plan-usage facts come only from a measured rate-limit event', () => {
  const base = { ...emptyState(), usage: usage(1000), lastUpdatedAt: NOW };
  assert.equal(buildFacts(base, NOW).some((f) => f.label === '5H'), false);
  const measured = {
    ...base,
    rateLimits: { window: 'five_hour', utilization: 0.18, resetsAt: null, status: 'allowed' },
  };
  const fact = buildFacts(measured, NOW).find((f) => f.label === '5H');
  assert.equal(fact.value, '82%');
  assert.ok(/5 hour/.test(fact.accessibleName));
});

test('a rate-limit event with no utilization number renders no plan fact', () => {
  const s = {
    ...emptyState(), lastUpdatedAt: NOW,
    rateLimits: { window: 'five_hour', utilization: null, resetsAt: null, status: 'allowed' },
  };
  assert.equal(buildFacts(s, NOW).some((f) => f.label === '5H'), false);
});

test('every fact carries an accessible name in words, icon or not', () => {
  const s = {
    ...emptyState(),
    usage: usage(12_400), contextTokens: 40, contextWindow: 100,
    turnStartedAt: NOW - 5000, lastUpdatedAt: NOW,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
    rateLimits: { window: 'seven_day', utilization: 0.5, resetsAt: null, status: 'allowed' },
  };
  const facts = buildFacts(s, NOW);
  assert.ok(facts.length >= 6);
  for (const f of facts) {
    assert.ok(f.accessibleName.trim().length > 3, `fact ${f.label} has no accessible name`);
    assert.ok(/[a-z]/.test(f.accessibleName), 'the accessible name must be words, not a glyph');
  }
});

test('no glyph is ever used twice in one strip', () => {
  const s = {
    ...emptyState(),
    usage: usage(9), contextTokens: 1, contextWindow: 10,
    turnStartedAt: NOW - 1000, lastUpdatedAt: NOW,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
    rateLimits: { window: 'five_hour', utilization: 0.1, resetsAt: null, status: 'allowed' },
  };
  assert.equal(glyphsAreUnique(buildFacts(s, NOW)), true);
});

test('the pair a single glyph cannot discriminate stays as words', () => {
  const s = { ...emptyState(), turnStartedAt: NOW - 1000, lastUpdatedAt: NOW };
  const facts = buildFacts(s, NOW);
  assert.equal(facts.find((f) => f.label === 'ELAPSED').icon, 'timer');
  assert.equal(facts.find((f) => f.label === 'UPD').icon, null, 'the second time fact reverts to text');
});

test('the context window is read from the provider, never guessed', () => {
  assert.equal(contextWindowFor(undefined, 'claude-x'), null);
  assert.equal(contextWindowFor({ 'claude-x': {} }, 'claude-x'), null);
  assert.equal(contextWindowFor({ 'claude-x': { contextWindow: 200000 } }, 'claude-x'), 200000);
  assert.equal(
    contextWindowFor({ 'claude-x': { contextWindow: 200000 }, 'claude-y': { contextWindow: 9 } }, 'claude-y'),
    9,
    'the session model picks its own window, not the first entry',
  );
});

test('the number and time voices are stable', () => {
  assert.equal(compactNumber(999), '999');
  assert.equal(compactNumber(12_400), '12.4K');
  assert.equal(compactNumber(2_500_000), '2.50M');
  assert.equal(shortDuration(450), '450MS');
  assert.equal(shortDuration(4500), '4.5S');
  assert.equal(shortDuration(125_000), '2M 5S');
  assert.equal(shortAge(30_000), 'NOW');
  assert.equal(shortAge(4 * 60_000), '4M');
  assert.equal(shortAge(2 * 3_600_000), '2H');
  assert.equal(shortAge(25 * 3_600_000), '1D');
});

/* -------------------------------------------- which facts may wear a colour */

const limits = (window, status, utilization) => ({ window, utilization, resetsAt: null, status });
const withPlan = (window, status, u) => ({ ...emptyState(), lastUpdatedAt: NOW, rateLimits: limits(window, status, u) });

test('only a BUDGET may escalate; a readout never colours at any value', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000,
    contextTokens: 150_000,          // 75% - a budget in its warning band
    usage: usage(9_999_999),          // an enormous readout
    lastUpdatedAt: NOW,
    turnStartedAt: NOW - 3_600_000,   // an enormous duration
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
  };
  const facts = buildFacts(s, NOW);
  for (const f of facts) {
    if (!f.budget) assert.equal(f.tone, 'quiet', `${f.label} is a readout and has no wall to escalate toward`);
  }
  // The reviewer check from 4 is a COUNT, not a judgement.
  const pastThreshold = facts.filter((f) => f.budget && f.tone !== 'quiet').length;
  assert.equal(escalatedCount(facts), pastThreshold);
  assert.equal(escalatedCount(facts), 1);
});

test('a readout that arrives carrying a tone is forced back to quiet', () => {
  // The gate is structural, not a convention: buildFacts maps it out at the end.
  const s = { ...emptyState(), usage: usage(500), lastUpdatedAt: NOW };
  assert.deepEqual(buildFacts(s, NOW).filter((f) => f.tone !== 'quiet'), []);
});

test('the escalated fact carries a state word on BOTH channels', () => {
  const warn = buildFacts(withPlan('seven_day', 'allowed_warning', 0.79), NOW).find((f) => f.budget);
  assert.equal(stateWord(warn.tone), 'WARN');
  assert.match(factAriaLabel(warn), /Warning\.$/);
  const crit = buildFacts(withPlan('seven_day', 'rejected', 0.98), NOW).find((f) => f.budget);
  assert.equal(stateWord(crit.tone), 'CRIT');
  assert.match(factAriaLabel(crit), /Critical\.$/);
  assert.equal(stateWord('quiet'), null);
});

test('every percentage names its direction; there is no default reading', () => {
  const s = { ...emptyState(), contextWindow: 200_000, contextTokens: 84_000, lastUpdatedAt: NOW };
  assert.equal(buildFacts(s, NOW).find((f) => f.label === 'CTX').direction, 'USED');
  const plan = buildFacts(withPlan('seven_day', 'allowed', 0.79), NOW).find((f) => f.budget);
  assert.equal(plan.label, '7D');
  assert.equal(plan.direction, 'LEFT');
  assert.equal(plan.value, '21%');
  for (const f of buildFacts({ ...s, usage: usage(400), turnStartedAt: NOW - 1000 }, NOW)) {
    if (!f.value.endsWith('%')) assert.equal(f.direction, null, `${f.label} is not a proportion`);
  }
});

test('the plan window map is exhaustive, and an unknown window renders nothing', () => {
  const seen = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'].map(
    (w) => buildFacts(withPlan(w, 'allowed', 0.5), NOW).find((f) => f.budget).label,
  );
  // The Opus and Sonnet windows are NOT the plain seven-day window: collapsing
  // them to 7D puts a label on the wrong wall.
  assert.deepEqual(seen, ['5H', '7D', '7D OPUS', '7D SONNET']);
  assert.equal(new Set(seen).size, seen.length);
  for (const w of ['unknown', 'a_window_the_sdk_added_later']) {
    assert.equal(buildFacts(withPlan(w, 'allowed', 0.5), NOW).some((f) => f.budget), false, w);
  }
});

test('overage has nothing left to have a direction, and being there is the state', () => {
  const f = buildFacts(withPlan('overage', 'allowed', 0.12), NOW).find((x) => x.budget);
  assert.equal(f.label, 'OVER');
  assert.equal(f.direction, null);
  assert.equal(f.value, '12%');
  assert.equal(f.tone, 'danger', 'past the wall is the danger state regardless of the provider status');
  assert.match(f.accessibleName, /overage used/i);
});

test('the strip carries at most one plan fact - one budget, one nearest wall', () => {
  const facts = buildFacts(withPlan('seven_day', 'allowed_warning', 0.79), NOW);
  assert.equal(facts.filter((f) => f.budget && f.label !== 'CTX').length, 1);
});

test('a remainder percentage renders its word forever - no glyph depicts "remaining"', () => {
  for (const w of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage']) {
    assert.equal(buildFacts(withPlan(w, 'allowed', 0.5), NOW).find((f) => f.budget).icon, null, w);
  }
  // And the token pair labels itself in words: `arrow-down` / `arrow-up` said
  // aloud are "something incoming" and "something outgoing", which could
  // introduce any transfer fact on any strip.
  for (const label of ['IN', 'OUT']) {
    const f = buildFacts({ ...emptyState(), usage: usage(112_100), lastUpdatedAt: NOW }, NOW)
      .find((x) => x.label === label);
    assert.equal(f.icon, null, label);
  }
});

/* ============================================================== the 12 strip */

/* THE LAW: NO EVENT, NO NUMBER. Unmeasured is ABSENT.
 *
 * This block exists because the opposite shipped. On 2026-08-29 the strip
 * rendered plan-usage figures with no measurement behind them, substituting a
 * duplicated local token total in a session where no rate-limit event had ever
 * arrived. The fallback was deleted rather than corrected, and these assertions
 * are what stop it being reintroduced in a kinder form: a zero, a dash, a
 * greyed digit, an estimate, a "not yet".
 *
 * A first-time user's very first session is exactly the state where every one
 * of the eight has no data yet, so the empty state is the PRIMARY case here and
 * not an edge one. */

const ALL_ON = {
  context: true, plan: true, tokensIn: true, tokensOut: true,
  elapsed: true, agents: true, sessionStart: true, sessionUpdated: true,
};

test('ABSENCE LAW: with no event, the strip renders no digits at all', () => {
  const facts = buildFacts(emptyState(), NOW);
  assert.deepEqual(facts, [], 'a fresh session renders zero facts');
  // The claim the eye actually checks, asserted as a claim about CHARACTERS:
  // not "no facts" but "no NUMBER anywhere in the strip". A zero, a dash or a
  // greyed placeholder all pass a length check and all fail this one.
  const printed = facts.map((f) => `${f.label} ${f.direction ?? ''} ${f.value}`).join(' ');
  assert.equal(/[0-9]/.test(printed), false, `the strip printed a digit with nothing measured: "${printed}"`);
  assert.equal(printed.includes('-'), false, 'a dash is a placeholder wearing punctuation');
});

test('ABSENCE LAW: each of the eight is absent on its own, one at a time', () => {
  // Every readout is switched ON here, so nothing below is hidden by a
  // preference: what is missing is missing because it was never measured.
  for (const id of RENDER_ORDER) {
    const facts = visibleFacts(buildFacts(emptyState(), NOW), ALL_ON);
    assert.equal(facts.some((f) => f.id === id), false, `${id} rendered with no measurement behind it`);
  }
});

test('ABSENCE LAW: no readout is ever computed from another readout data', () => {
  /* The substitution clause, and it names the defect that actually happened.
     A local token total is not a plan figure that is merely imprecise; it is a
     different quantity wearing the plan's label. */
  const tokensOnly = { ...emptyState(), usage: usage(4_000_000), lastUpdatedAt: NOW };
  assert.equal(buildFacts(tokensOnly, NOW).some((f) => f.budget), false,
    'a token total conjured a budget fact - that is the 2026-08-29 CRITICAL');

  // Context needs BOTH halves of its own measurement, and borrows neither.
  assert.equal(
    buildFacts({ ...tokensOnly, contextTokens: 120_000 }, NOW).some((f) => f.id === 'context'), false,
    'a context percentage was computed without the provider window',
  );
  assert.equal(
    buildFacts({ ...tokensOnly, contextWindow: 200_000 }, NOW).some((f) => f.id === 'context'), false,
    'a context percentage was computed without a token count',
  );
  // And a start time is never borrowed from the last update.
  assert.equal(buildFacts({ ...tokensOnly, lastUpdatedAt: NOW }, NOW).some((f) => f.id === 'sessionStart'), false);
});

test('ABSENCE LAW: START has one writer, and a reopen is not it', () => {
  const session = (extra = {}) => ({
    kind: 'session', sessionId: 's', model: 'm', cwd: '/', permissionMode: 'default',
    slashCommands: [], contextWindow: 200_000, stream: null, ...extra,
  });
  // A FRESH session stamps its own start from the event.
  const fresh = reduce(emptyState(), session());
  assert.equal(typeof fresh.sessionStartedAt, 'number');

  // A RESUMED one whose record carries no creation time stays ABSENT, and the
  // later session event must not stamp the moment the tab was reopened.
  let resumed = reduce(emptyState(), { kind: 'session-restored', startedAt: null, stream: null });
  resumed = reduce(resumed, session());
  assert.equal(resumed.sessionStartedAt, null,
    'the reopen time was stamped under a label that says the conversation began then');
  assert.equal(buildFacts(resumed, NOW).some((f) => f.id === 'sessionStart'), false);

  // And a record that DOES carry one keeps the original, never the reopen.
  const original = NOW - 3 * 3_600_000;
  let restored = reduce(emptyState(), { kind: 'session-restored', startedAt: original, stream: null });
  restored = reduce(restored, session());
  assert.equal(restored.sessionStartedAt, original);
});

test('ABSENCE LAW: a switched-ON readout with no measurement is still absent', () => {
  // The settings row explains it; the strip never apologises for itself.
  const s = { ...emptyState(), sessionStartedAt: null, lastUpdatedAt: null };
  assert.deepEqual(visibleFacts(buildFacts(s, NOW), ALL_ON), []);
});

/* ------------------------------------------------------- order and the pair */

test('render order is the table order, always, and it does not reorder on state', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000, contextTokens: 84_000,
    rateLimits: { window: 'seven_day', utilization: 0.79, resetsAt: null, status: 'allowed_warning' },
    usage: usage(112_100),
    turnStartedAt: NOW - 72_000,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
    sessionStartedAt: NOW - 2_000_000,
    lastUpdatedAt: NOW,
  };
  const ids = buildFacts(s, NOW).map((f) => f.id);
  assert.deepEqual(ids, [...RENDER_ORDER]);
  // And the same set with an escalated budget renders in the same order.
  const hot = { ...s, contextTokens: 190_000 };
  assert.deepEqual(buildFacts(hot, NOW).map((f) => f.id), [...RENDER_ORDER]);
});

test('IN and OUT are a pair: adjacent, in that order, off one measurement', () => {
  const s = { ...emptyState(), usage: { inputTokens: 84_200, outputTokens: 27_900, cacheReadTokens: 9, totalTokens: 112_109, costUsd: 0 }, lastUpdatedAt: NOW };
  const ids = buildFacts(s, NOW).map((f) => f.id);
  const i = ids.indexOf('tokensIn');
  assert.equal(ids[i + 1], 'tokensOut', 'a fact came between the halves of the pair');
  const facts = buildFacts(s, NOW);
  assert.equal(facts.find((f) => f.id === 'tokensIn').value, '84.2K');
  assert.equal(facts.find((f) => f.id === 'tokensOut').value, '27.9K');
  // Fresh input in the digits, cache reads named in the tooltip and excluded.
  assert.match(FACT_TOOLTIPS.tokensIn.join(' '), /Excludes cache reads/);
  // Neither half is ever produced without the other.
  assert.equal(buildFacts({ ...emptyState(), lastUpdatedAt: NOW }, NOW).some((f) => f.id === 'tokensIn'), false);
});

/* ----------------------------------------------------------------- the ring */

test('a ring is earned by a BUDGET and by nothing else', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000, contextTokens: 84_000,
    rateLimits: { window: 'seven_day', utilization: 0.79, resetsAt: null, status: 'allowed' },
    usage: usage(112_100), turnStartedAt: NOW - 1000,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
    sessionStartedAt: NOW - 1000, lastUpdatedAt: NOW,
  };
  const facts = buildFacts(s, NOW);
  for (const f of facts) {
    if (!f.budget) assert.equal(f.ring, null, `${f.id} has no denominator for an arc to be a fraction of`);
  }
  // The ceiling is DERIVED from the budget count, never allowed as a number.
  assert.equal(ringCount(facts), facts.filter((f) => f.budget).length);
  assert.equal(ringCount(facts), 2);
});

test('the arc draws CONSUMPTION on every ring, even where the label reads LEFT', () => {
  const ctx = buildFacts({ ...emptyState(), contextWindow: 100, contextTokens: 42, lastUpdatedAt: NOW }, NOW)
    .find((f) => f.id === 'context');
  assert.equal(ctx.value, '42%');
  assert.equal(ctx.ring, 0.42, 'on a USED fact the arc and the digits agree');

  const plan = buildFacts(withPlan('seven_day', 'allowed', 0.79), NOW).find((f) => f.id === 'plan');
  assert.equal(plan.value, '21%');
  assert.ok(Math.abs(plan.ring - 0.79) < 1e-9, 'on a LEFT fact the arc is the complement of the digits');

  // The reviewer check, and it is arithmetic rather than judgement.
  for (const f of [ctx, plan]) {
    const printed = Number.parseInt(f.value, 10) / 100;
    const expected = f.direction === 'LEFT' ? 1 - printed : printed;
    assert.ok(Math.abs(f.ring - expected) < 1e-9, `${f.id}: arc and printed fraction disagree`);
  }

  // Past the wall the arc is full, unconditionally.
  assert.equal(buildFacts(withPlan('overage', 'allowed', 0.12), NOW).find((f) => f.id === 'plan').ring, 1);
});

test('the arc geometry is derived, and a speck is never drawn', () => {
  assert.equal(ringDashOffset(0), RING_CIRCUMFERENCE, 'an empty budget leaves the track alone');
  assert.equal(ringDashOffset(1), 0);
  assert.equal(ringDashOffset(0.5), Math.round(RING_CIRCUMFERENCE * 50) / 100);
  // Below the floor the caller draws nothing: a round-capped speck at 1% would
  // assert a magnitude the measurement does not have.
  assert.ok(RING_MIN_CONSUMED > 0 && RING_MIN_CONSUMED < 0.1);
  const tiny = buildFacts({ ...emptyState(), contextWindow: 1000, contextTokens: 10, lastUpdatedAt: NOW }, NOW)
    .find((f) => f.id === 'context');
  assert.ok(tiny.ring < RING_MIN_CONSUMED, 'the 1% case must fall under the floor the renderer checks');
});

/* --------------------------------------------------- the narrow-pane ladder */

test('the ladder drops whole facts, in order, and never a budget', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000, contextTokens: 84_000,
    rateLimits: { window: 'seven_day', utilization: 0.79, resetsAt: null, status: 'allowed' },
    usage: usage(112_100), turnStartedAt: NOW - 1000,
    subagents: { a: { agentId: 'a', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null } },
    sessionStartedAt: NOW - 1000, lastUpdatedAt: NOW,
  };
  const facts = buildFacts(s, NOW);
  const W = 50, GAP = 8;
  const width = () => W;
  const at = (n) => fitFacts(facts, width, n * W + (n - 1) * GAP, GAP).map((f) => f.id);

  assert.deepEqual(at(8), [...RENDER_ORDER], 'a wide pane drops nothing');
  assert.deepEqual(at(7), RENDER_ORDER.filter((i) => i !== 'sessionUpdated'));
  assert.deepEqual(at(6), ['context', 'plan', 'tokensIn', 'tokensOut', 'elapsed', 'agents']);
  assert.deepEqual(at(5), ['context', 'plan', 'tokensIn', 'tokensOut', 'elapsed']);
  assert.deepEqual(at(4), ['context', 'plan', 'tokensIn', 'tokensOut']);
  // The pair goes as ONE: `IN 84.2K` standing alone reads as the total, so
  // there is no three-fact rung between four and two.
  assert.deepEqual(at(3), ['context', 'plan']);
  assert.deepEqual(at(2), ['context', 'plan']);
  /* The budgets outlast every readout, which is what "never drops" means: the
     strip answers "am I about to hit a wall", so the facts that answer it are
     the last to go. It does NOT mean they are exempt from fitting - below the
     floor the answer is no strip at all, asserted on its own below. */
  assert.deepEqual(at(2), ['context', 'plan']);
  assert.deepEqual(fitFacts(facts, width, 10, GAP), []);
});

test('the drop order is the reverse of the render order, pair aside', () => {
  const flat = DROP_GROUPS.flat();
  assert.deepEqual(flat, ['sessionUpdated', 'sessionStart', 'agents', 'elapsed', 'tokensOut', 'tokensIn']);
  for (const id of ['context', 'plan']) {
    assert.equal(flat.includes(id), false, `${id} is a budget and may not appear in the ladder`);
  }
});

/* ------------------------------------------------------- time, and the date */

test('a start time on another day carries the date; a clock alone would be legible and wrong', () => {
  const start = Date.UTC(2026, 7, 29, 9, 14);
  const sameDayNow = start + 3 * 3_600_000;
  const nextDay = start + 30 * 3_600_000;
  const stamp = (now) => buildFacts({ ...emptyState(), sessionStartedAt: start, lastUpdatedAt: now }, now)
    .find((f) => f.id === 'sessionStart').value;
  assert.match(stamp(sameDayNow), /^\d{2}:\d{2}$/);
  assert.match(stamp(nextDay), /^\d{2}\.\d{2} \d{2}:\d{2}$/);
});

test('the plan tooltip names the reset only at CRIT, and only when the provider sent one', () => {
  const crit = buildFacts(
    { ...emptyState(), lastUpdatedAt: NOW, rateLimits: { window: 'seven_day', utilization: 0.99, resetsAt: NOW + 3_600_000, status: 'rejected' } },
    NOW,
  ).find((f) => f.id === 'plan');
  assert.equal(crit.tone, 'danger');
  assert.equal(crit.longForm.length, 4);
  assert.match(crit.longForm[3], /^Resets at \d{2}:\d{2}\.$/);

  const quiet = buildFacts(withPlan('seven_day', 'allowed', 0.2), NOW).find((f) => f.id === 'plan');
  assert.equal(quiet.longForm.length, 3, 'a quiet fact never earns the fourth line');

  // Never estimated from the window name.
  const noReset = buildFacts(
    { ...emptyState(), lastUpdatedAt: NOW, rateLimits: { window: 'seven_day', utilization: 0.99, resetsAt: null, status: 'rejected' } },
    NOW,
  ).find((f) => f.id === 'plan');
  assert.equal(noReset.longForm.length, 3);
});

/* ------------------------------------------------ the switches and the copy */

test('the default combination is five on and three off', () => {
  const v = factVisibility(DEFAULT_SETTINGS);
  assert.deepEqual(
    RENDER_ORDER.filter((id) => v[id]),
    ['context', 'plan', 'tokensIn', 'tokensOut', 'elapsed'],
  );
  assert.deepEqual(RENDER_ORDER.filter((id) => !v[id]), ['agents', 'sessionStart', 'sessionUpdated']);
});

test('every readout has one settings key, one name and one long form', () => {
  const keys = RENDER_ORDER.map((id) => FACT_SETTING_KEYS[id]);
  assert.equal(new Set(keys).size, 8, 'two readouts share a settings key');
  for (const id of RENDER_ORDER) {
    assert.equal(typeof FACT_NAMES[id], 'string');
    assert.ok(FACT_NAMES[id].length > 0);
    // What it counts / what it excludes / where it comes from. Three lines, and
    // the third is the one that says where the number is allowed to come from.
    assert.equal(FACT_TOOLTIPS[id].length, 3, id);
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, FACT_SETTING_KEYS[id]));
  }
  // The tooltip and the settings description are ONE string, so nothing here
  // may be a second copy of prose that lives elsewhere.
  assert.match(FACT_TOOLTIPS.context.join(' '), /Subagents run in their own context windows/);
  assert.match(FACT_TOOLTIPS.tokensOut.join(' '), /Includes every subagent session/);
});

test('a switched-off readout leaves no gap where it was', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000, contextTokens: 84_000,
    usage: usage(112_100), lastUpdatedAt: NOW,
  };
  const off = { ...ALL_ON, tokensIn: false, tokensOut: false, sessionUpdated: false };
  assert.deepEqual(visibleFacts(buildFacts(s, NOW), off).map((f) => f.id), ['context']);
});

test('the ladder does not stop at the budgets: below the floor there is NO strip', () => {
  const s = {
    ...emptyState(),
    contextWindow: 200_000, contextTokens: 84_000,
    rateLimits: { window: 'seven_day', utilization: 0.79, resetsAt: null, status: 'allowed' },
    usage: usage(112_100), lastUpdatedAt: NOW,
  };
  const facts = buildFacts(s, NOW);
  const W = 50, GAP = 8;
  const width = () => W;
  // Room for the two budgets: they stand.
  assert.deepEqual(fitFacts(facts, width, 2 * W + GAP, GAP).map((f) => f.id), ['context', 'plan']);
  /* One pixel less and they no longer fit WHOLE. "A budget never drops" is a
     priority, not an exemption from fitting: the answer is nothing, never a
     clipped `CTX USED 4`. This is also what makes a measured floor safe to
     state as a band - a wider face empties the strip a pane-width sooner
     instead of clipping the most important number on it. */
  assert.deepEqual(fitFacts(facts, width, 2 * W + GAP - 1, GAP), []);
  assert.deepEqual(fitFacts(facts, width, W, GAP), []);
  assert.deepEqual(fitFacts(facts, width, 1, GAP), []);
});

/* ================== the strip populates after a REAL turn, end to end ======
 *
 * The absence law makes an unmeasured strip render nothing, which means "the
 * feature looks like it was never built" is the EXPECTED first-run appearance.
 * That makes the opposite failure - readouts absent while the data exists -
 * impossible to spot by looking, because both states look identical.
 *
 * So it is measured instead, through the shipped path and nothing else: raw
 * SDK messages -> the real Normalizer -> the real reducer -> the real
 * buildFacts. No hand-made ChatState anywhere in this block. A test that
 * assembled the state itself would prove the fact builder works and say
 * nothing about whether a real turn ever reaches it, which is exactly the
 * question. */

const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: '7f3c1a2e-0000-4000-8000-0123456789ab',
  model: 'claude-opus-4-6',
  cwd: '/vault',
  permissionMode: 'default',
  slash_commands: [],
};

const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 72_000,
  result: 'done',
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 24_200,
    output_tokens: 27_900,
    cache_read_input_tokens: 811_000,
    cache_creation_input_tokens: 60_000,
  },
  modelUsage: { 'claude-opus-4-6': { contextWindow: 1_000_000 } },
};

function liveSession(messages) {
  const n = new Normalizer();
  let state = emptyState();
  for (const raw of messages) for (const event of n.normalize(raw)) state = reduce(state, event);
  return state;
}

test('END TO END: a real turn populates the strip', () => {
  const before = liveSession([INIT]);
  /* The first-run appearance Tom is looking at. A session exists, no turn has
     completed, and the honest render is nothing but UPD - which is OFF by
     default, so the visible strip is empty. This assertion is the one that
     says the empty row is CORRECT rather than broken. */
  assert.deepEqual(
    visibleFacts(buildFacts(before, NOW), factVisibility(DEFAULT_SETTINGS)),
    [],
    'a session with no completed turn should render nothing under the default switches',
  );

  const after = liveSession([INIT, RESULT]);
  const facts = visibleFacts(buildFacts(after, NOW), factVisibility(DEFAULT_SETTINGS));
  const ids = facts.map((f) => f.id);
  /* And the moment the data exists it is on screen. Four of the five default
     readouts; ELAPSED is absent because the turn has ENDED, which is its whole
     design - it self-hides when idle. */
  assert.deepEqual(ids, ['context', 'tokensIn', 'tokensOut'],
    `after a completed turn the strip rendered ${JSON.stringify(ids)}`);

  const by = (id) => facts.find((f) => f.id === id);
  // input_tokens + cache_creation_input_tokens, which is what usageFrom sets.
  assert.equal(by('tokensIn').value, '84.2K');
  assert.equal(by('tokensOut').value, '27.9K');
  /* (84_200 fresh input + 811_000 cache reads + 27_900 output) / 1_000_000,
     against the provider's OWN window. Cache reads are excluded from the IN
     digits and included here, which is the subagent-and-cache asymmetry the
     tooltips spell out: tokens are spend, context is room. */
  assert.equal(by('context').value, '92%');
  assert.equal(by('context').ring, 0.92, 'the ring is drawn from a real turn, not from a fixture');
  assert.equal(by('context').tone, 'danger', 'a 92% context window is past the CRIT threshold');
});

test('END TO END: the plan fact stays absent until a rate-limit event arrives', () => {
  /* The one readout that can be blank for a WHOLE session even after many
     turns, and the reason the strip can look half-built to someone who has not
     hit a wall. It is the readout the 2026-08-29 CRITICAL was about, so it is
     the one that must never fill itself in from the tokens beside it. */
  const after = liveSession([INIT, RESULT]);
  assert.equal(buildFacts(after, NOW).some((f) => f.id === 'plan'), false);

  /* The provider's real shape: a TOP-LEVEL `rate_limit_event`, payload nested
     under `rate_limit_info`. Written from `normalize.ts` rather than from
     memory - the first draft of this fixture guessed a `system` subtype with a
     flat payload, and the assertion below is what caught it. A hand-made
     ChatState would have sailed past that, which is the whole reason this
     block drives raw messages. */
  const RATE = {
    type: 'rate_limit_event',
    rate_limit_info: {
      rateLimitType: 'seven_day',
      utilization: 0.79,
      status: 'allowed_warning',
      resetsAt: null,
    },
  };
  const withLimit = liveSession([INIT, RESULT, RATE]);
  const plan = buildFacts(withLimit, NOW).find((f) => f.id === 'plan');
  assert.ok(plan, 'a real rate-limit event did not reach the strip');
  assert.equal(plan.value, '21%');
  assert.equal(plan.direction, 'LEFT');
  assert.equal(plan.tone, 'warning');
});

test('END TO END: ELAPSED runs during a turn and stands down after it', () => {
  const n = new Normalizer();
  let state = emptyState();
  for (const e of n.normalize(INIT)) state = reduce(state, e);
  // The view applies its own user-turn event when Tom sends; that is what
  // starts the clock, so it is applied here the same way the view does.
  state = reduce(state, { kind: 'user-turn', text: 'go', contextNote: null, stream: null });
  const during = buildFacts(state, Date.now() + 72_000).find((f) => f.id === 'elapsed');
  assert.ok(during, 'ELAPSED is absent while a turn is running');
  assert.equal(during.icon, 'timer');
  for (const e of n.normalize(RESULT)) state = reduce(state, e);
  assert.equal(buildFacts(state, NOW).some((f) => f.id === 'elapsed'), false,
    'ELAPSED outlived its turn - it self-hides when idle, which is why it is on by default');
});
