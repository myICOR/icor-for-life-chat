/* Record one real turn's wire frames, verbatim, as a replayable fixture.
 *
 * Diagnostic + fixture-authoring tool. Not part of `npm test`: it spends a
 * token budget and needs a logged-in CLI. The fixture it writes is what
 * `test/turn-render.test.mjs` replays, so the gate is driven by traffic the
 * CLI actually produced rather than by a shape somebody assumed. */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync } from 'node:fs';
import { buildChildEnv, resolveCliPath } from '../src/sdk/cli';
import { STRUCTURED_REPLY_PROMPT } from '../src/constants';

const cwd = process.argv[2] ?? process.cwd();
const out = process.argv[3] ?? 'test/fixtures/recorded-turn.json';
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);

const KEEP = new Set(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop']);
const frames: unknown[] = [];

const q = query({
  prompt:
    'Give me a structured reply about yourself: one card, an ASKED line, an ANSWER line, ' +
    'one INSIGHT line and one decision. Think it through first. Use no tools.',
  options: {
    cwd,
    env: buildChildEnv(process.env, env),
    pathToClaudeCodeExecutable: cliPath,
    permissionMode: 'default',
    includePartialMessages: true,
    model: 'opus',
    effort: 'high',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: STRUCTURED_REPLY_PROMPT },
  },
});

for await (const m of q as AsyncIterable<Record<string, unknown>>) {
  if (m.type === 'stream_event') {
    const e = m.event as Record<string, unknown>;
    if (KEEP.has(String(e.type))) frames.push(m);
  } else if (m.type === 'assistant' || m.type === 'result') {
    frames.push(m);
  }
}

writeFileSync(out, `${JSON.stringify(frames, null, 1)}\n`);
process.stdout.write(`${frames.length} frames -> ${out}\n`);
