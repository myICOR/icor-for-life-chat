/* The life snapshot, read back: the schema gate, the staleness rule, the
 * brief and the three reader lines.
 *
 * The fixture is a hand-built snapshot in the SHAPE `life-snapshot.py` writes
 * (schema 1), not a copy of one vault's numbers: every value here is chosen
 * to exercise a branch. The numbers are shapes, not measurements.
 *
 * What this gate cannot prove: that the script still writes these keys. That
 * is the schema integer's job, and refusing a schema this build does not know
 * is what the first test measures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_PATH, SNAPSHOT_SCHEMA, SNAPSHOT_COMMAND,
  parseSnapshot, snapshotIsStale, snapshotBrief, snapshotReaderLine,
  snapshotStatusLine, snapshotContextBlock, joinShort,
} from './build/pure.mjs';

const FULL = {
  schema: 1,
  generated_at: '2026-09-15T15:32:34Z',
  generated_local_date: '2026-09-15',
  thresholds: { stale_after_hours: 6 },
  goals: { open: [{ name: 'Regain control over body' }, { name: '300K a month' }] },
  projects: {
    focus: [{ name: 'myICOR App Dev', focus_rank: 1 }, { name: 'Channel strategy', focus_rank: 2 }],
    active: [],
    active_count: 33,
  },
  weekly_goals: {
    week: '2026-W38',
    items: [{ text: 'Ship the explainer video', done: false }, { text: 'Book the sleep lab', done: true }],
    done_count: 1,
    reason: null,
  },
  highlight: { date: '2026-09-15', text: 'Record episode 3', done: null, reason: null },
  key_elements: [{ name: 'Health' }, { name: 'myICOR' }],
  topics: {
    hot: [{ name: 'Scaffold over model', attention: { score: 7 } }],
    ranked_count: 79,
    sources_counted: { journal: 14, scratchpad: 0, notes: 1, planner: 0 },
  },
  today: { journal_entries: [{}], scratchpads: [{}, {}] },
  findings: [],
  degraded: [],
};

/* The same day and hour the fixture was generated, so "fresh" is the branch
   under test and the clock of the machine running the suite is not. */
const FRESH_NOW = new Date('2026-09-15T16:00:00Z');

function read(overrides = {}) {
  return parseSnapshot(JSON.stringify({ ...FULL, ...overrides }));
}

test('the path is the machine layer, and the schema is a gate not a guess', () => {
  assert.equal(SNAPSHOT_PATH, '.icor-for-life/scripts/snapshot.json');
  assert.equal(SNAPSHOT_SCHEMA, 1);
  const wrong = parseSnapshot(JSON.stringify({ ...FULL, schema: 2 }));
  assert.equal(wrong.kind, 'unreadable');
  assert.match(wrong.reason, /schema 2/);
});

test('a broken file is a sentence, never a throw', () => {
  assert.equal(parseSnapshot('not json at all').kind, 'unreadable');
  assert.equal(parseSnapshot('[]').kind, 'unreadable');
  assert.equal(parseSnapshot(JSON.stringify({ schema: 1 })).kind, 'unreadable');
});

test('staleness: older than the file\'s own threshold, or not generated today', () => {
  const ok = read();
  assert.equal(ok.kind, 'ok');
  assert.equal(snapshotIsStale(ok.report, FRESH_NOW), false);
  assert.equal(snapshotIsStale(ok.report, new Date('2026-09-15T23:00:00Z')), true, 'past six hours');
  assert.equal(snapshotIsStale(ok.report, new Date('2026-09-16T15:35:00Z')), true, 'not today');
  const unparsable = read({ generated_at: 'whenever' });
  assert.equal(unparsable.kind, 'ok');
  assert.equal(snapshotIsStale(unparsable.report, FRESH_NOW), true, 'an unreadable stamp is stale');
});

test('joinShort keeps the first names and counts the rest', () => {
  assert.equal(joinShort([], 3), 'none');
  assert.equal(joinShort(['a', 'b'], 3), 'a, b');
  assert.equal(joinShort(['a', 'b', 'c', 'd'], 2), 'a, b, ... (2 more)');
});

test('the brief carries one line per question, in the script\'s order', () => {
  const ok = read();
  const lines = snapshotBrief(ok.report, FRESH_NOW).split('\n');
  assert.equal(lines[0], 'Life snapshot 2026-09-15 15:32 UTC (fresh)');
  assert.equal(lines[1], 'Goals (2 open): Regain control over body, 300K a month');
  assert.equal(lines[2], 'Focus (your ranks): 1 myICOR App Dev . 2 Channel strategy');
  assert.equal(lines[3], 'Active projects: 33 (focus set on 2)');
  assert.equal(
    lines[4],
    'Weekly priorities 2026-W38 (1 of 2 done): [ ] Ship the explainer video . [x] Book the sleep lab',
  );
  assert.equal(lines[5], 'Daily highlight: Record episode 3 (pending)');
  assert.equal(lines[6], 'Key elements (2): Health, myICOR');
  assert.equal(lines[7], 'Hot topics (30d, weighted): Scaffold over model 7');
  assert.equal(lines[8], 'Attention sources counted: journal 14, scratchpad 0, notes 1, planner 0');
  assert.equal(lines[9], 'Today: 1 journal entry, 2 scratchpads');
  assert.equal(lines[10], 'Degraded: none');
  assert.equal(lines[11], 'Findings: none');
});

