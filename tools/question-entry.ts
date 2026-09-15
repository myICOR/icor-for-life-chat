/* Headless measurement: how AskUserQuestion actually reaches an SDK host, and
 * whether it arrives as a `request_user_dialog` at all. Not part of
 * `npm test` - it spends tokens and needs a logged-in CLI. The dated finding
 * lives in docs/architecture.md under "AskUserQuestion".
 *
 * The harness deliberately declares `supportedDialogKinds: ['ask_user_question']`
 * and wires `onUserDialog`, so a dialog of that kind would be logged if the CLI
 * emitted one. */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildChildEnv, resolveCliPath } from '../src/provider/cli';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);
const t0 = Date.now();
const log = (line: string): void => { process.stdout.write(`${String(Date.now() - t0).padStart(6)}ms ${line}\n`); };

let dialogCalls = 0;
let questionSeen = false;

const handle = query({
  prompt: 'Use the AskUserQuestion tool right now to ask me exactly one question: which colour I prefer, with the options Red and Blue. Ask nothing else and use no other tool.',
  options: {
    cwd,
    env: buildChildEnv(process.env, env),
    pathToClaudeCodeExecutable: cliPath,
    model: 'haiku',
    includePartialMessages: false,
    supportedDialogKinds: ['ask_user_question'],
    onUserDialog: async (request) => {
      dialogCalls += 1;
      log(`onUserDialog kind=${JSON.stringify(request.dialogKind)} toolUseID=${String(request.toolUseID)}`);
      log(`  payload ${JSON.stringify(request.payload).slice(0, 2000)}`);
      return { behavior: 'cancelled' };
    },
    canUseTool: async (toolName, input) => {
      log(`canUseTool ${toolName}`);
      log(`  input ${JSON.stringify(input).slice(0, 4000)}`);
      if (toolName !== 'AskUserQuestion') return { behavior: 'deny', message: 'not part of this measurement' };
      questionSeen = true;
      const questions = (input as { questions?: { question: string; options?: { label: string }[] }[] }).questions ?? [];
      const answers: Record<string, string> = {};
      for (const q of questions) {
        const multi = (q as unknown as { multiSelect?: boolean }).multiSelect === true;
        answers[q.question] = multi
          ? (q.options ?? []).slice(0, 2).map((o) => o.label).join(', ')
          : q.options?.[0]?.label ?? 'Red';
      }
      const updatedInput = { ...input, answers };
      log(`  answering ${JSON.stringify(updatedInput).slice(0, 2000)}`);
      return { behavior: 'allow', updatedInput };
    },
  },
});

setTimeout(() => { void handle.return(undefined); }, 180000);
for await (const message of handle) {
  const m = message as { type?: string; subtype?: string; message?: { content?: unknown } };
  if (m.type === 'stream_event') continue;
  const content = m.message?.content;
  const gloss = Array.isArray(content)
    ? content.map((b) => {
        const block = b as { type: string; name?: string; content?: unknown; tool_use_id?: string };
        if (block.type === 'tool_use') return `tool_use:${String(block.name)}`;
        if (block.type === 'tool_result') return `tool_result ${JSON.stringify(block.content).slice(0, 1200)}`;
        return block.type;
      }).join(' | ')
    : typeof content === 'string' ? content.slice(0, 200) : '';
  log(`wire ${m.type}${m.subtype ? '/' + m.subtype : ''} ${gloss}`);
}
log(`dialogCalls=${dialogCalls} askUserQuestionThroughCanUseTool=${questionSeen}`);
process.exit(0);
