/* THE ACTIVITY SENTENCE: what a group of tool calls did, in one line.
 *
 * The collapsed group used to read `12 TOOL CALLS`, which is a count of the
 * thing the reader is not looking at. What the reader wants is the shape of
 * the work: how many notes were read, how many touched, how many commands
 * ran, how long it took. Every number below is measured off the rows the
 * renderer already holds - distinct targets, family counts, first start to
 * last end - and no model is asked for any of it. Deterministic, therefore a
 * script (GL-075). */

import { shortDuration } from './format';

export interface ActivityRow {
  name: string;
  /** The raw argument: a path for the file tools, a command for Bash. */
  target: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
}

export interface ActivityCounts {
  /** Distinct paths read. */
  read: number;
  /** True when every path read ends in .md, so the noun can say "notes". */
  readNotes: boolean;
  /** Distinct paths written or edited. */
  edited: number;
  commands: number;
  searches: number;
  fetches: number;
  agents: number;
  /** Calls whose family the table does not know. Counted, never dropped. */
  other: number;
  /** First start to last measured end, or null when no row has finished. */
  elapsedMs: number | null;
}

export function activityCounts(rows: readonly ActivityRow[]): ActivityCounts {
  const read = new Set<string>();
  const edited = new Set<string>();
  let commands = 0;
  let searches = 0;
  let fetches = 0;
  let agents = 0;
  let other = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    switch (row.name) {
      case 'Read':
        read.add(row.target || `#${read.size}`);
        break;
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        edited.add(row.target || `#${edited.size}`);
        break;
      case 'Bash':
        commands += 1;
        break;
      case 'Glob':
      case 'Grep':
        searches += 1;
        break;
      case 'WebFetch':
      case 'WebSearch':
        fetches += 1;
        break;
      case 'Task':
      case 'Agent':
        agents += 1;
        break;
      default:
        other += 1;
    }
    if (row.startedAt < first) first = row.startedAt;
    if (row.endedAt !== null && row.endedAt > last) last = row.endedAt;
  }
  const paths = Array.from(read);
  return {
    read: read.size,
    readNotes: paths.length > 0 && paths.every((p) => p.toLowerCase().endsWith('.md')),
    edited: edited.size,
    commands,
    searches,
    fetches,
    agents,
    other,
    elapsedMs: Number.isFinite(first) && Number.isFinite(last) && last >= first ? last - first : null,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `Read 4 notes, edited 2, ran 3 commands · 41 s`. A family with zero is
 * omitted, the first clause is capitalised, and the elapsed time follows a
 * middle dot only when some row has actually finished. Empty rows give an
 * empty string, so a caller can fall back to a count.
 */
export function activitySentence(rows: readonly ActivityRow[]): string {
  const c = activityCounts(rows);
  const parts: string[] = [];
  if (c.read > 0) parts.push(`read ${plural(c.read, c.readNotes ? 'note' : 'file', c.readNotes ? 'notes' : 'files')}`);
  if (c.edited > 0) parts.push(`edited ${c.edited}`);
  if (c.commands > 0) parts.push(`ran ${plural(c.commands, 'command', 'commands')}`);
  if (c.searches > 0) parts.push(`searched ${plural(c.searches, 'time', 'times')}`);
  if (c.fetches > 0) parts.push(`fetched ${plural(c.fetches, 'page', 'pages')}`);
  if (c.agents > 0) parts.push(`sent ${plural(c.agents, 'agent', 'agents')}`);
  if (c.other > 0) parts.push(`${plural(c.other, 'other call', 'other calls')}`);
  if (parts.length === 0) return '';
  const head = parts[0] ?? '';
  const sentence = [head.charAt(0).toUpperCase() + head.slice(1), ...parts.slice(1)].join(', ');
  return c.elapsedMs !== null ? `${sentence} · ${shortDuration(c.elapsedMs)}` : sentence;
}
