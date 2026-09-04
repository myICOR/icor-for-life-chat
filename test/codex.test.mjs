/* The Codex provider, asserted headless.
 *
 * Three sources of truth. `test/fixtures/codex-recorded-turn.json` is verbatim
 * wire traffic recorded by `tools/codex-probe.mjs` against a SIGNED-IN
 * codex-cli 0.153.2 on 2026-09-04: the handshake, a thread start, one turn that
 * ran a shell command behind an approval request and answered "Done.", one long
 * turn interrupted mid-stream, the store calls and the catalogue.
 * `test/fixtures/codex-recorded-signed-out.json` is the earlier recording from
 * the same day with a revoked sign-in, kept for the failure path. `synthetic()`
 * below holds the schema shapes for item kinds the live turn did not exercise
 * (file changes, a failing command). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CodexNormalizer, replayFromThread, rateLimitFrom, codexToolInput,
  codexMode, codexModeLabel,
  modelChoicesOf,
  defaultModelFromConfig, signedInFrom,
  handoverText,
  providerOptions, DEFAULT_SETTINGS,
} from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RECORDED = JSON.parse(readFileSync(resolve(here, 'fixtures/codex-recorded-turn.json'), 'utf8'));
const SIGNED_OUT = JSON.parse(readFileSync(resolve(here, 'fixtures/codex-recorded-signed-out.json'), 'utf8'));
const CWD = RECORDED.cwd;

/** The server's answer to the FIRST client request with this method. */
function responseTo(method) {
  const req = RECORDED.frames.find((f) => f.dir === 'client' && f.frame.method === method && f.frame.id !== undefined);
  assert.ok(req, `the recording has no ${method} request`);
  const res = RECORDED.frames.find((f) => f.dir === 'server' && f.frame.id === req.frame.id && f.frame.method === undefined);
  assert.ok(res, `the recording has no answer to ${method}`);
  return res.frame;
}

function notifications(recording = RECORDED) {
  return recording.frames
    .filter((f) => f.dir === 'server' && f.frame.method !== undefined && f.frame.id === undefined)
    .map((f) => f.frame);
}

function responseIn(recording, method) {
  const req = recording.frames.find((f) => f.dir === 'client' && f.frame.method === method && f.frame.id !== undefined);
  const res = recording.frames.find((f) => f.dir === 'server' && f.frame.id === req.frame.id && f.frame.method === undefined);
  return res.frame;
}

/* ------------------------------------------------------------ the recording */

test('the recording is what the header says: a handshake, a thread, one completed turn, one interrupted, the store calls', () => {
  const methods = RECORDED.frames.filter((f) => f.dir === 'client' && f.frame.method).map((f) => f.frame.method);
  for (const m of ['initialize', 'initialized', 'thread/start', 'turn/start', 'turn/interrupt', 'thread/list', 'thread/read', 'model/list', 'account/read', 'thread/fork']) {
    assert.ok(methods.includes(m), `${m} was never sent`);
  }
  const completed = notifications().filter((n) => n.method === 'turn/completed');
  assert.deepEqual(completed.map((n) => n.params.turn.status), ['completed', 'interrupted']);
  const approvals = RECORDED.frames.filter((f) => f.dir === 'server' && f.frame.method === 'item/commandExecution/requestApproval');
  assert.equal(approvals.length, 1, 'the shell command asked for approval once');
});

