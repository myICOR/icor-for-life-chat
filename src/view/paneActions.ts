/* THE PANE'S OWN ACTION SURFACE, painted whenever Obsidian hides `.view-header`.
 *
 * Obsidian hides the header entirely in a sidebar - `display: none`, height 0
 * (Tom, 2026-09-07, verified via CDP: the three `addAction` icons exist in the
 * DOM, none disabled, none hidden by this plugin - the HOST hides their
 * container). Chats open in the right sidebar by default (`leafRoute.ts`), so
 * this is not an edge case: it is most members' every session, and the
 * release's headline actions - the two hand-offs and the insights view - were
 * invisible to them.
 *
 * The fix does not stretch the host header. It paints a second, always-
 * reachable copy of the same actions inside the pane itself, and shows
 * exactly one copy at a time. Both copies read from the exact same functions
 * here, so "same icon, same label, same enabled/disabled reason" is not a
 * rule ChatView has to keep - it is a fact about how many times the label is
 * computed (once).
 *
 * Everything below is plain data in, plain data out. The DOM wiring lives in
 * ChatView (`setIcon`/`setAttr`/`toggleClass` on whichever element exists);
 * this file never touches an element, so node:test reads it with no Obsidian
 * runtime and it never disagrees with what ChatView paints, because there is
 * only one function computing either. */

/** The one shape both surfaces paint: icon, label (doubles as the tooltip and
 *  the disabled reason), and whether the action is currently clickable. */
export interface ActionPaint {
  icon: string;
  label: string;
  disabled: boolean;
}

/**
 * The terminal hand-off's action, unchanged from `paintHandoffAction`'s own
 * logic before this file existed: `reason` is `handoffReason()`'s answer,
 * null when available.
 */
export function handoffActionPaint(reason: string | null): ActionPaint {
  return { icon: 'terminal', label: reason ?? 'Continue in the terminal', disabled: reason !== null };
}

/**
 * Remote Control's four states, exactly as `paintRemoteControlAction` read
 * them before this file existed: already handed off (offers the way back), no
 * session yet to hand over, eligible, or disqualified with reasons.
 */
export type RemoteControlPaintState =
  | { kind: 'handed-off' }
  | { kind: 'no-session' }
  | { kind: 'eligible' }
  | { kind: 'ineligible'; reasons: readonly string[] };

export function remoteControlActionPaint(state: RemoteControlPaintState): ActionPaint {
  if (state.kind === 'handed-off') return { icon: 'corner-down-left', label: 'Bring it back', disabled: false };
  if (state.kind === 'no-session') {
    return {
      icon: 'smartphone',
      label: 'Send a message first: a fresh pane has no session to hand over',
      disabled: true,
    };
  }
  if (state.kind === 'eligible') return { icon: 'smartphone', label: 'Continue on your phone', disabled: false };
  return { icon: 'smartphone', label: state.reasons.join(' '), disabled: true };
}

/**
 * Which surface paints the three actions right now. `sideSplit` is the
 * structural fact - this leaf's root is the left or right sidedock, not the
 * main workspace split - true the instant the leaf is placed in the tree,
 * before layout has run once. `hostHeaderHidden` is the live measurement
 * (`getComputedStyle(viewHeader).display === 'none'`), the fact that would
 * still catch a host that hides the header some OTHER way (a theme, a future
 * Obsidian layout) even in the main area. Either fact alone is enough to move
 * the actions in-pane; the OR is deliberate, not a hedge - it is two
 * independent ways of noticing the same host behaviour, so a change to
 * either one on its own still gets caught.
 */
export interface PaneHeaderFacts {
  sideSplit: boolean;
  hostHeaderHidden: boolean;
}

export type PaneHeaderTarget = 'host' | 'in-pane';

export function paneHeaderTarget(facts: PaneHeaderFacts): PaneHeaderTarget {
  return facts.sideSplit || facts.hostHeaderHidden ? 'in-pane' : 'host';
}
