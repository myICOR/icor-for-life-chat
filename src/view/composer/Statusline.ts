/* The DOM half of the readout strip. The fact set itself is built in
 * model/facts.ts, which has no Obsidian import, so the measurement rules and
 * the narrow-pane ladder can be asserted without a workspace.
 *
 * Three things live here and nowhere else.
 *
 * THE CELLS ARE KEYED AND REUSED, never re-created. `el.empty()` on every
 * render would destroy the ring's SVG node on every turn, and a
 * `stroke-dashoffset` transition cannot run on an element that did not exist a
 * frame ago. So each readout owns one cell, reconciled by id.
 *
 * THE RING IS DRAWN HERE. Two circles in a 12px box: a full track, and an arc
 * that starts at twelve o'clock and runs clockwise. It carries `aria-hidden`,
 * because the fact's accessible name already says the number and the state in
 * words and an arc with its own name is the number said twice.
 *
 * THE NARROW PANE IS MEASURED, never clipped. The strip renders every visible
 * measured fact, reads their real widths, and removes WHOLE facts from the tail
 * until the row fits. A fact renders whole or not at all: `84.2K` clipped to
 * `84` is a wrong number rendered with full authority. */

import { setIcon, setTooltip } from 'obsidian';
import type { ChatState } from '../../model/types';
import type { Fact, FactId } from '../../model/facts';
import {
  RING_CIRCUMFERENCE, RING_MIN_CONSUMED,
  buildFacts, factAriaLabel, fitFacts, glyphsAreUnique, ringDashOffset, stateWord, visibleFacts,
} from '../../model/facts';
import { PLUGIN_ID } from '../../constants';

export type { Fact, FactTone } from '../../model/facts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* One counter per plugin load, because a vault can hold more than one chat tab
 * and a DOM id is document-wide. Two panes minting the same
 * `aria-describedby` target would leave the second pane's readouts described by
 * the FIRST pane's node - the same text today, and a silent cross-pane
 * reference the moment the strings stop being identical. */
let stripSeq = 0;

interface Cell {
  root: HTMLElement;
  fact: HTMLElement;
  ring: SVGSVGElement | null;
  arc: SVGCircleElement | null;
  label: HTMLElement;
  direction: HTMLElement;
  value: HTMLElement;
  state: HTMLElement;
  describe: HTMLElement;
  icon: HTMLElement;
  iconName: string | null;
}

/** Every readout on by default, for a caller that has no settings to read. */
function allOn(): Record<FactId, boolean> {
  return {
    context: true, plan: true, tokensIn: true, tokensOut: true,
    elapsed: true, agents: true, sessionStart: true, sessionUpdated: true,
  };
}

