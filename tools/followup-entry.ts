/* Headless measurement: what the CLI does with a SECOND user message pushed
 * while a turn is still running. Not part of `npm test` - it spends tokens and
 * needs a logged-in CLI. The dated finding lives at the top of session.ts. */
import { ChatSession } from '../src/provider/claude/session';
import { buildChildEnv, resolveCliPath } from '../src/provider/cli';
import type { ChatEvent } from '../src/model/types';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);
const launch = { cliPath, env: buildChildEnv(process.env, env) };
const detect = { ...env, extra: [], configured: '' };
const t0 = Date.now();
const log = (line: string): void => { process.stdout.write(`${String(Date.now() - t0).padStart(6)}ms ${line}\n`); };

const seen: ChatEvent[] = [];
let turnEnds = 0;
let secondSent = false;
const session = new ChatSession(
  { provider: 'claude' as const, cliPath: '', cwd, detect, model: 'haiku', effort: 'low',
    permissionMode: 'default', structuredReplies: false, resumeSessionId: null },
  launch,
  {
    onEvent: (e) => {
      seen.push(e);
      if (e.kind === 'text-delta') return;
      if (e.kind === 'text-final') log(`text-final ${JSON.stringify(e.text.slice(0, 120))}`);
      else if (e.kind === 'turn-end') { turnEnds += 1; log(`turn-end #${turnEnds} tokens=${e.usage.totalTokens} err=${e.isError}`); }
      else if (e.kind === 'error') log(`ERROR ${e.message}`);
      else log(e.kind);
      if (e.kind === 'text-open' && !secondSent) {
        secondSent = true;
        setTimeout(() => { session.send('And after that, say the single word PINEAPPLE.'); log('sent #2 (mid-turn, 1.5s after the first text block opened)'); }, 1500);
      }
      if (turnEnds >= 2) session.dispose();
    },
    onApprovalRequest: (r) => { log(`approval ${r.toolName}`); session.answerApproval(r.toolUseId, 'deny'); },
    onApprovalSettled: () => {},
    onRawMessage: (raw) => {
      const r = raw as { type?: string; subtype?: string; message?: { role?: string; content?: unknown } };
      if (r.type === 'stream_event') return;
      const content = r.message?.content;
      const gloss = typeof content === 'string' ? content.slice(0, 60)
        : Array.isArray(content) ? content.map((b) => (b as { type: string }).type).join(',') : '';
      log(`  wire ${r.type}${r.subtype ? '/' + r.subtype : ''} ${gloss}`);
    },
  },
);

session.send('Count slowly from 1 to 30, one number per line, and write two sentences about each number before moving on. Use no tools.');
log('sent #1');
setTimeout(() => { log('timeout, disposing'); session.dispose(); }, 120000);
await session.drain();
const finals = seen.filter((e) => e.kind === 'text-final').map((e) => (e as { text: string }).text);
log(`turn-ends=${turnEnds} text-finals=${finals.length} pineapple=${finals.some((t) => /PINEAPPLE/i.test(t))}`);
process.exit(0);
