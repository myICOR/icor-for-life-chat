/* One shim, and the reason it exists.
 *
 * Obsidian runs plugins in an Electron renderer, where `AbortSignal` is the
 * DOM class. The Agent SDK hands its abort signal to Node's
 * `events.setMaxListeners`, which recognises an EventTarget by an internal
 * symbol that only Node's own realm carries. A renderer signal therefore fails
 * the check and the whole query dies before it launches:
 *
 *   TypeError: The "eventTargets" argument must be an instance of
 *   EventEmitter or EventTarget. Received an instance of AbortSignal
 *
 * Node's own implementation offers the way out. Its check is:
 *
 *   if (isEventTarget(target)) { ... }
 *   else if (typeof target.setMaxListeners === 'function') target.setMaxListeners(n);
 *   else throw ERR_INVALID_ARG_TYPE(...)
 *
 * so a target carrying a `setMaxListeners` method is accepted and Node calls
 * it instead of throwing. Listener caps are a diagnostic, not a behaviour, so
 * a no-op is the honest implementation of that method for a DOM signal, which
 * has no listener cap to raise.
 *
 * This is deliberately not a patch of a Node builtin: it adds one
 * non-enumerable no-op method to a DOM prototype and changes nothing else.
 * Found by driving the real plugin in Obsidian; every headless test passed
 * with the bug present, because Node's own AbortSignal is never wrong. */

let installed = false;

interface CompatScope {
  AbortSignal?: { prototype?: object };
}

export function installRendererCompat(
  // `window` for popout-window correctness per Obsidian's guideline; the
  // typeof guard keeps the pure-node test harness able to call this without a
  // DOM, passing its own scope.
  scope: CompatScope = typeof window === 'undefined' ? {} : window,
): boolean {
  if (installed) return false;
  installed = true;
  const proto = scope.AbortSignal?.prototype;
  if (!proto) return false;
  const existing = (proto as { setMaxListeners?: unknown }).setMaxListeners;
  if (typeof existing === 'function') return false;
  try {
    Object.defineProperty(proto, 'setMaxListeners', {
      value: function setMaxListeners(): void {
        // A DOM signal has no listener cap. Accepting the call is the point.
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget that the shim ran. */
export function resetRendererCompat(): void {
  installed = false;
}
