/* The manifest id and the constants the PANE roots stamp must be the same string.
 *
 * Every root this plugin owns declares itself with `data-ink-plugin`, which is
 * how the INKLINE theme knows to leave that subtree alone instead of applying
 * its own control skin. The roots cannot read the manifest: `buildPane` is
 * called by the browser fixture, which has no plugin instance and therefore no
 * manifest, so that side reads a constant.
 *
 * Two sources for one identity is exactly the drift this closes. Rename the
 * plugin and this goes red in the same commit, which is the whole point: the
 * failure a drifted declaration produces is a pane that quietly loses its
 * theme exemption, and nothing in the running product would say why. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { INK_PLUGIN_NAME, PLUGIN_ID } from './build/pure.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

test('the manifest id is the string the pane roots stamp', () => {
  assert.equal(
    INK_PLUGIN_NAME,
    manifest.id,
    'the pane roots stamp INK_PLUGIN_NAME and the manifest declares another id; a rename moved one and not the other',
  );
});

test('the plugin id constant is the manifest id too', () => {
  assert.equal(PLUGIN_ID, manifest.id, 'PLUGIN_ID drifted from manifest.json');
});

/* ============================ minAppVersion vs the APIs actually used ======
 *
 * The Obsidian community directory's source scan FAILED this plugin:
 * obsidianmd/no-unsupported-api, "uses Obsidian APIs newer than the declared
 * minAppVersion". The manifest said 1.4.0 while thirteen call sites used the
 * `setTooltip` free function (since 1.4.4) and four used
 * `workspace.revealLeaf` (since 1.7.2). The declaration was a promise about a
 * floor nobody had ever checked, and the first checker was the directory's
 * gate, in public, blocking the listing.
 *
 * This is that scan, in-repo, against the SAME source of truth the scanner
 * reads: the `@since` annotations in obsidian.d.ts. Two sweeps, matching the
 * two shapes the failure actually took:
 *
 *   1. every named import from 'obsidian' -> its module-level declaration's
 *      @since (catches setTooltip),
 *   2. every member called through .workspace / .vault / .metadataCache /
 *      .adapter -> the member's @since on its owning class (catches
 *      revealLeaf).
 *
 * DELIBERATELY NOT a full type-checker: a member call on a local variable of
 * an Obsidian type reaches neither sweep. The two sweeps cover every access
 * path the plugin uses today, and a new access path added without extending
 * this comment is what review is for. Mobile-only classes (CapacitorAdapter)
 * are excluded because the manifest declares isDesktopOnly. */

const dts = readFileSync(resolve(repo, 'node_modules/obsidian/obsidian.d.ts'), 'utf8');
const dtsLines = dts.split('\n');

const parseVer = (v) => v.split('.').map(Number);
const cmpVer = (a, b) => {
  const [x, y] = [parseVer(a), parseVer(b)];
  for (let i = 0; i < 3; i += 1) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
};

