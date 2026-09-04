/* Drive an Agent Client Protocol agent by hand and record every frame.
 *
 * usage: node tools/acp-probe.mjs --cwd <dir> --out <file.json> -- <command> [args...]
 *
 * Speaks JSON-RPC 2.0 over the agent's stdio, one JSON object per line, per
 * https://agentclientprotocol.com/protocol/v1/overview. Nothing here is the
 * plugin; the plugin's normaliser is asserted against what this wrote.
 * The probe never signs in and never configures a key: an agent that refuses
 * for auth is recorded refusing, with the auth methods it advertised. */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = {};
for (let i = 0; i < (sep === -1 ? argv.length : sep); i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
const command = sep === -1 ? [] : argv.slice(sep + 1);
if (!opts.cwd || command.length === 0) {
  console.error('usage: node tools/acp-probe.mjs --cwd <dir> [--out <file.json>] -- <command> [args...]');
  process.exit(2);
}
mkdirSync(opts.cwd, { recursive: true });

const frames = [];
const startedAt = Date.now();
const child = spawn(command[0], command.slice(1), { cwd: opts.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let nextId = 1;
const stderr = [];
createInterface({ input: child.stderr }).on('line', (l) => { stderr.push(l); console.error('[stderr]', l.slice(0, 200)); });

function record(dir, frame) {
  frames.push({ dir, at: Date.now(), frame });
}
function write(frame) {
  record('client', frame);
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    write({ jsonrpc: '2.0', id, method, params });
  });
}
function notify(method, params) {
  write({ jsonrpc: '2.0', method, params });
}

const updates = [];
let permissionAnswers = 0;
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  let f;
  try { f = JSON.parse(line); } catch { console.error('[not json]', line.slice(0, 200)); return; }
  record('server', f);
  const short = JSON.stringify(f).slice(0, 220);
  if (f.id !== undefined && f.method === undefined) {
    const p = pending.get(f.id);
    pending.delete(f.id);
    console.log(`[res ${p?.method}]`, short);
    if (!p) return;
    if (f.error) p.reject(Object.assign(new Error(f.error.message), { code: f.error.code, data: f.error.data }));
    else p.resolve(f.result);
    return;
  }
  if (f.id !== undefined && f.method !== undefined) {
    console.log('[server request]', short);
    if (f.method === 'session/request_permission') {
      const options = f.params?.options ?? [];
      const allow = options.find((o) => o.kind === 'allow_once') ?? options[0];
      permissionAnswers += 1;
      write({ jsonrpc: '2.0', id: f.id, result: allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : { outcome: { outcome: 'cancelled' } } });
    } else {
      write({ jsonrpc: '2.0', id: f.id, error: { code: -32601, message: `${f.method} is not supported by this probe` } });
    }
    return;
  }
  if (f.method === 'session/update') updates.push(f.params?.update?.sessionUpdate ?? '?');
  console.log('[notify]', short);
});

function timeout(ms, what) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms));
}

const summary = { command, cwd: opts.cwd, recordedAt: new Date().toISOString() };
try {
  const init = await Promise.race([
    request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'icor-for-life-chat-probe', title: 'ICOR probe', version: '0.0.0' },
    }),
    timeout(30000, 'initialize'),
  ]);
  summary.agentInfo = init?.agentInfo ?? null;
  summary.agentCapabilities = init?.agentCapabilities ?? null;
  summary.authMethods = init?.authMethods ?? [];
  summary.protocolVersion = init?.protocolVersion ?? null;

  let session;
  try {
    session = await Promise.race([request('session/new', { cwd: opts.cwd, mcpServers: [] }), timeout(60000, 'session/new')]);
  } catch (error) {
    summary.sessionNewError = { message: error.message, code: error.code ?? null, data: error.data ?? null };
    console.log('[session/new failed]', error.message);
  }
  if (session?.sessionId) {
    summary.sessionId = session.sessionId;
    summary.modes = session.modes ?? null;
    summary.configOptions = session.configOptions ?? null;
    const first = await Promise.race([
      request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Run exactly one shell command that creates a file named probe.txt containing the word hi in the current directory, then tell me in one short line that it is done.' }],
      }),
      timeout(180000, 'session/prompt'),
    ]).catch((error) => ({ error: error.message, code: error.code ?? null, data: error.data ?? null }));
    summary.firstPrompt = first;
    console.log('[prompt 1]', JSON.stringify(first));

    const second = request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Count slowly from 1 to 300, one number per line, and after every ten numbers write one sentence about the number.' }],
    });
    await new Promise((r) => setTimeout(r, 6000));
    notify('session/cancel', { sessionId: session.sessionId });
    summary.secondPrompt = await Promise.race([second, timeout(60000, 'second prompt after cancel')]).catch((error) => ({ error: error.message, code: error.code ?? null }));
    console.log('[prompt 2 after cancel]', JSON.stringify(summary.secondPrompt));

    const modes = session.modes?.availableModes ?? [];
    if (modes.length > 0) {
      const other = modes.find((m) => m.id !== session.modes.currentModeId) ?? modes[0];
      summary.setMode = await request('session/set_mode', { sessionId: session.sessionId, modeId: other.id }).catch((error) => ({ error: error.message, code: error.code ?? null }));
      console.log('[set_mode]', JSON.stringify(summary.setMode));
    }
    if (init?.agentCapabilities?.loadSession) {
      summary.load = await Promise.race([
        request('session/load', { sessionId: session.sessionId, cwd: opts.cwd, mcpServers: [] }),
        timeout(60000, 'session/load'),
      ]).catch((error) => ({ error: error.message, code: error.code ?? null }));
      console.log('[load]', JSON.stringify(summary.load));
    }
  }
} catch (error) {
  summary.fatal = error.message;
  console.log('[fatal]', error.message);
} finally {
  summary.updatesSeen = [...new Set(updates)];
  summary.permissionAnswers = permissionAnswers;
  summary.stderrTail = stderr.slice(-20);
  summary.durationMs = Date.now() - startedAt;
  try { child.stdin.end(); } catch { /* closed */ }
  setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, 1500);
  if (opts.out) {
    writeFileSync(opts.out, JSON.stringify({ ...summary, frames }, null, 2));
    console.log(`[wrote] ${opts.out} ${frames.length} frames`);
  }
  console.log('[summary]', JSON.stringify({ ...summary, stderrTail: undefined }, null, 1).slice(0, 3000));
  setTimeout(() => process.exit(0), 2000);
}