test('thread/start becomes one session event carrying the thread id, the model and the provider', () => {
  const n = new CodexNormalizer(CWD);
  const events = n.sessionEvent(responseTo('thread/start').result, codexMode('plan'));
  assert.equal(events.length, 1);
  const s = events[0];
  assert.equal(s.kind, 'session');
  assert.equal(s.provider, 'codex');
  assert.match(s.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(s.permissionMode, 'plan', 'read-only plus on-request reads back as plan');
  assert.equal(s.contextWindow, null, 'no context window was measured, so none is claimed');
});

test('the live turn replays as reasoning, one Bash row with its result, the streamed answer, and a measured turn end', () => {
  const n = new CodexNormalizer(CWD);
  const events = [];
  for (const frame of notifications()) events.push(...n.notification(frame.method, frame.params));
  const kinds = events.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'turn-end').length, 1, 'the completed turn ends once');
  assert.equal(kinds.filter((k) => k === 'aborted').length, 1, 'the interrupted turn aborts, never ends');
  const calls = events.filter((e) => e.kind === 'tool-call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Bash');
  assert.match(calls[0].target, /probe\.txt/, 'the row opens onto the raw command');
  const results = events.filter((e) => e.kind === 'tool-result');
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  const finals = events.filter((e) => e.kind === 'text-final');
  assert.equal(finals[0].text, 'Done.');
  assert.ok(events.filter((e) => e.kind === 'text-delta').length > 10, 'the answer streamed as deltas');
  const end = events.find((e) => e.kind === 'turn-end');
  assert.equal(end.isError, false);
  assert.ok(end.usage.totalTokens > 0 && end.usage.inputTokens > 0 && end.usage.outputTokens > 0, 'usage is measured from the wire');
  /* The wire's own numbers, so the cached-inside-input rule is held against
     the recording and not only against a synthetic frame. */
  const wire = notifications().filter((n) => n.method === 'thread/tokenUsage/updated').map((n) => n.params.tokenUsage.total);
  const last = wire[wire.length - 1];
  assert.equal(end.usage.cacheReadTokens, last.cachedInputTokens);
  assert.equal(end.usage.inputTokens, last.inputTokens - last.cachedInputTokens, 'cached tokens counted once, not inside input as well');
  assert.equal(end.usage.totalTokens, last.totalTokens);
  assert.ok(end.durationMs > 0);
  assert.ok(kinds.indexOf('tool-call') < kinds.indexOf('text-final'), 'the command ran before the answer');
});

test('a failed turn (signed-out recording) replays as an error event and a turn-end that says isError, and nothing throws', () => {
  const n = new CodexNormalizer(SIGNED_OUT.cwd);
  const kinds = [];
  for (const frame of notifications(SIGNED_OUT)) {
    for (const e of n.notification(frame.method, frame.params)) kinds.push(e.kind);
  }
  assert.deepEqual(kinds, ['error', 'turn-end', 'error', 'turn-end']);
});

test('frames the plugin does not model yield no events: status changes, MCP startup, remote control', () => {
  const n = new CodexNormalizer(CWD);
  for (const method of ['thread/status/changed', 'mcpServer/startupStatus/updated', 'remoteControl/status/changed', 'thread/started', 'turn/started', 'item/started']) {
    const frame = notifications().find((f) => f.method === method);
    if (!frame) continue;
    assert.deepEqual(n.notification(frame.method, frame.params), [], `${method} produced events`);
  }
  assert.deepEqual(n.notification('something/new', { anything: 1 }), []);
  assert.deepEqual(n.notification('item/completed', null), []);
  assert.deepEqual(n.notification('item/completed', { item: 'not a record' }), []);
});

test('the catalogue comes from model/list, hidden rows stay hidden, and efforts are the four the plugin knows', () => {
  const choices = modelChoicesOf(responseTo('model/list').result);
  assert.ok(choices.length > 0, 'the recording served a catalogue while signed out');
  const gpt = choices.find((c) => c.value === 'gpt-5.5');
  assert.ok(gpt, 'gpt-5.5 is in the catalogue');
  assert.equal(gpt.displayName, 'GPT-5.5');
  assert.deepEqual(gpt.supportedEffortLevels, ['low', 'medium', 'high', 'xhigh']);
  assert.ok(choices.every((c) => c.value && c.displayName), 'no row without a name');
});

test('account/read reads signedIn from the wire: true in the live recording, false when signed out, never null for a real answer', () => {
  assert.equal(signedInFrom(responseTo('account/read').result), true);
  assert.equal(signedInFrom(responseIn(SIGNED_OUT, 'account/read').result), false);
  assert.equal(signedInFrom({ account: { type: 'chatgpt', planType: 'plus' } }), true);
  assert.equal(signedInFrom(undefined), null);
  assert.equal(signedInFrom('garbage'), null);
});

test('a stored thread replays as entries: the user\'s words, then the completed items', () => {
  const entries = replayFromThread(responseTo('thread/read').result.thread, CWD);
  assert.ok(entries.length >= 1);
  assert.match(entries[0].spoken, /^Run exactly one shell command/);
  assert.ok(Array.isArray(entries[0].events));
});

/* ------------------------------------------------------- the schema path */

