/* THE LIFE SNAPSHOT, READ BACK INTO THE PANEL. The pure half.
 *
 * `life-snapshot.py` (in the vault's own `06 AI Team/AI Team Knowledge/
 * Scripts/`) walks the My Life rooms, the journal, the scratchpads and the
 * Planner once and writes one JSON file under the machine layer. This file
 * turns that JSON back into the twenty-line brief the script prints, so a
 * conversation starts knowing the six everyday questions instead of walking
 * the folders again.
 *
 * Two facts about this file that are easy to get wrong later.
 *
 * THE PLUGIN NEVER RUNS THE SCRIPT. Obsidian has no Python and mobile has no
 * shell. A missing file means "not run on this device yet", never an error
 * and never "the member has no goals" (GL-1008: a missing report is never a
 * green).
 *
 * THE BRIEF IS RENDERED TWICE, IN TWO LANGUAGES, ON PURPOSE. The script
 * renders it for the session-start hook and the skill prerun; this renders it
 * for the chat. `brief()` in `life-snapshot.py` is the shape of record and
 * this mirrors it line for line. Two labels differ from the script as it
 * stands today and the difference is deliberate: Iris ruled on 2026-09-15
 * that the week's outcomes are "Weekly priorities" and the day's is the
 * "Daily highlight", and the script's own labels follow in its next pass.
 * The JSON KEYS (`weekly_goals`, `highlight`) are untouched: a key something
 * has already been written under is a migration, a label is not.
 *
 * Everything here is pure, so the brief the model actually receives can be
 * asserted on a string with no vault and no workspace. */

/** The file, under the machine layer (GL-1008). Reached through the adapter only. */
export const SNAPSHOT_PATH = '.icor-for-life/scripts/snapshot.json';

/** The one schema this reader understands. A different integer is refused, not guessed at. */
export const SNAPSHOT_SCHEMA = 1;

/** The scoring window the script uses, in days. Shown in the hot-topics line. */
export const SNAPSHOT_WINDOW_DAYS = 30;

/** Used only when the file carries no `thresholds.stale_after_hours` of its own. */
export const SNAPSHOT_STALE_AFTER_HOURS = 6;

/** The command that produces the file, quoted the way a member can paste it. */
export const SNAPSHOT_COMMAND =
  'python3 "06 AI Team/AI Team Knowledge/Scripts/life-snapshot.py" --write';

export interface SnapshotNamed {
  name: string;
}

export interface SnapshotFocus {
  name: string;
  focusRank: number | null;
}

export interface SnapshotWeeklyItem {
  text: string;
  done: boolean;
}

export interface SnapshotHotTopic {
  name: string;
  score: number;
}

export interface SnapshotDegraded {
  source: string;
  reason: string;
  effect: string;
}

export interface SnapshotFinding {
  id: string;
  message: string;
}

/** The slice of `snapshot.json` the brief is built from. Nothing else is read. */
export interface LifeSnapshot {
  schema: number;
  generatedAt: string;
  generatedLocalDate: string;
  goalsOpen: SnapshotNamed[];
  focus: SnapshotFocus[];
  activeCount: number;
  weeklyWeek: string;
  weeklyItems: SnapshotWeeklyItem[];
  weeklyDoneCount: number;
  weeklyReason: string | null;
  highlightText: string | null;
  highlightDone: boolean | null;
  highlightReason: string | null;
  keyElements: SnapshotNamed[];
  hotTopics: SnapshotHotTopic[];
  rankedTopics: number;
  sourcesCounted: [string, number][];
  todayJournalEntries: number;
  todayScratchpads: number;
  degraded: SnapshotDegraded[];
  findings: SnapshotFinding[];
  staleAfterHours: number;
}

export type SnapshotRead =
  | { kind: 'ok'; report: LifeSnapshot; stale: boolean }
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: string };

