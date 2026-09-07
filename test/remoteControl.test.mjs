/* Remote Control: the hand-off's whole logic layer, asserted headless.
 * `npm run gate`'s fixtures never spawn a real terminal or write a real
 * clipboard - every side effect here is a fake port. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  versionAtLeast, parseVersionTuple,
  remoteControlDisplayName, NOTE_TITLE_MAX, DISPLAY_NAME_MAX,
  remoteControlEligibility, MIN_CLI_VERSION, TELEMETRY_DISQUALIFYING_VARS, ROUTING_DISQUALIFYING_VARS,
  remoteControlArgs, remoteControlArgv, quotePosix, quoteWindows, quoteForPlatform, remoteControlCommandLine,
  launchRemoteControlTerminal, spawnFailureMessage,
  parseHeldSessions, heldSessionsHas,
  isSessionId, SESSION_ID_PATTERN,
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

/* ---------------------------------------------------- displayName safety */

test('control characters and newlines are stripped from both the vault name and the note title, on every platform (Vex M3)', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const name = remoteControlDisplayName('Vault\r\nwith a newline', 'Title\x1bwith an escape', platform);
    assert.doesNotMatch(name, /[\x00-\x1f\x7f]/, platform);
    assert.equal(name, 'ICOR: Vaultwith a newline - Titlewith an escape', platform);
  }
});

test('a literal % is stripped only on win32 - Vex H3, cmd.exe expands %VAR% regardless of quoting', () => {
  const posix = remoteControlDisplayName('%USERPROFILE%\\Desktop', null, 'darwin');
  assert.equal(posix, 'ICOR: %USERPROFILE%\\Desktop', 'POSIX shells never expand % - nothing to strip');
  const linux = remoteControlDisplayName('%USERPROFILE%\\Desktop', null, 'linux');
  assert.equal(linux, 'ICOR: %USERPROFILE%\\Desktop');
  const windows = remoteControlDisplayName('%USERPROFILE%\\Desktop', null, 'win32');
  assert.equal(windows, 'ICOR: USERPROFILE\\Desktop', '% is dropped, not escaped - the display name has no functional need for it');
});

test('% in the note title is also stripped on win32, and platform defaults to darwin (no stripping) when omitted', () => {
  assert.equal(remoteControlDisplayName('V', '100% done', 'win32'), 'ICOR: V - 100 done');
  assert.equal(remoteControlDisplayName('V', '100% done'), 'ICOR: V - 100% done');
});

