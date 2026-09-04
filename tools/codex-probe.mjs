/* Drive `codex app-server` by hand and record every frame.
 *
 * Measurement, not product: the Codex provider is written from what this
 * script saw on a real install, never from a document. Run it whenever the
 * Codex CLI is upgraded; a method that vanishes shows up here first.
 *
 *   node tools/codex-probe.mjs <cwd> [out.json]
 *
 * The turn asks for a file write under a read-only sandbox, so the server has
 * to raise `item/commandExecution/requestApproval` or
 * `item/fileChange/requestApproval` and the approval round trip is on the
 * recording. A second turn is interrupted mid-flight. Then the read-only
 * calls the provider's store and settings need. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

const cwd = process.argv[2];
const out = process.argv[3] ?? null;
if (!cwd) {
  console.error('usage: node tools/codex-probe.mjs <cwd> [out.json]');
  process.exit(2);
}
mkdirSync(cwd, { recursive: true });

const frames = [];
const child = spawn('codex', ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
child.stderr.on('data', (d) => process.stderr.write(`[stderr] ${d}`));

let nextId = 1;
const pending = new Map();
const waiters = [];

function send(frame) {
  frames.push({ dir: 'client', at: Date.now(), frame });
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

/** Resolve the next notification whose method matches, with a timeout. */
function waitFor(match, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${match}`)), timeoutMs);
    waiters.push({ match, resolve: (f) => { clearTimeout(timer); resolve(f); } });
  });
}

const approvals = [];
const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    frames.push({ dir: 'server', at: Date.now(), raw: line });
    return;
  }
  frames.push({ dir: 'server', at: Date.now(), frame });
  if (frame.id !== undefined && frame.method === undefined) {
    const p = pending.get(frame.id);
    if (p) {
      pending.delete(frame.id);
      if (frame.error) p.reject(new Error(`${p.method}: ${JSON.stringify(frame.error)}`));
      else p.resolve(frame.result);
    }
    return;
  }
  if (frame.id !== undefined && frame.method !== undefined) {
    // A server REQUEST: an approval or similar. Answer accept.
    approvals.push(frame);
    console.log(`[server request] ${frame.method} ${JSON.stringify(frame.params).slice(0, 300)}`);
    if (frame.method === 'item/commandExecution/requestApproval' || frame.method === 'item/fileChange/requestApproval') {
      send({ jsonrpc: '2.0', id: frame.id, result: { decision: 'accept' } });
    } else if (frame.method === 'item/permissions/requestApproval') {
      send({ jsonrpc: '2.0', id: frame.id, result: { permissions: frame.params.permissions ?? {}, scope: 'turn' } });
    } else {
      send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'probe declines' } });
    }
    return;
  }
  const method = frame.method ?? '';
  const short = JSON.stringify(frame.params ?? {}).slice(0, 160);
  console.log(`[notify] ${method} ${short}`);
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    const w = waiters[i];
    const hit = typeof w.match === 'string' ? method === w.match : w.match(frame);
    if (hit) {
      waiters.splice(i, 1);
      w.resolve(frame);
    }
  }
});

async function main() {
  const init = await request('initialize', {
    clientInfo: { name: 'icor-for-life-chat-probe', title: 'ICOR probe', version: '0.0.0' },
    capabilities: { experimentalApi: false },
  });
  console.log('[initialize]', JSON.stringify(init).slice(0, 300));
  notify('initialized', {});

  const started = await request('thread/start', {
    cwd,
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
  });
  console.log('[thread/start]', JSON.stringify(started).slice(0, 600));
  const threadId = started.thread.id;

  // Turn 1: needs a write under a read-only sandbox, so an approval is raised.
  const t1 = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Run exactly one shell command that creates a file named probe.txt containing the word hi in the current directory, then tell me in one short line that it is done.' }],
  });
  console.log('[turn/start]', JSON.stringify(t1).slice(0, 300));
  await waitFor((f) => f.method === 'turn/completed' && f.params?.turn?.id === t1.turn.id);

  // Turn 2: long, then interrupted.
  const t2 = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Count slowly from 1 to 200, one number per line, and after every ten numbers write one sentence about the number.' }],
  });
  const firstSignal = await Promise.race([
    waitFor('item/agentMessage/delta', 90000).then(() => 'delta'),
    waitFor((f) => f.method === 'turn/completed' && f.params?.turn?.id === t2.turn.id, 90000).then(() => 'completed'),
  ]).catch(() => 'timeout');
  console.log('[turn 2 first signal]', firstSignal);
  if (firstSignal === 'delta') {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const interrupted = await request('turn/interrupt', { threadId, turnId: t2.turn.id });
      console.log('[turn/interrupt]', JSON.stringify(interrupted).slice(0, 200));
    } catch (e) {
      console.log('[turn/interrupt] ERROR', e.message.slice(0, 200));
    }
    await waitFor((f) => f.method === 'turn/completed' && f.params?.turn?.id === t2.turn.id, 30000).catch((e) => console.log('[warn]', e.message));
  }

  for (const [m, params] of [
    ['thread/list', { cwd, limit: 5, sortKey: 'updated_at' }],
    ['thread/read', { threadId, includeTurns: true }],
    ['model/list', { limit: 20 }],
    ['thread/name/set', { threadId, name: 'probe' }],
  ]) {
    try {
      const r = await request(m, params);
      console.log(`[${m}]`, JSON.stringify(r).slice(0, 1200));
    } catch (e) {
      console.log(`[${m}] ERROR`, e.message.slice(0, 300));
    }
  }
  for (const m of ['account/read', 'account/rateLimits/read']) {
    try {
      const r = await request(m, {});
      console.log(`[${m}]`, JSON.stringify(r).slice(0, 500));
    } catch (e) {
      console.log(`[${m}] ERROR`, e.message.slice(0, 300));
    }
  }
  for (const m of ['thread/fork']) {
    try {
      const r = await request(m, { threadId });
      console.log(`[${m}]`, JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.log(`[${m}] ERROR`, e.message.slice(0, 300));
    }
  }
  console.log('[approvals seen]', approvals.map((a) => a.method));
  if (out) {
    writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), codexVersion: null, cwd, frames }, null, 2));
    console.log('[wrote]', out, frames.length, 'frames');
  }
  child.kill('SIGTERM');
}

main().catch((e) => {
  console.error('[probe failed]', e);
  child.kill('SIGTERM');
  process.exit(1);
});
