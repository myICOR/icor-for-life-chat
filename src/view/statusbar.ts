/* CLEARING OBSIDIAN'S OWN STATUS BAR, by measuring it rather than guessing it.
 *
 * The app's status bar ("306 backlinks · 5 properties · 180 words") is painted
 * over the bottom-right of the window, above whatever leaf happens to be there.
 * In a right sidebar that is this pane, so the bottom of the composer card and
 * everything under it were simply covered - the readout strip was invisible on
 * a machine where it rendered perfectly.
 *
 * The height is not a constant this file may hold. It moves with the theme, the
 * font size, the plugins that add their own status items, and it is zero when
 * the user has hidden the bar entirely. So it is MEASURED, every time the pane
 * or the bar changes size, and the answer is written to one custom property the
 * stylesheet reads. Geometry with one right answer is a script's job.
 *
 * `overlapPx` is a pure function over two rectangles so the rule can be
 * asserted without a window: the pane reserves exactly the vertical overlap
 * between itself and the bar, and exactly zero when they do not overlap
 * horizontally at all - which is the common case for a main-area tab, and the
 * reason a blanket bottom padding would be wrong.
 */

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The variable the stylesheet reads. Set on the pane root, never on body. */
export const STATUS_BAR_VAR = '--aic-statusbar-clearance';

/**
 * How much of the pane's bottom edge the bar covers, in px.
 *
 * Zero unless the two overlap on BOTH axes. A bar that sits to the right of a
 * narrow pane costs that pane nothing, and reserving space for it anyway would
 * put a permanent empty band under every composer in the vault.
 */
export function overlapPx(pane: Rect, bar: Rect): number {
  const horizontal = Math.min(pane.right, bar.right) - Math.max(pane.left, bar.left);
  if (horizontal <= 0) return 0;
  const vertical = Math.min(pane.bottom, bar.bottom) - Math.max(pane.top, bar.top);
  if (vertical <= 0) return 0;
  // Never reserve more than the pane has: a bar taller than the pane would
  // otherwise push the composer out of its own leaf.
  return Math.round(Math.min(vertical, pane.bottom - pane.top));
}

/**
 * Measure the live bar against this pane and write the clearance.
 *
 * No bar and no measurement both resolve to zero, written explicitly: leaving
 * the property unset would keep whatever the last measurement said, so a bar
 * the user has just hidden would go on being paid for.
 */
export function applyStatusBarClearance(root: HTMLElement, doc: Document): number {
  const bar = doc.querySelector('.status-bar');
  let clearance = 0;
  if (bar instanceof HTMLElement && bar.offsetParent !== null) {
    clearance = overlapPx(root.getBoundingClientRect(), bar.getBoundingClientRect());
  }
  root.style.setProperty(STATUS_BAR_VAR, `${clearance}px`);
  return clearance;
}