test('the whole rendered name is capped at DISPLAY_NAME_MAX as a safety net, without disturbing any normal-length name', () => {
  const hugeVault = 'V'.repeat(DISPLAY_NAME_MAX + 50);
  const name = remoteControlDisplayName(hugeVault, 'a title');
  assert.ok(name.length <= DISPLAY_NAME_MAX, `${name.length} <= ${DISPLAY_NAME_MAX}`);
  assert.ok(name.endsWith('...'));
  // The everyday case established above is untouched by the cap existing.
  assert.equal(remoteControlDisplayName('My Vault', 'Q3 planning'), 'ICOR: My Vault - Q3 planning');
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

/* -------------------------------------------------- routing disqualifiers */

test('CLAUDE_CODE_USE_BEDROCK and CLAUDE_CODE_USE_VERTEX each disqualify - Remote Control needs api.anthropic.com directly', () => {
  for (const name of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
    const result = remoteControlEligibility({ ...CLEAN, childEnv: { [name]: '1' } });
    assert.equal(result.enabled, false, name);
    assert.match(result.reasons[0], new RegExp(name));
  }
});

test('any one Microsoft Foundry config var disqualifies - there is no single CLAUDE_CODE_USE_FOUNDRY toggle to check instead', () => {
  for (const name of ['ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN']) {
    const result = remoteControlEligibility({ ...CLEAN, childEnv: { [name]: 'anything' } });
    assert.equal(result.enabled, false, name);
    assert.match(result.reasons[0], new RegExp(name));
  }
});

test('every ROUTING_DISQUALIFYING_VARS entry is a real, exported name the test above can iterate without hardcoding it twice', () => {
  assert.deepEqual(ROUTING_DISQUALIFYING_VARS, [
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  ]);
});

test('ANTHROPIC_BASE_URL pointing away from api.anthropic.com disqualifies and names the host', () => {
  const result = remoteControlEligibility({ ...CLEAN, childEnv: { ANTHROPIC_BASE_URL: 'https://my-llm-gateway.example.com' } });
  assert.equal(result.enabled, false);
  assert.match(result.reasons[0], /ANTHROPIC_BASE_URL/);
  assert.match(result.reasons[0], /my-llm-gateway\.example\.com/);
});

test('ANTHROPIC_BASE_URL pointing AT api.anthropic.com does not disqualify', () => {
  const result = remoteControlEligibility({ ...CLEAN, childEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } });
  assert.deepEqual(result, { enabled: true, reasons: [] });
});

test('ANTHROPIC_BASE_URL unset, empty, or unparsable-as-a-URL never disqualifies on its own unless it actually points elsewhere', () => {
  assert.deepEqual(remoteControlEligibility({ ...CLEAN, childEnv: {} }), { enabled: true, reasons: [] });
  assert.deepEqual(remoteControlEligibility({ ...CLEAN, childEnv: { ANTHROPIC_BASE_URL: '' } }), { enabled: true, reasons: [] });
  // Unparsable fails CLOSED (disqualifies) rather than silently passing an
  // env var that is clearly set to SOMETHING other than the real API host.
  const garbage = remoteControlEligibility({ ...CLEAN, childEnv: { ANTHROPIC_BASE_URL: 'not a url' } });
  assert.equal(garbage.enabled, false);
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

/* --------------------------------------------------------------- sessionId */

test('isSessionId accepts exactly the UUID shape Claude Code mints, case-insensitively', () => {
  assert.equal(isSessionId('4b1f9a2e-6c3d-4e11-8a9f-2d5b7c9e0a11'), true);
  assert.equal(isSessionId('4B1F9A2E-6C3D-4E11-8A9F-2D5B7C9E0A11'), true, 'upper-case hex is still valid');
});

test('isSessionId refuses anything else, including a shell-metacharacter payload dressed up as an id', () => {
  for (const bad of [
    null, undefined, 42, '',
    'not-a-uuid',
    '4b1f9a2e-6c3d-4e11-8a9f-2d5b7c9e0a1', // one hex short
    '4b1f9a2e-6c3d-4e11-8a9f-2d5b7c9e0a111', // one hex long
    '$(touch /tmp/pwned)',
    '4b1f9a2e-6c3d-4e11-8a9f-2d5b7c9e0a11; rm -rf /',
  ]) {
    assert.equal(isSessionId(bad), false, JSON.stringify(bad));
  }
});

test('SESSION_ID_PATTERN is exported so a caller can build its own message around a rejected id', () => {
  assert.ok(SESSION_ID_PATTERN instanceof RegExp);
  assert.equal(SESSION_ID_PATTERN.test('4b1f9a2e-6c3d-4e11-8a9f-2d5b7c9e0a11'), true);
});

/* ------------------------------------------------------------------- held */

test('parseHeldSessions keeps only non-empty strings, de-duplicated, and never throws on a malformed file', () => {
  assert.deepEqual(parseHeldSessions(['a', 'b', 'a', '', 42, null, 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseHeldSessions(null), []);
  assert.deepEqual(parseHeldSessions(undefined), []);
  assert.deepEqual(parseHeldSessions('not-an-array'), []);
  assert.deepEqual(parseHeldSessions({ a: 1 }), []);
});

test('heldSessionsHas is case-blind, like handoff.ts\'s own guard - the CLI lower-cases ids before argv', () => {
  const held = new Set(['ABC-123']);
  assert.equal(heldSessionsHas(held, 'abc-123'), true);
  assert.equal(heldSessionsHas(held, 'ABC-123'), true);
  assert.equal(heldSessionsHas(held, 'xyz-999'), false);
  assert.equal(heldSessionsHas(held, ''), false);
  assert.equal(heldSessionsHas([], 'abc-123'), false, 'an empty registry holds nothing');
});

/* ------------------------------------------------------------------ launch */

function fakePorts(overrides = {}) {
  const calls = { spawn: [], clipboard: [], notice: [] };
  const ports = {
    terminalPlugin: null,
    // `opts` (cwd, windowsVerbatimArguments, onExit, onError) is captured
    // whole so a test can inspect it without every OTHER test needing to
    // know its shape - most tests only ever look at `file` and `args`.
    spawn: { spawnDetached: (file, args, opts) => calls.spawn.push([file, args, opts]) },
    clipboard: { writeText: async (text) => calls.clipboard.push(text) },
    notice: { show: (message, ms) => calls.notice.push([message, ms]) },
    ...overrides,
  };
  return { ports, calls };
}

/** A fake spawn that immediately reports failure through whichever handler
 * `opts` carries - a synchronous stand-in for a real child's async `exit`/
 * `error` event, so a test does not need a real process to prove the caller
 * reacts correctly. */
function failingSpawn(mode, code) {
  return (file, args, opts) => {
    if (mode === 'exit') opts?.onExit?.(code ?? 1);
    else opts?.onError?.(new Error('ENOENT'));
  };
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

test('macOS with no Terminal plugin spawns osascript with an ARGUMENT ARRAY, never a shell string, cwd riding the spawn options', () => {
  return (async () => {
    const { ports, calls } = fakePorts();
    const route = await launchRemoteControlTerminal(REQ, ports);
    assert.equal(route, 'os-terminal');
    assert.equal(calls.spawn.length, 1);
    const [file, args, opts] = calls.spawn[0];
    assert.equal(file, 'osascript');
    assert.deepEqual(args.slice(0, 1), ['-e']);
    assert.equal(args.length, 2, 'osascript gets -e plus ONE script argument, never a joined shell string');
    assert.match(args[1], /tell application "Terminal" to do script/);
    // The command line's own quoting survives inside the AppleScript literal.
    assert.match(args[1], /--remote-control/);
    assert.equal(opts.cwd, REQ.cwd, 'Flint HIGH / Vex M2: every OS route carries the vault as its cwd');
  })();
});

test('Windows: cwd rides both the /D flag AND the native spawn cwd, and the tail after /c is ONE verbatim string (Flint HIGH + MEDIUM)', async () => {
  const { ports, calls } = fakePorts();
  const cwd = 'C:\\Users\\Tom\\My Vault';
  const route = await launchRemoteControlTerminal({ ...REQ, platform: 'win32', cwd }, ports);
  assert.equal(route, 'os-terminal');
  const [file, args, opts] = calls.spawn[0];
  assert.equal(file, 'cmd');
  assert.equal(args.length, 2, 'the whole tail is one string, not loose tokens Node would re-quote individually');
  assert.equal(args[0], '/c');
  assert.equal(args[1], `start "" /D ${quoteWindows(cwd)} cmd /k ${REQ.commandLine}`);
  assert.match(args[1], /^start "" \/D /, 'the empty title comes first, so /D is never mistaken for the title (Flint HIGH)');
  assert.equal(opts.cwd, cwd);
  assert.equal(opts.windowsVerbatimArguments, true,
    'Flint MEDIUM: without this, Node re-escapes a string command.ts already quoted for cmd.exe once - two quoting layers is the classic breakage. UNVERIFIED on a real Windows machine.');
});

test('Linux: the emulator gets -e plus the command, and its OWN cwd rides the spawn options (Flint HIGH + Vex M2)', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal(
    { ...REQ, platform: 'linux', linuxTerminalPath: '/usr/bin/x-terminal-emulator' },
    ports,
  );
  assert.equal(route, 'os-terminal');
  const [file, args, opts] = calls.spawn[0];
  assert.equal(file, '/usr/bin/x-terminal-emulator');
  assert.deepEqual(args, ['-e', REQ.commandLine]);
  assert.equal(opts.cwd, REQ.cwd, 'most terminal emulators start their shell in the spawning process\'s own cwd');
});

test('Linux with no terminal emulator found copies instead of guessing at a binary name', async () => {
  const { ports, calls } = fakePorts();
  const route = await launchRemoteControlTerminal({ ...REQ, platform: 'linux', linuxTerminalPath: null }, ports);
  assert.equal(route, 'clipboard');
  assert.deepEqual(calls.clipboard, [REQ.commandLine]);
  assert.equal(calls.spawn.length, 0);
});

/* ---------------------------------------------------------- spawn failure */

test('spawnFailureMessage names the macOS Automation fix specifically, and stays generic elsewhere', () => {
  assert.match(spawnFailureMessage('darwin'), /System Settings/);
  assert.match(spawnFailureMessage('darwin'), /Automation/);
  assert.doesNotMatch(spawnFailureMessage('win32'), /System Settings/);
  assert.doesNotMatch(spawnFailureMessage('linux'), /System Settings/);
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.match(spawnFailureMessage(platform), /command is copied/);
  }
});

test('a non-zero exit on macOS (the denied-Automation shape, Flint MEDIUM) copies the command, shows the fix, and fires onSpawnFailure', async () => {
  const { ports, calls } = fakePorts({ spawn: { spawnDetached: failingSpawn('exit', 1) } });
  let rolledBack = false;
  ports.onSpawnFailure = () => { rolledBack = true; };
  const route = await launchRemoteControlTerminal(REQ, ports);
  assert.equal(route, 'os-terminal', 'the route name reflects what was ATTEMPTED; the failure is reported separately');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rolledBack, true);
  assert.deepEqual(calls.clipboard, [REQ.commandLine]);
  assert.match(calls.notice.at(-1)[0], /System Settings/);
});

test('a spawn error event (a missing binary or a dead symlink) copies the command, shows the generic fix, and fires onSpawnFailure', async () => {
  const { ports, calls } = fakePorts({
    spawn: { spawnDetached: failingSpawn('error') },
    linuxTerminalPath: '/usr/bin/x-terminal-emulator',
  });
  let rolledBack = false;
  ports.onSpawnFailure = () => { rolledBack = true; };
  const route = await launchRemoteControlTerminal(
    { ...REQ, platform: 'linux', linuxTerminalPath: '/usr/bin/x-terminal-emulator' },
    ports,
  );
  assert.equal(route, 'os-terminal');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rolledBack, true);
  assert.deepEqual(calls.clipboard, [REQ.commandLine]);
  assert.match(calls.notice.at(-1)[0], /could not open a terminal automatically/);
});

test('exit code 0 is success: no clipboard copy, no failure notice, onSpawnFailure never fires', async () => {
  const { ports, calls } = fakePorts({ spawn: { spawnDetached: failingSpawn('exit', 0) } });
  let rolledBack = false;
  ports.onSpawnFailure = () => { rolledBack = true; };
  await launchRemoteControlTerminal(REQ, ports);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rolledBack, false);
  assert.equal(calls.clipboard.length, 0);
});

test('both an error event and a later non-zero exit for the same launch report failure only ONCE', async () => {
  const { ports, calls } = fakePorts({
    spawn: {
      spawnDetached: (file, args, opts) => {
        opts?.onError?.(new Error('ENOENT'));
        opts?.onExit?.(1);
      },
    },
  });
  let failures = 0;
  ports.onSpawnFailure = () => { failures += 1; };
  await launchRemoteControlTerminal(REQ, ports);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(failures, 1);
  assert.equal(calls.clipboard.length, 1);
});
