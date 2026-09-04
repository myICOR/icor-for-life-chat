/* Abort, approval and state: the paths where a hang is the failure mode. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApprovalBroker, toPermissionAnswer, ChatStore, reduce, emptyState,
  skipPermissions, archiveRoot, DEFAULT_SETTINGS,
  contextPreamble, withContext, selectionRangeLabel, MAX_SELECTION_CHARS,
  STRUCTURED_REPLY_PROMPT,
  routeChatLeaf,
} from './build/pure.mjs';

const req = { toolUseId: 't1', toolName: 'Bash', target: 'rm -rf /', title: 'Claude wants to run Bash' };

test('abort during approval resolves the pending promise, it does not hang', async () => {
  const ac = new AbortController();
  const broker = new ApprovalBroker(() => {}, () => {});
  const pending = broker.request(req, ac.signal);
  ac.abort();
  assert.equal(await pending, 'deny');
  assert.equal(broker.size, 0);
});

test('an approval asked on an already-aborted signal denies immediately', async () => {
  const ac = new AbortController();
  ac.abort();
  const broker = new ApprovalBroker(() => {}, () => {});
  assert.equal(await broker.request(req, ac.signal), 'deny');
});

test('closing the broker resolves every outstanding request as a denial', async () => {
  const broker = new ApprovalBroker(() => {}, () => {});
  const a = broker.request(req, new AbortController().signal);
  const b = broker.request({ ...req, toolUseId: 't2' }, new AbortController().signal);
  broker.close();
  assert.deepEqual(await Promise.all([a, b]), ['deny', 'deny']);
});

test('an answer settles once; a second answer changes nothing', async () => {
  const settled = [];
  const broker = new ApprovalBroker(() => {}, (id, choice) => settled.push([id, choice]));
  const p = broker.request(req, new AbortController().signal);
  broker.answer('t1', 'allow-once');
  broker.answer('t1', 'deny');
  assert.equal(await p, 'allow-once');
  assert.deepEqual(settled, [['t1', 'allow-once']]);
});

test('the widest grant only widens when the SDK offered a suggestion to widen', () => {
  assert.deepEqual(toPermissionAnswer('deny', { a: 1 }, [{ x: 1 }]).behavior, 'deny');
  assert.equal(toPermissionAnswer('allow-once', { a: 1 }, [{ x: 1 }]).updatedPermissions, undefined);
  assert.deepEqual(toPermissionAnswer('allow-always', { a: 1 }, [{ x: 1 }]).updatedPermissions, [{ x: 1 }]);
  assert.equal(toPermissionAnswer('allow-always', { a: 1 }, undefined).updatedPermissions, undefined);
});

test('a subagent still running when the turn closes is orphaned, not spinning', () => {
  let s = emptyState();
  s = reduce(s, { kind: 'subagent-start', agentId: 'a', agentType: 'pax', description: 'd', stream: null });
  s = reduce(s, { kind: 'subagent-start', agentId: 'b', agentType: 'quinn', description: 'e', stream: null });
  s = reduce(s, { kind: 'subagent-end', agentId: 'b', ok: true, stream: null });
  s = reduce(s, {
    kind: 'turn-end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, totalTokens: 2, costUsd: 0 },
    durationMs: 10, isError: false, text: '', stream: null,
  });
  assert.equal(s.subagents.a.status, 'orphaned');
  assert.equal(s.subagents.b.status, 'done');
  assert.equal(s.status, 'idle');
});

test('an abort settles the turn without marking it an error', () => {
  let s = reduce(emptyState(), { kind: 'user-turn', text: 'hi', contextNote: null, stream: null });
  assert.equal(s.status, 'streaming');
  s = reduce(s, { kind: 'aborted', stream: null });
  assert.equal(s.status, 'idle');
  assert.equal(s.lastError, null);
});

test('an unknown event never destabilises the store', () => {
  const store = new ChatStore();
  const seen = [];
  const off = store.subscribe((e) => seen.push(e.kind));
  store.apply({ kind: 'text-delta', blockId: 'x', text: 'a', stream: null });
  off();
  store.apply({ kind: 'text-delta', blockId: 'x', text: 'b', stream: null });
  assert.deepEqual(seen, ['text-delta']);
  assert.equal(store.state.status, 'idle');
});

test('skip-permissions is reachable from exactly one mode', () => {
  assert.equal(skipPermissions('bypassPermissions'), true);
  for (const m of ['default', 'plan', 'acceptEdits']) assert.equal(skipPermissions(m), false);
});

test('the archive root follows the vault layout', () => {
  assert.equal(archiveRoot(DEFAULT_SETTINGS, true), '06 AI Team/AI Sessions');
  assert.equal(archiveRoot(DEFAULT_SETTINGS, false), 'AI Sessions');
  assert.equal(archiveRoot({ ...DEFAULT_SETTINGS, archiveFolder: ' Chats ' }, true), 'Chats');
  assert.equal(archiveRoot({ ...DEFAULT_SETTINGS, vaultMode: 'scaffold' }, false), '06 AI Team/AI Sessions');
});

test('the shipped defaults are the safe ones', () => {
  assert.equal(DEFAULT_SETTINGS.defaultPermissionMode, 'default');
  assert.equal(DEFAULT_SETTINGS.cliPath, '');
});

/* Structured replies are the format the whole product is designed around, so a
 * user who never opens settings still gets it. It is not a safety default and
 * does not belong in the test above: it appends a plugin-owned instruction to
 * the system prompt, which is the ONE thing this plugin puts in the team's
 * mouth, and the README says so. Asserted here so the day somebody flips it
 * back is a day the suite argues. */