function synthetic(n) {
  const out = [];
  const push = (m, p) => out.push(...n.notification(m, p));
  push('item/started', { item: { type: 'reasoning', id: 'r1' }, threadId: 't', turnId: 'u' });
  push('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'think', threadId: 't', turnId: 'u' });
  push('item/completed', { item: { type: 'reasoning', id: 'r1', summary: ['thought'], content: [] } });
  push('item/started', { item: { type: 'commandExecution', id: 'c1', command: 'ls -la', commandActions: [{ type: 'listFiles', command: 'ls -la', path: `${CWD}/sub` }], status: 'inProgress' } });
  push('item/completed', { item: { type: 'commandExecution', id: 'c1', command: 'ls -la', commandActions: [], status: 'completed', exitCode: 0, aggregatedOutput: 'a.md\nb.md\n' } });
  push('item/started', { item: { type: 'commandExecution', id: 'c2', command: 'cat x', commandActions: [{ type: 'read', command: 'cat x', name: 'x', path: `${CWD}/notes/x.md` }] } });
  push('item/completed', { item: { type: 'commandExecution', id: 'c2', command: 'cat x', status: 'failed', exitCode: 1, aggregatedOutput: 'no such file' } });
  push('item/completed', { item: { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: `${CWD}/notes/y.md`, kind: 'update', diff: '+hello' }] } });
  push('item/started', { item: { type: 'agentMessage', id: 'a1' } });
  push('item/agentMessage/delta', { itemId: 'a1', delta: 'Hel' });
  push('item/agentMessage/delta', { itemId: 'a1', delta: 'lo' });
  push('item/completed', { item: { type: 'agentMessage', id: 'a1', text: 'Hello' } });
  push('thread/tokenUsage/updated', { threadId: 't', turnId: 'u', tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10, reasoningOutputTokens: 3, totalTokens: 150 }, last: {}, modelContextWindow: 200000 } });
  push('turn/completed', { threadId: 't', turn: { id: 'u', status: 'completed', error: null, durationMs: 1234 } });
  return out;
}

test('the model-output path, per schema: rows keyed by item id, purposes in the plugin\'s words, usage on the turn end', () => {
  const events = synthetic(new CodexNormalizer(CWD));
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, [
    'thinking-open', 'thinking-delta', 'thinking-final',
    'tool-call', 'tool-result',
    'tool-call', 'tool-result',
    'tool-call', 'tool-result',
    'text-open', 'text-delta', 'text-delta', 'text-final',
    'turn-end',
  ]);
  const calls = events.filter((e) => e.kind === 'tool-call');
  assert.equal(calls[0].name, 'Bash');
  assert.equal(calls[0].purpose, 'Listed files in sub', 'a listFiles action reads as a sentence with the vault-relative path');
  assert.equal(calls[0].target, 'ls -la', 'the raw command is what the row opens onto');
  assert.equal(calls[1].name, 'Read');
  assert.equal(calls[1].purpose, 'Read notes/x.md');
  assert.equal(calls[2].name, 'Edit');
  assert.equal(calls[2].purpose, 'Edited notes/y.md');
  const results = events.filter((e) => e.kind === 'tool-result');
  assert.equal(results[0].ok, true);
  assert.equal(results[0].detail, 'a.md');
  assert.equal(results[1].ok, false, 'exit 1 is a failure');
  assert.equal(results[1].detail, 'no such file');
  assert.equal(results[2].ok, true);
  const end = events[events.length - 1];
  assert.deepEqual(end.usage, { inputTokens: 60, outputTokens: 10, cacheReadTokens: 40, totalTokens: 150, costUsd: 0 });
  assert.equal(end.contextWindow, 200000);
  assert.equal(end.durationMs, 1234);
  assert.equal(end.isError, false);
  assert.equal(end.text, 'Hello');
  // A completed tool that was never started still gets its row (c2's sibling f1 above).
  assert.equal(calls[2].toolUseId, 'f1');
});

test('an interrupted turn is an aborted event, not a turn end', () => {
  const n = new CodexNormalizer(CWD);
  const events = n.notification('turn/completed', { threadId: 't', turn: { id: 'u', status: 'interrupted', error: null } });
  assert.deepEqual(events.map((e) => e.kind), ['aborted']);
});

