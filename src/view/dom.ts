/* Small DOM helpers. Obsidian's createEl covers most of it; these exist so the
 * INKLINE voices (kicker, hand, mono number) are spelled once. */

import { setIcon, setTooltip } from 'obsidian';

export function kicker(parent: HTMLElement, text: string, cls = ''): HTMLElement {
  return parent.createDiv({ cls: `aic-kicker ${cls}`.trim(), text });
}

export function icon(parent: HTMLElement, name: string, cls = ''): HTMLElement {
  const el = parent.createSpan({ cls: `aic-icon ${cls}`.trim() });
  setIcon(el, name);
  return el;
}

/** An icon button with a real accessible name. Never an unnamed glyph. */
export function iconButton(
  parent: HTMLElement,
  name: string,
  label: string,
  onClick: (event: MouseEvent) => void,
  cls = '',
): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: `aic-icon-btn ${cls}`.trim(), type: 'button' });
  setIcon(btn, name);
  btn.setAttr('aria-label', label);
  setTooltip(btn, label);
  btn.addEventListener('click', onClick);
  return btn;
}

export function dot(parent: HTMLElement, tone: 'marker' | 'warning' | 'destructive' | 'success' | 'faint'): HTMLElement {
  return parent.createSpan({ cls: `aic-dot aic-dot-${tone}` });
}

export function middot(parent: HTMLElement): HTMLElement {
  return parent.createSpan({ cls: 'aic-middot', text: '·' });
}

export {
  shortAge, shortDuration, compactNumber, displayPath,
} from '../model/format';

export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