/* ---- reading JSON without trusting it ------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function arrayAt(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberAt(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Three-valued on purpose: the highlight's done marker is `Y`, `N` or pending. */
function boolAt(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function namedRows(rows: unknown[]): SnapshotNamed[] {
  const out: SnapshotNamed[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = stringAt(row, 'name');
    if (name) out.push({ name });
  }
  return out;
}

/**
 * The snapshot, or why it cannot be used. Never throws: a corrupt file is a
 * reader's problem to SAY, not to crash on.
 */
export function parseSnapshot(text: string): SnapshotRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'unreadable', reason: 'the file is not valid JSON' };
  }
  if (!isRecord(raw)) return { kind: 'unreadable', reason: 'the file is not a JSON object' };
  const schema = numberAt(raw, 'schema', -1);
  if (schema !== SNAPSHOT_SCHEMA) {
    return {
      kind: 'unreadable',
      reason: `the file is schema ${schema === -1 ? 'unknown' : String(schema)}, this build reads schema ${SNAPSHOT_SCHEMA}`,
    };
  }
  const generatedAt = stringAt(raw, 'generated_at');
  if (!generatedAt) return { kind: 'unreadable', reason: 'the file carries no generated_at' };

  const thresholds = recordAt(raw, 'thresholds');
  const goals = recordAt(raw, 'goals');
  const projects = recordAt(raw, 'projects');
  const weekly = recordAt(raw, 'weekly_goals');
  const highlight = recordAt(raw, 'highlight');
  const topics = recordAt(raw, 'topics');
  const today = recordAt(raw, 'today');
  const sources = recordAt(topics, 'sources_counted');

  const focus: SnapshotFocus[] = [];
  for (const row of arrayAt(projects, 'focus')) {
    if (!isRecord(row)) continue;
    const name = stringAt(row, 'name');
    if (!name) continue;
    const rank = row['focus_rank'];
    focus.push({ name, focusRank: typeof rank === 'number' && Number.isFinite(rank) ? rank : null });
  }

  const weeklyItems: SnapshotWeeklyItem[] = [];
  for (const row of arrayAt(weekly, 'items')) {
    if (!isRecord(row)) continue;
    const text_ = stringAt(row, 'text');
    if (!text_) continue;
    weeklyItems.push({ text: text_, done: row['done'] === true });
  }

  const hotTopics: SnapshotHotTopic[] = [];
  for (const row of arrayAt(topics, 'hot')) {
    if (!isRecord(row)) continue;
    const name = stringAt(row, 'name');
    if (!name) continue;
    hotTopics.push({ name, score: numberAt(recordAt(row, 'attention'), 'score', 0) });
  }

  const sourcesCounted: [string, number][] = [];
  for (const [key, value] of Object.entries(sources)) {
    if (typeof value === 'number' && Number.isFinite(value)) sourcesCounted.push([key, value]);
  }

  const degraded: SnapshotDegraded[] = [];
  for (const row of arrayAt(raw, 'degraded')) {
    if (!isRecord(row)) continue;
    degraded.push({
      source: stringAt(row, 'source') ?? 'unknown',
      reason: stringAt(row, 'reason') ?? 'not stated',
      effect: stringAt(row, 'effect') ?? 'not stated',
    });
  }

  const findings: SnapshotFinding[] = [];
  for (const row of arrayAt(raw, 'findings')) {
    if (!isRecord(row)) continue;
    findings.push({
      id: stringAt(row, 'id') ?? 'finding',
      message: stringAt(row, 'message') ?? 'not stated',
    });
  }

  const report: LifeSnapshot = {
    schema,
    generatedAt,
    generatedLocalDate: stringAt(raw, 'generated_local_date') ?? generatedAt.slice(0, 10),
    goalsOpen: namedRows(arrayAt(goals, 'open')),
    focus,
    activeCount: numberAt(projects, 'active_count', arrayAt(projects, 'active').length),
    weeklyWeek: stringAt(weekly, 'week') ?? '',
    weeklyItems,
    weeklyDoneCount: numberAt(weekly, 'done_count', weeklyItems.filter((i) => i.done).length),
    weeklyReason: stringAt(weekly, 'reason'),
    highlightText: stringAt(highlight, 'text'),
    highlightDone: boolAt(highlight, 'done'),
    highlightReason: stringAt(highlight, 'reason'),
    keyElements: namedRows(arrayAt(raw, 'key_elements')),
    hotTopics,
    rankedTopics: numberAt(topics, 'ranked_count', 0),
    sourcesCounted,
    todayJournalEntries: arrayAt(today, 'journal_entries').length,
    todayScratchpads: arrayAt(today, 'scratchpads').length,
    degraded,
    findings,
    staleAfterHours: numberAt(thresholds, 'stale_after_hours', SNAPSHOT_STALE_AFTER_HOURS),
  };
  return { kind: 'ok', report, stale: snapshotIsStale(report) };
}

