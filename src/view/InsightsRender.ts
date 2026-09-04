/* The insights page, drawn. No `App` in here: the view aggregates and hands
 * this function the numbers plus a host of callbacks, so the same function
 * mounts in the computed-style fixture with recorded data and the pixels the
 * gate measures are the pixels the product draws.
 *
 * Charts are inline SVG for the bars and HTML for every word and digit. The
 * SVG stretches to the column (`preserveAspectRatio: none`) and carries no
 * text of its own, so nothing on the page scales with the pane width except
 * the bars, which is the one thing that should. Every readout is a number
 * that was measured from an archive; a bucket without a token count draws no
 * bar and a stat without a measurement draws no tile. */

import { setIcon, setTooltip } from 'obsidian';
import type { Aggregate, Bucket, Filters, RangeKey } from '../team/insights';
import { RANGES } from '../team/insights';
import type { VaultCounts } from '../team/load';
import { compactNumber } from '../model/format';
import { renderAvatar } from './TeamStrip';

export interface InsightsUiState {
  range: RangeKey;
  filters: Filters;
}

export interface InsightsHost {
  resolveAvatar: (path: string) => string;
  /** The roster's portrait for a participant key, or null. */
  avatarFor: (key: string) => string | null;
  openSession: (folder: string) => void;
  /** Open a WiP folder's brief or README (R1). */
  openWip: (folder: string) => void;
  onRange: (range: RangeKey) => void;
  onAgent: (key: string | null) => void;
  onModel: (model: string | null) => void;
  /** An agent's journal, read lazily per row; absent hosts show no journal line. */
  journalsFor?: (key: string) => Promise<{ count: number; newest: { path: string; title: string; date: string | null } | null } | null>;
}

export interface InsightsPage {
  agg: Aggregate;
  vault: VaultCounts;
  /** Every archived session, before range and filters. */
  totalSessions: number;
  archiveRoot: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

function stat(parent: HTMLElement, value: number | null, label: string, suffix = ''): void {
  if (value === null) return;
  const tile = parent.createDiv({ cls: 'aic-stat' });
  tile.createDiv({ cls: 'aic-stat-value', text: `${compactNumber(value)}${suffix}` });
  tile.createDiv({ cls: 'aic-stat-label', text: label });
}

function chip(parent: HTMLElement, label: string, active: boolean, onClick: () => void, clearable = false): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: 'aic-filter-chip', type: 'button' });
  btn.toggleClass('is-active', active);
  btn.createSpan({ text: label });
  if (clearable) {
    const x = btn.createSpan({ cls: 'aic-filter-x' });
    setIcon(x, 'x');
    btn.setAttr('aria-label', `Clear the ${label} filter`);
  } else {
    btn.setAttr('aria-label', `Show ${label}`);
    btn.setAttr('aria-pressed', active ? 'true' : 'false');
  }
  btn.addEventListener('click', onClick);
  return btn;
}

function section(parent: HTMLElement, kicker: string): HTMLElement {
  const s = parent.createDiv({ cls: 'aic-ins-section' });
  s.createDiv({ cls: 'aic-kicker', text: kicker });
  return s;
}

function dateLabel(day: string): string {
  // `YYYY-MM-DD` to `DD MMM`, no locale surprise: the month names are ours.
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const m = Number.parseInt(day.slice(5, 7), 10);
  return `${day.slice(8, 10)} ${MONTHS[m - 1] ?? ''}`.trim();
}

/**
 * A column chart over the buckets. `value` picks the measured quantity; a
 * null answer draws no bar. Returns nothing: the chart is its own readout.
 */
function columns(
  parent: HTMLElement,
  buckets: readonly Bucket[],
  unit: 'day' | 'week',
  value: (b: Bucket) => number | null,
  describe: (b: Bucket, v: number) => string,
  format: (v: number) => string,
): void {
  const measured = buckets.map(value).filter((v): v is number => v !== null);
  const wrap = parent.createDiv({ cls: 'aic-chart' });
  if (measured.length === 0) {
    wrap.createDiv({ cls: 'aic-ins-empty', text: 'Nothing measured in this range.' });
    return;
  }
  const max = Math.max(...measured, 1);
  const axis = wrap.createDiv({ cls: 'aic-chart-y' });
  axis.createSpan({ cls: 'aic-chart-tick', text: format(max) });
  axis.createSpan({ cls: 'aic-chart-tick', text: format(max / 2) });
  axis.createSpan({ cls: 'aic-chart-tick', text: '0' });

  const plot = wrap.createDiv({ cls: 'aic-chart-plot' });
  const svg = svgEl(plot, 'svg', {
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
    class: 'aic-chart-svg',
    role: 'img',
    'aria-label': `${measured.length} of ${buckets.length} ${unit}s measured`,
  });
  svgEl(svg, 'line', { x1: '0', y1: '50', x2: '100', y2: '50', class: 'aic-chart-grid' });
  svgEl(svg, 'line', { x1: '0', y1: '100', x2: '100', y2: '100', class: 'aic-chart-base' });
  const readout = wrap.createDiv({ cls: 'aic-chart-readout' });
  const slot = 100 / buckets.length;
  const barW = slot * 0.7;
  buckets.forEach((b, i) => {
    const v = value(b);
    if (v === null) return;
    const h = (v / max) * 100;
    const rect = svgEl(svg, 'rect', {
      x: String(i * slot + (slot - barW) / 2),
      y: String(100 - h),
      width: String(barW),
      height: String(Math.max(h, 0.6)),
      class: 'aic-chart-bar',
    });
    const text = describe(b, v);
    const title = svgEl(rect, 'title', {});
    title.textContent = text;
    rect.addEventListener('mouseenter', () => readout.setText(text));
    rect.addEventListener('mouseleave', () => readout.setText(''));
  });
  const x = wrap.createDiv({ cls: 'aic-chart-x' });
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (first) x.createSpan({ cls: 'aic-chart-tick', text: dateLabel(first.day) });
  if (last && last !== first) x.createSpan({ cls: 'aic-chart-tick', text: dateLabel(last.day) });
}

