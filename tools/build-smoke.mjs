import esbuild from 'esbuild';
import builtins from 'builtin-modules';
await esbuild.build({
  entryPoints: ['tools/smoke-entry.ts', 'tools/abort-entry.ts', 'tools/structured-entry.ts', 'tools/subagent-entry.ts', 'tools/frames-entry.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outdir: 'tools/build', outExtension: { '.js': '.mjs' }, logLevel: 'warning',
  external: [...builtins, ...builtins.map((m) => `node:${m}`)],
});
