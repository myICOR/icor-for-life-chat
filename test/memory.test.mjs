/* The session log read back: every rule about what a row says, on strings.
 *
 * The rows on the empty state quote the vault's own record, so the parser is
 * held to the record's real shapes: the template's placeholder bullets, a
 * log with no INSIGHTS section, a name without a date. A row that quoted the
 * template back would be the placeholder defect wearing a session log. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSIGHT_CHARS, dateFromName, stripFrontmatter, firstHeading, firstBulletUnder, plainLine, cutLine,
  parseSessionLog, journalTitle,
} from './build/pure.mjs';

const LOG = `---
agent_id: larry
type: close-session
---

# AI Chat 0.6.1: six improvements shipped

## Context

One goal.

## What we did

- Larry cut three git worktrees off \`publish\`.
- Stream A: tool rows say what was done.

## Insights

- A **guard** that closes a popover must decide before the handler it guards can mutate the DOM, see [[GL-073-the-session-contract|GL-073]].
- Second insight.
`;

test('the date comes from the file name, and only from a name that carries one', () => {
  assert.equal(dateFromName('2026-09-04-12-50_larry_ai-chat.md'), '2026-09-04');
  assert.equal(dateFromName('2026-05-21-larry-session.md'), '2026-05-21');
  assert.equal(dateFromName('_template.md'), null);
  assert.equal(dateFromName('notes-2026-09-04.md'), null);
});

test('frontmatter is stripped, and a body without any is returned whole', () => {
  assert.equal(stripFrontmatter(LOG).startsWith('\n# AI Chat'), true);
  assert.equal(stripFrontmatter('# Plain\n\ntext'), '# Plain\n\ntext');
  assert.equal(stripFrontmatter('---\nopen: true\n'), '---\nopen: true\n', 'an unclosed frontmatter is not frontmatter');
});

test('the title is the first level-one heading', () => {
  assert.equal(firstHeading(stripFrontmatter(LOG)), 'AI Chat 0.6.1: six improvements shipped');
  assert.equal(firstHeading('## only a level two\n'), null);
});

test('the insight is the first bullet under INSIGHTS, emphasis and wikilinks flattened', () => {
  const parsed = parseSessionLog('2026-09-04-12-50_larry_ai-chat.md', LOG, { agent_id: 'larry' });
  assert.equal(parsed.date, '2026-09-04');
  assert.equal(parsed.agent, 'larry');
  assert.equal(parsed.title, 'AI Chat 0.6.1: six improvements shipped');
  assert.equal(parsed.insight,
    'A guard that closes a popover must decide before the handler it guards can mutate the DOM, see GL-073.');
});

test('with no INSIGHTS section the first WHAT WE DID bullet stands in; with neither, null', () => {
  const noInsights = LOG.replace(/## Insights[\s\S]*$/, '');
  assert.equal(parseSessionLog('2026-09-04_x.md', noInsights, null).insight, 'Larry cut three git worktrees off publish.');
  assert.equal(parseSessionLog('2026-09-04_x.md', '# Just a title\n', null).insight, null);
});

test('the template placeholders are never an insight', () => {
  const body = '# T\n\n## Insights\n\n- ...\n\n## Realignments\n\n- _(none this session)_\n\n## What we did\n\n- Real work.\n';
  assert.equal(firstBulletUnder(body, 'Insights'), null);
  assert.equal(firstBulletUnder(body, 'Realignments'), null);
  assert.equal(parseSessionLog('2026-01-01_t.md', body, null).insight, 'Real work.');
});

test('a checkbox bullet counts as a bullet; heading matching ignores case', () => {
  const body = '# T\n\n## INSIGHTS\n\n- [ ] Follow up on X.\n';
  assert.equal(firstBulletUnder(body, 'insights'), 'Follow up on X.');
});

test('a long insight is cut at the limit with an ellipsis, a short one is untouched', () => {
  const long = 'x'.repeat(INSIGHT_CHARS + 40);
  const cut = cutLine(long);
  assert.equal(cut.length, INSIGHT_CHARS);
  assert.ok(cut.endsWith('...'));
  assert.equal(cutLine('short'), 'short');
  assert.equal(plainLine('  `code`  and   **bold**  '), 'code and bold');
});

test('a title falls back to the file name, and a journal title to the name without its date', () => {
  assert.equal(parseSessionLog('2026-09-04_larry_no-heading.md', 'no heading here', null).title, '2026-09-04_larry_no-heading');
  assert.equal(journalTitle('2026-09-04-claude-session-sharing.md', '# Claude session sharing\n'), 'Claude session sharing');
  assert.equal(journalTitle('2026-09-04-claude-session-sharing.md', 'no heading'), 'claude session sharing');
});
