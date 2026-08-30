/* The open-decisions badge, its list, and the mention toolbar.
 *
 * The badge is the first element inside the composer card. Bounded, counted,
 * and gone at zero - which is what makes a tint legal here: an unbounded warm
 * wash present in every session would be a standing shout, a badge that
 * disappears when there is nothing to decide is a state readout. The fill is a
 * TINT under quiet ink; a solid fill with knocked-out text belongs to the send
 * pill alone, because two knocked-out pills in one card is two loud moments. */

import { setIcon, setTooltip } from 'obsidian';
import type { TrackedDecision } from '../../structured/decisions';
import { badgeLabel } from '../../structured/decisions';
import { shortAge } from '../../model/format';

export interface BadgeHost {
  /** Scroll the stream to a mention and flash it once. */
  navigate: (code: string, mentionIndex: number) => void;
}

export class DecisionBadge {
  private readonly el: HTMLElement;
  private popover: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private decisions: TrackedDecision[] = [];
  private outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly slot: HTMLElement,
    private readonly toolbarSlot: HTMLElement,
    private readonly host: BadgeHost,
  ) {
    this.el = slot.createEl('button', { cls: 'aic-badge is-hidden', type: 'button' });
    this.el.addEventListener('click', () => this.toggle());
  }

  /** Zero renders nothing. Absence, not a green state, is the done signal. */
  render(open: TrackedDecision[]): void {
    this.decisions = open;
    const label = badgeLabel(open.length);
    if (!label) {
      this.el.addClass('is-hidden');
      this.close();
      return;
    }
    this.el.removeClass('is-hidden');
    this.el.setText(label);
    this.el.setAttr('aria-label', `${label}. Open the list.`);
    setTooltip(this.el, 'Open decisions');
    if (this.popover) this.fillPopover();
  }

  private toggle(): void {
    if (this.popover) this.close();
    else this.open();
  }

  /** The list opens UPWARD over the stream: composer geometry never moves. */
  private open(): void {
    if (this.decisions.length === 0) return;
    this.popover = this.slot.createDiv({ cls: 'aic-popover aic-decision-list' });
    this.fillPopover();
    this.outsideHandler = (ev: MouseEvent): void => {
      if (!this.popover) return;
      const target = ev.target;
      if (target instanceof Node && (this.popover.contains(target) || this.el.contains(target))) return;
      this.close();
    };
    this.keyHandler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    };
    document.addEventListener('mousedown', this.outsideHandler);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  private fillPopover(): void {
    const pop = this.popover;
    if (!pop) return;
    pop.empty();
    const now = Date.now();
    for (const decision of this.decisions) {
      const row = pop.createDiv({ cls: 'aic-popover-row' });
      row.setAttr('role', 'button');
      row.setAttr('tabindex', '0');
      row.setAttr('aria-label', `Go to decision ${decision.code}: ${decision.title}`);
      row.createSpan({ cls: 'aic-code-chip aic-code-mini', text: decision.code });
      row.createSpan({ cls: 'aic-popover-title', text: decision.title || decision.code });
      row.createSpan({ cls: 'aic-popover-age', text: shortAge(now - decision.at) });
      const go = (): void => {
        this.close();
        this.host.navigate(decision.code, 0);
        if (decision.mentions.length >= 2) this.showToolbar(decision, 0);
      };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          go();
        }
      });
    }
  }

  close(): void {
    this.popover?.remove();
    this.popover = null;
    if (this.outsideHandler) document.removeEventListener('mousedown', this.outsideHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, true);
    this.outsideHandler = null;
    this.keyHandler = null;
  }

  /* The toolbar appears ONLY after a list navigation onto a decision with two
   * or more mentions. Never on its own; at most one at a time. */
  private showToolbar(decision: TrackedDecision, position: number): void {
    this.dismissToolbar();
    let at = position;
    const bar = this.toolbarSlot.createDiv({ cls: 'aic-mention-bar' });
    bar.setAttr('role', 'toolbar');
    bar.setAttr('aria-label', `Mentions of ${decision.code}`);
    bar.createSpan({ cls: 'aic-mention-code', text: decision.code });
    const counter = bar.createSpan({ cls: 'aic-mention-count' });
    const paint = (): void => counter.setText(`${at + 1}/${decision.mentions.length}`);
    const jump = (delta: number): void => {
      at = (at + delta + decision.mentions.length) % decision.mentions.length;
      paint();
      this.host.navigate(decision.code, at);
    };
    for (const [icon, label, delta] of [
      ['chevron-up', 'Previous mention', -1],
      ['chevron-down', 'Next mention', 1],
    ] as Array<[string, string, number]>) {
      const btn = bar.createEl('button', { cls: 'aic-icon-btn aic-mini', type: 'button' });
      setIcon(btn, icon);
      btn.setAttr('aria-label', label);
      setTooltip(btn, label);
      btn.addEventListener('click', () => jump(delta));
    }
    const dismiss = bar.createEl('button', { cls: 'aic-icon-btn aic-mini', type: 'button' });
    setIcon(dismiss, 'x');
    dismiss.setAttr('aria-label', 'Dismiss the mention toolbar');
    dismiss.addEventListener('click', () => this.dismissToolbar());
    paint();
    this.toolbar = bar;
  }

  /** Dismissed by x, by Escape, and by the next send. */
  dismissToolbar(): void {
    this.toolbar?.remove();
    this.toolbar = null;
  }

  destroy(): void {
    this.close();
    this.dismissToolbar();
  }
}