/** @since of the doc block directly above line i, or null. */
function sinceAbove(i) {
  for (let j = i - 1; j >= Math.max(0, i - 14); j -= 1) {
    const line = dtsLines[j];
    if (/\*\//.test(line) && j !== i - 1) break;
    const m = line.match(/@since\s+([\d.]+)/);
    if (m) return m[1];
    if (/^\s*(?:export\s+)?(?:abstract\s+)?[a-zA-Z]+\s*\(/.test(line) && j !== i) break;
  }
  return null;
}

function ownerOf(i) {
  for (let j = i; j >= 0; j -= 1) {
    const m = dtsLines[j].match(/^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)/);
    if (m) return m[1];
  }
  return 'module';
}

/** Highest @since among declarations of `name` on any of `owners`. Null when
 * no declaration carries one (an unannotated API predates the annotations). */
function memberSince(name, owners) {
  let worst = null;
  const re = new RegExp(`^\\s*(?:abstract\\s+)?${name}\\s*[(<:]`);
  dtsLines.forEach((line, i) => {
    if (!re.test(line)) return;
    if (!owners.includes(ownerOf(i))) return;
    const v = sinceAbove(i);
    if (v && (!worst || cmpVer(v, worst) > 0)) worst = v;
  });
  return worst;
}

function moduleSince(name) {
  const re = new RegExp(`^export (?:function|class|const|abstract class) ${name}\\b`);
  const i = dtsLines.findIndex((l) => re.test(l));
  return i === -1 ? null : sinceAbove(i);
}

const srcFiles = execSync('git ls-files src', { cwd: repo, encoding: 'utf8' }).trim().split('\n');
const srcText = srcFiles.map((f) => readFileSync(resolve(repo, f), 'utf8')).join('\n');

test('every Obsidian API in use exists at the declared minAppVersion', () => {
  const floor = manifest.minAppVersion;
  const offenders = [];

  // Sweep 1: named imports from 'obsidian'.
  const importNames = new Set();
  for (const m of srcText.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'obsidian'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '');
      if (name) importNames.add(name);
    }
  }
  assert.ok(importNames.size >= 10, `only ${importNames.size} obsidian imports found - the sweep lost its input`);
  for (const name of importNames) {
    const v = moduleSince(name);
    if (v && cmpVer(v, floor) > 0) offenders.push(`import ${name} (since ${v})`);
  }

  // Sweep 2: members reached through the app surfaces the plugin actually
  // holds. The owner lists are the desktop classes behind each accessor.
  const SURFACES = {
    workspace: ['Workspace'],
    vault: ['Vault'],
    metadataCache: ['MetadataCache'],
    adapter: ['DataAdapter', 'FileSystemAdapter'],
  };
  const seen = new Set();
  for (const m of srcText.matchAll(/\.(workspace|vault|metadataCache|adapter)\.([a-zA-Z]+)\s*\(/g)) {
    const key = `${m[1]}.${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // `on` is overloaded PER EVENT NAME and the overloads carry different
    // sinces, so worst-of-all-overloads convicts events nobody registers:
    // the first run of this sweep flagged workspace.on at 1.5.1, which is
    // `editor-menu`'s since, while the plugin registers four events all
    // predating 1.0. Overloads discriminated by a literal are resolved by
    // that literal below instead.
    if (m[2] === 'on') continue;
    const v = memberSince(m[2], SURFACES[m[1]]);
    if (v && cmpVer(v, floor) > 0) offenders.push(`${key} (since ${v})`);
  }
  // Sweep 2b: each `.on('event')` registration, resolved against its own
  // overload rather than the family's worst.
  const events = new Set();
  for (const m of srcText.matchAll(/\.workspace\.on\(\s*'([a-z-]+)'/g)) events.add(m[1]);
  assert.ok(events.size >= 3, `only ${events.size} workspace events swept - the sweep lost its input`);
  for (const event of events) {
    const re = new RegExp(`^\\s*on\\(name: '${event}'`);
    let v = null;
    dtsLines.forEach((line, i) => {
      if (!re.test(line) || ownerOf(i) !== 'Workspace') return;
      const s2 = sinceAbove(i);
      if (s2 && (!v || cmpVer(s2, v) > 0)) v = s2;
    });
    if (v && cmpVer(v, floor) > 0) offenders.push(`workspace.on('${event}') (since ${v})`);
  }
  assert.ok(seen.size >= 5, `only ${seen.size} member accesses swept - the sweep lost its input`);

  assert.deepEqual(offenders, [],
    `manifest.json declares minAppVersion ${floor}, and these APIs did not exist there. ` +
    `The community directory's scan fails exactly this, in public, blocking the listing. ` +
    `Raise the floor or rewrite the call site:\n  ${offenders.join('\n  ')}`);
});

test('versions.json maps this release to the floor it declares', () => {
  const versions = JSON.parse(readFileSync(resolve(repo, 'versions.json'), 'utf8'));
  // versions.json is how an OLDER Obsidian resolves which plugin release it may
  // install, so the current version must be present and must agree with the
  // manifest - a mismatch hands an old app a build it cannot run.
  assert.equal(versions[manifest.version], manifest.minAppVersion,
    `versions.json maps ${manifest.version} to ${versions[manifest.version]}, ` +
    `manifest declares ${manifest.minAppVersion}`);
});

test('the since-parser reads known anchors correctly, so silence means clean', () => {
  /* The instrument's own control. A parser that returns null for everything
     would pass the offender sweep with an empty list - green having measured
     nothing. Three anchors with known answers, one of each kind: a module
     function with a since, a member with a since, and an old API without one. */
  assert.equal(moduleSince('setTooltip'), '1.4.4', 'the module-level sweep no longer reads @since');
  assert.equal(memberSince('revealLeaf', ['Workspace']), '1.7.2', 'the member sweep no longer reads @since');
  assert.equal(moduleSince('normalizePath'), null, 'an unannotated veteran API should read as null');
});
