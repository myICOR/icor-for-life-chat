/* The insights model. Pure: no Obsidian import, so every bucket, range and
 * filter has one right answer and is asserted in test/team.test.mjs.
 *
 * Two sources feed it and both are records the plugin itself wrote:
 *   - `session-manifest.json`, one per archived conversation. From 0.6.0 it
 *     carries per-agent and per-tool counts; older folders do not, and for
 *     those the loader derives the same counts from `transcript.json` with
 *     `deriveFromEvents` below - the SAME function the writer uses, so the
 *     numbers a 0.5.x archive yields are the numbers a 0.6.0 archive would have
 *     been written with.
 *   - the vault's own counts (roster, session logs, tasks), read by the loader.
 *
 * A session with no token count contributes NO bar. Null is a real answer and
 * it is never drawn as zero. */

import type { ChatEvent } from '../model/types';
import type { RosterRef } from './usage';
import { matchRoster } from './usage';

/** One participant's counts in one session, as the manifest records them. */
export interface ManifestAgent {
  agentType: string;
  toolCalls: number;
  textBlocks: number;
  /** Null when the record cannot say - a transcript replayed after the fact. */
  durationMs: number | null;
  status: string;
}

export interface DerivedCounts {
  agents: ManifestAgent[];
  tools: Record<string, number>;
  mainToolCalls: number;
  mainTextBlocks: number;
}

/**
 * Per-agent and per-tool counts from a transcript's events. Main-thread events
 * carry `stream === null`; a subagent's carry the tool-use id that spawned it,
 * which `subagent-start` names first.
 */
export function deriveFromEvents(events: readonly ChatEvent[]): DerivedCounts {
  const agents = new Map<string, ManifestAgent>();
  const tools: Record<string, number> = {};
  let mainToolCalls = 0;
  let mainTextBlocks = 0;
  for (const event of events) {
    if (event.kind === 'subagent-start') {
      if (!agents.has(event.agentId)) {
        agents.set(event.agentId, {
          agentType: event.agentType || 'agent',
          toolCalls: 0,
          textBlocks: 0,
          durationMs: null,
          status: 'unknown',
        });
      }
      continue;
    }
    if (event.kind === 'subagent-end') {
      const agent = agents.get(event.agentId);
      if (agent) agent.status = event.ok ? 'done' : 'failed';
      continue;
    }
    if (event.kind === 'tool-call') {
      if (event.stream === null) {
        mainToolCalls += 1;
        tools[event.name] = (tools[event.name] ?? 0) + 1;
      } else {
        const agent = agents.get(event.stream);
        if (agent) agent.toolCalls += 1;
      }
      continue;
    }
    if (event.kind === 'text-final' && event.text.trim()) {
      if (event.stream === null) mainTextBlocks += 1;
      else {
        const agent = agents.get(event.stream);
        if (agent) agent.textBlocks += 1;
      }
    }
  }
  return { agents: Array.from(agents.values()), tools, mainToolCalls, mainTextBlocks };
}

/** One archived conversation, in the shape the charts consume. */
export interface SessionRecord {
  /** Vault-relative archive folder. */
  folder: string;
  title: string;
  startedAt: number;
  endedAt: number;
  /** Null when the manifest recorded no measured total. */
  tokens: number | null;
  model: string | null;
  agents: ManifestAgent[];
  tools: Record<string, number>;
  mainToolCalls: number;
  mainTextBlocks: number;
  /** WiP folders the session touched, from the manifest; empty for older folders. */
  wip: string[];
}

export type RangeKey = '7d' | '30d' | '90d' | 'all';

export const RANGES: ReadonlyArray<{ key: RangeKey; label: string; days: number | null }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'ALL', days: null },
];

export interface Filters {
  /** A participant key as `agentKey` produces it, or null. */
  agent: string | null;
  model: string | null;
}

export interface Bucket {
  /** The bucket's first day as `YYYY-MM-DD`, local time. */
  day: string;
  startMs: number;
  sessions: number;
  /** Null when no session in the bucket carried a measured token count. */
  tokens: number | null;
}

export interface AgentTotal {
  key: string;
  name: string;
  /** Times the agent worked: one per session for the main thread, one per spawn for a subagent. */
  runs: number;
  activity: number;
  toolCalls: number;
  sessions: number;
  matched: boolean;
}

export interface Aggregate {
  sessions: SessionRecord[];
  unit: 'day' | 'week';
  buckets: Bucket[];
  sessionCount: number;
  /** Null when no session in range carried a measured token count. */
  tokens: number | null;
  agents: AgentTotal[];
  tools: Array<{ name: string; count: number }>;
  models: Array<{ model: string; sessions: number }>;
}

const DAY = 86_400_000;

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar day. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday of the week that holds `ms`, local time. */
function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const weekday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - weekday);
  return d.getTime();
}

export function rangeStart(range: RangeKey, now: number): number | null {
  const spec = RANGES.find((r) => r.key === range);
  if (!spec || spec.days === null) return null;
  return startOfDay(now - (spec.days - 1) * DAY);
}

/**
 * The key a participant is filtered and totalled under: the roster slug when
 * the type matches one, otherwise the raw type lowercased. The main thread is
 * `larry` when the roster has him, `team` when it does not.
 */
export function agentKey(agentType: string, roster: RosterRef[] | null): { key: string; name: string; matched: boolean } {
  const hit = matchRoster(agentType, roster);
  if (hit) return { key: hit.slug, name: hit.name, matched: true };
  const raw = agentType.trim() || 'agent';
  return { key: raw.toLowerCase(), name: raw, matched: false };
}