test('structured replies ship ON', () => {
  assert.equal(DEFAULT_SETTINGS.structuredReplies, true);
});

test('context is sent as a visible preamble, or not at all', () => {
  assert.equal(withContext('go', null), 'go');
  const ctx = { path: 'a/b.md', basename: 'b', selection: 'hello', fromLine: 12, toLine: 48 };
  assert.equal(selectionRangeLabel(ctx), 'L12-48');
  const out = withContext('summarise', ctx);
  assert.ok(out.includes('Open note: a/b.md'));
  assert.ok(out.includes('Selected text (L12-48):'));
  assert.ok(out.endsWith('summarise'));
});

test('a note with no selection sends the note and nothing more', () => {
  const p = contextPreamble({ path: 'a.md', basename: 'a', selection: null, fromLine: null, toLine: null });
  assert.equal(p, 'Open note: a.md');
});

test('a huge selection is truncated and says so', () => {
  const p = contextPreamble({
    path: 'a.md', basename: 'a', selection: 'x'.repeat(MAX_SELECTION_CHARS + 500), fromLine: 1, toLine: 900,
  });
  assert.ok(p.includes('[truncated]'));
  assert.ok(p.length < MAX_SELECTION_CHARS + 200);
});

test('the one prompt the plugin owns is a fixed constant, not a template', () => {
  assert.ok(STRUCTURED_REPLY_PROMPT.includes('ICOR card format'));
  assert.ok(!/\$\{|\{\{/.test(STRUCTURED_REPLY_PROMPT), 'no interpolation may reach the prompt');
});

/* ------------------------------------------------------- the chip tray */

test('a finished chip stays until it is opened or the next send closes the turn', async () => {
  const { SubagentBus } = await import('./build/pure.mjs');
  const bus = new SubagentBus();
  bus.open({ agentId: 'a', agentType: 'pax', description: 'd', task: 't', sessionId: null });
  assert.equal(bus.active().length, 1, 'a running subagent shows');
  bus.close('a', true);
  assert.equal(bus.active().length, 1, 'a finished subagent keeps its chip');
  bus.markOpened('a');
  assert.equal(bus.active().length, 0, 'opening the transcript retires the chip');
});

test('the next user send retires every finished chip, opened or not', async () => {
  const { SubagentBus } = await import('./build/pure.mjs');
  const bus = new SubagentBus();
  bus.open({ agentId: 'a', agentType: 'pax', description: '', task: '', sessionId: null });
  bus.open({ agentId: 'b', agentType: 'quinn', description: '', task: '', sessionId: null });
  bus.close('a', true);
  bus.close('b', false);
  assert.equal(bus.active().length, 2);
  bus.retireFinished();
  assert.equal(bus.active().length, 0);
});

test('a still-running subagent survives the send that retires the finished ones', async () => {
  const { SubagentBus } = await import('./build/pure.mjs');
  const bus = new SubagentBus();
  bus.open({ agentId: 'a', agentType: 'pax', description: '', task: '', sessionId: null });
  bus.open({ agentId: 'b', agentType: 'quinn', description: '', task: '', sessionId: null });
  bus.close('a', true);
  bus.retireFinished();
  assert.deepEqual(bus.active().map((t) => t.agentId), ['b']);
});

test('a subagent left running when the turn closes is orphaned, and says so', async () => {
  const { SubagentBus } = await import('./build/pure.mjs');
  const bus = new SubagentBus();
  bus.open({ agentId: 'a', agentType: 'pax', description: '', task: '', sessionId: null });
  bus.orphanRunning();
  assert.equal(bus.get('a').status, 'orphaned');
  assert.notEqual(bus.get('a').endedAt, null);
});

/* ============ WHEN A SESSION EVENT FIRES, and why a ruling depends on it ====
 *
 * The empty-strip ruling rests on one mechanical fact: a `session` event
 * arrives when a QUERY begins, not at plugin load and not at pane open. If it
 * fired earlier, `START` and `UPD` would have data in a pane where nothing has
 * been sent, and the default set would have to be re-ruled.
 *
 * It is pinned at the SOURCE, because the alternative is asserting on a real
 * Obsidian view, and the claim is about which methods call which. `.start()` is
 * the only thing that constructs a query, so where it is called from IS the
 * answer. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chatView = readFileSync(resolve(repoRoot, 'src/view/ChatView.ts'), 'utf8');
const sessionSrc = readFileSync(resolve(repoRoot, 'src/provider/claude/session.ts'), 'utf8');

/** Comments blanked, line count preserved: the prose here discusses the code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, '');

test('opening the pane does not begin a session', () => {
  const code = strip(chatView);
  const open = code.indexOf('override async onOpen(');
  assert.ok(open > 0, 'onOpen was renamed - this premise is no longer pinned to anything');
  // The method body, to the next member at the same indent.
  const rest = code.slice(open);
  const end = rest.search(/\n  (?:override |private |public |async |get |\/\*\*)/);
  const body = rest.slice(0, end === -1 ? rest.length : end);
  assert.equal(/\.start\(\)/.test(body), false,
    'onOpen starts a session. A session event would then arrive on pane open, and START and UPD ' +
    'would carry data in a pane where nothing has been sent - which re-opens the default ruling.');
  assert.equal(/ensureSession\(/.test(body), false, 'onOpen constructs a session');
});

test('a query begins in exactly two places, and both are deliberate', () => {
  const code = strip(chatView);
  const calls = code.match(/\.start\(\)/g) ?? [];
  assert.equal(calls.length, 1, `ChatView starts a session in ${calls.length} places, not 1`);
  /* The one call site is RESUME, and this is the correction to the premise:
     resuming a stored conversation calls start() with no user turn, so a
     session event DOES arrive without the user sending anything. It does not
     move the ruling - a resumed session is exactly where START and UPD were
     already argued to earn their place - but "only when the user sends" would
     be wrong, and a ruling should rest on the true sentence. */
  const resume = code.indexOf('async resume(');
  assert.ok(resume > 0, 'resume() was renamed');
  const at = code.indexOf('.start()');
  assert.ok(at > resume, 'the one start() call moved out of resume()');
  const after = code.slice(resume);
  const nextMember = after.search(/\n  (?:override |private |public |\/\*\*)/);
  assert.ok(at - resume < nextMember, 'the one start() call is no longer inside resume()');

  // And the other one, in the session itself: sending starts the query.
  assert.match(strip(sessionSrc), /send\([^)]*\)[^{]*\{[\s\S]{0,200}this\.start\(\);/,
    'send() no longer starts the query, so a first message would go nowhere');
});

/* ================= where a chat opens: the right sidebar, never the centre ==
 *
 * Tom, before his video: "a new ICOR chat session should open as a new tab in
 * the right sidepanel, not in the center main area." Two layers of gate,
 * because the two failures are different: the ROUTE (which leaf is chosen or
 * created) is a pure function tested on constructed facts, and the CALL SITE
 * (which workspace API openChat actually reaches for) is pinned at the source,
 * the same way the session-premise is - a real workspace cannot be run
 * headless, and a fake one would only ever agree with itself. */

test('openChat reaches for the RIGHT sidebar, and never the centre, for a chat', () => {
  const code = strip(readFileSync(resolve(repoRoot, 'src/main.ts'), 'utf8'));
  const open = code.indexOf('async openChat(');
  assert.ok(open > 0, 'openChat was renamed - the directive is no longer pinned to anything');
  const rest = code.slice(open);
  const end = rest.search(/\n  (?:override |private |public |async |get |\/\*\*)/);
  const body = rest.slice(0, end === -1 ? rest.length : end);
  assert.match(body, /getRightLeaf\(/,
    'openChat no longer opens in the right sidebar - Tom: "not in the center main area"');
  assert.equal(/getLeaf\(\s*'tab'\s*\)/.test(body), false,
    "openChat still spawns a centre tab - that is the exact behaviour the directive retires");
  assert.match(body, /revealLeaf\(/,
    'openChat never reveals - a collapsed right sidebar would swallow the open silently');
});

test('the subagent transcript keeps its centre tab', () => {
  // The directive names the CHAT. A subagent transcript is a reading surface
  // the user opens deliberately, and nothing ruled it out of the centre - so
  // this pins that the change did not leak wider than its brief.
  const code = strip(readFileSync(resolve(repoRoot, 'src/main.ts'), 'utf8'));
  const open = code.indexOf('async openSubagent(');
  const rest = code.slice(open);
  const end = rest.search(/\n  (?:override |private |public |async |get |\/\*\*)/);
  const body = rest.slice(0, end === -1 ? rest.length : end);
  assert.match(body, /getLeaf\(\s*'tab'\s*\)/, 'openSubagent moved out of the centre without a ruling');
});

test('the route: reveal beats resume-into beats create-right', () => {
  const L = (id, sessionId, occupied) => ({ leaf: id, facts: { sessionId, occupied } });

  // Nothing exists: a NEW TAB in the right sidebar, never the centre.
  assert.deepEqual(routeChatLeaf([], null), { kind: 'create-right' });
  assert.deepEqual(routeChatLeaf([], 's1'), { kind: 'create-right' });

  // A pane already holding the requested thread is REVEALED, wherever it is,
  // even when an empty pane also exists - resuming a live thread twice would
  // hand the same conversation two owners.
  assert.deepEqual(
    routeChatLeaf([L('a', null, false), L('b', 's1', true)], 's1'),
    { kind: 'reveal', leaf: 'b' },
  );

  // New session with an unoccupied pane on screen: reveal it. Pressing the
  // robot twice must not mint two empty panes.
  assert.deepEqual(
    routeChatLeaf([L('a', null, false)], null),
    { kind: 'reveal', leaf: 'a' },
  );

  // Resume with only an unoccupied pane: the thread lands IN it.
  assert.deepEqual(
    routeChatLeaf([L('a', null, false)], 's9'),
    { kind: 'resume-into', leaf: 'a' },
  );

  // Every pane occupied with OTHER conversations: a second conversation is a
  // second tab (multi-conversation is a feature), and it opens on the right.
  assert.deepEqual(
    routeChatLeaf([L('a', 's1', true), L('b', 's2', true)], null),
    { kind: 'create-right' },
  );
  assert.deepEqual(
    routeChatLeaf([L('a', 's1', true)], 's3'),
    { kind: 'create-right' },
  );

  // A pane mid-send (session object alive, no session id yet) is OCCUPIED and
  // never reused: reuse only ever reveals or resumes, and this pane is busy
  // becoming a conversation.
  assert.deepEqual(
    routeChatLeaf([L('a', null, true)], null),
    { kind: 'create-right' },
  );
});

/* ------------------------------------------------------ the launch permissions */

/* "Clicking Bypass does not bypass", as a unit.
 *
 * The behavioural half of this cannot live here - it is a live CLI, a real tool
 * call, and a file that either appears on disk or does not. That was driven
 * against the real CLI in all four combinations of (launch mode, flag) on
 * 2026-08-31, and the CLI's own refusal was read verbatim before the fix was
 * written. What CAN live here is the invariant that came out of it, which is
 * the thing a future edit would quietly undo: the flag is armed regardless of
 * the launch mode, and arming it never widens the mode. */

import { launchPermissions } from './build/pure.mjs';

test('the launch flag is armed in EVERY mode, not only in the one that needs it', () => {
  for (const mode of ['default', 'plan', 'acceptEdits', 'bypassPermissions']) {
    assert.equal(launchPermissions(mode).allowDangerouslySkipPermissions, true,
      `${mode}: the session cannot enter Bypass later without the launch flag, and the ` +
      `composer's picker acts on a session that is ALREADY RUNNING. Arming the flag only ` +
      `when the launch mode is already bypass arms it exactly when it is not needed.`);
  }
});

test('arming the flag never widens the mode the session starts in', () => {
  // The flag is the CLI's consent to let the mode reach bypass; the mode is
  // what actually decides whether a tool runs unprompted. If this ever starts
  // returning bypass for an ask-mode launch, the plugin has begun granting a
  // permission the user did not grant.
  for (const mode of ['default', 'plan', 'acceptEdits', 'bypassPermissions']) {
    assert.equal(launchPermissions(mode).permissionMode, mode,
      `${mode}: the launcher substituted a different mode`);
  }
  assert.equal(launchPermissions('default').permissionMode, 'default');
});

test('only an explicit Bypass counts as skipping permissions', () => {
  // The flag being universal must not leak into how the rest of the plugin
  // decides whether the user is in the dangerous mode.
  assert.equal(skipPermissions('bypassPermissions'), true);
  for (const mode of ['default', 'plan', 'acceptEdits']) {
    assert.equal(skipPermissions(mode), false, `${mode} reported itself as skipping permissions`);
  }
});

test('Ask is still what ships out of the box', () => {
  assert.equal(DEFAULT_SETTINGS.defaultPermissionMode, 'default',
    'offering Bypass in settings must not change what a fresh install starts in');
});
