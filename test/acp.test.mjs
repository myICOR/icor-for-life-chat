/* The ACP runtimes, asserted headless.
 *
 * Two sources of truth. `test/fixtures/acp-gemini-recorded.json` is verbatim
 * wire traffic recorded by `tools/acp-probe.mjs` against Gemini CLI 0.58.0
 * on 2026-09-04: the handshake, and a `session/new` refused for a missing
 * API key (the probe signs nothing in). Everything past the handshake is
 * asserted against synthetic frames written from the protocol specification,
 * marked as such; the day a signed-in recording exists, those frames are
 * replaced and these tests are the first to say where the spec and the agent
 * disagree. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  AcpNormalizer, acpToolInput, acpToolName, agentModeFor, approvalOf, contentText, optionFor, pluginModeFor,
  ACP_RECIPES, ACP_PROVIDER_IDS, isAcpProviderId, recipeCandidates,
  archiveStoreFor, configureArchiveIndex,
  resolveAcpExecutable,
  entriesFromEvents,
} from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GEMINI = JSON.parse(readFileSync(resolve(here, 'fixtures/acp-gemini-recorded.json'), 'utf8'));
const CWD = GEMINI.cwd;

/* ------------------------------------------------------------ the recording */

test('the Gemini recording is what the header says: a handshake, then a session refused for auth', () => {
  assert.deepEqual(GEMINI.command, ['gemini', '--acp']);
  assert.equal(GEMINI.agentInfo.name, 'gemini-cli');
  assert.equal(GEMINI.protocolVersion, 1);
  assert.equal(GEMINI.agentCapabilities.loadSession, true, 'Gemini advertises session/load');
  assert.deepEqual(GEMINI.agentCapabilities.promptCapabilities, { image: true, audio: true, embeddedContext: true });
  const methods = GEMINI.authMethods.map((m) => m.id);
  assert.ok(methods.includes('gemini-api-key') && methods.includes('vertex-ai'), 'the permitted auth routes are advertised');
  assert.equal(GEMINI.sessionNewError.code, -32000);
  assert.match(GEMINI.sessionNewError.message, /API key is missing/);
  assert.deepEqual(GEMINI.updatesSeen, [], 'no update was seen, so nothing below is measured against Gemini');
  const clientMethods = GEMINI.frames.filter((f) => f.dir === 'client').map((f) => f.frame.method);
  assert.ok(!clientMethods.includes('authenticate'), 'the probe signed in');
});

test('the recipe table states what is measured, and only Gemini is', () => {
  assert.deepEqual(ACP_PROVIDER_IDS, ['gemini', 'copilot', 'opencode', 'qwen']);
  assert.equal(ACP_RECIPES.gemini.measured, true);
  for (const id of ['copilot', 'opencode', 'qwen']) assert.equal(ACP_RECIPES[id].measured, false, `${id} claims a recording that does not exist`);
  for (const id of ACP_PROVIDER_IDS) {
    assert.ok(ACP_RECIPES[id].installation.command && ACP_RECIPES[id].installation.page);
    assert.ok(ACP_RECIPES[id].args.length > 0, `${id} has no ACP flag`);
  }
  assert.equal(isAcpProviderId('gemini'), true);
  assert.equal(isAcpProviderId('claude'), false);
  assert.doesNotMatch(ACP_RECIPES.gemini.authHint, /free|personal Google/i, 'the Gemini row promises the tier Google ended');
});

/* ----------------------------------------------------- the session event */

test('session/new becomes one session event carrying the id, the runtime, and the mode the agent is in', () => {
  const n = new AcpNormalizer(CWD);
  const events = n.sessionEvent({
    sessionId: 'sess-1', cwd: CWD, currentModeId: 'plan', availableModes: [{ id: 'plan', name: 'Plan' }], provider: 'gemini',
  }, 'default');
  assert.equal(events.length, 1);
  const s = events[0];
  assert.equal(s.kind, 'session');
  assert.equal(s.provider, 'gemini');
  assert.equal(s.sessionId, 'sess-1');
  assert.equal(s.permissionMode, 'plan', 'the agent said plan; the request said default; the agent wins');
  assert.equal(s.model, '', 'no model is reported on the handshake, so none is claimed');
  assert.equal(s.contextWindow, null);
});

/* --------------------------------------------- the update path, per spec */

function updates(n, list) {
  const out = [];
  for (const u of list) out.push(...n.update(u));
  return out;
}

