/* Remote Control: the hand-off's whole logic layer, asserted headless.
 * `npm run gate`'s fixtures never spawn a real terminal or write a real
 * clipboard - every side effect here is a fake port. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  versionAtLeast, parseVersionTuple,
  remoteControlDisplayName, NOTE_TITLE_MAX,
  remoteControlEligibility, MIN_CLI_VERSION, TELEMETRY_DISQUALIFYING_VARS,
  remoteControlArgs, remoteControlArgv, quotePosix, quoteWindows, quoteForPlatform, remoteControlCommandLine,
  launchRemoteControlTerminal,
} from './build/pure.mjs';

/* --------------------------------------------------------------- version */

test('parseVersionTuple reads the leading X.Y.Z out of the CLI banner', () => {
  assert.deepEqual(parseVersionTuple('2.1.263 (Claude Code)'), [2, 1, 263]);
  assert.deepEqual(parseVersionTuple('2.1.263'), [2, 1, 263]);
  assert.equal(parseVersionTuple('not a version'), null);
  assert.equal(parseVersionTuple(''), null);
});

test('versionAtLeast compares as numbers, never as strings', () => {
  assert.equal(versionAtLeast('2.1.263', '2.1.154'), true);
  assert.equal(versionAtLeast('2.1.154', '2.1.154'), true, 'exactly the floor counts');
  assert.equal(versionAtLeast('2.1.9', '2.1.154'), false, '9 must not beat 154 as a string would');
  assert.equal(versionAtLeast('2.2.0', '2.1.154'), true, 'a newer minor wins regardless of patch');
  assert.equal(versionAtLeast('1.9.999', '2.1.154'), false, 'a newer patch never beats an older major');
  assert.equal(versionAtLeast(null, '2.1.154'), false, 'unmeasured is never "at least"');
  assert.equal(versionAtLeast('garbage', '2.1.154'), false);
});

/* ------------------------------------------------------------ displayName */

test('the base name with no note behind the session', () => {
  assert.equal(remoteControlDisplayName('My Life Folder - TR', null), 'ICOR: My Life Folder - TR');
  assert.equal(remoteControlDisplayName('My Life Folder - TR', '   '), 'ICOR: My Life Folder - TR',
    'a whitespace-only title is the same as no title');
});

test('a short note title is appended whole', () => {
  assert.equal(
    remoteControlDisplayName('My Vault', 'Q3 planning'),
    'ICOR: My Vault - Q3 planning',
  );
});

test('a long note title is truncated to NOTE_TITLE_MAX, with an ellipsis, never the vault name', () => {
  const longTitle = 'a'.repeat(NOTE_TITLE_MAX + 20);
  const name = remoteControlDisplayName('V', longTitle);
  const appended = name.slice('ICOR: V - '.length);
  assert.equal(appended.length, NOTE_TITLE_MAX);
  assert.ok(appended.endsWith('...'), 'a cut title says so');
  assert.ok(name.startsWith('ICOR: V - '), 'the vault name is never touched by the note-title cap');
});

/* -------------------------------------------------------------- eligibility */

const CLEAN = { authSource: 'subscription', childEnv: {}, cliVersion: '2.1.263' };

test('a clean subscription session on a current CLI is enabled with no reasons', () => {
  assert.deepEqual(remoteControlEligibility(CLEAN), { enabled: true, reasons: [] });
});

test('an API-key session disqualifies, by itself', () => {
  const result = remoteControlEligibility({ ...CLEAN, authSource: 'api-key' });
  assert.equal(result.enabled, false);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /API key/);
  assert.match(result.reasons[0], /claude\.ai sign-in/);
});

test('an unknown auth source never disqualifies by itself - unmeasured is not guessed either way', () => {
  assert.deepEqual(remoteControlEligibility({ ...CLEAN, authSource: 'unknown' }), { enabled: true, reasons: [] });
});

test('any one telemetry-disqualifying env var, truthy, disqualifies and names itself', () => {
  for (const name of TELEMETRY_DISQUALIFYING_VARS) {
    const result = remoteControlEligibility({ ...CLEAN, childEnv: { [name]: '1' } });
    assert.equal(result.enabled, false, name);
    assert.match(result.reasons[0], new RegExp(name));
  }
});

