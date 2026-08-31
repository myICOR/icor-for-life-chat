/* Rendering a structured reply as native INKLINE blocks.
 *
 * The governing move: a terminal glyph whose job the GUI already does with form
 * dies with no replacement. The specialist emoji, the lightbulb, the magnifier,
 * the diamond - all gone, because a name kicker, a voice change, a reserved
 * kicker and an amber wash already say those things. What survives is carried
 * by shape, never by hue: the one-red-region law becomes a rail whose WEIGHT
 * ranks it, so a scattered red run is still unmistakably red. */

import { setIcon, setTooltip } from 'obsidian';
import type { Block, Disposition, Row, Segment, StructuredDoc } from './model';
import type { TrackedDecision } from './decisions';
import { basenameOf, iconForPath, isReadableInObsidian, parentOf, splitUrl } from './icons';
import { displayPath } from '../model/format';
import { railRuns } from './rails';

/* One glyph per band, and they are chosen to be told apart at a glance rather
 * than to be clever: a question mark for the question, a target for the answer
 * it lands on, an info mark for the reasoning behind it. */
const BAND_ICONS: Record<'asked' | 'answer' | 'why', string> = {
  asked: 'help-circle',
  answer: 'target',
  why: 'info',
};

export interface RenderHost {
  home: string;
  /** Insert `code ` into the composer and focus it. */
  insertCode: (code: string) => void;
  openFile: (path: string) => void;
  revealFile: (path: string) => void;
  openUrl: (url: string) => void;
  copy: (text: string) => void;
  /** Current lifecycle state, keyed by code. Derived, never stored. */
  decisionState: (code: string) => TrackedDecision | null;
}

function gutter(cell: HTMLElement, disposition: Disposition | null): void {
  cell.empty();
  switch (disposition) {
    case 'handled': {
      // Handled is quiet: a tick, never a green fill.
      const tick = cell.createSpan({ cls: 'aic-gutter-tick' });
      setIcon(tick, 'check');
      break;
    }
    case 'owned':
      cell.createSpan({ cls: 'aic-dot aic-dot-warning aic-dot-static' });
      break;
    case 'unowned':
      cell.createSpan({ cls: 'aic-dot aic-dot-destructive aic-dot-static' });
      break;
    case 'noted':
      cell.createSpan({ cls: 'aic-ring' });
      break;
    default:
      break;
  }
}

function renderRow(parent: HTMLElement, row: Row): HTMLElement {
  const el = parent.createDiv({ cls: 'aic-srow' });
  gutter(el.createSpan({ cls: 'aic-srow-gutter' }), row.disposition);
  el.createSpan({ cls: 'aic-srow-label', text: row.label });
  const right = el.createSpan({ cls: 'aic-srow-right' });
  if (row.value) right.createSpan({ cls: 'aic-srow-value', text: row.value });
  if (row.qualifier) right.createSpan({ cls: 'aic-srow-qual', text: `(${row.qualifier})` });
  return el;
}

class Renderer {
  private redRunsSeen = 0;
  private handSeen = false;

  constructor(private readonly host: RenderHost) {}

  renderDoc(parent: HTMLElement, doc: StructuredDoc, prose: (el: HTMLElement, text: string) => void): void {
    for (const segment of doc.segments) this.renderSegment(parent, segment, prose);
  }

  private renderSegment(
    parent: HTMLElement,
    segment: Segment,
    prose: (el: HTMLElement, text: string) => void,
  ): void {
    if (segment.kind === 'prose') {
      prose(parent.createDiv({ cls: 'aic-assistant is-rendered' }), segment.text);
      return;
    }
    if (segment.kind === 'flag') {
      const el = parent.createDiv({ cls: 'aic-flag' });
      el.createDiv({ cls: 'aic-kicker', text: 'FLAG' });
      el.createDiv({ cls: 'aic-flag-body', text: segment.text });
      return;
    }
    if (segment.kind === 'decision') {
      this.renderDecision(parent, segment.decision);
      return;
    }
    const card = parent.createDiv({ cls: 'aic-card' });
    const head = card.createDiv({ cls: 'aic-card-head' });
    head.createSpan({ cls: 'aic-card-name', text: segment.header.name });
    if (segment.header.scope) {
      head.createSpan({ cls: 'aic-middot', text: '·' });
      head.createSpan({ cls: 'aic-card-scope', text: segment.header.scope });
    }
    if (segment.header.status) {
      const status = head.createSpan({ cls: 'aic-card-status' });
      const tone =
        segment.header.status === 'PARTIAL' ? 'warning'
          : segment.header.status === 'BLOCKED' ? 'destructive'
            : segment.header.status === 'IN FLIGHT' ? 'marker' : null;
      if (tone) {
        status.createSpan({ cls: `aic-dot aic-dot-${tone} aic-dot-static` });
      } else {
        const tick = status.createSpan({ cls: 'aic-gutter-tick' });
        setIcon(tick, 'check');
      }
      status.createSpan({ cls: 'aic-kicker', text: segment.header.status });
    }
    for (const block of segment.blocks) this.renderBlock(card, block, prose);
  }

