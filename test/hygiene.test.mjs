/* What the directory's own review page measures, measured here first.
 *
 * Every finding under "Source code" and "CSS lint" on the 2026-09-01 review
 * was ours to fix, and each is a text property of the repo - so each gets a
 * gate that reads the same text the scanner reads. The "Behavior" findings
 * are not here on purpose: shell execution, direct fs, and system identity
 * are what this plugin IS, and plugins that do the same are listed in the
 * directory carrying all three. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_SETTINGS, RENDER_ORDER, FACT_SETTING_KEYS,
  settingDefinitions, controlKeys, isNote, modelOptions, validateRetention,
} from './build/pure.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(resolve(repo, f), 'utf8');
/* Comments are blanked, not removed, so line numbers in a failure message
   still point at the real file. */
const cssCode = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* --------------------------------------------------------------- CSS lint */

test('no rule declares the same property twice', () => {
  /* The scanner flagged 37 of these. Every one was the "reset then set"
     idiom inside a single block - `cursor: inherit; cursor: pointer;` - where
     the later declaration wins and the earlier one is dead weight the cascade
     already discards. Keeping only the last is a no-op for the render and it
     was proved so: the whole computed-style suite measured identical values
     before and after the 37 removals.

     Declarations are split on `;`, NOT on newlines. The first version of this
     gate read one declaration per line, which is the shape the scanner flagged
     and the shape the file uses - and a duplicate written inline on one line
     slipped straight past it under mutation. A gate that only sees the shape
     its author had in mind is the gate this repo keeps refusing to ship. */
  const offenders = [];
  for (const m of cssCode.matchAll(/\{([^{}]*)\}/g)) {
    const startLine = cssCode.slice(0, m.index).split('\n').length;
    const seen = new Map();
    let line = startLine;
    for (const decl of m[1].split(';')) {
      const d = decl.match(/^\s*([a-zA-Z-]+)\s*:/);
      const at = line;
      line += (decl.match(/\n/g) ?? []).length;
      if (!d) continue;
      const prop = d[1];
      if (seen.has(prop)) offenders.push(`${prop} at lines ${seen.get(prop)} and ${at}`);
      else seen.set(prop, at);
    }
  }
  assert.deepEqual(offenders, [], `duplicate declarations:\n  ${offenders.join('\n  ')}`);
});

test('the stylesheet uses no :has()', () => {
  // Flagged for its invalidation cost. The one use - the composer's focus
  // trigger - became a class the composer stamps on real textarea focus, and
  // the PROPERTY it carried is still measured by real focus in the suite.
  assert.doesNotMatch(cssCode, /:has\(/, ':has() is back in a rule');
});

test('no partially-supported text-decoration longhands', () => {
  assert.doesNotMatch(cssCode, /text-decoration-(style|thickness)\s*:/,
    'the scanner marks these as partially supported; the dotted rule is a border now');
});

/* ------------------------------------------------------------- source code */

test('builtin-modules is gone; Node carries the same list itself', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!('builtin-modules' in (pkg.devDependencies ?? {})), 'builtin-modules is still a devDependency');
  assert.ok(!('builtin-modules' in (pkg.dependencies ?? {})), 'builtin-modules is still a dependency');
  for (const f of ['esbuild.config.mjs', 'test/build.mjs']) {
    assert.match(read(f), /from 'node:module'/, `${f} does not read the list from node:module`);
  }
});

test('a .node-version pins the Node the release is built with', () => {
  // The scanner rebuilds main.js and compares byte-for-byte. It passed
  // 2026-09-01 on 83b8045b35e5cd89; the pin is what keeps that from depending
  // on whatever Node the scanner happens to have.
  assert.ok(existsSync(resolve(repo, '.node-version')), 'no .node-version');
  assert.match(read('.node-version').trim(), /^\d+(\.\d+)*$/, '.node-version is not a version');
});

/* ----------------------------------------- the settings table, one source */

const INPUT = { settings: { ...DEFAULT_SETTINGS }, catalog: [], defaultArchiveFolder: '06 AI Team/AI Sessions' };

test('every persisted setting has exactly one row, and no row invents a key', () => {
  /* The review said this tab's settings were invisible to settings search on
     1.13. The fix is a declarative table, and a table is only trustworthy if
     it is COMPLETE: a setting with no row cannot be changed from the UI, and a
     row keyed to nothing writes into the void. */
  const keys = controlKeys(settingDefinitions(INPUT));
  const expected = Object.keys(DEFAULT_SETTINGS).sort();
  assert.deepEqual([...keys].sort(), expected,
    `rows and settings disagree.\n  missing rows: ${expected.filter((k) => !keys.includes(k))}\n  unknown keys: ${keys.filter((k) => !expected.includes(k))}`);
  assert.equal(new Set(keys).size, keys.length, 'a setting has two rows');
});

