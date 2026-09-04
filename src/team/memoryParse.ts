/* READING A SESSION LOG BACK, with no Obsidian import.
 *
 * The scaffold's session log is the team's memory (AGENTS.md: "the session
 * log is the record"), and until now nothing in this panel read it. A new
 * conversation opened onto "What are we working on?" with no trace of what
 * the last one concluded, which is the one question the record exists to
 * answer. Everything a row shows comes from the log's own text: the name
 * carries the date, the first heading carries the title, and the first
 * bullet under INSIGHTS (or, failing that, under WHAT WE DID) is the line
 * worth reading before starting again. Pure, so every rule is assertable on
 * a string. */

export interface ParsedLog {
  title: string;
  /** YYYY-MM-DD from the file name, or null when the name carries none. */
  date: string | null;
  /** The `agent_id` frontmatter value, or null. */
  agent: string | null;
  /** One line, cut at INSIGHT_CHARS with an ellipsis; null when the log has no bullet at all. */
  insight: string | null;
}

export const INSIGHT_CHARS = 160;

/** The leading date of a log or journal file name: `2026-09-04-12-50_larry_...` gives `2026-09-04`. */
export function dateFromName(name: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(name);
  return m ? m[1] ?? null : null;
}

/** The body without its YAML frontmatter. A file that does not open with `---` is returned whole. */
export function stripFrontmatter(source: string): string {
  if (!source.startsWith('---')) return source;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return source;
  const after = source.indexOf('\n', end + 1);
  return after === -1 ? '' : source.slice(after + 1);
}

/** The first `# ` heading of the body, or null. */
export function firstHeading(body: string): string | null {
  for (const raw of body.split('\n')) {
    const m = /^#\s+(.+?)\s*$/.exec(raw);
    if (m) return m[1] ?? null;
  }
  return null;
}

/**
 * The first bullet under the `## <heading>` section, or null.
 *
 * A placeholder bullet (`_(none this session)_`, `...`) is not an insight and
 * is skipped, because the template ships those and a row that quoted the
 * template back would be the placeholder defect wearing a session log.
 */
export function firstBulletUnder(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const wanted = heading.trim().toLowerCase();
  let inside = false;
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      inside = (h[1] ?? '').trim().toLowerCase() === wanted;
      continue;
    }
    if (!inside) continue;
    const b = /^[-*]\s+(?:\[[ x]\]\s+)?(.+)$/.exec(line);
    if (!b) continue;
    const text = (b[1] ?? '').trim();
    if (!text || /^_?\(?none/i.test(text) || /^\.\.\.$/.test(text) || text === '_(none this session)_') continue;
    return text;
  }
  return null;
}

/** Markdown emphasis and wikilink brackets stripped for a one-line readout. */
export function plainLine(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cutLine(text: string, max = INSIGHT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function parseSessionLog(
  name: string,
  source: string,
  frontmatter: Record<string, unknown> | null,
): ParsedLog {
  const body = stripFrontmatter(source);
  const bullet = firstBulletUnder(body, 'Insights') ?? firstBulletUnder(body, 'What we did') ?? firstBulletUnder(body, 'What I did');
  const agentRaw = frontmatter?.agent_id;
  return {
    title: firstHeading(body) ?? name.replace(/\.md$/, ''),
    date: dateFromName(name),
    agent: typeof agentRaw === 'string' && agentRaw.trim() ? agentRaw.trim() : null,
    insight: bullet ? cutLine(plainLine(bullet)) : null,
  };
}

/** A journal entry's title: the first heading, else the name without its date prefix. */
export function journalTitle(name: string, source: string): string {
  const heading = firstHeading(stripFrontmatter(source));
  if (heading) return plainLine(heading);
  return name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/-/g, ' ') || name;
}