test('"0", "false" and empty are read as unset, not as the var being on', () => {
  for (const value of ['0', 'false', 'FALSE', '', '   ']) {
    const result = remoteControlEligibility({ ...CLEAN, childEnv: { DISABLE_TELEMETRY: value } });
    assert.deepEqual(result, { enabled: true, reasons: [] }, JSON.stringify(value));
  }
});

test('several set vars name themselves together, in one sentence', () => {
  const result = remoteControlEligibility({
    ...CLEAN,
    childEnv: { DO_NOT_TRACK: '1', DISABLE_GROWTHBOOK: 'true' },
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /DO_NOT_TRACK, DISABLE_GROWTHBOOK/);
  assert.match(result.reasons[0], / are set/);
});

test('an unmeasured CLI version disqualifies - a button that could launch on a too-old CLI fails silently otherwise', () => {
  const result = remoteControlEligibility({ ...CLEAN, cliVersion: null });
  assert.equal(result.enabled, false);
  assert.match(result.reasons[0], new RegExp(MIN_CLI_VERSION.replace(/\./g, '\\.')));
});

test('a CLI older than MIN_CLI_VERSION disqualifies and names the version', () => {
  const result = remoteControlEligibility({ ...CLEAN, cliVersion: '2.1.100' });
  assert.equal(result.enabled, false);
  assert.match(result.reasons[0], /2\.1\.100/);
});

test('every disqualifier that applies is reported, not just the first', () => {
  const result = remoteControlEligibility({
    authSource: 'api-key',
    childEnv: { DISABLE_TELEMETRY: '1' },
    cliVersion: '1.0.0',
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reasons.length, 3);
});

/* ----------------------------------------------------------------- command */

test('remoteControlArgs is the CLI flags in order, one argv entry each', () => {
  assert.deepEqual(remoteControlArgs('ICOR: Vault', 'abc-123'), ['--remote-control', 'ICOR: Vault', '--resume', 'abc-123']);
});

test('remoteControlArgv puts the resolved executable first', () => {
  assert.deepEqual(
    remoteControlArgv('/usr/local/bin/claude', 'ICOR: Vault', 'abc-123'),
    ['/usr/local/bin/claude', '--remote-control', 'ICOR: Vault', '--resume', 'abc-123'],
  );
});

test('quotePosix survives an embedded single quote, the common case (a possessive note title)', () => {
  assert.equal(quotePosix("Tom's Ideas"), `'Tom'\\''s Ideas'`);
  assert.equal(quotePosix('ICOR: My Vault'), `'ICOR: My Vault'`);
  // Round-trip: a POSIX shell fed this exact string back gives the original.
  assert.equal(quotePosix(`a"b$c\`d`), `'a"b$c\`d'`);
});

test('quoteWindows doubles an embedded double quote and wraps only when needed', () => {
  assert.equal(quoteWindows('plainword'), 'plainword');
  assert.equal(quoteWindows('ICOR: My Vault'), '"ICOR: My Vault"');
  assert.equal(quoteWindows('a "quoted" name'), '"a ""quoted"" name"');
});

test('quoteForPlatform routes to the right quoting rule', () => {
  assert.equal(quoteForPlatform("Tom's Vault", 'darwin'), `'Tom'\\''s Vault'`);
  assert.equal(quoteForPlatform("Tom's Vault", 'linux'), `'Tom'\\''s Vault'`);
  assert.equal(quoteForPlatform('Tom\'s Vault', 'win32'), '"Tom\'s Vault"');
});

test('remoteControlCommandLine is the exact string the button runs, executable first, every arg quoted', () => {
  const line = remoteControlCommandLine('/usr/local/bin/claude', "ICOR: Tom's Vault - Q3 plan", 'abc-123-def', 'darwin');
  assert.equal(
    line,
    `'/usr/local/bin/claude' '--remote-control' 'ICOR: Tom'\\''s Vault - Q3 plan' '--resume' 'abc-123-def'`,
  );
});

test('remoteControlCommandLine on Windows quotes only the args that need it (the one with a space)', () => {
  const line = remoteControlCommandLine('C:\\claude\\claude.exe', 'ICOR: Vault', 'abc-123', 'win32');
  assert.equal(line, 'C:\\claude\\claude.exe --remote-control "ICOR: Vault" --resume abc-123');
});

/* ------------------------------------------------------------------ launch */

function fakePorts(overrides = {}) {
  const calls = { spawn: [], clipboard: [], notice: [] };
  const ports = {
    terminalPlugin: null,
    spawn: { spawnDetached: (file, args) => calls.spawn.push([file, args]) },
    clipboard: { writeText: async (text) => calls.clipboard.push(text) },
    notice: { show: (message, ms) => calls.notice.push([message, ms]) },
    ...overrides,
  };
  return { ports, calls };
}

const REQ = {
  commandLine: "'/usr/local/bin/claude' '--remote-control' 'ICOR: Vault' '--resume' 'abc'",
  cwd: '/Users/x/vault',
  platform: 'darwin',
  isDesktopApp: true,
  linuxTerminalPath: null,
};

test('mobile (not desktop) always copies, regardless of platform', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal({ ...REQ, isDesktopApp: false }, ports);
  assert.equal(route, 'clipboard');
  assert.deepEqual(calls.clipboard, [REQ.commandLine]);
  assert.equal(calls.spawn.length, 0);
});

test('the Terminal plugin is preferred when it successfully types the command', async () => {
  const { ports, calls } = fakePorts({
    terminalPlugin: { newTerminalWithText: async (text, cwd) => { calls.notice.push(['typed', text, cwd]); return true; } },
  });
  const route = await launchRemoteControlTerminal(REQ, ports);
  assert.equal(route, 'terminal-plugin');
  assert.equal(calls.spawn.length, 0, 'no OS terminal fallback once the plugin succeeded');
});

test('a Terminal plugin that returns false or throws falls through to the OS terminal', async () => {
  for (const impl of [
    async () => false,
    async () => { throw new Error('boom'); },
  ]) {
    const { ports, calls } = fakePorts({ terminalPlugin: { newTerminalWithText: impl } });
    const route = await launchRemoteControlTerminal(REQ, ports);
    assert.equal(route, 'os-terminal');
    assert.equal(calls.spawn.length, 1);
    assert.equal(calls.spawn[0][0], 'osascript');
  }
});

test('macOS with no Terminal plugin spawns osascript with an ARGUMENT ARRAY, never a shell string', () => {
  return (async () => {
    const { ports, calls } = fakePorts();
    const route = await launchRemoteControlTerminal(REQ, ports);
    assert.equal(route, 'os-terminal');
    assert.equal(calls.spawn.length, 1);
    const [file, args] = calls.spawn[0];
    assert.equal(file, 'osascript');
    assert.deepEqual(args.slice(0, 1), ['-e']);
    assert.equal(args.length, 2, 'osascript gets -e plus ONE script argument, never a joined shell string');
    assert.match(args[1], /tell application "Terminal" to do script/);
    // The command line's own quoting survives inside the AppleScript literal.
    assert.match(args[1], /--remote-control/);
  })();
});

test('Windows spawns cmd /c start "" cmd /k "<command>", quoted defensively', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal({ ...REQ, platform: 'win32' }, ports);
  assert.equal(route, 'os-terminal');
  const [file, args] = calls.spawn[0];
  assert.equal(file, 'cmd');
  assert.deepEqual(args, ['/c', 'start', '', 'cmd', '/k', REQ.commandLine]);
});

test('Linux with a resolved terminal emulator spawns it with -e', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal(
    { ...REQ, platform: 'linux', linuxTerminalPath: '/usr/bin/x-terminal-emulator' },
    ports,
  );
  assert.equal(route, 'os-terminal');
  assert.deepEqual(calls.spawn[0], ['/usr/bin/x-terminal-emulator', ['-e', REQ.commandLine]]);
});

test('Linux with no terminal emulator found copies instead of guessing at a binary name', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal({ ...REQ, platform: 'linux', linuxTerminalPath: null }, ports);
  assert.equal(route, 'clipboard');
  assert.deepEqual(calls.clipboard, [REQ.commandLine]);
  assert.equal(calls.spawn.length, 0);
});
