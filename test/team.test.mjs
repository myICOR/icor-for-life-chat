/* The team: who did the work, and what the archives add up to. Both are pure
 * functions with one right answer each, so they are asserted here and not
 * through a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentShares, matchRoster, aggregate, deriveFromEvents, rangeStart, dayKey, agentRecords, WEEK_THRESHOLD_DAYS,
} from './build/pure.mjs';

const ROSTER = [
  { name: 'Larry', slug: 'larry' },
  { name: 'Pax', slug: 'pax' },
  { name: 'Penn', slug: 'penn' },
];

/* ------------------------------------------------------------- the shares */

test('the main thread is Larry when the roster has him, and Team when it does not', () => {
  const withLarry = agentShares({ main: { toolCalls: 3, textBlocks: 1 }, subagents: [], roster: ROSTER });
  assert.deepEqual(withLarry.map((s) => [s.name, s.share, s.matched]), [['Larry', 1, true]]);
  const bare = agentShares({ main: { toolCalls: 3, textBlocks: 1 }, subagents: [], roster: null });
  assert.deepEqual(bare.map((s) => [s.name, s.slug, s.matched]), [['Team', 'team', false]]);
});

test('a subagent type matches the roster by slug or by name, case-insensitively', () => {
  assert.equal(matchRoster('pax', ROSTER)?.name, 'Pax');
  assert.equal(matchRoster('PAX', ROSTER)?.name, 'Pax');
  assert.equal(matchRoster('Penn', ROSTER)?.name, 'Penn');
  assert.equal(matchRoster('general-purpose', ROSTER), null);
  assert.equal(matchRoster('', ROSTER), null);
});

