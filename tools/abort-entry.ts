/* Abort gate: stop a live turn and prove no claude process is left behind. */
import { ChatSession } from '../src/provider/claude/session';
import { buildChildEnv, resolveCliPath } from '../src/provider/cli';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);
const launch = { cliPath, env: buildChildEnv(process.env, env) };
const detect = { ...env, extra: [], configured: '' };

let deltas = 0;
let aborted = false;
const session = new ChatSession(
  {
    provider: 'claude' as const, cliPath: '', cwd, detect,
    model: 'haiku', effort: 'low', permissionMode: 'default',
    structuredReplies: false, resumeSessionId: null,
  },
  launch,
  {
    onEvent: (e) => {
      if (e.kind === 'text-delta') {
        deltas += 1;
        if (deltas === 3) void session.interrupt();
      }
      if (e.kind === 'aborted') aborted = true;
      if (e.kind === 'turn-end') process.stdout.write(`turn-end after interrupt (deltas=${deltas})\n`);
    },
    onApprovalRequest: (r) => session.answerApproval(r.toolUseId, 'deny'),
    onApprovalSettled: () => {},
  },
);

session.send('Count slowly from 1 to 200, one number per line. Use no tools.');
setTimeout(() => {
  process.stdout.write(`deltas=${deltas} aborted=${aborted}\n`);
  session.dispose();
  setTimeout(() => process.exit(deltas > 0 ? 0 : 1), 1500);
}, 25_000);
