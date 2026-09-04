/* The reply surface's two pure pieces: the sentence a collapsed tool group
 * says, and the registry every reply action comes from. Both are asserted
 * headless because both are decisions with one right answer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySentence, activityCounts, ReplyActionRegistry, bindActions } from './build/pure.mjs';

const row = (name, target, startedAt, endedAt = null) => ({ name, target, status: 'done', startedAt, endedAt });

test('the sentence names every family that happened and none that did not', () => {
  const rows = [
    row('Read', 'a.md', 0, 100), row('Read', 'b.md', 100, 200), row('Read', 'a.md', 200, 300),
    row('Edit', 'a.md', 300, 400), row('Write', 'c.md', 400, 500),
    row('Bash', 'ls', 500, 600), row('Bash', 'pwd', 600, 700), row('Bash', 'date', 700, 800),
    row('Grep', 'x', 800, 900), row('WebFetch', 'https://a', 900, 1000),
    row('Agent', 'pax', 1000, 41_000),
  ];
  assert.equal(
    activitySentence(rows),
    'Read 2 notes, edited 2, ran 3 commands, searched 1 time, fetched 1 page, sent 1 agent · 41.0S',
  );
});

test('a family with zero is left out, and the first clause is capitalised', () => {
  assert.equal(activitySentence([row('Bash', 'ls', 0, 2000)]), 'Ran 1 command · 2.0S');
  assert.equal(activitySentence([row('Read', 'x.md', 0, 500), row('Read', 'y.md', 0, 500)]), 'Read 2 notes · 500MS');
});

test('paths that are not notes say files; unknown tools are counted, never dropped', () => {
  assert.equal(activitySentence([row('Read', 'data.csv', 0, 10)]), 'Read 1 file · 10MS');
  const c = activityCounts([row('Read', 'x.md', 0, 10), row('FetchThing', '', 0, 10)]);
  assert.equal(c.other, 1);
  assert.match(activitySentence([row('FetchThing', '', 0, 10)]), /^1 other call/);
});

test('elapsed is measured from the first start to the last end, or absent', () => {
  assert.equal(activityCounts([row('Bash', 'a', 100, null)]).elapsedMs, null);
  assert.equal(activitySentence([row('Bash', 'a', 100, null)]), 'Ran 1 command');
  assert.equal(activityCounts([row('Bash', 'a', 100, 300), row('Bash', 'b', 50, 250)]).elapsedMs, 250);
});

test('no rows means no sentence, so the caller falls back to a count', () => {
  assert.equal(activitySentence([]), '');
});

const ctx = (role = 'assistant') => ({ app: {}, plugin: {}, view: {}, blockId: 'b', text: 't', el: null, role, key: role === 'user' ? '0' : null });

test('the registry replaces on id, filters on when, and unregisters exactly its own entry', () => {
  const reg = new ReplyActionRegistry();
  const off = reg.register({ id: 'a', icon: 'x', label: 'A', run: () => {} });
  reg.register({ id: 'b', icon: 'x', label: 'B', when: (c) => c.role === 'user', run: () => {} });
  assert.deepEqual(reg.list(ctx('assistant')).map((a) => a.id), ['a']);
  assert.deepEqual(reg.list(ctx('user')).map((a) => a.id), ['a', 'b']);
  // Same id again: one entry, the newer definition.
  reg.register({ id: 'a', icon: 'y', label: 'A2', run: () => {} });
  assert.deepEqual(reg.all().map((a) => a.label), ['B', 'A2']);
  // The old unregister function points at the replaced object and removes nothing.
  off();
  assert.deepEqual(reg.all().map((a) => a.id), ['b', 'a']);
});

test('binding carries the context into run and defaults the section to primary', async () => {
  const reg = new ReplyActionRegistry();
  const seen = [];
  reg.register({ id: 'a', icon: 'x', label: 'A', run: (c) => { seen.push(c.text); } });
  reg.register({ id: 'm', icon: 'x', label: 'M', section: 'more', run: () => {} });
  const bound = bindActions(reg, ctx());
  assert.deepEqual(bound.map((b) => [b.id, b.section]), [['a', 'primary'], ['m', 'more']]);
  await bound[0].run();
  assert.deepEqual(seen, ['t']);
});
