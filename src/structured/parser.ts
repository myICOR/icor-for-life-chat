/* The tolerant parser.
 *
 * The contract that matters more than any grammar rule: a reply that is not in
 * the format must render as ordinary chat. The parser therefore claims a run of
 * lines only when the format's OWN signals are present - a card header with a
 * status word, a kicker on its own line, a row with the `::` separator, a
 * decision keyword followed by a five-character code. Anything else falls
 * through to prose, and a card that half-parses is emitted as prose entire,
 * because a half-rendered card is worse than an unrendered one.
 *
 * Fenced code is passed through untouched. A fence is the one place where the
 * format's signals are just characters. */

import type {
  Block, CardHeader, CardStatus, DecisionBlock, DecisionVariant, Disposition,
  Finding, Row, Segment, StructuredDoc,
} from './model';
import { isReadableCode } from './model';

const STATUS_WORDS: CardStatus[] = ['COMPLETE', 'PARTIAL', 'BLOCKED', 'IN FLIGHT'];

const DISPOSITIONS: Array<[string, Disposition]> = [
  ['🟢', 'handled'],
  ['🟡', 'owned'],
  ['🔴', 'unowned'],
  ['⚪', 'noted'],
];

const KICKERS = new Set([
  'ASKED', 'ANSWER', 'INSIGHT', 'WHY', 'NOT COVERED', 'NEXT', 'FILES', 'LINKS', 'PICKED',
]);

const MIDDOTS = /\s*[·•]\s*/;

/**
 * In structured mode no emoji reaches the DOM: mapped glyphs become forms, and
 * everything else is removed. Safe by the format's own doctrine - emphasis is
 * carried by position, so a glyph is never the sole carrier of meaning.
 */
