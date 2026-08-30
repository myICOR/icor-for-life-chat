/* Headless end-to-end check: a real CLI, a real turn, our own normalizer.
 * Not part of `npm test` - it spends a token budget and needs a logged-in CLI. */
import { ChatSession } from '../src/sdk/session';
import { buildChildEnv, resolveCliPath } from '../src/sdk/cli';
import type { ChatEvent } from '../src/model/types';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);
process.stdout.write(`cli: ${cliPath}\n`);

const seen: ChatEvent[] = [];
const session = new ChatSession(
  {
    cliPath,
    cwd,
    env: buildChildEnv(process.env, env),
    model: 'haiku',
    effort: 'low',
    permissionMode: 'default',
    structuredReplies: false,
    resumeSessionId: null,
  },
  {
    onEvent: (e) => {
      seen.push(e);
      if (e.kind === 'session') process.stdout.write(`session ${e.sessionId} model=${e.model}\n`);
      if (e.kind === 'text-delta') process.stdout.write(e.text);
      if (e.kind === 'turn-end') {
        process.stdout.write(`\nturn-end tokens=${e.usage.totalTokens} err=${e.isError}\n`);
        session.dispose();
      }
      if (e.kind === 'error') process.stdout.write(`\nERROR ${e.message}\n`);
    },
    onApprovalRequest: (r) => {
      process.stdout.write(`\napproval asked: ${r.toolName}\n`);
      session.answerApproval(r.toolUseId, 'deny');
    },
    onApprovalSettled: () => {},
  },
);

session.send('Reply with exactly: ICOR OK. Use no tools.');
await session.drain();
const kinds = new Set(seen.map((e) => e.kind));
process.stdout.write(`\nevent kinds: ${[...kinds].join(', ')}\n`);
process.exit(kinds.has('turn-end') ? 0 : 1);