export function mainKey(roster: RosterRef[] | null): { key: string; name: string; matched: boolean } {
  const larry = matchRoster('larry', roster);
  return larry ? { key: larry.slug, name: larry.name, matched: true } : { key: 'team', name: 'Team', matched: false };
}

/** Every participant of a session, main thread included, keyed. */
/* EVERY AGENT THAT RAN IS A PARTICIPANT, measured activity or not.
 *
 * The archive carries a subagent's spawn (`subagent-start`) but not its own
 * stream: the SDK's session file holds only the main thread, so a 0.5.x
 * folder records that Quinn ran and nothing of what Quinn did. Dropping the
 * zero-activity rows made those agents vanish from the ranking while their
 * avatars still sat on the session list - "subagents are not tracked" (Tom,
 * 2026-09-04). A run is a fact the archive does hold, so runs are what the
 * ranking counts; tool calls stay a detail, shown only when measured. */
function participants(session: SessionRecord, roster: RosterRef[] | null): Array<{ key: string; name: string; matched: boolean; activity: number; toolCalls: number; runs: number }> {
  const out: Array<{ key: string; name: string; matched: boolean; activity: number; toolCalls: number; runs: number }> = [];
  const mainActivity = session.mainToolCalls + session.mainTextBlocks;
  out.push({ ...mainKey(roster), activity: mainActivity, toolCalls: session.mainToolCalls, runs: 1 });
  for (const agent of session.agents) {
    out.push({ ...agentKey(agent.agentType, roster), activity: agent.toolCalls + agent.textBlocks, toolCalls: agent.toolCalls, runs: 1 });
  }
  return out;
}

/** More than this many days in view and the bars become weeks. */
export const WEEK_THRESHOLD_DAYS = 100;

export function aggregate(
  all: readonly SessionRecord[],
  range: RangeKey,
  filters: Filters,
  roster: RosterRef[] | null,
  now = Date.now(),
): Aggregate {
  const start = rangeStart(range, now);
  const inRange = all.filter((s) => (start === null || s.startedAt >= start) && s.startedAt <= now + DAY);
  const filtered = inRange.filter((s) => {
    if (filters.model && (s.model ?? '') !== filters.model) return false;
    if (filters.agent && !participants(s, roster).some((p) => p.key === filters.agent)) return false;
    return true;
  });
  const sessions = filtered.slice().sort((a, b) => b.startedAt - a.startedAt);

  /* The time axis spans the RANGE, not the data: a 30-day view with three
     sessions still shows thirty bars, most of them empty, because an axis that
     shrinks to fit the data hides how quiet the quiet days were. `all` spans
     from the earliest session in view to today. */
  const first = sessions.length ? Math.min(...sessions.map((s) => s.startedAt)) : now;
  const axisStart = start ?? startOfDay(first);
  const spanDays = Math.max(1, Math.round((startOfDay(now) - startOfDay(axisStart)) / DAY) + 1);
  const unit: 'day' | 'week' = spanDays > WEEK_THRESHOLD_DAYS ? 'week' : 'day';
  const bucketStart = unit === 'day' ? startOfDay : startOfWeek;
  const step = unit === 'day' ? DAY : 7 * DAY;

  const buckets: Bucket[] = [];
  const index = new Map<number, Bucket>();
  for (let t = bucketStart(axisStart); t <= now; t += step) {
    // Re-anchor through the calendar so a DST shift never lands a bucket a
    // hour off its own day.
    const anchored = bucketStart(t);
    if (index.has(anchored)) continue;
    const b: Bucket = { day: dayKey(anchored), startMs: anchored, sessions: 0, tokens: null };
    buckets.push(b);
    index.set(anchored, b);
  }
  for (const s of sessions) {
    const b = index.get(bucketStart(s.startedAt));
    if (!b) continue;
    b.sessions += 1;
    if (s.tokens !== null) b.tokens = (b.tokens ?? 0) + s.tokens;
  }

  const measured = sessions.filter((s) => s.tokens !== null);
  const tokens = measured.length ? measured.reduce((sum, s) => sum + (s.tokens ?? 0), 0) : null;

  const agentMap = new Map<string, AgentTotal>();
  const toolMap = new Map<string, number>();
  const modelMap = new Map<string, number>();
  for (const s of sessions) {
    const seen = new Set<string>();
    for (const p of participants(s, roster)) {
      const row = agentMap.get(p.key) ?? { key: p.key, name: p.name, activity: 0, toolCalls: 0, runs: 0, sessions: 0, matched: p.matched };
      row.activity += p.activity;
      row.toolCalls += p.toolCalls;
      row.runs += p.runs;
      if (!seen.has(p.key)) {
        row.sessions += 1;
        seen.add(p.key);
      }
      agentMap.set(p.key, row);
    }
    for (const [name, count] of Object.entries(s.tools)) toolMap.set(name, (toolMap.get(name) ?? 0) + count);
    if (s.model) modelMap.set(s.model, (modelMap.get(s.model) ?? 0) + 1);
  }

  return {
    sessions,
    unit,
    buckets,
    sessionCount: sessions.length,
    tokens,
    agents: Array.from(agentMap.values()).sort((a, b) => b.runs - a.runs || b.activity - a.activity || a.name.localeCompare(b.name)),
    tools: Array.from(toolMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    models: Array.from(modelMap.entries()).map(([model, sessions]) => ({ model, sessions })).sort((a, b) => b.sessions - a.sessions),
  };
}
