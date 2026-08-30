/* Build ICOR for Life - Chat into a single CommonJS main.js for Obsidian.
 *
 * The Agent SDK is an ESM package that uses `import.meta.url` to build a
 * CommonJS `require`. Obsidian loads plugins as CJS, where `import.meta` does
 * not exist, so the banner materialises the value and `define` rewrites every
 * reference to it. Without this the bundle throws on first import.
 */
import esbuild from 'esbuild';
import builtins from 'builtin-modules';
import process from 'node:process';

const production = process.argv[2] === 'production';

const importMetaShim = [
  'const __icorFilename = typeof __filename === "string" ? __filename : "";',
  'const __icorImportMetaUrl = __icorFilename',
  '  ? require("node:url").pathToFileURL(__icorFilename).href',
  '  : "file:///icor-for-life-chat";',
  'const __icorImportMetaDirname = __icorFilename',
  '  ? require("node:path").dirname(__icorFilename)',
  '  : "/";',
].join('\n');

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  treeShaking: true,
  sourcemap: production ? false : 'inline',
  minify: production,
  banner: { js: importMetaShim },
  define: {
    'import.meta.url': '__icorImportMetaUrl',
    'import.meta.dirname': '__icorImportMetaDirname',
  },
  external: [
    'obsidian',
    'electron',
    '@codemirror/state',
    '@codemirror/view',
    ...builtins,
    ...builtins.map((m) => `node:${m}`),
  ],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