export class Statusline {
  private readonly cells = new Map<FactId, Cell>();
  private readonly seq = stripSeq++;
  private painted: Fact[] = [];
  private observer: ResizeObserver | null = null;
  /** Session started AND at least one readout switched on. */
  private live = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly enabled: () => Record<FactId, boolean> = allOn,
  ) {
    /* The ladder is a function of the PANE's width, so it has to re-run when
       the pane changes width and not only when an event arrives. Without this
       a user who narrows a leaf keeps a strip measured against the old width
       until the next second tick, which is the one moment the overflow is
       visible. */
    /* Observed on the PARENT, not on the strip itself, and that is not a
       detail. A pane too narrow for the budgets empties the strip, which makes
       it `display: none`, and a hidden element's box never changes size again -
       so a strip that watched itself could go dark once and never come back
       when the user widened the leaf. The parent always has a box. */
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.fit());
      this.observer.observe(this.el.parentElement ?? this.el);
    }
  }

  render(state: ChatState, now = Date.now()): void {
    const enabled = this.enabled();
    const facts = visibleFacts(buildFacts(state, now), enabled);
    /* THE STRIP HAS TWO HEIGHTS AND NO THIRD: zero while no `session` event has
       arrived, and 24px from the first one onward, whether or not any fact has
       yet been MEASURED. That is one reflow per session, at the moment the
       empty state is being replaced by the stream anyway - and it is why the
       bar is governed by the session rather than by the fact count, which
       would pop the strip open again on the first turn-end. The height never
       animates; a chrome bar that grows is motion at the pane's edge.

       The one case that stays at zero on a live session is every readout
       switched OFF: absence, not an empty bar, and no hairline either. */
    this.live = state.sessionId !== null && Object.values(enabled).some(Boolean);
    this.el.toggleClass('is-live', this.live);
    // A colliding pair means the glyph stopped being a label. Everything falls
    // back to words rather than shipping an ambiguous icon.
    const useIcons = glyphsAreUnique(facts);
    const wanted = new Set(facts.map((f) => f.id));
    for (const [id, cell] of this.cells) {
      if (!wanted.has(id)) {
        cell.root.remove();
        this.cells.delete(id);
      }
    }
    facts.forEach((fact, index) => {
      const cell = this.cellFor(fact.id);
      this.paint(cell, fact, useIcons);
      cell.root.toggleClass('is-first', index === 0);
      // Appending an existing node MOVES it, which keeps the ring's element
      // identity and therefore its transition.
      this.el.appendChild(cell.root);
    });
    this.painted = facts;
    this.fit();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private cellFor(id: FactId): Cell {
    const found = this.cells.get(id);
    if (found) return found;
    /* Born on the strip via Obsidian's own helper. It lands appended, which is
       fine: render() re-appends every visible cell in order anyway, and an
       appendChild of an existing node is a MOVE. */
    const root = this.el.createSpan({ cls: 'aic-fact-cell' });
    /* The readout names itself in the DOM. The ladder, the ring ceiling and the
       tab-stop count are all claims about WHICH readout, and a gate that had to
       infer that from a label string would be guarding the label. */
    root.setAttr('data-fact', id);
    root.createSpan({ cls: 'aic-middot', text: '·' });
    const fact = root.createSpan({ cls: 'aic-fact' });
    const icon = fact.createSpan({ cls: 'aic-fact-icon' });
    const label = fact.createSpan({ cls: 'aic-fact-label' });
    const direction = fact.createSpan({ cls: 'aic-fact-dir' });
    const value = fact.createSpan({ cls: 'aic-fact-value' });
    const state = fact.createSpan({ cls: 'aic-fact-state' });
    /* The LONG form reaches assistive technology through `aria-describedby`, so
       the accessible NAME stays one clause and the detail is still reachable.
       The tooltip carries the same string: two copies would be two things to
       keep true. */
    const describe = fact.createSpan({ cls: 'aic-fact-desc' });
    const descId = `${PLUGIN_ID}-${this.seq}-fact-${id}`;
    describe.setAttr('id', descId);
    describe.setAttr('hidden', 'hidden');
    fact.setAttr('aria-describedby', descId);
    const cell: Cell = {
      root, fact, ring: null, arc: null, label, direction, value, state, describe, icon, iconName: null,
    };
    this.cells.set(id, cell);
    return cell;
  }

  private paint(cell: Cell, fact: Fact, useIcons: boolean): void {
    cell.fact.removeClass('is-quiet', 'is-warning', 'is-danger');
    cell.fact.addClass(`is-${fact.tone}`);
    cell.fact.setAttr('aria-label', factAriaLabel(fact));
    const long = fact.longForm.join('\n');
    setTooltip(cell.fact, long);
    cell.describe.setText(long);

    this.paintRing(cell, fact);

    /* The glyph replaces the whole label cell, direction word included - it is
       only ever sanctioned on a fact whose glyph already depicts the direction.
       Otherwise both words render. */
    const glyph = useIcons ? fact.icon : null;
    if (glyph !== cell.iconName) {
      cell.icon.empty();
      if (glyph) setIcon(cell.icon, glyph);
      cell.iconName = glyph;
    }
    cell.icon.toggleClass('is-off', glyph === null);
    cell.label.setText(glyph ? '' : fact.label);
    cell.label.toggleClass('is-off', glyph !== null);
    cell.direction.setText(glyph ? '' : fact.direction ?? '');
    cell.direction.toggleClass('is-off', glyph !== null || !fact.direction);
    cell.value.setText(fact.value);
    // The word rides the quiet ink voice, never the amber: state marks, it
    // never carries the string.
    const word = stateWord(fact.tone);
    cell.state.setText(word ?? '');
    cell.state.toggleClass('is-off', word === null);
  }

  /* The arc always depicts CONSUMPTION, even where the label reads LEFT. Under
     "arc = printed number" the two rings would invert each other and a dial is
     read before its label is. */
  private paintRing(cell: Cell, fact: Fact): void {
    if (fact.ring === null) {
      cell.ring?.remove();
      cell.ring = null;
      cell.arc = null;
      return;
    }
    if (!cell.ring) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'aic-ring');
      svg.setAttribute('viewBox', '0 0 12 12');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const track = document.createElementNS(SVG_NS, 'circle');
      track.setAttribute('class', 'aic-ring-track');
      track.setAttribute('cx', '6');
      track.setAttribute('cy', '6');
      track.setAttribute('r', '5.25');
      svg.appendChild(track);
      cell.ring = svg;
      cell.fact.insertBefore(svg, cell.fact.firstChild);
    }
    const consumed = fact.ring;
    if (consumed < RING_MIN_CONSUMED) {
      cell.arc?.remove();
      cell.arc = null;
      return;
    }
    if (!cell.arc) {
      const arc = document.createElementNS(SVG_NS, 'circle');
      arc.setAttribute('class', 'aic-ring-arc');
      arc.setAttribute('cx', '6');
      arc.setAttribute('cy', '6');
      arc.setAttribute('r', '5.25');
      arc.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
      cell.arc = arc;
      cell.ring.appendChild(arc);
    }
    cell.arc.setAttribute('stroke-dashoffset', String(ringDashOffset(consumed)));
  }

  /**
   * The ladder. Measures the real cells, then removes whole facts from the tail
   * in the drop order until the row fits. A dropped fact's absence is never
   * signalled: no overflow chip, no ellipsis, no "+2". Chrome that reports on
   * its own truncation has become content.
   */
  private fit(): void {
    /* Measured in the VISIBLE state, always. A previous pass may have emptied
       the strip on a narrower pane, and a hidden element measures zero - which
       reads exactly like a pane with no room and would latch the strip dark
       forever. Restoring the class first costs nothing: no paint happens
       between here and the end of this function. */
    this.el.toggleClass('is-live', this.live);
    if (this.painted.length === 0) return;
    for (const fact of this.painted) this.cells.get(fact.id)?.root.removeClass('is-dropped');
    const style = window.getComputedStyle(this.el);
    const available =
      this.el.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    // A pane that has not been laid out yet cannot be measured, and a guess
    // here would drop facts the pane has room for. The next render measures it.
    if (!Number.isFinite(available) || available <= 0) return;
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    const widths = new Map<FactId, number>();
    for (const fact of this.painted) widths.set(fact.id, this.cells.get(fact.id)?.root.offsetWidth ?? 0);
    const kept = fitFacts(this.painted, (f) => widths.get(f.id) ?? 0, available, gap);
    const keptIds = new Set(kept.map((f) => f.id));
    this.painted.forEach((fact) => {
      const cell = this.cells.get(fact.id);
      if (!cell) return;
      cell.root.toggleClass('is-dropped', !keptIds.has(fact.id));
    });
    kept.forEach((fact, index) => this.cells.get(fact.id)?.root.toggleClass('is-first', index === 0));
    /* NO STRIP AT ALL, never a clipped one. The ladder ran out of readouts to
       remove and the budgets still do not fit whole, so the honest render is
       nothing: same zero height as a pane with no session behind it, and no
       third height is introduced. */
    if (kept.length === 0) this.el.removeClass('is-live');
  }
}
