/* Does the model actually emit what the parser claims? The only way to know. */
import { ChatSession } from '../src/provider/claude/session';
import { buildChildEnv, resolveCliPath } from '../src/provider/cli';
import { parseStructured, decisionsOf } from '../src/structured/parser';

const cwd = process.argv[2] ?? process.cwd();
const env = { platform: 'darwin' as const, home: process.env.HOME ?? '', path: '/usr/bin:/bin' };
const cliPath = resolveCliPath('', env);
const launch = { cliPath, env: buildChildEnv(process.env, env) };
const detect = { ...env, extra: [], configured: '' };
let final = '';

const session = new ChatSession(
  {
    provider: 'claude' as const, cliPath: '', cwd, detect,
    model: 'sonnet', effort: 'low', permissionMode: 'default',
    structuredReplies: true, resumeSessionId: null,
  },
  launch,
  {
    onEvent: (e) => {
      if (e.kind === 'text-final') final += `${e.text}\n`;
      if (e.kind === 'turn-end' || e.kind === 'error') session.dispose();
    },
    onApprovalRequest: (r) => session.answerApproval(r.toolUseId, 'deny'),
    onApprovalSettled: () => {},
  },
);

session.send(
  'Report on the state of this vault: how many notes, and is the CLAUDE.md present. ' +
  'Use no tools, just answer from what you know, invent two plausible numbers as an ' +
  'example, and raise one decision for me.',
);
await session.drain();

process.stdout.write('----- RAW -----\n');
process.stdout.write(final);
process.stdout.write('\n----- PARSED -----\n');
const doc = parseStructured(final);
process.stdout.write(`structured: ${doc.structured}\n`);
for (const seg of doc.segments) {
  if (seg.kind === 'card') {
    process.stdout.write(`card ${seg.header.name} | ${seg.header.scope} | ${seg.header.status}\n`);
    for (const b of seg.blocks) {
      const detail =
        b.kind === 'group' ? `${b.title ?? '-'} (${b.rows.length} rows)` :
        b.kind === 'findings' ? `${b.findings.length} findings` :
        b.kind === 'files' ? `${b.paths.length} paths` :
        b.kind === 'links' ? `${b.urls.length} urls` :
        b.kind === 'next' ? `${b.items.length} items` : '';
      process.stdout.write(`  block ${b.kind} ${detail}\n`);
    }
  } else if (seg.kind === 'decision') {
    process.stdout.write(`decision ${seg.decision.code} "${seg.decision.title}"\n`);
  } else {
    process.stdout.write(`${seg.kind}: ${seg.text.slice(0, 60).replace(/\n/g, ' ')}\n`);
  }
}
process.stdout.write(`decisions: ${decisionsOf(doc).length}\n`);
process.exit(doc.structured ? 0 : 1);