function hbars(
  parent: HTMLElement,
  rows: ReadonlyArray<{ key: string; name: string; count: number; detail: string; avatar: string | null; active: boolean }>,
  resolve: (path: string) => string,
  onPick: ((key: string) => void) | null,
): void {
  if (rows.length === 0) {
    parent.createDiv({ cls: 'aic-ins-empty', text: 'Nothing measured in this range.' });
    return;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  const list = parent.createDiv({ cls: 'aic-hbars' });
  for (const r of rows) {
    const row = onPick
      ? list.createEl('button', { cls: 'aic-hbar-row', type: 'button' })
      : list.createDiv({ cls: 'aic-hbar-row is-static' });
    row.toggleClass('is-active', r.active);
    if (onPick) {
      row.setAttr('aria-pressed', r.active ? 'true' : 'false');
      row.setAttr('aria-label', `${r.name}, ${r.detail}. ${r.active ? 'Clear this filter' : 'Filter by this agent'}.`);
      row.addEventListener('click', () => onPick(r.key));
    }
    if (r.avatar !== undefined && onPick) renderAvatar(row, r.name, r.avatar, resolve, 'aic-hbar-face');
    row.createSpan({ cls: 'aic-hbar-name', text: r.name });
    const track = row.createSpan({ cls: 'aic-hbar-track' });
    const fill = track.createSpan({ cls: 'aic-hbar-fill' });
    fill.setCssStyles({ width: `${Math.max(1, Math.round((r.count / max) * 100))}%` });
    row.createSpan({ cls: 'aic-hbar-count', text: compactNumber(r.count) });
    setTooltip(row, `${r.name} · ${r.detail}`);
  }
}

export function renderInsights(root: HTMLElement, page: InsightsPage, state: InsightsUiState, host: InsightsHost): void {
  root.empty();
  const { agg, vault } = page;

  const head = root.createDiv({ cls: 'aic-ins-head' });
  const k = head.createDiv({ cls: 'aic-kicker aic-kicker-wide' });
  k.createSpan({ text: 'AI TEAM' });
  k.createSpan({ cls: 'aic-middot', text: '·' });
  k.createSpan({ text: 'INSIGHTS' });
  head.createDiv({ cls: 'aic-empty-display', text: 'The team at work.' });

  /* The stat row. Five candidates, and only the measured ones become tiles:
     a vault with no team folder has no roster count, and a range with no
     token-carrying session has no token total. */
  const stats = root.createDiv({ cls: 'aic-stats' });
  stat(stats, agg.sessionCount, 'sessions in range');
  stat(stats, agg.tokens, 'tokens in range');
  stat(stats, vault.agents, 'agents on the roster');
  stat(stats, vault.sessionLogs, 'session logs');
  stat(stats, vault.tasksOpen, 'tasks open');

  const filters = root.createDiv({ cls: 'aic-filters' });
  filters.setAttr('role', 'group');
  filters.setAttr('aria-label', 'Range and filters');
  for (const r of RANGES) chip(filters, r.label, state.range === r.key, () => host.onRange(r.key));
  if (state.filters.agent) {
    const name = agg.agents.find((a) => a.key === state.filters.agent)?.name ?? state.filters.agent;
    chip(filters, name, true, () => host.onAgent(null), true);
  }
  if (state.filters.model) chip(filters, state.filters.model, true, () => host.onModel(null), true);

  if (page.totalSessions === 0) {
    root.createDiv({ cls: 'aic-ins-empty aic-ins-empty-page', text: 'No archived sessions yet.' });
    root.createDiv({
      cls: 'aic-ins-note',
      text: `Sessions are archived into ${page.archiveRoot || 'the archive folder'} after every turn. The charts fill from there.`,
    });
    return;
  }
  if (agg.sessionCount === 0) {
    root.createDiv({ cls: 'aic-ins-empty aic-ins-empty-page', text: 'No sessions in this range.' });
    return;
  }

  const unitWord = agg.unit === 'day' ? 'DAY' : 'WEEK';
  const tokensSec = section(root, `TOKENS OVER TIME · PER ${unitWord}`);
  columns(
    tokensSec, agg.buckets, agg.unit,
    (b) => b.tokens,
    (b, v) => `${b.day} · ${compactNumber(v)} tokens · ${b.sessions} session${b.sessions === 1 ? '' : 's'}`,
    compactNumber,
  );

  const sessionsSec = section(root, `SESSIONS PER ${unitWord}`);
  columns(
    sessionsSec, agg.buckets, agg.unit,
    (b) => (b.sessions > 0 ? b.sessions : null),
    (b, v) => `${b.day} · ${v} session${v === 1 ? '' : 's'}`,
    (v) => String(Math.round(v)),
  );

  const agentsSec = section(root, 'MOST USED AGENTS · BY RUNS');
  hbars(
    agentsSec,
    agg.agents.map((a) => ({
      key: a.key,
      name: a.name,
      count: a.runs,
      detail: [
        `${a.sessions} session${a.sessions === 1 ? '' : 's'}`,
        a.toolCalls > 0 ? `${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}` : null,
      ].filter((part): part is string => part !== null).join(' · '),
      avatar: host.avatarFor(a.key),
      active: state.filters.agent === a.key,
    })),
    host.resolveAvatar,
    (key) => host.onAgent(state.filters.agent === key ? null : key),
  );
  /* THE JOURNAL LINE, per roster agent, filled in after the row exists. The
     journals are the agents' own memory and this is the one place the vault
     shows who learned what; read lazily so a 52-agent roster costs nothing
     until the page is open. An agent with no journal folder gets no line, and
     a folder with zero entries says so in words rather than in a zero. */
  if (host.journalsFor) {
    const rows = Array.from(agentsSec.querySelectorAll<HTMLElement>('.aic-hbar-row'));
    agg.agents.forEach((a, i) => {
      const row = rows[i];
      if (!row || !a.matched) return;
      void host.journalsFor?.(a.key).then((journal) => {
        if (!journal || !row.isConnected) return;
        const line = row.createSpan({ cls: 'aic-hbar-journal' });
        if (journal.count === 0) {
          line.setText('No journal entries yet');
          return;
        }
        const parts = [`${journal.count} journal entr${journal.count === 1 ? 'y' : 'ies'}`];
        if (journal.newest?.date) parts.push(journal.newest.date);
        line.setText(parts.join(' · '));
      });
    });
  }

  const toolsSec = section(root, 'TOOLS USED · MAIN THREAD');
  hbars(
    toolsSec,
    agg.tools.map((t) => ({ key: t.name, name: t.name, count: t.count, detail: `${t.count} call${t.count === 1 ? '' : 's'}`, avatar: null, active: false })),
    host.resolveAvatar,
    null,
  );

  if (agg.models.length > 0) {
    const modelsSec = section(root, 'MODELS');
    const row = modelsSec.createDiv({ cls: 'aic-filters' });
    for (const m of agg.models) {
      chip(row, `${m.model} · ${m.sessions}`, state.filters.model === m.model, () =>
        host.onModel(state.filters.model === m.model ? null : m.model));
    }
  }

  const listSec = section(root, `SESSIONS · ${agg.sessionCount}`);
  const list = listSec.createDiv({ cls: 'aic-ins-sessions' });
  for (const s of agg.sessions) {
    const row = list.createEl('button', { cls: 'aic-ins-session', type: 'button' });
    row.setAttr('aria-label', `Open the archived conversation: ${s.title}`);
    row.addEventListener('click', () => host.openSession(s.folder));
    const d = new Date(s.startedAt);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    row.createSpan({ cls: 'aic-ins-session-date', text: stamp });
    row.createSpan({ cls: 'aic-ins-session-title', text: s.title });
    const faces = row.createSpan({ cls: 'aic-ins-session-faces' });
    const seen = new Set<string>();
    for (const a of s.agents) {
      const key = a.agentType.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const face = renderAvatar(faces, a.agentType, host.avatarFor(key), host.resolveAvatar, 'aic-face-tiny');
      setTooltip(face, a.agentType);
    }
    if (s.tokens !== null) row.createSpan({ cls: 'aic-ins-session-tokens', text: `${compactNumber(s.tokens)} TOK` });
    /* THE DELIVERABLES A SESSION TOUCHED (R1): one glyph per WiP folder, each
       its own button so a click opens the folder and not the conversation.
       Only sessions whose manifest carries the fact show it; an older folder
       shows nothing rather than an empty glyph. */
    const wip = s.wip ?? [];
    if (wip.length > 0) {
      const strip = list.createDiv({ cls: 'aic-ins-session-wip' });
      for (const folder of wip) {
        const name = folder.split('/').pop() ?? folder;
        const btn = strip.createEl('button', { cls: 'aic-ins-wip', type: 'button' });
        const glyph = btn.createSpan({ cls: 'aic-ins-wip-icon' });
        setIcon(glyph, 'briefcase');
        btn.createSpan({ cls: 'aic-ins-wip-name', text: name });
        btn.setAttr('aria-label', `Open the deliverable ${name}`);
        setTooltip(btn, folder);
        btn.addEventListener('click', () => host.openWip(folder));
      }
    }
  }
}
