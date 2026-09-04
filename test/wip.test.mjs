/* The WiP room's naming rules and the archive's link back (R1, R5).
 *
 * A folder name for a title on a day, the next task number, which WiP
 * folders a session touched, which folder is newest, and what a README reads
 * after a session line lands in it: each has one right answer, so each is
 * asserted here with no vault. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugForTitle, titleFromReply, deliverableFolderName, uniqueName, nextTaskNumber, taskFileName, taskId,
  sortWipFolders, wipFoldersTouched, withSessionLine, sessionLine, SESSIONS_HEADING,
} from './build/pure.mjs';

test('a title becomes a GL-001 kebab slug, bounded and never empty', () => {
  assert.equal(slugForTitle('Raw terminal mode: feasibility, part 2'), 'raw-terminal-mode-feasibility-part-2');
  assert.equal(slugForTitle('Ärger über Öl'), 'arger-uber-ol');
  assert.equal(slugForTitle('!!!'), 'deliverable');
  assert.equal(slugForTitle('a'.repeat(80)).length, 48);
  assert.equal(deliverableFolderName('2026-09-04', 'Copilot learnings'), '2026-09-04-copilot-learnings');
});

test('the reply names the deliverable: its first heading, else its first line, marks stripped', () => {
  assert.equal(titleFromReply('Two lines of prose.\n\n## The plan\n\nbody'), 'The plan');
  assert.equal(titleFromReply('**Bold** start with a [[Note|alias]] link\nmore'), 'Bold start with a Note link');
  assert.equal(titleFromReply('\n\n   \n'), 'Deliverable');
  assert.equal(titleFromReply(`# ${'x'.repeat(120)}`).length, 80);
});

test('a taken folder name gets a numeric suffix, never an overwrite', () => {
  assert.equal(uniqueName('2026-09-04-brief', []), '2026-09-04-brief');
  assert.equal(uniqueName('2026-09-04-brief', ['2026-09-04-brief']), '2026-09-04-brief-2');
  assert.equal(uniqueName('2026-09-04-brief', new Set(['2026-09-04-brief', '2026-09-04-brief-2'])), '2026-09-04-brief-3');
});

test('the task number is the next free one for the day, and the file name carries it', () => {
  const names = ['tsk-2026-09-04-001-a.md', 'tsk-2026-09-04-004-b.md', 'tsk-2026-09-03-009-c.md', 'README.md'];
  assert.equal(nextTaskNumber(names, '2026-09-04'), 5);
  assert.equal(nextTaskNumber(names, '2026-09-05'), 1);
  assert.equal(taskFileName('2026-09-04', 5, 'Fix the thing'), 'tsk-2026-09-04-005-fix-the-thing.md');
  assert.equal(taskId('2026-09-04', 5), 'tsk-2026-09-04-005');
});

test('WiP folders sort newest first by their date prefix, undated last by mtime, archive never', () => {
  const sorted = sortWipFolders([
    { path: '03 WiP/_archive', name: '_archive', mtime: 9e12, notes: 100 },
    { path: '03 WiP/old-undated', name: 'old-undated', mtime: 10, notes: 1 },
    { path: '03 WiP/2026-09-01-a', name: '2026-09-01-a', mtime: 5, notes: 1 },
    { path: '03 WiP/2026-09-04-b', name: '2026-09-04-b', mtime: 1, notes: 1 },
    { path: '03 WiP/2026-09-04-a', name: '2026-09-04-a', mtime: 2, notes: 1 },
    { path: '03 WiP/new-undated', name: 'new-undated', mtime: 20, notes: 1 },
  ]).map((f) => f.name);
  assert.deepEqual(sorted, ['2026-09-04-a', '2026-09-04-b', '2026-09-01-a', 'new-undated', 'old-undated']);
});

test('the folders a session touched come from writes and Bash commands, never from reads', () => {
  const events = [
    { kind: 'tool-call', toolUseId: '1', name: 'Read', target: '03 WiP/2026-09-04-read-only/00-brief.md', input: {}, purpose: '', stream: null },
    { kind: 'tool-call', toolUseId: '2', name: 'Write', target: '03 WiP/2026-09-04-written/notes.md', input: {}, purpose: '', stream: null },
    { kind: 'tool-call', toolUseId: '3', name: 'Edit', target: '/Users/t/vault/03 WiP/2026-09-03-edited/x.md', input: {}, purpose: '', stream: null },
    { kind: 'tool-call', toolUseId: '4', name: 'Bash', target: 'ls', input: { command: 'cp a "03 WiP/2026-09-02-bashed/b.md" && ls 03 WiP/_archive/old' }, purpose: '', stream: null },
    { kind: 'tool-call', toolUseId: '5', name: 'Write', target: '04 Inner World/x.md', input: {}, purpose: '', stream: null },
    { kind: 'tool-result', toolUseId: '5', ok: true, detail: '', output: '', stream: null },
  ];
  assert.deepEqual(wipFoldersTouched(events, ['03 WiP/2026-09-04-attached']), [
    '03 WiP/2026-09-02-bashed',
    '03 WiP/2026-09-03-edited',
    '03 WiP/2026-09-04-attached',
    '03 WiP/2026-09-04-written',
  ]);
  assert.deepEqual(wipFoldersTouched([], []), []);
});

test('a README gains one session line, once, under a heading created once', () => {
  const line = sessionLine('06 AI Team/AI Sessions/2026-09-04_1200_x_abc123', 'A session');
  assert.equal(line, '- [[06 AI Team/AI Sessions/2026-09-04_1200_x_abc123/conversation|A session]]');
  const fresh = withSessionLine(null, 'my-brief', line);
  assert.equal(fresh, `# my-brief\n\n${SESSIONS_HEADING}\n\n${line}\n`);
  assert.equal(withSessionLine(fresh, 'my-brief', line), fresh, 'the same line was added twice');
  const second = withSessionLine(fresh, 'my-brief', '- [[x/conversation|Another]]');
  assert.equal(second, `# my-brief\n\n${SESSIONS_HEADING}\n\n${line}\n- [[x/conversation|Another]]\n`);
  // A heading in the middle: the line joins its block, before the next heading.
  const mid = `# t\n\n${SESSIONS_HEADING}\n\n- [[a/conversation|A]]\n\n## Notes\n\ntext\n`;
  assert.equal(withSessionLine(mid, 't', '- [[b/conversation|B]]'), `# t\n\n${SESSIONS_HEADING}\n\n- [[a/conversation|A]]\n- [[b/conversation|B]]\n\n## Notes\n\ntext\n`);
});