/**
 * The reader's staleness rule, the same one `is_stale()` states in the script:
 * older than the file's own threshold, OR not generated on today's local date.
 * A snapshot whose stamp cannot be read counts as stale.
 */
export function snapshotIsStale(report: LifeSnapshot, now: Date = new Date()): boolean {
  const generated = Date.parse(report.generatedAt);
  if (!Number.isFinite(generated)) return true;
  const hours = (now.getTime() - generated) / 3_600_000;
  if (hours >= report.staleAfterHours) return true;
  const localToday = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return report.generatedLocalDate !== localToday;
}

/* ---- the brief ----------------------------------------------------------- */

/** `join_short` in the script: the first `keep` names, then how many are left. */
export function joinShort(names: readonly string[], keep: number): string {
  if (names.length === 0) return 'none';
  const shown = names.slice(0, keep).join(', ');
  return names.length <= keep ? shown : `${shown}, ... (${names.length - keep} more)`;
}

const HIGHLIGHT_STATE: Record<string, string> = {
  true: 'done',
  false: 'not done',
  null: 'pending',
};

/**
 * The twenty-line block, mirroring `brief()` in `life-snapshot.py`. Rendered
 * here and never by a model, which is the whole point of the file existing.
 */
export function snapshotBrief(report: LifeSnapshot, now: Date = new Date()): string {
  const lines: string[] = [];
  const fresh = snapshotIsStale(report, now) ? 'stale' : 'fresh';
  lines.push(
    `Life snapshot ${report.generatedLocalDate} ${report.generatedAt.slice(11, 16)} UTC (${fresh})`,
  );

  lines.push(
    `Goals (${report.goalsOpen.length} open): ${joinShort(report.goalsOpen.map((g) => g.name), 6)}`,
  );

  if (report.focus.length > 0) {
    lines.push(
      `Focus (your ranks): ${report.focus.map((p) => `${p.focusRank ?? '?'} ${p.name}`).join(' . ')}`,
    );
  } else {
    lines.push(
      'Focus (your ranks): none set. Say which projects matter and I will store the decision.',
    );
  }
  lines.push(`Active projects: ${report.activeCount} (focus set on ${report.focus.length})`);

  /* "Weekly priorities", not "weekly goals": Iris, 2026-09-15. The JSON key
     stays `weekly_goals`; only the words a person reads changed. */
  if (report.weeklyItems.length > 0) {
    const rows = report.weeklyItems
      .map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`)
      .join(' . ');
    lines.push(
      `Weekly priorities ${report.weeklyWeek} (${report.weeklyDoneCount} of ${report.weeklyItems.length} done): ${rows}`,
    );
  } else {
    lines.push(
      `Weekly priorities ${report.weeklyWeek}: none (${report.weeklyReason ?? 'empty'})`,
    );
  }

  if (report.highlightText) {
    const state = HIGHLIGHT_STATE[String(report.highlightDone)] ?? 'pending';
    lines.push(`Daily highlight: ${report.highlightText} (${state})`);
  } else {
    lines.push(`Daily highlight: none recorded (${report.highlightReason ?? 'empty'})`);
  }

  lines.push(
    `Key elements (${report.keyElements.length}): ${joinShort(report.keyElements.map((k) => k.name), 8)}`,
  );

  if (report.hotTopics.length > 0) {
    lines.push(
      `Hot topics (${SNAPSHOT_WINDOW_DAYS}d, weighted): ${report.hotTopics.map((t) => `${t.name} ${t.score}`).join(' . ')}`,
    );
  } else {
    lines.push(
      `Hot topics (${SNAPSHOT_WINDOW_DAYS}d, weighted): none scored above 0 (${report.rankedTopics} topics ranked)`,
    );
  }
  lines.push(
    `Attention sources counted: ${report.sourcesCounted.map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );

  lines.push(
    `Today: ${report.todayJournalEntries} journal ${report.todayJournalEntries === 1 ? 'entry' : 'entries'}, `
    + `${report.todayScratchpads} scratchpad${report.todayScratchpads === 1 ? '' : 's'}`,
  );

  if (report.degraded.length > 0) {
    lines.push(`Degraded (${report.degraded.length}):`);
    for (const row of report.degraded) lines.push(`  ${row.source}: ${row.reason} -> ${row.effect}`);
  } else {
    lines.push('Degraded: none');
  }

  if (report.findings.length > 0) {
    lines.push(`Findings (${report.findings.length}):`);
    for (const row of report.findings.slice(0, 5)) lines.push(`  ${row.id}: ${row.message}`);
    if (report.findings.length > 5) {
      lines.push(`  ... and ${report.findings.length - 5} more in snapshot.json`);
    }
  } else {
    lines.push('Findings: none');
  }
  return lines.join('\n');
}

/* ---- the three reader lines (Axon section 7.3) --------------------------- */

/**
 * The one line the reader must say, word for word, or null when the snapshot
 * is fresh, complete and there is nothing to declare.
 *
 * Stale, missing and degraded are three different sentences and none of them
 * is an error message. They are stated here rather than left to the model
 * because a model asked to improvise a caveat improvises a different one
 * every time.
 */
export function snapshotReaderLine(read: SnapshotRead, now: Date = new Date()): string | null {
  if (read.kind === 'missing' || read.kind === 'unreadable') {
    return `No life snapshot on this device yet. Run: ${SNAPSHOT_COMMAND}. `
      + 'Until then I would have to read the folders, which is slower and less reliable; '
      + 'say the word and I will.';
  }
  if (snapshotIsStale(read.report, now)) {
    return `Snapshot is from ${read.report.generatedLocalDate} ${read.report.generatedAt.slice(11, 16)} UTC; `
      + 'run life-snapshot.py --write for a fresh one.';
  }
  if (read.report.degraded.length > 0) {
    return `Part of the snapshot is empty: ${read.report.degraded.map((d) => d.effect).join('; ')}.`;
  }
  return null;
}

/** The short fact for the status area. Never a caveat, never a call to action. */
export function snapshotStatusLine(read: SnapshotRead, now: Date = new Date()): string {
  if (read.kind === 'missing') return 'Life snapshot: not run on this device.';
  if (read.kind === 'unreadable') return `Life snapshot: unreadable (${read.reason}).`;
  const state = snapshotIsStale(read.report, now) ? 'stale' : 'fresh';
  const degraded = read.report.degraded.length;
  return `Life snapshot ${read.report.generatedLocalDate}: ${state}`
    + (degraded > 0 ? `, ${degraded} source${degraded === 1 ? '' : 's'} empty.` : '.');
}

/**
 * What is prepended to the FIRST message of a conversation: the reader line,
 * the brief, and the two things the model may not do with it (Axon 7.4).
 * Empty string when there is nothing to inject at all.
 */
export function snapshotContextBlock(read: SnapshotRead, now: Date = new Date()): string {
  const head = `Life snapshot (${SNAPSHOT_PATH}, schema ${SNAPSHOT_SCHEMA}).`;
  const line = snapshotReaderLine(read, now);
  if (read.kind !== 'ok') {
    return [
      head,
      'The file is not readable on this device, so there is no snapshot to answer from.',
      line,
      'Do not answer the six life questions from memory, and never read an absent file as an empty life.',
    ].filter(Boolean).join('\n');
  }
  const body = [
    head,
    'Answer the six everyday questions from this block: goals, the projects in focus, the',
    "week's priorities, today's highlight, key elements, and the topics with recent attention.",
    'The order rules are in the file. Do not re-rank it, drop entries or improve an order.',
  ];
  if (line) body.push(line);
  body.push('', snapshotBrief(read.report, now));
  return body.join('\n');
}
