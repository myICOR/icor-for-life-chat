/* The environment a GUI-launched Obsidian actually hands a child process. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import {
  augmentPath, buildChildEnv, candidatePaths, classifyCli, cliFileNames,
  resolveCliPath, splitExtraPath,
} from './build/pure.mjs';

const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const mac = { platform: 'darwin', home: '/Users/t', path: GUI_PATH };

test('PATH augmentation reaches the install dirs a Dock launch never sees', () => {
  const out = augmentPath(mac).split(':');
  for (const dir of ['/Users/t/.local/bin', '/opt/homebrew/bin', '/Users/t/.bun/bin']) {
    assert.ok(out.includes(dir), `${dir} missing from augmented PATH`);
  }
});

test('augmentation appends, never reorders: the user PATH keeps precedence', () => {
  const out = augmentPath({ ...mac, path: '/my/first:/usr/bin' }).split(':');
  assert.equal(out[0], '/my/first');
  assert.equal(out[1], '/usr/bin');
});

test('augmentation dedupes without dropping the first occurrence', () => {
  const out = augmentPath({ ...mac, path: '/opt/homebrew/bin:/usr/bin' }).split(':');
  assert.equal(out.filter((d) => d === '/opt/homebrew/bin').length, 1);
  assert.equal(out[0], '/opt/homebrew/bin');
});

test('user extras are searched after the real PATH and before the defaults', () => {
  const out = augmentPath({ ...mac, extra: ['/opt/mine'] }).split(':');
  assert.ok(out.indexOf('/opt/mine') > out.indexOf('/usr/bin'));
  assert.ok(out.indexOf('/opt/mine') < out.indexOf('/Users/t/.local/bin'));
});

test('custom env vars merge over process.env without clobbering PATH', () => {
  const env = buildChildEnv({ PATH: GUI_PATH, MY_TOKEN: 'x', SHELL: '/bin/zsh' }, mac);
  assert.equal(env.MY_TOKEN, 'x');
  assert.equal(env.SHELL, '/bin/zsh');
  assert.ok(env.PATH.startsWith('/usr/bin:/bin'));
  assert.ok(env.PATH.includes('/opt/homebrew/bin'));
});

test('Windows: the real executable is preferred over the cmd shim', () => {
  const names = cliFileNames('win32');
  assert.ok(names.indexOf('claude.exe') < names.indexOf('claude.cmd'));
});

test('Windows: drive letters and spaces survive candidate assembly', () => {
  const cands = candidatePaths({
    platform: 'win32',
    home: 'C:\\Users\\Tom Reidel',
    path: 'C:\\Program Files\\nodejs',
  });
  assert.ok(cands.some((p) => p === 'C:\\Program Files\\nodejs\\claude.exe'));
  assert.ok(cands.some((p) => p.startsWith('C:\\Users\\Tom Reidel\\')));
});

test('the cmd shim is classified separately: it cannot be spawned shell-free', () => {
  assert.equal(classifyCli('C:\\x\\claude.cmd'), 'windows-shim');
  assert.equal(classifyCli('/usr/local/bin/claude'), 'native');
  assert.equal(classifyCli('/x/cli.js'), 'node-script');
});

/* THE RESOLVER, HERMETICALLY.
 *
 * The probe is CONSTRUCTED, never the real filesystem. Faking HOME and PATH is
 * not enough: half the candidate list is absolute system directories that no
 * fake environment redirects, so the no-install assertion below held on every
 * machine without Claude Code and went green-by-leak the day a real install
 * landed at /opt/homebrew/bin - the test was measuring the machine, not the
 * code. Its verdict now depends only on what it builds. No skip-on-detection
 * either: a skip is a green that measured nothing. */

const NOTHING_INSTALLED = () => false;
const installedAt = (...paths) => (p) => paths.includes(p);

test('a missing CLI fails with a message naming the fix, not an ENOENT', () => {
  // On a machine WITH a real machine-wide install, this throw must still
  // happen: the probe says the constructed world is empty, and the constructed
  // world is the only one the resolver may consult.
  assert.throws(
    () => resolveCliPath('', mac, NOTHING_INSTALLED),
    (e) => /plugin settings/.test(e.message) && /claude\.com\/claude-code/.test(e.message),
  );
});

test('the happy path: an install the probe reports is found and returned', () => {
  // The other direction, so the injection is proven live both ways: a probe
  // claiming an install must produce that path, machine-wide install or not.
  assert.equal(
    resolveCliPath('', mac, installedAt('/opt/homebrew/bin/claude')),
    '/opt/homebrew/bin/claude',
  );
  // And PATH precedence survives the injection: an install earlier in the
  // real PATH beats a later default dir when both exist.
  assert.equal(
    resolveCliPath('', mac, installedAt('/usr/bin/claude', '/opt/homebrew/bin/claude')),
    '/usr/bin/claude',
  );
});

test('a configured path that is not a file is rejected by name', () => {
  assert.throws(
    () => resolveCliPath('/definitely/not/here', mac, NOTHING_INSTALLED),
    /does not point at a file/,
  );
  // A configured path the probe confirms is returned verbatim, no search.
  assert.equal(
    resolveCliPath('/my/own/claude', mac, installedAt('/my/own/claude')),
    '/my/own/claude',
  );
});

test('the production default probe is the real filesystem, stated once', () => {
  /* The injection must not quietly become the only path: production callers
     omit the probe and get the real fs. Pinned at the source, because a
     hermetic suite cannot assert on the real filesystem without becoming the
     defect it just fixed. */
  const src = readFileSync(resolve(repoRoot, 'src/provider/cli.ts'), 'utf8');
  assert.match(src, /probe: FileProbe = isExecutableFile/,
    'resolveCliPath no longer defaults to the real filesystem probe');
  /* The production call site moved from the view into the Claude provider
     with the seam (0.7.0): resolving the executable is a fact about THIS
     provider. It passes its own real-filesystem probe by name, which is the
     same default under a name the provider owns. */
  const provider = readFileSync(resolve(repoRoot, 'src/provider/claude/index.ts'), 'utf8');
  assert.match(provider, /resolveCliPath\(config\.cliPath, pathEnv, isExecutableFile\)/,
    'the production call site no longer resolves with the real filesystem probe');
  const view = readFileSync(resolve(repoRoot, 'src/view/ChatView.ts'), 'utf8');
  assert.doesNotMatch(view, /resolveCliPath\(/, 'the view resolves the executable itself again; that is the provider\'s job');
});

test('extra PATH parsing tolerates blank lines and CRLF', () => {
  assert.deepEqual(splitExtraPath('/a\r\n\n  /b  \n'), ['/a', '/b']);
});
