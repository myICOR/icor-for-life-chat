import esbuild from 'esbuild';
import { builtinModules as builtins } from 'node:module';
await esbuild.build({
  entryPoints: ['tools/smoke-entry.ts', 'tools/followup-entry.ts', 'tools/abort-entry.ts', 'tools/structured-entry.ts', 'tools/subagent-entry.ts', 'tools/frames-entry.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outdir: 'tools/build', outExtension: { '.js': '.mjs' }, logLevel: 'warning',
  external: [...builtins, ...builtins.map((m) => `node:${m}`)],
});
