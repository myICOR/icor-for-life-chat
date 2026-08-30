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
        brands: ['Claude Code', 'ICOR', 'Obsidian', 'AI Sessions', 'Bypass'],
        acronyms: ['PATH', 'AI', 'CLI'],
      }],
    },
  },
  {
    /* THE ONE FILE-SCOPED EXEMPTION, with its reason. The declarative settings
       API the two rules push toward is @since Obsidian 1.13.0; this plugin's
       honest minAppVersion is 1.7.2, the highest version any used API actually
       requires. Adopting the new API would raise the floor for a settings
       search affordance. Inline disables are (rightly) forbidden by the
       recommended config, so the exemption lives here, scoped and dated
       2026-08-30; revisit when the floor moves past 1.13.0. */
    files: ['src/settings/SettingsTab.ts'],
    rules: {
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
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