test('the effort dropdown offers the four rungs the composer offers', () => {
  const row = settingDefinitions(INPUT).flatMap((g) => g.items).find((i) => !isNote(i) && i.control.key === 'effort');
  assert.deepEqual(Object.keys(row.control.options), ['low', 'medium', 'high', 'xhigh']);
});

test('Bypass is offered as a default mode, and Ask is still what ships', () => {
  const row = settingDefinitions(INPUT).flatMap((g) => g.items).find((i) => !isNote(i) && i.control.key === 'defaultPermissionMode');
  assert.ok('bypassPermissions' in row.control.options, 'Bypass missing from the default-mode dropdown');
  assert.equal(DEFAULT_SETTINGS.defaultPermissionMode, 'default');
});

test('the eight readout switches come in the strip\'s own render order', () => {
  const strip = settingDefinitions(INPUT).find((g) => g.heading === 'Statusline');
  const keys = strip.items.filter((i) => !isNote(i)).map((i) => i.control.key);
  assert.deepEqual(keys, RENDER_ORDER.map((id) => FACT_SETTING_KEYS[id]));
  assert.ok(strip.items.some(isNote), 'the measured-readouts note is gone from the strip section');
});

test('the model dropdown never invents a catalogue, and never loses a stored choice', () => {
  assert.deepEqual(modelOptions(INPUT), { '': 'CLI default' }, 'an empty catalogue grew names from nowhere');
  const withStored = modelOptions({ ...INPUT, settings: { ...DEFAULT_SETTINGS, model: 'opus' } });
  assert.equal(withStored.opus, 'opus', 'a stored model the catalogue has not confirmed was dropped');
  const catalog = [{ value: 'default', displayName: 'Default', description: '', supportedEffortLevels: null },
                   { value: 'claude-fable-5[1m]', displayName: 'Fable', description: '', supportedEffortLevels: null }];
  const live = modelOptions({ ...INPUT, catalog });
  assert.equal(live['claude-fable-5[1m]'], 'Fable');
  assert.ok(!('default' in live), "the provider's 'default' row duplicates the empty-string row");
});

test('retention accepts whole non-negative days and refuses the rest', () => {
  assert.equal(validateRetention(0), undefined);
  assert.equal(validateRetention(90), undefined);
  assert.ok(validateRetention(-1), 'negative days accepted');
  assert.ok(validateRetention(1.5), 'fractional days accepted');
  assert.ok(validateRetention(Number.NaN), 'NaN accepted');
});

/* ------------------------------------------------ the Provider seam (0.7.0) */

/** Every .ts file under a directory, repo-relative, sorted. */
function tsFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(resolve(repo, d))) {
      const rel = `${d}/${name}`;
      if (statSync(resolve(repo, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.ts')) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

test('the Agent SDK is imported under src/provider/claude/ and nowhere else', () => {
  /* The seam is only a seam while it is the ONLY door. A second provider is
     a second folder; a view that reached for the SDK by name would make it a
     second view, which is the tax Copilot pays and this plugin refuses. */
  const offenders = tsFilesUnder('src')
    .filter((f) => !f.startsWith('src/provider/claude/'))
    .filter((f) => /@anthropic-ai\/claude-agent-sdk/.test(read(f)));
  assert.deepEqual(offenders, [], `the SDK leaked past the seam:\n  ${offenders.join('\n  ')}`);
});

test('the view and main.ts reach a provider through the registry only', () => {
  const offenders = [...tsFilesUnder('src/view'), 'src/main.ts', ...tsFilesUnder('src/state'), ...tsFilesUnder('src/model')]
    .filter((f) => /from '[^']*provider\/claude[^']*'/.test(read(f)));
  assert.deepEqual(offenders, [], `a Claude type crossed the seam:\n  ${offenders.join('\n  ')}`);
});

test('the seam declares every provider id, and the registry answers each one', () => {
  const src = read('src/provider/types.ts');
  assert.match(src, /'claude' \| 'codex' \| 'acp'/, 'the ProviderId union changed shape');
  const registry = read('src/provider/registry.ts');
  for (const id of ['claude', 'codex', 'acp']) {
    assert.match(registry, new RegExp(`\\b${id}:`), `the registry has no entry for ${id}`);
  }
});
