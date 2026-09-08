/* THE ENV-FILE BACKEND (0.13.0, the suite-wide secrets contract, point 8):
 * "the env-file parser and writer are pure modules with tests (byte-identical
 * rest of file, idempotent, comment lines untouched)". Every case here is a
 * string in, a string out; the adapter cases hand in a map. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENV_FILE_PATH, ENV_KEY_FOR, cleanVaultPath, isOutsideVault, parseEnvFile, upsertEnvLine, readEnvKey, vaultPathRefusal, writeEnvKey,
} from './build/pure.mjs';

const SAMPLE = [
  '# ── Anthropic ──────────',
  '# Get from: https://console.anthropic.com/settings/keys',
  'ANTHROPIC_API_KEY=sk-ant-old',
  '',
  'export OPENAI_API_KEY=sk-openai-1',
  '  INDENTED_KEY = spaced value  ',
  '# OPENROUTER_API_KEY=commented-out',
  'BAD LINE WITHOUT EQUALS',
  '=no-key',
  'QUOTED="keeps the quotes"',
  'INTERP=${HOME}/x',
].join('\n') + '\n';

/* ------------------------------------------------------------- parser */

test('KEY=value lines parse; comments, blanks and malformed lines are skipped', () => {
  const map = parseEnvFile(SAMPLE);
  assert.equal(map.get('ANTHROPIC_API_KEY'), 'sk-ant-old');
  assert.equal(map.get('OPENAI_API_KEY'), 'sk-openai-1', 'an export prefix is accepted on read');
  assert.equal(map.get('INDENTED_KEY'), 'spaced value', 'whitespace around key and value is trimmed');
  assert.equal(map.has('OPENROUTER_API_KEY'), false, 'a commented-out line is a comment, not a value');
  assert.equal(map.has('BAD'), false);
  assert.equal(map.has(''), false);
});

test('values are literal: no quote stripping, no interpolation', () => {
  const map = parseEnvFile(SAMPLE);
  assert.equal(map.get('QUOTED'), '"keeps the quotes"');
  assert.equal(map.get('INTERP'), '${HOME}/x');
});

test('the first line for a key wins, and only the first = splits', () => {
  const map = parseEnvFile('A=1\nA=2\nB=x=y\n');
  assert.equal(map.get('A'), '1');
  assert.equal(map.get('B'), 'x=y');
});

test('CRLF files parse the same as LF files', () => {
  assert.equal(parseEnvFile('A=1\r\nB=2\r\n').get('B'), '2');
});

/* ------------------------------------------------------------- writer */

test('updating a key rewrites only that line; every other byte is identical', () => {
  const out = upsertEnvLine(SAMPLE, 'ANTHROPIC_API_KEY', 'sk-ant-new');
  const before = SAMPLE.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length, 'the line count changed');
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === 'ANTHROPIC_API_KEY=sk-ant-old') assert.equal(after[i], 'ANTHROPIC_API_KEY=sk-ant-new');
    else assert.equal(after[i], before[i], `line ${i + 1} changed`);
  }
});

test('a commented-out line for the same key is left untouched and a real line is appended', () => {
  const out = upsertEnvLine(SAMPLE, 'OPENROUTER_API_KEY', 'sk-or-1');
  assert.ok(out.includes('# OPENROUTER_API_KEY=commented-out\n'), 'the comment was rewritten');
  assert.ok(out.endsWith('INTERP=${HOME}/x\nOPENROUTER_API_KEY=sk-or-1\n'), 'the new line is not appended at the end');
  assert.equal(out.slice(0, SAMPLE.length), SAMPLE, 'the original bytes moved');
});

test('the writer is idempotent', () => {
  const once = upsertEnvLine(SAMPLE, 'OPENROUTER_API_KEY', 'sk-or-1');
  const twice = upsertEnvLine(once, 'OPENROUTER_API_KEY', 'sk-or-1');
  assert.equal(twice, once);
  const updated = upsertEnvLine(SAMPLE, 'ANTHROPIC_API_KEY', 'sk-ant-old');
  assert.equal(updated, SAMPLE, 'rewriting the value already there changed the file');
});

test('an export prefix, indentation and spacing around = survive an update', () => {
  const out = upsertEnvLine(SAMPLE, 'OPENAI_API_KEY', 'sk-openai-2');
  assert.ok(out.includes('export OPENAI_API_KEY=sk-openai-2\n'));
  const spaced = upsertEnvLine(SAMPLE, 'INDENTED_KEY', 'v2');
  assert.ok(spaced.includes('  INDENTED_KEY = v2\n'), 'the spacing the member wrote was normalised away');
});

