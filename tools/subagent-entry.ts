/* Does forwardSubagentText actually tag the nested transcript? */
import { ChatSession } from '../src/sdk/session';
import { buildChildEnv, resolveCliPath } from '../src/sdk/cli';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const streams = new Map<string, number>();
let spawns = 0;
let ends = 0;

const session = new ChatSession(
  {
    cliPath: resolveCliPath('', env), cwd, env: buildChildEnv(process.env, env),
    model: 'sonnet', effort: 'low', permissionMode: 'acceptEdits',
    structuredReplies: false, resumeSessionId: null,
  },
  {
    onEvent: (e) => {
      if (e.stream) streams.set(e.stream, (streams.get(e.stream) ?? 0) + 1);
      if (e.kind === 'subagent-start') {
        spawns += 1;
        process.stdout.write(`spawn ${e.agentId.slice(0, 10)} type=${e.agentType} "${e.description}"\n`);
      }
      if (e.kind === 'subagent-end') {
        ends += 1;
        process.stdout.write(`end   ${e.agentId.slice(0, 10)} ok=${e.ok}\n`);
      }
      if (e.kind === 'turn-end' || e.kind === 'error') {
        if (e.kind === 'error') process.stdout.write(`ERROR ${e.message}\n`);
        session.dispose();
      }
    },
    onApprovalRequest: (r) => session.answerApproval(r.toolUseId, 'allow-once'),
    onApprovalSettled: () => {},
  },
);

session.send('Use the Task tool to launch one general-purpose subagent whose only job is to reply with the single word BANANA. Then tell me what it said.');
await session.drain();
process.stdout.write(`\nspawns=${spawns} ends=${ends}\n`);
for (const [id, n] of streams) process.stdout.write(`  stream ${id.slice(0, 10)}: ${n} events\n`);
process.exit(spawns > 0 && streams.size > 0 ? 0 : 1);
