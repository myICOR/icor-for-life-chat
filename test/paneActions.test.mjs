/* The pane's own action surface: what paints when Obsidian hides the host
 * `.view-header` in a sidebar. Asserted headless - see `src/view/paneActions.ts`
 * for why there is exactly one function computing each label, shared by the
 * host action, the in-pane button, and the pane menu. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handoffActionPaint, remoteControlActionPaint, paneHeaderTarget,
} from './build/pure.mjs';

/* ---------------------------------------------------------- handoffActionPaint */

test('handoffActionPaint: available reads as the terminal icon, enabled, plain label', () => {
  assert.deepEqual(handoffActionPaint(null), {
    icon: 'terminal',
    label: 'Continue in the terminal',
    disabled: false,
  });
});

test('handoffActionPaint: unavailable disables and the label BECOMES the reason - one string, not two', () => {
  const reason = 'Install ICOR for Life - Terminal';
  assert.deepEqual(handoffActionPaint(reason), { icon: 'terminal', label: reason, disabled: true });
});

/* ------------------------------------------------------ remoteControlActionPaint */

test('remoteControlActionPaint: handed off offers the way back', () => {
  assert.deepEqual(remoteControlActionPaint({ kind: 'handed-off' }), {
    icon: 'corner-down-left',
    label: 'Bring it back',
    disabled: false,
  });
});

test('remoteControlActionPaint: no session yet is disabled with the send-a-message reason', () => {
  assert.deepEqual(remoteControlActionPaint({ kind: 'no-session' }), {
    icon: 'smartphone',
    label: 'Send a message first: a fresh pane has no session to hand over',
    disabled: true,
  });
});

test('remoteControlActionPaint: eligible is the plain enabled offer', () => {
  assert.deepEqual(remoteControlActionPaint({ kind: 'eligible' }), {
    icon: 'smartphone',
    label: 'Continue on your phone',
    disabled: false,
  });
});

test('remoteControlActionPaint: ineligible joins every disqualifying reason into one label', () => {
  const reasons = ['Claude Code 2.0.0 is older than 2.1.154.', 'Signed in with an API key: Remote Control needs a claude.ai sign-in.'];
  assert.deepEqual(remoteControlActionPaint({ kind: 'ineligible', reasons }), {
    icon: 'smartphone',
    label: reasons.join(' '),
    disabled: true,
  });
});

test('remoteControlActionPaint is pure: the same state always paints the same descriptor - the guarantee that keeps the host icon, the in-pane button and the pane-menu row from ever drifting apart, because all three call this once and paint what it returns', () => {
  const state = { kind: 'ineligible', reasons: ['x'] };
  assert.deepEqual(remoteControlActionPaint(state), remoteControlActionPaint(state));
  assert.deepEqual(handoffActionPaint('reason'), handoffActionPaint('reason'));
});

/* ------------------------------------------------------------- paneHeaderTarget */

test('paneHeaderTarget: a main-area leaf with a visible host header paints the host actions', () => {
  assert.equal(paneHeaderTarget({ sideSplit: false, hostHeaderHidden: false }), 'host');
});

test('paneHeaderTarget: a fake leaf in a side split paints in-pane, even while the host header still measures visible', () => {
  assert.equal(paneHeaderTarget({ sideSplit: true, hostHeaderHidden: false }), 'in-pane');
});

test('paneHeaderTarget: a main-area leaf whose host header the DOM measures hidden ALSO paints in-pane - the CSS fact catches what the split fact alone would miss', () => {
  assert.equal(paneHeaderTarget({ sideSplit: false, hostHeaderHidden: true }), 'in-pane');
});

test('paneHeaderTarget: both facts true is still exactly one target, never both', () => {
  assert.equal(paneHeaderTarget({ sideSplit: true, hostHeaderHidden: true }), 'in-pane');
});