export function stripGlyphs(text: string): string {
  return text
    // The variation selector and the keycap combiner sit OUTSIDE the class:
    // inside one they read as composed-character mistakes to a linter, and the
    // intent here really is the bare code points - stripping a stray FE0F that
    // lost its base is the point.
    .replace(/(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{20E3})/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function leadingDisposition(line: string): { disposition: Disposition | null; rest: string } {
  for (const [glyph, disposition] of DISPOSITIONS) {
    if (line.startsWith(glyph)) {
      return { disposition, rest: line.slice(glyph.length).trim() };
    }
  }
  return { disposition: null, rest: line };
}

/** `label :: value (qualifier)`. The `::` is the row's own signal. */
function parseRow(line: string): Row | null {
  const { disposition, rest } = leadingDisposition(line.trim());
  const at = rest.indexOf('::');
  if (at === -1) return null;
  const label = stripGlyphs(rest.slice(0, at)).trim();
  let value = stripGlyphs(rest.slice(at + 2)).trim();
  if (!label && !value) return null;
  let qualifier: string | null = null;
  const q = value.match(/\s*\(([^()]*)\)\s*$/);
  if (q && q[1]) {
    qualifier = q[1].trim();
    value = value.slice(0, q.index).trim();
  }
  return { disposition, label, value, qualifier };
}

/**
 * A card header is `NAME · scope · STATUS`. The status word is the strongest
 * signal but not the only one: a live reply put a free-text phrase in the last
 * slot, which rejected the header and dropped the whole card to prose. So a
 * header without a status word is accepted when the caller can confirm the very
 * next line is a kicker - two independent format signals instead of one, which
 * keeps ordinary prose containing a middot from being claimed.
 */
function parseHeader(line: string, nextLine?: string): CardHeader | null {
  const parts = line.split(MIDDOTS).map((p) => stripGlyphs(p).trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const nameRaw = parts[0] ?? '';
  const name = nameRaw.trim();
  if (!name || name.length > 48 || /[.!?]$/.test(name)) return null;
  const last = parts[parts.length - 1] ?? '';
  const status = STATUS_WORDS.find((w) => w === last.toUpperCase()) ?? null;
  if (status) {
    const scopeParts = parts.slice(1, -1).filter(Boolean);
    return { name, scope: scopeParts.length ? scopeParts.join(' · ') : null, status };
  }
  // No status word: require the corroborating kicker on the next line, and a
  // name that reads as a name rather than as the start of a sentence.
  if (nextLine === undefined || !isKicker(nextLine.trim())) return null;
  if (name !== name.toUpperCase() && !/^[A-Z]/.test(name)) return null;
  const scopeParts = parts.slice(1).filter(Boolean);
  return { name, scope: scopeParts.length ? scopeParts.join(' · ') : null, status: null };
}

function parseDecisionOpen(line: string): { code: string; title: string; variant: DecisionVariant } | null {
  const cleaned = stripGlyphs(line).trim();
  const match = cleaned.match(/^(DECISION|BLOCKED|CLEARED)\s+([A-Za-z0-9]+)\s*(?:[·•\-—]\s*(.*))?$/);
  if (!match) return null;
  const keyword = match[1] ?? '';
  const code = (match[2] ?? '').toLowerCase();
  if (!isReadableCode(code)) return null;
  const variant: DecisionVariant =
    keyword === 'BLOCKED' ? 'blocked' : keyword === 'CLEARED' ? 'cleared' : 'decision';
  return { code, title: (match[3] ?? '').trim(), variant };
}

function isKicker(line: string): string | null {
  const cleaned = stripGlyphs(line).trim().replace(/:$/, '');
  if (!cleaned || cleaned.length > 24) return null;
  const upper = cleaned.toUpperCase();
  if (KICKERS.has(upper)) return upper;
  // A short all-caps line is a group sub-head (VERDICT, LEDGER vs REPO).
  if (cleaned === upper && /^[A-Z0-9 ./&-]+$/.test(cleaned) && cleaned.length >= 3) return upper;
  return null;
}

interface Cursor {
  lines: string[];
  i: number;
}

function peek(c: Cursor): string | undefined {
  return c.lines[c.i];
}

/** The next non-blank line at or after `offset`, for one-line lookahead. */
function nextNonEmpty(c: Cursor, offset: number): string | undefined {
  for (let i = c.i + offset; i < c.lines.length; i += 1) {
    const line = c.lines[i];
    if (line && line.trim()) return line;
  }
  return undefined;
}

/** Split off fenced regions so nothing inside them is ever interpreted. */
function splitFences(text: string): Array<{ fenced: boolean; text: string }> {
  const out: Array<{ fenced: boolean; text: string }> = [];
  const lines = text.split('\n');
  let buffer: string[] = [];
  let fenced = false;
  const flush = (): void => {
    if (buffer.length) out.push({ fenced, text: buffer.join('\n') });
    buffer = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      buffer.push(line);
      if (fenced) {
        flush();
        fenced = false;
      } else {
        const opener = buffer.pop() as string;
        buffer.pop();
        buffer.push(opener);
        // Re-split: everything before the fence is prose, the fence starts here.
        const before = buffer.slice(0, -1);
        buffer = [opener];
        if (before.length) out.push({ fenced: false, text: before.join('\n') });
        fenced = true;
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out.filter((part) => part.text.trim().length > 0 || part.fenced);
}

export function parseStructured(text: string): StructuredDoc {
  const segments: Segment[] = [];
  let structured = false;
  const proseBuffer: string[] = [];

  const flushProse = (): void => {
    const joined = proseBuffer.join('\n').trim();
    proseBuffer.length = 0;
    if (joined) segments.push({ kind: 'prose', text: joined });
  };

  for (const part of splitFences(text)) {
    if (part.fenced) {
      proseBuffer.push(part.text);
      continue;
    }
    const c: Cursor = { lines: part.text.split('\n'), i: 0 };
    while (c.i < c.lines.length) {
      const line = peek(c) ?? '';
      const trimmed = line.trim();
      if (!trimmed) {
        proseBuffer.push(line);
        c.i += 1;
        continue;
      }

      const decision = parseDecisionOpen(trimmed);
      if (decision) {
        flushProse();
        c.i += 1;
        /* THE WHOLE BODY, however long the model wrote it. This loop used to
           stop at three lines, which was GL-068's editorial bound pressed into
           the parser - and the parser is the wrong enforcer: by the time text
           reaches here it has already been written, so the cap did not make
           the reply shorter, it made lines four onward CEASE TO EXIST. The
           user saw a decision that ended mid-sentence with no way to unfold
           it, which on a decision - the one block that asks them to act - is
           the worst place in the format to lose words. The bound is the
           renderer's now: a measured three-line clamp that opens on click. */
        const body: string[] = [];
        while (c.i < c.lines.length) {
          const next = (peek(c) ?? '').trim();
          if (!next || parseDecisionOpen(next) || parseHeader(next, nextNonEmpty(c, 1))) break;
          body.push(stripGlyphs(next));
          c.i += 1;
        }
        segments.push({
          kind: 'decision',
          decision: { ...decision, body: body.join(' ').trim() },
        });
        structured = true;
        continue;
      }

      const header = parseHeader(trimmed, nextNonEmpty(c, 1));
      if (header) {
        flushProse();
        c.i += 1;
        const blocks = parseCardBody(c);
        segments.push({ kind: 'card', header, blocks });
        structured = true;
        continue;
      }

      proseBuffer.push(line);
      c.i += 1;
    }
  }
  flushProse();
  return { segments, structured };
}

function parseCardBody(c: Cursor): Block[] {
  const blocks: Block[] = [];
  let insightSeen = false;
  const prose: string[] = [];
  const flushProse = (): void => {
    const joined = prose.join('\n').trim();
    prose.length = 0;
    if (joined) blocks.push({ kind: 'prose', text: joined });
  };

  while (c.i < c.lines.length) {
    const raw = peek(c) ?? '';
    const trimmed = raw.trim();

    // A card ends where the next card or the decision region begins.
    if (trimmed && (parseHeader(trimmed, nextNonEmpty(c, 1)) || parseDecisionOpen(trimmed))) break;

    if (!trimmed) {
      c.i += 1;
      continue;
    }

    const kicker = isKicker(trimmed);
    if (kicker) {
      flushProse();
      c.i += 1;
      switch (kicker) {
        case 'ASKED':
        case 'ANSWER':
        case 'WHY': {
          const text = takeParagraph(c);
          if (text) {
            blocks.push(
              kicker === 'ASKED'
                ? { kind: 'asked', text }
                : kicker === 'ANSWER'
                  ? { kind: 'answer', text }
                  : { kind: 'why', text },
            );
          }
          break;
        }
        case 'INSIGHT': {
          const text = takeParagraph(c);
          // At most one hand-voice line per card. A second is not an insight.
          if (text && !insightSeen) {
            blocks.push({ kind: 'insight', text });
            insightSeen = true;
          } else if (text) {
            blocks.push({ kind: 'prose', text });
          }
          break;
        }
        case 'NOT COVERED': {
          const rows = takeRows(c);
          if (rows.length) blocks.push({ kind: 'notCovered', rows: rows.slice(0, 3) });
          break;
        }
        case 'NEXT': {
          const items = takeList(c);
          if (items.length) blocks.push({ kind: 'next', items });
          break;
        }
        case 'FILES': {
          const paths = takeBareLines(c, (l) => !/^https?:\/\//i.test(l));
          if (paths.length) blocks.push({ kind: 'files', paths });
          break;
        }
        case 'LINKS': {
          const urls = takeBareLines(c, (l) => /^https?:\/\//i.test(l));
          if (urls.length) blocks.push({ kind: 'links', urls });
          break;
        }
        default: {
          const rows = takeRows(c);
          if (rows.length) {
            blocks.push({ kind: 'group', title: kicker, rows });
          } else {
            const text = takeParagraph(c);
            if (text) blocks.push({ kind: 'prose', text });
          }
        }
      }
      continue;
    }

    const row = parseRow(trimmed);
    if (row) {
      const rows = takeRows(c);
      const findings = rows.filter((r) => !r.value);
      if (findings.length === rows.length && rows.length > 0) {
        blocks.push({ kind: 'findings', findings: rows.map(toFinding) });
      } else {
        blocks.push({ kind: 'group', title: null, rows });
      }
      continue;
    }

    const bare = leadingDisposition(trimmed);
    if (bare.disposition) {
      const findings = takeFindings(c);
      if (findings.length) {
        blocks.push({ kind: 'findings', findings });
        continue;
      }
    }

    prose.push(raw);
    c.i += 1;
  }
  flushProse();
  return blocks;
}

function toFinding(row: Row): Finding {
  return { disposition: row.disposition, claim: row.label, ownership: null, evidence: null };
}

function takeParagraph(c: Cursor): string {
  const out: string[] = [];
  while (c.i < c.lines.length) {
    const line = (peek(c) ?? '').trim();
    if (!line) break;
    if (isKicker(line) || parseHeader(line) || parseDecisionOpen(line) || parseRow(line)) break;
    out.push(stripGlyphs(line));
    c.i += 1;
  }
  return out.join(' ').trim();
}

/* A WRAPPED VALUE IS STILL ONE VALUE.
 *
 * The prompt now tells the model this is a panel and not a terminal, which is
 * the real fix. This is the net under it, because the model brings a
 * terminal-formatting habit with it and will sometimes wrap anyway. Before it,
 * a wrapped row ended the group at the first continuation line and the rest of
 * the value fell out of the card as loose prose - the reader saw a row that
 * stopped mid-sentence and a paragraph of orphaned fragments underneath.
 *
 * The discriminator is the BLANK LINE, and it is the only honest one available:
 * a hard wrap has none, a new paragraph has one. `takeRows` already stops at a
 * blank line, so a continuation is a non-empty line that directly follows a row
 * and is not itself a row, a kicker, a header or a decision. Anything a blank
 * line separates from the group is still prose and is still left alone.
 *
 * It is deliberately conservative: it can only ever join text to a row that
 * already exists, and it never invents a row.
 */
function takeRows(c: Cursor): Row[] {
  const rows: Row[] = [];
  while (c.i < c.lines.length) {
    const line = (peek(c) ?? '').trim();
    if (!line) break;
    const row = parseRow(line);
    if (!row) {
      const last = rows[rows.length - 1];
      // Nothing to continue, or the line is a structure of its own.
      if (!last || !isContinuation(line, c)) break;
      last.value = last.value ? `${last.value} ${line}` : line;
      c.i += 1;
      continue;
    }
    rows.push(row);
    c.i += 1;
  }
  return rows;
}

/** A line that can only be the tail of the row above it. */
function isContinuation(line: string, c: Cursor): boolean {
  if (isKicker(line)) return false;
  if (parseDecisionOpen(line)) return false;
  if (parseHeader(line, nextNonEmpty(c, 1))) return false;
  // A disposition glyph opens a row, so a line carrying one is a row the
  // author forgot the `::` on, not a continuation of the row above.
  return leadingDisposition(line).disposition === null;
}

function takeFindings(c: Cursor): Finding[] {
  const findings: Finding[] = [];
  while (c.i < c.lines.length) {
    const line = (peek(c) ?? '').trim();
    if (!line) break;
    const head = leadingDisposition(line);
    if (!head.disposition || parseRow(line)) break;
    c.i += 1;
    const claim = stripGlyphs(head.rest);
    const extra: string[] = [];
    while (c.i < c.lines.length && extra.length < 2) {
      const next = (peek(c) ?? '');
      if (!next.trim()) break;
      if (!/^\s{2,}|^\t/.test(next)) break;
      const nextTrim = next.trim();
      if (leadingDisposition(nextTrim).disposition || isKicker(nextTrim)) break;
      extra.push(stripGlyphs(nextTrim));
      c.i += 1;
    }
    findings.push({
      disposition: head.disposition,
      claim,
      ownership: extra[0] ?? null,
      evidence: extra[1] ?? null,
    });
  }
  return findings;
}

function takeList(c: Cursor): string[] {
  const out: string[] = [];
  while (c.i < c.lines.length) {
    const line = (peek(c) ?? '').trim();
    if (!line) break;
    if (isKicker(line) || parseHeader(line) || parseDecisionOpen(line)) break;
    out.push(stripGlyphs(line.replace(/^(\d+[.)]|[-*])\s*/, '')));
    c.i += 1;
  }
  return out;
}

function takeBareLines(c: Cursor, accept: (line: string) => boolean): string[] {
  const out: string[] = [];
  while (c.i < c.lines.length) {
    const line = (peek(c) ?? '').trim();
    if (!line) break;
    if (isKicker(line) || parseHeader(line) || parseDecisionOpen(line)) break;
    const bare = line.replace(/^[-*]\s*/, '').replace(/^`|`$/g, '');
    if (!accept(bare)) break;
    out.push(bare);
    c.i += 1;
  }
  return out;
}

/** Every decision in a document, in order of appearance. */
export function decisionsOf(doc: StructuredDoc): DecisionBlock[] {
  return doc.segments
    .filter((s): s is Extract<Segment, { kind: 'decision' }> => s.kind === 'decision')
    .map((s) => s.decision);
}
