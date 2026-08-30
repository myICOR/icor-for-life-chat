/* Resuming a conversation FROM THE VAULT.
 *
 * The archive note is the only record of a conversation that outlives the
 * plugin's own memory, and it carries every session id the thread ever had.
 * These are the shapes that record arrives in: Obsidian's metadata cache
 * returns a YAML list as an array, a single-item list can come back as a bare
 * string, and a hand-edited note can carry a list written out inline. All three
 * are the same fact, and a reader that only understands one of them makes a
 * note look unresumable instead of failing. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionIdsFromFrontmatter, resumableSessionId } from './build/pure.mjs';

const A = '96fca9d2-9bfc-4f21-963c-c959acad3b1c';
const B = '00000000-0000-4000-8000-000000000000';

test('a YAML list comes back in order', () => {
  assert.deepEqual(sessionIdsFromFrontmatter([A, B]), [A, B]);
});

test('a single id, listed or bare, reads the same', () => {
  assert.deepEqual(sessionIdsFromFrontmatter([A]), [A]);
  assert.deepEqual(sessionIdsFromFrontmatter(A), [A]);
});

test('an inline list written by hand is still a list', () => {
  assert.deepEqual(sessionIdsFromFrontmatter(`["${A}", "${B}"]`), [A, B]);
  assert.deepEqual(sessionIdsFromFrontmatter(`${A}, ${B}`), [A, B]);
});

test('anything that is not a session id is not one', () => {
  assert.deepEqual(sessionIdsFromFrontmatter(undefined), []);
  assert.deepEqual(sessionIdsFromFrontmatter(''), []);
  assert.deepEqual(sessionIdsFromFrontmatter(['not-a-uuid', 42, null]), []);
  assert.deepEqual(sessionIdsFromFrontmatter({ session_ids: A }), []);
});

test('duplicates collapse', () => {
  assert.deepEqual(sessionIdsFromFrontmatter([A, A]), [A]);
});

/* The one that decides behaviour. A fork or a resume MINTS a new id and the
 * earlier ones are ancestors, so resuming the first would reopen a conversation
 * that stops before its own ending - and it would look like it worked. */
test('the resumable id is the LAST, because a resume mints a new one', () => {
  assert.equal(resumableSessionId([A, B]), B);
  assert.equal(resumableSessionId([A]), A);
  assert.equal(resumableSessionId([]), null);
  assert.equal(resumableSessionId(undefined), null);
});