test('Iris\'s two labels, not the two words they replaced', () => {
  // "Weekly Priority" and "Daily Highlight", ruled 2026-09-15. The JSON keys
  // (`weekly_goals`, `highlight`) are untouched; only the words changed.
  const brief = snapshotBrief(read().report, FRESH_NOW);
  assert.match(brief, /^Weekly priorities /m);
  assert.match(brief, /^Daily highlight: /m);
  assert.ok(!/^Weekly goals/m.test(brief), 'the week no longer wears the word goal');
  assert.ok(!/^Highlight today/m.test(brief), 'the day says Daily highlight');
});

test('an empty week and an empty day name their reason, and nothing nags', () => {
  const ok = read({
    weekly_goals: { week: '2026-W38', items: [], done_count: 0, reason: 'no note at 02 Planner/Weeks/2026-W38.md' },
    highlight: { date: '2026-09-15', text: null, done: null, reason: 'no note at 02 Planner/Weeks/2026-W38.md' },
  });
  const brief = snapshotBrief(ok.report, FRESH_NOW);
  assert.match(brief, /Weekly priorities 2026-W38: none \(no note at 02 Planner\/Weeks\/2026-W38\.md\)/);
  assert.match(brief, /Daily highlight: none recorded \(no note at 02 Planner\/Weeks\/2026-W38\.md\)/);
});

test('no focus rank set is an invitation, never an empty list', () => {
  const ok = read({ projects: { focus: [], active: [], active_count: 33 } });
  assert.match(snapshotBrief(ok.report, FRESH_NOW), /Focus \(your ranks\): none set\./);
});

test('the highlight\'s three states are three words', () => {
  const state = (done) => snapshotBrief(
    read({ highlight: { date: '2026-09-15', text: 'Record episode 3', done, reason: null } }).report,
    FRESH_NOW,
  ).match(/^Daily highlight: Record episode 3 \((.+)\)$/m)[1];
  assert.equal(state(true), 'done');
  assert.equal(state(false), 'not done');
  assert.equal(state(null), 'pending');
});

test('the reader line is absent when there is nothing to declare', () => {
  assert.equal(snapshotReaderLine(read(), FRESH_NOW), null);
});

test('the missing line names the command and refuses to infer an empty life', () => {
  const line = snapshotReaderLine({ kind: 'missing' }, FRESH_NOW);
  assert.ok(line.startsWith('No life snapshot on this device yet.'));
  assert.ok(line.includes(SNAPSHOT_COMMAND));
  assert.match(line, /say the word and I will\.$/);
  assert.equal(snapshotReaderLine({ kind: 'unreadable', reason: 'x' }, FRESH_NOW), line,
    'an unreadable file is the same case as an absent one');
});

test('the stale line says when, and what to run', () => {
  const line = snapshotReaderLine(read(), new Date('2026-09-16T15:35:00Z'));
  assert.equal(line, 'Snapshot is from 2026-09-15 15:32 UTC; run life-snapshot.py --write for a fresh one.');
});

test('the degraded line uses the file\'s own effect strings', () => {
  const ok = read({
    degraded: [
      { source: 'focus_rank', reason: 'no GL-002 row yet', effect: 'the focus list is empty' },
      { source: 'planner_week', reason: 'note type not written yet', effect: 'the week and the day are empty' },
    ],
  });
  assert.equal(
    snapshotReaderLine(ok, FRESH_NOW),
    'Part of the snapshot is empty: the focus list is empty; the week and the day are empty.',
  );
  assert.match(snapshotBrief(ok.report, FRESH_NOW), /Degraded \(2\):\n {2}focus_rank: no GL-002 row yet -> the focus list is empty/);
});

test('findings are listed, and a long list says how many are left in the file', () => {
  const findings = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, message: `m${i}` }));
  const brief = snapshotBrief(read({ findings }).report, FRESH_NOW);
  assert.match(brief, /Findings \(7\):/);
  assert.match(brief, /\.\.\. and 2 more in snapshot\.json/);
});

test('the status line is a fact, and never a call to action', () => {
  assert.equal(snapshotStatusLine(read(), FRESH_NOW), 'Life snapshot 2026-09-15: fresh.');
  assert.equal(
    snapshotStatusLine(read(), new Date('2026-09-16T15:35:00Z')),
    'Life snapshot 2026-09-15: stale.',
  );
  assert.equal(snapshotStatusLine({ kind: 'missing' }), 'Life snapshot: not run on this device.');
  assert.equal(
    snapshotStatusLine(read({ degraded: [{ source: 'a', reason: 'b', effect: 'c' }] }), FRESH_NOW),
    'Life snapshot 2026-09-15: fresh, 1 source empty.',
  );
});

test('the injected block carries the brief and the two things the model may not do', () => {
  const block = snapshotContextBlock(read(), FRESH_NOW);
  assert.ok(block.startsWith(`Life snapshot (${SNAPSHOT_PATH}, schema 1).`));
  assert.match(block, /Do not re-rank it, drop entries or improve an order\./);
  assert.ok(block.includes(snapshotBrief(read().report, FRESH_NOW)));
});

test('a missing file injects the refusal, not a brief', () => {
  const block = snapshotContextBlock({ kind: 'missing' }, FRESH_NOW);
  assert.match(block, /Do not answer the six life questions from memory/);
  assert.match(block, /never read an absent file as an empty life/);
  assert.ok(!block.includes('Goals ('), 'nothing is invented to fill the block');
});
