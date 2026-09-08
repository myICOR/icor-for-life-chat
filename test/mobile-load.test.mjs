/* THE MOBILE LOAD GATE (2026-09-06, `chat-mobile-engine-spec-v1.md` §4/5).
 *
 * `manifest.json` now declares `isDesktopOnly: false`, so Obsidian mobile
 * evaluates `main.js` too - and Obsidian mobile has no Node runtime at all:
 * no `node:child_process`, no `node:fs`, no `node:os`. Claude Code and Codex
 * are desktop CLIs the plugin spawns as a child process (`provider/claude/`,
 * `provider/codex/`), and importing either at MODULE SCOPE - a plain
 * top-of-file `import` - means `require('node:fs')` etc. runs the instant
 * `main.js` is evaluated, on every platform, before a single
 * `Platform.isDesktopApp` check anywhere in the product gets a chance to run.
 *
 * This is that failure, reproduced directly against the SHIPPED bundle
 * rather than reasoned about from the source tree: a hand-audit of every
 * `import` statement would have to also account for what a bundled
 * third-party dependency (`@anthropic-ai/claude-agent-sdk`) does at ITS OWN
 * module scope, which no static read of this repo's own files can answer.
 * `main.js` is loaded in a sandboxed CommonJS module wrapper whose `require`
 * throws for the exact builtins mobile does not have, and 'obsidian' /
 * 'electron' are stubbed the way Obsidian's own loader provides them. If
 * evaluating the module (NOT calling anything on it - just running its own
 * top level, which is everything a `require()` does) reaches one of those
 * throwing `require` calls, the plugin fails to load on mobile with nothing
 * on screen but a load error, and this test goes red.
 *
 * PROVEN TO HAVE TEETH, not just proven to pass: before the fix that added
 * this file (`provider/registry.ts`'s lazy `require('./claude')` /
 * `require('./codex')`, `provider/cli.ts`'s deferred `node:fs` / `node:path`,
 * `main.ts`'s deferred `node:os`), this exact test failed with
 * "Cannot find module 'node:fs'" - measured by hand against the pre-fix
 * bundle, not assumed. A gate whose red state has never been seen is not a
 * gate (GL-075's own rule, carried into this repo by the team that maintains
 * it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainJsPath = resolve(repo, 'main.js');
// This test file is ESM (.mjs), which has no ambient `require`; main.js
// itself is CJS and is what needs a real, CJS-shaped `require` handed to it.
const require = createRequire(import.meta.url);

/* Exactly the Node builtins Obsidian mobile does not carry, named rather
 * than inferred: the four this repo's own source reaches for on the
 * spawn-a-CLI path (`node:child_process`, `node:fs`, `node:os`,
 * `node:readline`, checked against the manifest-hardening grep this fix was
 * built from) plus their un-prefixed aliases, since either spelling resolves
 * to the same module and a bundle can carry either. */
const MOBILE_MISSING = new Set([
  'node:child_process', 'child_process',
  'node:fs', 'fs',
  'node:fs/promises', 'fs/promises',
  'node:os', 'os',
  'node:readline', 'readline',
]);

/* Everything else Node-builtin-shaped that the bundle is allowed to ask for
 * eagerly: harmless, side-effect-free modules real Node (this test's own
 * runtime) can answer for real, so a genuine, currently-unknown eager
 * dependency on one of THESE is not what this gate is measuring and is let
 * through rather than turned into a second, noisier failure mode. */
function realOrThrow(id) {
  if (MOBILE_MISSING.has(id)) {
    throw new Error(`Cannot find module '${id}' (simulated: not available on Obsidian mobile)`);
  }
  return require(id);
}

test('main.js evaluates its own top level without any Node API Obsidian mobile lacks', () => {
  const code = readFileSync(mainJsPath, 'utf8');
  const wrapped = Module.wrap(code);
  const script = new vm.Script(wrapped, { filename: mainJsPath });
  const fn = script.runInThisContext();
  const mod = { exports: {} };

  const sandboxRequire = (id) => {
    if (id === 'obsidian') {
      // A Proxy that manufactures a class for any named import: this test
      // never calls into the plugin, so nothing needs a real Obsidian API -
      // only enough shape that `class X extends Plugin {}` and similar
      // top-level class declarations do not throw while being DEFINED.
      return new Proxy({}, { get: () => class ObsidianStub {} });
    }
    if (id === 'electron') return {};
    return realOrThrow(id);
  };

  let thrown = null;
  try {
    fn.call(mod.exports, mod.exports, sandboxRequire, mod, mainJsPath, dirname(mainJsPath));
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, null,
    `main.js's own module-scope code reached for a Node API Obsidian mobile does not have: ${thrown?.message}\n` +
    'This is the exact failure that keeps the plugin from loading at all on a phone or tablet - fix the eager ' +
    'import (see provider/registry.ts, provider/cli.ts and main.ts\'s own homeDir getter for the pattern), it is ' +
    'never acceptable to relax this test instead.');

  assert.deepEqual(Object.keys(mod.exports).sort(), ['default'],
    'main.js stopped exporting a default plugin class - the sandbox mounted something unexpected');
});

test('the sandbox itself would have caught the pre-fix shape of this bug', () => {
  // The instrument's own control (the same discipline `manifest.test.mjs`'s
  // "since-parser reads known anchors" test applies): a sandbox that throws
  // for NOTHING would pass the test above having measured nothing. Prove the
  // throwing path fires on a real, current Node module this repo's bundle
  // could plausibly reach for, so silence in the test above means clean and
  // not merely untriggered.
  assert.throws(() => realOrThrow('node:fs'), /Cannot find module 'node:fs'/);
  assert.throws(() => realOrThrow('node:child_process'), /Cannot find module/);
  // And the allow-through path is real, not a second throw in disguise.
  assert.equal(typeof realOrThrow('node:path').join, 'function');
});
