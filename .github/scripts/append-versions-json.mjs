/* Appends this release's key to versions.json, and never touches an earlier one.
 *
 * release-please has no native updater for the Obsidian versions map, and JSON
 * cannot carry the marker comment a `generic` updater needs, so this runs as a
 * step on the release pull request branch after release-please has already
 * bumped manifest.json.
 *
 * manifest.json is the single source of truth for both halves of the new entry:
 * the version release-please just wrote, and the minAppVersion a human set. The
 * map is append-only. An earlier release is still installed in somebody's vault
 * and its floor must not move, so an existing key is left exactly as it was and
 * the script refuses to write at all if any earlier value would change.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'manifest.json';
const VERSIONS = 'versions.json';

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const version = manifest.version;
const minAppVersion = manifest.minAppVersion;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`${MANIFEST} has no usable version field: ${JSON.stringify(version)}`);
}
if (typeof minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(minAppVersion)) {
  throw new Error(`${MANIFEST} has no usable minAppVersion field: ${JSON.stringify(minAppVersion)}`);
}

const raw = readFileSync(VERSIONS, 'utf8');
const before = JSON.parse(raw);

if (Object.prototype.hasOwnProperty.call(before, version)) {
  if (before[version] !== minAppVersion) {
    console.log(
      `versions.json already carries ${version} at ${before[version]}, and manifest.json ` +
      `says ${minAppVersion}. Leaving the existing key alone: the map is append-only. ` +
      `A human decides which of the two is wrong.`,
    );
  } else {
    console.log(`versions.json already carries ${version} at ${before[version]}. Nothing to do.`);
  }
  process.exit(0);
}

const after = { ...before, [version]: minAppVersion };

for (const key of Object.keys(before)) {
  if (after[key] !== before[key]) {
    throw new Error(`refusing to write: ${key} would change from ${before[key]} to ${after[key]}`);
  }
}
if (Object.keys(after).length !== Object.keys(before).length + 1) {
  throw new Error('refusing to write: the key count did not grow by exactly one');
}

const trailingNewline = raw.endsWith('\n') ? '\n' : '';
writeFileSync(VERSIONS, `${JSON.stringify(after, null, 2)}${trailingNewline}`);
console.log(`versions.json: appended ${version} at ${minAppVersion}`);