test('the approval request shapes become the plugin\'s tool vocabulary', () => {
  const cmd = codexToolInput({ type: 'commandExecution', command: 'rm -rf build', commandActions: [] }, CWD);
  assert.equal(cmd.name, 'Bash');
  assert.equal(cmd.purpose, 'Ran a command');
  const file = codexToolInput({ type: 'fileChange', changes: [{ path: `${CWD}/a.md`, kind: 'add', diff: '' }] }, CWD);
  assert.equal(file.name, 'Write');
  assert.equal(file.purpose, 'Wrote a.md');
  const many = codexToolInput({ type: 'fileChange', changes: [{ path: '/x/a.md', kind: 'update' }, { path: '/x/b.md', kind: 'update' }] }, CWD);
  assert.equal(many.purpose, 'Edited 2 files');
});

test('rate limits map the App Server\'s windows and never invent a wall', () => {
  assert.deepEqual(rateLimitFrom({ primary: { usedPercent: 42, resetsAt: 1700000000, windowDurationMins: 300 } }), {
    window: 'five_hour', utilization: 0.42, resetsAt: 1700000000000, status: 'allowed',
  });
  assert.equal(rateLimitFrom({ primary: { usedPercent: 85, windowDurationMins: 10080 } }).status, 'allowed_warning');
  assert.equal(rateLimitFrom({ primary: { usedPercent: 100, windowDurationMins: 1 } }).window, 'unknown');
  assert.equal(rateLimitFrom({}), null);
});

/* ------------------------------------------------------------- the modes */

test('the four modes map onto approval policy times sandbox, and bypass is the only full-access one', () => {
  assert.deepEqual(codexMode('default'), { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
  assert.deepEqual(codexMode('plan'), { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } });
  assert.deepEqual(codexMode('acceptEdits'), { approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
  assert.deepEqual(codexMode('bypassPermissions'), { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } });
  const full = ['default', 'plan', 'acceptEdits', 'bypassPermissions'].filter((m) => codexMode(m).sandbox === 'danger-full-access');
  assert.deepEqual(full, ['bypassPermissions']);
  assert.equal(codexModeLabel('default'), 'on-request, workspace-write');
});

/* ------------------------------------------------------ detection facts */

test('the default model is read from config.toml\'s top-level model line, or is null', () => {
  const read = (text) => () => text;
  assert.equal(defaultModelFromConfig('/h', read('model = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n')), 'gpt-5.5');
  assert.equal(defaultModelFromConfig('/h', read('[projects."/x"]\nmodel = "not-top-level"\n')), null);
  assert.equal(defaultModelFromConfig('/h', () => null), null);
  assert.equal(defaultModelFromConfig('', read('model = "x"')), null);
});

test('the runtime dropdown offers only what detection found, plus the stored choice', () => {
  const providers = [{ id: 'claude', displayName: 'Claude Code' }, { id: 'codex', displayName: 'Codex' }];
  const both = providerOptions({ settings: DEFAULT_SETTINGS, catalog: [], defaultArchiveFolder: '', providers, detections: { claude: { found: true }, codex: { found: true } } });
  assert.deepEqual(Object.keys(both), ['claude', 'codex']);
  const one = providerOptions({ settings: DEFAULT_SETTINGS, catalog: [], defaultArchiveFolder: '', providers, detections: { claude: { found: true }, codex: { found: false } } });
  assert.deepEqual(Object.keys(one), ['claude'], 'a runtime that is not there is not offered');
  const stored = providerOptions({ settings: { ...DEFAULT_SETTINGS, defaultProvider: 'codex' }, catalog: [], defaultArchiveFolder: '', providers, detections: { claude: { found: true }, codex: { found: false } } });
  assert.deepEqual(Object.keys(stored), ['claude', 'codex'], 'the stored choice is never dropped by the picker');
});

/* ---------------------------------------------------------- the handover */

test('a continuation carries the transcript\'s words with an honest opening line, and nothing when there are no turns', () => {
  const note = '---\ntitle: "x"\nsource: icor-chat\n---\n\n# x\n\n## You\n\nhello\n\n## The team\n\nhi there\n';
  const text = handoverText(note, 'x');
  assert.match(text, /^This is the transcript of an earlier conversation \("x"\) that ran on a different AI runtime/);
  assert.match(text, /## You\n\nhello/);
  assert.match(text, /tool results, reasoning, approvals and images did not/);
  assert.equal(handoverText('---\ntitle: y\n---\n\n# y\n', 'y'), '');
});
