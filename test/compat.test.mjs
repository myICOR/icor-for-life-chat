/* The renderer shim: it must make a DOM-style signal acceptable to Node's
 * setMaxListeners without changing anything else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { installRendererCompat, resetRendererCompat } from './build/pure.mjs';

class DomLikeSignal {
  addEventListener() {}
  removeEventListener() {}
}

function scopeWith(proto) {
  return { AbortSignal: { prototype: proto } };
}

test('a DOM-realm signal is rejected by Node until the shim runs', () => {
  assert.throws(() => setMaxListeners(50, new DomLikeSignal()), /EventEmitter or EventTarget/);
});

test('the shim makes exactly that call succeed', () => {
  resetRendererCompat();
  assert.equal(installRendererCompat(scopeWith(DomLikeSignal.prototype)), true);
  setMaxListeners(50, new DomLikeSignal());
  assert.equal(typeof DomLikeSignal.prototype.setMaxListeners, 'function');
});

test('the added method is a no-op and never enumerable', () => {
  const signal = new DomLikeSignal();
  assert.equal(signal.setMaxListeners(99), undefined);
  assert.deepEqual(Object.keys(DomLikeSignal.prototype), []);
  const d = Object.getOwnPropertyDescriptor(DomLikeSignal.prototype, 'setMaxListeners');
  assert.equal(d.enumerable, false);
  assert.equal(d.configurable, true);
});

test('the shim runs once and never overwrites a real implementation', () => {
  resetRendererCompat();
  const real = function () { return 'mine'; };
  class Native { }
  Native.prototype.setMaxListeners = real;
  assert.equal(installRendererCompat(scopeWith(Native.prototype)), false, 'existing method is kept');
  assert.equal(Native.prototype.setMaxListeners, real);
});

test('a scope without AbortSignal is survived, not thrown on', () => {
  resetRendererCompat();
  assert.equal(installRendererCompat({}), false);
});
