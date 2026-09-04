/* THE PIN TRAY: rung 0, above the stream, so it never scrolls away.
 *
 * It exists because the question scrolls out of sight. Twenty tool rows and
 * two cards later, the user is reading an answer to a prompt they can no
 * longer see, and "what did I actually ask" is the one thing the pane should
 * always be able to answer. The first prompt is pinned by the plugin; any
 * other prompt is pinned by the user from its well. Pins stack in
 * conversation order, folded to one line each, and a click opens one to its
 * full text.
 *
 * The tray sits OUTSIDE the scroller on purpose. A sticky element inside it
 * would scroll with the column's width cap and fight the resume seam; a
 * sibling above it is simply always there. It is a quiet band, hairline
 * below, and it contributes zero height when there is nothing pinned. */

import { setIcon, setTooltip } from 'obsidian';
import type { PinnedPrompt } from '../model/pins';
import { firstLine, isFolded } from '../model/pins';

export interface PinTrayHost {
  /** Which pins are unfolded. Owned by the caller so it survives a repaint. */
  open: Set<string>;
  onToggleOpen: (key: string) => void;
  onUnpin: (key: string) => void;
  /** Scroll the stream to the user well this pin came from. */
  onJump: (key: string) => void;
}

/** Repaint the whole tray. Cheap: a handful of rows, rebuilt on every change. */
export function renderPinTray(el: HTMLElement, pins: readonly PinnedPrompt[], host: PinTrayHost): void {
  el.empty();
  el.toggleClass('is-empty', pins.length === 0);
  if (pins.length === 0) return;
  el.setAttr('role', 'list');
  el.setAttr('aria-label', pins.length === 1 ? 'Pinned prompt' : `${pins.length} pinned prompts`);
  const stacked = pins.length > 1;
  pins.forEach((pin, i) => {
    const open = host.open.has(pin.key);
    const folded = isFolded(pin.text);
    const row = el.createDiv({ cls: 'aic-pin' });
    row.setAttr('role', 'listitem');
    row.toggleClass('is-open', open);
    row.toggleClass('is-auto', pin.auto);
    row.dataset.pinKey = pin.key;

    /* THE ROW IS THE CONTROL when there is something to unfold. A one-line
       prompt that fits has nothing behind it, and a control that opens onto
       what is already shown is the empty promise this plugin refuses on tool
       rows too. */
    const head = row.createDiv({ cls: 'aic-pin-head' });
    const glyph = head.createSpan({ cls: 'aic-pin-icon' });
    setIcon(glyph, 'pin');
    if (stacked) head.createSpan({ cls: 'aic-pin-ordinal', text: `#${i + 1}` });
    head.createSpan({ cls: 'aic-pin-text', text: firstLine(pin.text) });
    if (folded) {
      head.setAttr('role', 'button');
      head.setAttr('tabindex', '0');
      head.setAttr('aria-expanded', open ? 'true' : 'false');
      head.setAttr('aria-label', open ? 'Fold this pinned prompt' : 'Show the whole pinned prompt');
      const toggle = (): void => host.onToggleOpen(pin.key);
      head.addEventListener('click', (ev: MouseEvent) => {
        if ((ev.target as HTMLElement | null)?.closest('button')) return;
        toggle();
      });
      head.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        if ((ev.target as HTMLElement | null)?.closest('button')) return;
        ev.preventDefault();
        toggle();
      });
      row.addClass('is-foldable');
    }

    const actions = head.createSpan({ cls: 'aic-pin-actions' });
    const jump = actions.createEl('button', { cls: 'aic-pin-btn', type: 'button' });
    setIcon(jump, 'arrow-down-to-line');
    jump.setAttr('aria-label', 'Jump to this prompt');
    setTooltip(jump, 'Jump to this prompt');
    jump.addEventListener('click', () => host.onJump(pin.key));
    const unpin = actions.createEl('button', { cls: 'aic-pin-btn', type: 'button' });
    setIcon(unpin, 'pin-off');
    unpin.setAttr('aria-label', 'Unpin this prompt');
    setTooltip(unpin, 'Unpin this prompt');
    unpin.addEventListener('click', () => host.onUnpin(pin.key));

    /* The full text, only while open. Built on open and dropped on fold, so a
       tray with ten folded pins carries ten lines of DOM and not ten prompts. */
    if (open && folded) {
      row.createDiv({ cls: 'aic-pin-body', text: pin.text });
    }
  });
}