test('a turn per spec: thought, text, a tool call that completes, more text, then an end_turn with unmeasured usage', () => {
  const n = new AcpNormalizer(CWD);
  n.promptStarted(1000);
  const events = updates(n, [
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Let me look.' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo.' } },
    { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read notes/x.md', kind: 'read', status: 'pending', locations: [{ path: `${CWD}/notes/x.md` }] },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'line one\nline two' } }] },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
  ]);
  events.push(...n.promptDone('end_turn', 3500));
  assert.deepEqual(events.map((e) => e.kind), [
    'thinking-open', 'thinking-delta',
    'thinking-final', 'text-open', 'text-delta',
    'text-delta',
    'text-final', 'tool-call',
    'tool-result',
    'text-open', 'text-delta',
    'text-final', 'turn-end',
  ]);
  const call = events.find((e) => e.kind === 'tool-call');
  assert.equal(call.name, 'Read');
  assert.equal(call.purpose, 'Read notes/x.md', 'a read reads like a Claude read');
  assert.equal(call.target, 'notes/x.md');
  const result = events.find((e) => e.kind === 'tool-result');
  assert.equal(result.ok, true);
  assert.equal(result.detail, 'line one');
  const finals = events.filter((e) => e.kind === 'text-final').map((e) => e.text);
  assert.deepEqual(finals, ['Hello.', 'Done.'], 'a tool row splits the prose into two blocks in order');
  const end = events[events.length - 1];
  assert.equal(end.isError, false);
  assert.equal(end.text, 'Done.');
  assert.equal(end.durationMs, 2500);
  assert.equal(end.usage.totalTokens, 0, 'no usage is published, so the total is zero and the strip prints nothing');
  assert.equal(end.contextWindow, null);
});

test('a cancelled prompt aborts, a refusal errors, and a failed request errors with a closed turn', () => {
  const n = new AcpNormalizer(CWD);
  assert.deepEqual(n.promptDone('cancelled').map((e) => e.kind), ['aborted']);
  assert.deepEqual(n.promptDone('refusal').map((e) => e.kind), ['error', 'turn-end']);
  assert.equal(n.promptDone('refusal')[1].isError, true);
  const failed = n.promptFailed('Gemini API key is missing or not configured.');
  assert.deepEqual(failed.map((e) => e.kind), ['error', 'turn-end']);
  assert.match(failed[0].message, /API key is missing/);
});

test('frames the plugin does not model yield no events and never throw', () => {
  const n = new AcpNormalizer(CWD);
  assert.deepEqual(n.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } }), []);
  assert.deepEqual(n.update({ sessionUpdate: 'available_commands_update', availableCommands: [] }), []);
  assert.deepEqual(n.update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }), []);
  assert.deepEqual(n.update({ sessionUpdate: 'something/new' }), []);
  assert.deepEqual(n.update(null), []);
  assert.deepEqual(n.update('garbage'), []);
  assert.deepEqual(n.update({ sessionUpdate: 'tool_call' }), [], 'a tool call without an id is nothing');
});

test('a tool update for a call never announced still gets its row, and a failed one reads as failed', () => {
  const n = new AcpNormalizer(CWD);
  const events = n.update({ sessionUpdate: 'tool_call_update', toolCallId: 'x9', title: 'Run `ls -la`', kind: 'execute', status: 'failed', rawOutput: 'no such directory' });
  assert.deepEqual(events.map((e) => e.kind), ['tool-call', 'tool-result']);
  assert.equal(events[0].name, 'Bash');
  assert.equal(events[0].purpose, 'Run `ls -la`', 'the agent\'s own title is the sentence');
  assert.equal(events[1].ok, false);
  assert.equal(events[1].detail, 'no such directory');
});

test('a plan is one TodoWrite row with the entries as its result', () => {
  const n = new AcpNormalizer(CWD);
  const events = n.update({ sessionUpdate: 'plan', entries: [{ content: 'Read the note', status: 'completed' }, { content: 'Write the summary', status: 'pending' }] });
  assert.deepEqual(events.map((e) => e.kind), ['tool-call', 'tool-result']);
  assert.equal(events[0].name, 'TodoWrite');
  assert.equal(events[1].detail, '2 steps');
  assert.match(events[1].output, /\[completed\] Read the note/);
});

test('the tool vocabulary maps every ACP kind onto the plugin\'s names', () => {
  assert.equal(acpToolName('read'), 'Read');
  assert.equal(acpToolName('edit'), 'Edit');
  assert.equal(acpToolName('execute'), 'Bash');
  assert.equal(acpToolName('search'), 'Grep');
  assert.equal(acpToolName('fetch'), 'WebFetch');
  assert.equal(acpToolName('think'), 'TodoWrite');
  assert.equal(acpToolName('other'), 'tool');
  const edit = acpToolInput({ kind: 'edit', title: 'Edit notes/y.md', rawInput: { file_path: `${CWD}/notes/y.md` } }, CWD);
  assert.equal(edit.name, 'Edit');
  assert.equal(edit.purpose, 'Edited notes/y.md');
  const fetch = acpToolInput({ kind: 'fetch', title: 'Fetch docs', rawInput: { url: 'https://example.com/a' } }, CWD);
  assert.equal(fetch.name, 'WebFetch');
  assert.equal(fetch.target, 'https://example.com/a');
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'diff', path: 'p', oldText: 'o', newText: 'n' }]), 'a\np\n--- old\no\n+++ new\nn');
});

/* ---------------------------------------------------------- permissions */