  private renderBlock(
    card: HTMLElement,
    block: Block,
    prose: (el: HTMLElement, text: string) => void,
  ): void {
    switch (block.kind) {
      case 'asked':
      case 'answer':
      case 'why': {
        /* THE THREE BANDS ARE BANNERS NOW, each with its own ground and its own
           glyph beside the word.
           They were three kickers over three runs of text, which meant the two
           blocks that answer "does this need me at all" looked exactly like
           every other label in the card and were read at the same speed as the
           rows. They are the first thing on the card and the only two the user
           may read; they are allowed to look like it. The glyph is redundant
           with the word ON PURPOSE - it is what makes the block findable while
           scrolling, when the word itself is too small to read. */
        const wrap = card.createDiv({ cls: `aic-band aic-band-${block.kind}` });
        const head = wrap.createDiv({ cls: 'aic-band-head' });
        const glyph = head.createSpan({ cls: 'aic-band-icon' });
        setIcon(glyph, BAND_ICONS[block.kind]);
        // `aria-hidden` because the kicker beside it already says the word: an
        // icon that announces "help circle" next to the text "ASKED" is the
        // same thing said twice.
        glyph.setAttr('aria-hidden', 'true');
        head.createSpan({ cls: 'aic-kicker aic-kicker-wide', text: block.kind.toUpperCase() });
        wrap.createDiv({ cls: `aic-${block.kind}-text`, text: block.text });
        break;
      }
      case 'insight': {
        // The hand voice IS the marker here: no icon, no kicker. One per card.
        if (this.handSeen) {
          card.createDiv({ cls: 'aic-band', text: block.text });
          break;
        }
        this.handSeen = true;
        card.createDiv({ cls: 'aic-insight', text: block.text });
        break;
      }
      case 'group': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        if (block.title) wrap.createDiv({ cls: 'aic-kicker', text: block.title });
        this.renderRailedRows(wrap, block.rows, (parent, row) => renderRow(parent, row));
        break;
      }
      case 'findings': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        this.renderRailedRows(wrap, block.findings, (parent, finding) => {
          const el = parent.createDiv({ cls: 'aic-finding' });
          gutter(el.createSpan({ cls: 'aic-srow-gutter' }), finding.disposition);
          const main = el.createDiv({ cls: 'aic-finding-main' });
          main.createDiv({ cls: 'aic-finding-claim', text: finding.claim });
          if (finding.ownership) main.createDiv({ cls: 'aic-finding-own', text: finding.ownership });
          if (finding.evidence) main.createDiv({ cls: 'aic-finding-ev', text: finding.evidence });
          return el;
        });
        break;
      }
      case 'notCovered': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide', text: 'NOT COVERED' });
        // No wash, no rail, no colour: a boundary is the quietest true thing.
        for (const row of block.rows) renderRow(wrap, { ...row, disposition: 'noted' });
        break;
      }
      case 'next': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide', text: 'NEXT' });
        block.items.forEach((item, i) => {
          const row = wrap.createDiv({ cls: 'aic-next-row' });
          row.createSpan({ cls: 'aic-next-num', text: String(i + 1) });
          row.createSpan({ cls: 'aic-next-text', text: item });
        });
        break;
      }
      case 'files': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide', text: 'FILES' });
        for (const path of block.paths) this.renderFileRow(wrap, path);
        break;
      }
      case 'links': {
        const wrap = card.createDiv({ cls: 'aic-band' });
        wrap.createDiv({ cls: 'aic-kicker aic-kicker-wide', text: 'LINKS' });
        for (const url of block.urls) this.renderLinkRow(wrap, url);
        break;
      }
      case 'prose':
      default:
        prose(card.createDiv({ cls: 'aic-band aic-assistant is-rendered' }), block.text);
        break;
    }
  }

  private renderRailedRows<T extends { disposition: Disposition | null }>(
    parent: HTMLElement,
    rows: T[],
    draw: (parent: HTMLElement, row: T) => HTMLElement,
  ): void {
    const runs = railRuns(rows);
    let cursor = 0;
    for (const [start, end] of runs) {
      for (let i = cursor; i < start; i += 1) {
        const row = rows[i];
        if (row) draw(parent, row);
      }
      this.redRunsSeen += 1;
      const rail = parent.createDiv({
        cls: `aic-rail ${this.redRunsSeen === 1 ? 'is-first' : 'is-later'}`,
      });
      for (let i = start; i <= end; i += 1) {
        const row = rows[i];
        if (row) draw(rail, row);
      }
      cursor = end + 1;
    }
    for (let i = cursor; i < rows.length; i += 1) {
      const row = rows[i];
      if (row) draw(parent, row);
    }
  }

  private renderFileRow(parent: HTMLElement, path: string): void {
    const row = parent.createDiv({ cls: 'aic-file' });
    row.setAttr('role', 'button');
    row.setAttr('tabindex', '0');
    const iconCell = row.createSpan({ cls: 'aic-file-icon' });
    setIcon(iconCell, iconForPath(path));
    const pathCell = row.createSpan({ cls: 'aic-file-path' });
    const shown = displayPath(path, this.host.home);
    pathCell.createSpan({ cls: 'aic-file-parent', text: parentOf(shown) });
    pathCell.createSpan({ cls: 'aic-file-base', text: basenameOf(shown) });

    const readable = isReadableInObsidian(path);
    const act = (): void => (readable ? this.host.openFile(path) : this.host.revealFile(path));
    const actionLabel = readable ? 'Open' : 'Reveal in Finder';
    row.setAttr('aria-label', `${actionLabel}: ${path}`);

    const actions = row.createSpan({ cls: 'aic-file-actions' });
    const copyBtn = actions.createEl('button', { cls: 'aic-icon-btn aic-mini', type: 'button' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttr('aria-label', `Copy path: ${path}`);
    setTooltip(copyBtn, 'Copy path');
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // The copied string is always the absolute original, never the display form.
      this.host.copy(path);
      setIcon(copyBtn, 'check');
      window.setTimeout(() => setIcon(copyBtn, 'copy'), 1200);
    });
    const actBtn = actions.createEl('button', { cls: 'aic-icon-btn aic-mini', type: 'button' });
    setIcon(actBtn, readable ? 'arrow-up-right' : 'folder-open');
    actBtn.setAttr('aria-label', `${actionLabel}: ${path}`);
    setTooltip(actBtn, actionLabel);
    actBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      act();
    });

    row.addEventListener('click', act);
    row.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        act();
      }
    });
  }

  private renderLinkRow(parent: HTMLElement, url: string): void {
    const { host, rest } = splitUrl(url);
    const row = parent.createEl('a', { cls: 'aic-link', href: url });
    row.setAttr('aria-label', `Open ${url}`);
    row.createSpan({ cls: 'aic-link-host', text: host });
    if (rest) row.createSpan({ cls: 'aic-link-rest', text: rest });
    const actions = row.createSpan({ cls: 'aic-file-actions' });
    const arrow = actions.createSpan({ cls: 'aic-icon' });
    setIcon(arrow, 'arrow-up-right');
    const copyBtn = actions.createEl('button', { cls: 'aic-icon-btn aic-mini', type: 'button' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttr('aria-label', `Copy link: ${url}`);
    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.host.copy(url);
    });
    row.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.host.openUrl(url);
    });
  }

  private renderDecision(parent: HTMLElement, decision: { code: string; title: string; body: string; variant: string }): void {
    const el = parent.createDiv({ cls: `aic-decision is-${decision.variant}` });
    el.dataset.code = decision.code;
    const head = el.createDiv({ cls: 'aic-decision-head' });
    const dotSlot = head.createSpan({ cls: 'aic-decision-dot' });
    const chip = head.createEl('button', { cls: 'aic-code-chip', text: decision.code, type: 'button' });
    const kickerEl = head.createSpan({ cls: 'aic-kicker aic-kicker-wide' });
    head.createSpan({ cls: 'aic-middot', text: '·' });
    head.createSpan({ cls: 'aic-decision-title', text: decision.title });
    // Hidden by the stylesheet when the block wears `is-resolved` (the class
    // `paint` below toggles), never by an inline style: one driver.
    el.createDiv({ cls: 'aic-decision-body', text: decision.body });

    const paint = (): void => {
      const state = this.host.decisionState(decision.code);
      const resolved = state?.resolved ?? decision.variant === 'cleared';
      el.toggleClass('is-resolved', resolved);
      dotSlot.empty();
      if (resolved) {
        dotSlot.createSpan({ cls: 'aic-dot aic-dot-success aic-dot-static' });
        kickerEl.setText(decision.variant === 'cleared' ? 'CLEARED' : 'RESOLVED');
        chip.disabled = true;
        chip.setAttr('aria-label', `Decision ${decision.code}, resolved`);
        setTooltip(chip, 'Resolved');
      } else {
        kickerEl.setText(decision.variant === 'blocked' ? 'BLOCKED' : 'DECISION');
        chip.disabled = false;
        chip.setAttr('aria-label', `Insert code ${decision.code} into the message box`);
        setTooltip(chip, 'Insert code');
      }
    };

    chip.addEventListener('click', () => {
      if (chip.disabled) return;
      this.host.insertCode(decision.code);
    });
    paint();
    // Resolution is derived on every render, so the block repaints on demand.
    (el as HTMLElement & { repaint?: () => void }).repaint = paint;
  }
}

export function renderStructured(
  parent: HTMLElement,
  doc: StructuredDoc,
  host: RenderHost,
  prose: (el: HTMLElement, text: string) => void,
): void {
  new Renderer(host).renderDoc(parent, doc, prose);
}

/** Repaint every decision block under `root` after the transcript changed. */
export function repaintDecisions(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll('.aic-decision'))) {
    const repaint = (el as HTMLElement & { repaint?: () => void }).repaint;
    if (repaint) repaint();
  }
}
