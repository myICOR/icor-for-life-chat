/* Three bundles feed the suite: the pure surface node:test imports directly,
 * and two browser fixtures the headless-Chrome gates mount. The
 * fixture aliases `obsidian` to a DOM shim so the gate runs the SHIPPED view
 * components; a hand-written copy of the markup would only ever agree with
 * itself. */
import esbuild from 'esbuild';
// Node's own list, so the build carries no dependency for what the runtime
// already knows. The directory scanner flagged the package as replaceable and
// it was right: `builtinModules` is the same list, maintained by Node itself.
import { builtinModules as builtins } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const external = [...builtins, ...builtins.map((m) => `node:${m}`)];

await esbuild.build({
  entryPoints: ['test/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'test/build/pure.mjs',
  logLevel: 'warning',
  external,
});

await esbuild.build({
  entryPoints: ['test/turn-entry.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'test/build/turn.js',
  logLevel: 'warning',
  alias: { obsidian: resolve(here, 'dom/shim.ts') },
});

await esbuild.build({
  entryPoints: ['test/dom-entry.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'test/build/dom.js',
  logLevel: 'warning',
  alias: { obsidian: resolve(here, 'dom/shim.ts') },
});