test('appending respects the file: no leading newline on an empty file, a newline after a file without one, CRLF kept', () => {
  assert.equal(upsertEnvLine('', 'A', '1'), 'A=1\n');
  assert.equal(upsertEnvLine('B=2', 'A', '1'), 'B=2\nA=1\n');
  assert.equal(upsertEnvLine('B=2\r\n', 'A', '1'), 'B=2\r\nA=1\r\n');
  assert.equal(upsertEnvLine('B=2\r\nA=old\r\n', 'A', '1'), 'B=2\r\nA=1\r\n');
});

test('blanking writes KEY= and keeps the line, so a later save lands in the same place', () => {
  const out = upsertEnvLine(SAMPLE, 'ANTHROPIC_API_KEY', '');
  assert.ok(out.includes('\nANTHROPIC_API_KEY=\n'));
  assert.equal(parseEnvFile(out).get('ANTHROPIC_API_KEY'), '');
});

test('the writer refuses a bad key name or a multi-line value rather than corrupting the file', () => {
  assert.throws(() => upsertEnvLine(SAMPLE, 'not a key', 'x'));
  assert.throws(() => upsertEnvLine(SAMPLE, 'A', 'one\ntwo'));
  assert.throws(() => upsertEnvLine(SAMPLE, 'A', 'one\r\nB=injected'));
});

/* ---------------------------------------------------------- the adapter */

function fakeAdapter(files = {}) {
  const store = { ...files };
  const writes = [];
  return {
    exists: async (p) => p in store,
    read: async (p) => store[p],
    write: async (p, data) => { store[p] = data; writes.push(p); },
    files: store,
    writes,
  };
}

test('readEnvKey answers empty for a missing file, a missing line, and an empty path', async () => {
  const host = fakeAdapter({ '.env': 'A=1\n' });
  assert.equal(await readEnvKey(host, '.env', 'A'), '1');
  assert.equal(await readEnvKey(host, '.env', 'B'), '');
  assert.equal(await readEnvKey(host, 'missing.env', 'A'), '');
  assert.equal(await readEnvKey(host, '', 'A'), '');
});

test('writeEnvKey creates the file, updates in place, and skips a write that changes nothing', async () => {
  const host = fakeAdapter();
  await writeEnvKey(host, 'x/.env', 'A', '1');
  assert.equal(host.files['x/.env'], 'A=1\n');
  await writeEnvKey(host, 'x/.env', 'A', '1');
  assert.equal(host.writes.length, 1, 'an unchanged file was rewritten');
  await writeEnvKey(host, 'x/.env', 'A', '2');
  assert.equal(host.files['x/.env'], 'A=2\n');
  await assert.rejects(() => writeEnvKey(host, '', 'A', '1'), /No env file path/);
});

/* ------------------------------------------------------------ constants */

test('the default path is the suite-wide one, and the variable names are documented ones', () => {
  assert.equal(DEFAULT_ENV_FILE_PATH, '06 AI Team/AI Team Knowledge/.env');
  assert.deepEqual(ENV_KEY_FOR, { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' });
});

test('cleanVaultPath trims, strips a leading ./, and turns backslashes around', () => {
  assert.equal(cleanVaultPath('  ./06 AI Team/.env '), '06 AI Team/.env');
  assert.equal(cleanVaultPath('a\\b/.env'), 'a/b/.env');
  assert.equal(cleanVaultPath(''), '');
});

test('cleanVaultPath refuses a path outside the vault: absolute, ~, or any .. segment (Vex A-1)', () => {
  // The demonstrated case: before 0.13.0 this came back as '../x'.
  for (const outside of ['../x', 'a/../../x', '06 AI Team/..', '..', '/etc/env', '\\\\server/.env', 'C:\\Users\\x\\.env', '~/.env', ' ~/.env ']) {
    assert.equal(isOutsideVault(outside), true, outside);
    assert.equal(cleanVaultPath(outside), '', outside);
  }
  // A dot in a name is not a dot-dot segment, and a leading ./ is the vault.
  for (const inside of ['a/..b/.env', '..env', '06 AI Team/.env', './x/.env', 'x/y.../.env']) {
    assert.equal(isOutsideVault(inside), false, inside);
    assert.notEqual(cleanVaultPath(inside), '', inside);
  }
  // The Planner's two sentences, word for word, so the suite refuses in one voice.
  assert.equal(vaultPathRefusal('../x'), 'The path must stay inside the vault (no "..").');
  assert.equal(vaultPathRefusal('/etc/env'), 'The path is relative to the vault root, not an absolute path.');
  assert.equal(vaultPathRefusal('~/.env'), 'The path is relative to the vault root, not an absolute path.');
  assert.equal(vaultPathRefusal('06 AI Team/.env'), null);
  for (const s of [vaultPathRefusal('../x'), vaultPathRefusal('/x')]) assert.doesNotMatch(s, /[\u2013\u2014]/);
});

test('a stored env file path outside the vault falls back to the default when settings load', () => {
  assert.equal(cleanVaultPath('../outside/.env') || DEFAULT_ENV_FILE_PATH, DEFAULT_ENV_FILE_PATH);
});