test('the same agent spawned twice sums, and shares add to one', () => {
  const shares = agentShares({
    main: { toolCalls: 2, textBlocks: 2 },
    subagents: [
      { agentType: 'pax', toolCalls: 3, textBlocks: 1, durationMs: 1000, status: 'done' },
      { agentType: 'pax', toolCalls: 1, textBlocks: 1, durationMs: 500, status: 'done' },
      { agentType: 'general-purpose', toolCalls: 2, textBlocks: 0, durationMs: 200, status: 'done' },
    ],
    roster: ROSTER,
  });
  // 4 (Larry) + 6 (Pax) + 2 (general-purpose) = 12
  assert.deepEqual(shares.map((s) => [s.name, s.activity, s.toolCalls, s.durationMs, s.matched]), [
    ['Pax', 6, 4, 1500, true],
    ['Larry', 4, 2, 0, true],
    ['general-purpose', 2, 2, 200, false],
  ]);
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares sum to ${total}`);
  // Never rounded here: 6/12 is exactly 0.5, 4/12 is not a whole percent.
  assert.equal(shares[0].share, 0.5);
  assert.equal(shares[1].share, 4 / 12);
});

test('nothing measured means no shares at all, never a row of zeros', () => {
  assert.deepEqual(agentShares({ main: { toolCalls: 0, textBlocks: 0 }, subagents: [], roster: ROSTER }), []);
  assert.deepEqual(agentShares({
    main: { toolCalls: 0, textBlocks: 0 },
    subagents: [{ agentType: 'pax', toolCalls: 0, textBlocks: 0, durationMs: 9, status: 'done' }],
    roster: ROSTER,
  }), []);
});

/* -------------------------------------------------- deriving from events */

const EVENTS = [
  { kind: 'tool-call', toolUseId: 'a', name: 'Read', target: 'x', input: {}, stream: null },
  { kind: 'tool-call', toolUseId: 'b', name: 'Bash', target: 'ls', input: {}, stream: null },
  { kind: 'tool-call', toolUseId: 'c', name: 'Bash', target: 'ls', input: {}, stream: null },
  { kind: 'subagent-start', agentId: 's1', agentType: 'pax', description: '', task: '', stream: null },
  { kind: 'tool-call', toolUseId: 'd', name: 'WebFetch', target: 'u', input: {}, stream: 's1' },
  { kind: 'text-final', blockId: 'm:0', text: 'found it', stream: 's1' },
  { kind: 'text-final', blockId: 'm:1', text: '', stream: 's1' },
  { kind: 'subagent-end', agentId: 's1', ok: true, stream: null },
  { kind: 'text-final', blockId: 'm:2', text: 'the answer', stream: null },
  // A stream nobody opened: dropped, never invented into an agent.
  { kind: 'tool-call', toolUseId: 'e', name: 'Read', target: 'x', input: {}, stream: 'ghost' },
];

test('per-agent and per-tool counts come out of a transcript', () => {
  const d = deriveFromEvents(EVENTS);
  assert.deepEqual(d.tools, { Read: 1, Bash: 2 });
  assert.equal(d.mainToolCalls, 3);
  assert.equal(d.mainTextBlocks, 1);
  assert.deepEqual(d.agents, [{ agentType: 'pax', toolCalls: 1, textBlocks: 1, durationMs: null, status: 'done' }]);
});

test('the manifest record overlays duration and status from the bus, by spawn order', () => {
  const rec = agentRecords(EVENTS, [
    { agentId: 's1', agentType: 'pax', description: '', task: '', status: 'done', startedAt: 1000, endedAt: 4000, events: [], openedAt: null, sessionId: null, tokens: 0, toolCalls: 1, textBlocks: 1 },
  ], 9000);
  assert.deepEqual(rec.agents, [{ agentType: 'pax', toolCalls: 1, textBlocks: 1, durationMs: 3000, status: 'done' }]);
  assert.equal(rec.mainToolCalls, 3);
  // No transcript for the agent: the derived null survives, never a zero.
  const bare = agentRecords(EVENTS, [], 9000);
  assert.equal(bare.agents[0].durationMs, null);
});

/* ------------------------------------------------------------ aggregating */

const NOW = new Date(2026, 8, 4, 12, 0).getTime();
const day = (offset, hour = 10) => new Date(2026, 8, 4 - offset, hour).getTime();
const session = (offset, extra = {}) => ({
  folder: `f${offset}`, title: `s${offset}`, startedAt: day(offset), endedAt: day(offset) + 1000,
  tokens: 1000, model: 'claude-opus-5', agents: [], tools: {}, mainToolCalls: 1, mainTextBlocks: 1, ...extra,
});

test('a range starts at the local midnight that puts N days in view', () => {
  assert.equal(dayKey(rangeStart('7d', NOW)), '2026-08-29');
  assert.equal(dayKey(rangeStart('30d', NOW)), '2026-08-06');
  assert.equal(rangeStart('all', NOW), null);
});

test('buckets span the RANGE, and a day with no measured tokens draws no bar', () => {
  const agg = aggregate([session(0), session(2, { tokens: null }), session(2), session(40)], '7d', { agent: null, model: null }, ROSTER, NOW);
  assert.equal(agg.unit, 'day');
  assert.equal(agg.buckets.length, 7);
  assert.equal(agg.sessionCount, 3);
  assert.equal(agg.tokens, 2000);
  const today = agg.buckets[6];
  assert.equal(today.day, '2026-09-04');
  assert.deepEqual([today.sessions, today.tokens], [1, 1000]);
  const twoAgo = agg.buckets[4];
  assert.deepEqual([twoAgo.sessions, twoAgo.tokens], [2, 1000]);
  const quiet = agg.buckets[5];
  assert.deepEqual([quiet.sessions, quiet.tokens], [0, null]);
});

test('no measured tokens in range means a null total, not a zero', () => {
  const agg = aggregate([session(0, { tokens: null })], '7d', { agent: null, model: null }, ROSTER, NOW);
  assert.equal(agg.tokens, null);
  assert.equal(agg.sessionCount, 1);
});

test('the axis becomes weeks past the threshold', () => {
  const agg = aggregate([session(WEEK_THRESHOLD_DAYS + 20), session(0)], 'all', { agent: null, model: null }, ROSTER, NOW);
  assert.equal(agg.unit, 'week');
  assert.ok(agg.buckets.length > 15 && agg.buckets.length < 20, `${agg.buckets.length} week buckets`);
  assert.equal(agg.buckets.reduce((n, b) => n + b.sessions, 0), 2);
});

test('agent totals count activity and sessions, main thread included as Larry', () => {
  const agg = aggregate([
    session(0, { agents: [{ agentType: 'pax', toolCalls: 4, textBlocks: 1, durationMs: 10, status: 'done' }] }),
    session(1, { agents: [{ agentType: 'PAX', toolCalls: 1, textBlocks: 0, durationMs: 10, status: 'done' },
                          { agentType: 'general-purpose', toolCalls: 2, textBlocks: 0, durationMs: 10, status: 'done' }] }),
  ], '7d', { agent: null, model: null }, ROSTER, NOW);
  assert.deepEqual(agg.agents.map((a) => [a.key, a.name, a.activity, a.sessions, a.matched]), [
    ['pax', 'Pax', 6, 2, true],
    ['larry', 'Larry', 4, 2, true],
    ['general-purpose', 'general-purpose', 2, 1, false],
  ]);
});

test('the agent filter keeps only sessions where that agent ran; the model filter likewise', () => {
  const all = [
    session(0, { agents: [{ agentType: 'pax', toolCalls: 4, textBlocks: 1, durationMs: 10, status: 'done' }] }),
    session(1, { model: 'claude-sonnet-5' }),
  ];
  const pax = aggregate(all, '7d', { agent: 'pax', model: null }, ROSTER, NOW);
  assert.deepEqual(pax.sessions.map((s) => s.folder), ['f0']);
  const larry = aggregate(all, '7d', { agent: 'larry', model: null }, ROSTER, NOW);
  assert.equal(larry.sessionCount, 2);
  const sonnet = aggregate(all, '7d', { agent: null, model: 'claude-sonnet-5' }, ROSTER, NOW);
  assert.deepEqual(sonnet.sessions.map((s) => s.folder), ['f1']);
  assert.deepEqual(sonnet.models, [{ model: 'claude-sonnet-5', sessions: 1 }]);
});

test('tools sum across sessions and sort by count', () => {
  const agg = aggregate([session(0, { tools: { Read: 2, Bash: 1 } }), session(1, { tools: { Bash: 5 } })], '7d', { agent: null, model: null }, ROSTER, NOW);
  assert.deepEqual(agg.tools, [{ name: 'Bash', count: 6 }, { name: 'Read', count: 2 }]);
});