test('a permission request becomes the plugin\'s approval vocabulary, and the answer is the agent\'s own option id', () => {
  const shaped = approvalOf({
    sessionId: 's', toolCall: { toolCallId: 'c7', title: 'Run `rm -rf build`', kind: 'execute', rawInput: { command: 'rm -rf build' } },
    options: [{ optionId: 'o-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'o-always', name: 'Always', kind: 'allow_always' }, { optionId: 'o-no', name: 'Reject', kind: 'reject_once' }],
  }, CWD);
  assert.equal(shaped.toolUseId, 'c7');
  assert.equal(shaped.toolName, 'Bash');
  assert.equal(shaped.target, 'rm -rf build');
  const options = [{ optionId: 'o-once', kind: 'allow_once' }, { optionId: 'o-always', kind: 'allow_always' }, { optionId: 'o-no', kind: 'reject_once' }];
  assert.equal(optionFor('allow-once', options), 'o-once');
  assert.equal(optionFor('allow-always', options), 'o-always');
  assert.equal(optionFor('deny', options), 'o-no');
  assert.equal(optionFor('deny', [{ optionId: 'y', kind: 'allow_once' }]), null, 'no reject option means a cancel, never a forged allow');
  assert.equal(approvalOf({ toolCall: {} }, CWD), null);
});

/* ---------------------------------------------------------------- modes */

test('the plugin\'s modes map onto the agent\'s advertised modes by name, and an absent mode is null', () => {
  const gemini = [{ id: 'default' }, { id: 'auto_edit' }, { id: 'plan' }, { id: 'yolo' }];
  assert.equal(agentModeFor('default', gemini), 'default');
  assert.equal(agentModeFor('acceptEdits', gemini), 'auto_edit');
  assert.equal(agentModeFor('plan', gemini), 'plan');
  assert.equal(agentModeFor('bypassPermissions', gemini), 'yolo');
  assert.equal(agentModeFor('plan', [{ id: 'default' }]), null, 'no plan mode means no plan mode, not the nearest one');
  assert.equal(pluginModeFor('unheard-of'), null);
  assert.equal(pluginModeFor('bypassPermissions'), 'bypassPermissions');
});

/* ------------------------------------------------------ the archive store */

test('the archive-backed store lists and reads only its own runtime, and answers nothing before the index is set', async () => {
  configureArchiveIndex(null);
  const empty = archiveStoreFor('gemini');
  assert.deepEqual(await empty.list('/v', 5), []);
  assert.equal(await empty.exists('a', '/v'), false);
  const rows = {
    gemini: [{ sessionId: 'g1', title: 'One', startedAt: 10, endedAt: 20 }, { sessionId: 'g2', title: 'Two', startedAt: 30, endedAt: 40 }],
    copilot: [{ sessionId: 'c1', title: 'Other', startedAt: 50, endedAt: 60 }],
  };
  configureArchiveIndex({
    async list(provider) { return rows[provider] ?? []; },
    async read(provider, id) {
      const row = (rows[provider] ?? []).find((r) => r.sessionId === id);
      return row ? { ...row, entries: [{ spoken: 'hi', events: [], messageId: null }, { spoken: 'again', events: [], messageId: null }] } : null;
    },
  });
  const store = archiveStoreFor('gemini');
  assert.deepEqual((await store.list('/v', 5)).map((s) => s.sessionId), ['g2', 'g1'], 'newest first');
  assert.equal(await store.exists('g1', '/v'), true);
  assert.equal(await store.exists('c1', '/v'), false, 'another runtime\'s session is not this runtime\'s');
  assert.equal(await store.createdAt('g2', '/v'), 30);
  const replay = await store.read('g1', '/v', 1);
  assert.equal(replay.omitted, 1);
  assert.equal(replay.entries[0].spoken, 'again');
  configureArchiveIndex(null);
});

test('stored events cut into one entry per user turn', () => {
  const entries = entriesFromEvents([
    { kind: 'user-turn', text: 'first', contextNote: null, contextPath: null, images: [], stream: null },
    { kind: 'text-final', blockId: 'b', text: 'answer', stream: null },
    { kind: 'user-turn', text: 'second', contextNote: null, contextPath: null, images: [], stream: null },
  ]);
  assert.deepEqual(entries.map((e) => [e.spoken, e.events.length]), [['first', 1], ['second', 0]]);
});

/* ------------------------------------------------------------- detection */

test('detection finds the recipe\'s own location after PATH, and reports not found in words', () => {
  const env = { platform: 'darwin', home: '/Users/t', path: '/usr/bin', extra: [], configured: '' };
  const shim = `/Users/t/${'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli'}/copilot`;
  assert.deepEqual(recipeCandidates(ACP_RECIPES.copilot, 'darwin', '/Users/t'), [shim]);
  assert.equal(resolveAcpExecutable(ACP_RECIPES.copilot, env, (p) => p === shim), shim);
  assert.throws(() => resolveAcpExecutable(ACP_RECIPES.gemini, env, () => false), /gemini was not found/);
  assert.throws(() => resolveAcpExecutable(ACP_RECIPES.gemini, { ...env, configured: '/nope/gemini' }, () => false), /does not point at a file/);
});
