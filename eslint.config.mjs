/* THE DIRECTORY'S SCANNER, IN-REPO.
 *
 * The community directory ran obsidianmd/no-unsupported-api and
 * no-static-styles-assignment against this plugin and FAILED the listing, in
 * public, on findings nothing in this repo had ever checked. The rules are
 * published as eslint-plugin-obsidianmd, so the scan now runs here: `npm run
 * lint` is the same instrument the directory uses, and a finding fails the
 * gate before it fails the listing.
 *
 * The scanner reads styles.css too (the static-styles and all-property
 * rules), so the css file is in scope on purpose. */
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import css from '@eslint/css';

export default defineConfig([
  /* The recommended set ships without a `files` scope, so unscoped it applies
     JS core rules to the stylesheet too and crashes on a CSS SourceCode. Every
     entry is pinned to the script surface; the stylesheet gets its own
     language block below. */
  ...obsidianmd.configs.recommended.map((c) => ({
    files: ['**/*.ts', '**/*.mjs'],
    ...c,
  })),
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
      },
    },
    plugins: { obsidianmd },
    rules: {
      /* Sentence case with the plugin's own vocabulary options, instead of
         scattering disables: these are product names and an env var, not
         capitalisation mistakes. */
      'obsidianmd/ui/sentence-case': ['warn', {
        /* 'Anthropic' / 'OpenRouter' added 2026-09-06 (mobile hardening,
           own-key engine): the two model-API providers named in the
           own-key engine's settings and status lines, proper nouns the same
           way the runtimes above them are. */
        brands: ['Claude Code', 'ICOR', 'Obsidian', 'AI Sessions', 'Bypass', 'Anthropic', 'OpenRouter'],
        /* 'API' added the same day: "API key" is the own-key engine's own
           vocabulary throughout Settings and the chat header. */
        acronyms: ['PATH', 'AI', 'CLI', 'API'],
      }],
    },
  },
  {
    /* THE THIRD FILE-SCOPED EXEMPTION, with its reason (2026-09-06, mobile
       hardening, Felix).

       `manifest.json` dropped `isDesktopOnly`, so `main.js` is now evaluated
       on Obsidian mobile too, and mobile has no Node runtime at all. These
       three files are exactly the ones where a plain top-of-file `import`
       from a Node builtin, or from the Claude/Codex provider folders (which
       themselves import the Agent SDK and more builtins), would run the
       instant the plugin loads, on every platform, before a single
       `Platform.isDesktopApp` check anywhere in the product gets to run:
       `main.ts`'s own `homeDir` getter (`node:os`), `provider/cli.ts`'s path
       resolution (`node:fs` / `node:path`, reached directly by `ChatView.ts`
       for `splitExtraPath`, not only by the two providers), and
       `provider/registry.ts`'s lazy loaders for `./claude` and `./codex`.

       The fix in every case is the same shape: keep the call, drop the
       static `import`, and reach for the module with a plain `require()`
       INSIDE the function that already only runs on the desktop or already
       only runs once something has actually asked for the runtime -
       `@typescript-eslint/no-require-imports` exists to keep CommonJS out of
       an ESM codebase, and this is the one place the codebase needs the
       opposite of what a static `import` gives it: a `require()` that does
       NOT run until asked. `test/mobile-load.test.mjs` measures the outcome
       against the built bundle, proven to fail before this fix landed. */
    files: ['src/main.ts', 'src/provider/cli.ts', 'src/provider/registry.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    /* THE SECOND FILE-SCOPED EXEMPTION, with its reason.
       The own-key engine's mobile transport (`chat-mobile-engine-spec-v1.md`
       section 5) needs `fetch` for ONE thing `requestUrl` cannot do: read a
       STREAMING response body. `requestUrl`'s own type in obsidian.d.ts
       resolves once with the full body - there is no streaming variant, so
       there is no `requestUrl` call this could be instead. `requestFull` in
       the same file, the "test key" call in testKey.ts, and every fallback
       path still call `requestUrl`; only the one function that streams
       reaches for `fetch`. Inline disables are (rightly) forbidden by the
       recommended config, so the exemption lives here, file-scoped. Dated
       2026-09-06. */
    files: ['src/engine/transport.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    /* THE FIRST FILE-SCOPED EXEMPTION, with its reason.
       The settings tab now implements the 1.13 declarative API, which is what
       the directory review asked for and what Obsidian 1.13 renders and
       indexes for settings search. `display()` is kept ON PURPOSE as the
       fallback for Obsidian < 1.13 - the floor is 1.7.2 - which is exactly the
       case its deprecation notice carves out, and it is never reached on 1.13
       once definitions are returned. Inline disables are (rightly) forbidden
       by the recommended config, so the exemption lives here, scoped. Dated
       2026-08-30, narrowed 2026-09-01; when the floor moves past 1.13.0,
       display() and this block both go. */
    files: ['src/settings/SettingsTab.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  {
    /* The stylesheet, under the same instrument. The directory's CSS findings
       ("unexpected property all", "avoid !important") are @eslint/css rules,
       which the obsidianmd plugin does not carry, so the css language plugin
       is wired directly. */
    files: ['styles.css'],
    plugins: { css },
    language: 'css/css',
    rules: {
      ...css.configs.recommended.rules,
      /* Both offs are checker limitations, not exemptions from the outcome:
         every font stack and colour routes through --aic-* tokens that this
         rule cannot resolve across selectors (136 false "unknown variable"
         findings), and every token's resolved value - fallback chains and
         generic font tails included - is measured as computed pixels by the
         four-room gate in test/computed-style.test.mjs, which is a stronger
         check than the static one being switched off. */
      'css/no-invalid-properties': 'off',
      'css/font-family-fallbacks': 'off',
    },
  },
  {
    ignores: ['main.js', 'node_modules/**', 'test/**', 'tools/**'],
  },
]);
