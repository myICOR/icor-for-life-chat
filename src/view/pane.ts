/* THE PANE SKELETON, stated once and built by everyone who builds a pane.
 *
 * Why this file exists. `ChatView.onOpen` assembled the pane and
 * `test/dom-entry.ts` assembled a REPLICA of it, so the gate's whole pane
 * census - the rung order, and the nesting property that keeps the statusline
 * strip outside the composer card - was pointed at the replica. It was proved
 * by mutation: moving the statusline back inside the composer card in
 * `ChatView.ts`, reintroducing in the shipped product the exact defect the
 * nesting property exists to catch, left `tsc --noEmit` at 0 and the suite at
 * 144/144 GREEN. The same move in the fixture went red immediately. The
 * assertion worked perfectly and it was aimed at a copy.
 *
 * `test/build.mjs`'s own header already carried the rule - "a hand-written copy
 * of the markup would only ever agree with itself" - and every rung BELOW the
 * pane (tool rows, mode chips, statusline facts, decision blocks) already came
 * from shipped components, which is why extending the gate downward found three
 * HIGH findings unaided. The pane assembly was the one seam where the discipline
 * did not hold, and it was the seam the nesting defect lived on.
 *
 * The two trees did not even agree on the day it was found: the view put the
 * chip tray inside `.aic-dock` and the fixture put it on the root, and the
 * fixture dropped `is-empty` entirely. Both happened to satisfy the nesting
 * property, so nothing surfaced. Now there is one tree because there is one
 * function.
 *
 * What this function deliberately does NOT own: the StreamRenderer. It needs an
 * `App` and a `Component`, which a browser fixture cannot honestly supply, and
 * the census is a property of the RUNGS rather than of what renders inside one.
 * So the skeleton is shared and each caller mounts its own renderer into the
 * returned `column`.
 *
 * The census, in document order, and the order is the contract:
 *   1  .aic-stream   (scroller) > .aic-column
 *   2  .aic-dock     > .aic-chips.is-empty
 *   3  .aic-dock     > .aic-composer   (the card, and the only :focus-within scope)
 *   4  .aic-facts    the statusline strip, a SIBLING of the card and the pane's
 *                    last child - outside the card's focus scope, which is the
 *                    REASON the nesting matters and not merely its coordinates.
 */

import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';
import { Composer } from './composer/Composer';
import type { ComposerCallbacks, ComposerState } from './composer/Composer';
import { DecisionBadge } from './composer/DecisionBadge';
import type { BadgeHost } from './composer/DecisionBadge';
import { Statusline } from './composer/Statusline';
import type { FactId } from '../model/facts';

export interface PaneOptions {
  /** The composer's opening state. */
  composer: ComposerState;
  /** Where the composer sends what the user does. */
  callbacks: ComposerCallbacks;
  /** Where the decision badge sends a navigate request. */
  badge: BadgeHost;
  /** The user's eight readout switches. Omitted means every readout on. */
  facts?: () => Record<FactId, boolean>;
}

export interface Pane {
  root: HTMLElement;
  /** Rung 1. The scroll box; `.aic-column` is the width-capped child. */
  scroller: HTMLElement;
  column: HTMLElement;
  /** A bare wrapper with no ground, no border and no radius - legal between rungs. */
  dock: HTMLElement;
  /** Rung 2. Empty until a subagent opens; `renderChipTray` owns `is-empty`. */
  chipTray: HTMLElement;
  /** Rung 3. */
  composer: Composer;
  badge: DecisionBadge;
  /** Rung 4, and its element, so a caller can assert on it without a query. */
  statusline: Statusline;
  facts: HTMLElement;
}

export function buildPane(root: HTMLElement, opts: PaneOptions): Pane {
  root.empty();
  root.addClass('aic-root');
  root.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);

  const scroller = root.createDiv({ cls: 'aic-stream' });
  const column = scroller.createDiv({ cls: 'aic-column' });

  const dock = root.createDiv({ cls: 'aic-dock' });
  const chipTray = dock.createDiv({ cls: 'aic-chips is-empty' });
  const composer = new Composer(dock, opts.composer, opts.callbacks);
  const badge = new DecisionBadge(composer.badgeContainer, dock, opts.badge);

  /* Rung 4 is mounted on the ROOT and not on the dock, and the reason is the
     focus scope rather than the geometry: `.aic-composer:focus-within` is the
     only focus-within rule in the stylesheet, and a readout nobody can focus
     was lighting up as part of the input's focus state. Mounting it one level
     up but still inside that scope would have moved the element and kept the
     defect. */
  const facts = root.createDiv({ cls: 'aic-facts' });
  const statusline = opts.facts ? new Statusline(facts, opts.facts) : new Statusline(facts);

  return { root, scroller, column, dock, chipTray, composer, badge, statusline, facts };
}
