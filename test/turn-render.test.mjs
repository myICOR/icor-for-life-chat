/* ONE ASSISTANT TURN IS ONE RENDERED MESSAGE NODE.
 *
 * The defect this closes shipped in 0.1.0 and was visible in every structured
 * reply: the answer appeared TWICE in the same conversation, once as raw
 * unstyled markdown and again below it as a rendered card.
 *
 * The producer is a disagreement about what a block id means. `Normalizer.
 * partial()` keys a block by the API's message-wide `content_block` index, and
 * `Normalizer.assistant()` keys it by its position inside the frame's own
 * `content` array. Those two agree only while one assistant message arrives as
 * one frame. The CLI splits it: measured on 2.1.x, a message whose content is
 * [thinking, text] arrives as TWO assistant frames of one block each, so the
 * text block is stream index 1 and frame index 0. The streamed node, keyed
 * `msg:1`, never receives its `text-final` and keeps the raw `setText` it was
 * built from; the final event, keyed `msg:0`, has no block and builds a second.
 *
 * The gate is a CENSUS, not a hunt for the raw node. Asserting "no unstyled
 * block" would pass the moment somebody hid one of the two, and a hidden node
 * leaves the second producer alive. Counting is the assertion that cannot be
 * satisfied by suppression.
 *
 * It replays `test/fixtures/recorded-turn.json`: verbatim CLI wire traffic,
 * recorded by `tools/frames-entry.ts`. A hand-typed frame sequence would agree
 * with whichever of the two index conventions its author had in mind, which is
 * the exact confusion under test. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Chrome } from './dom/chrome.mjs';
import { Normalizer } from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RECORDED = JSON.parse(readFileSync(resolve(here, 'fixtures/recorded-turn.json'), 'utf8'));

/* ------------------------------------------------------- the wire, as recorded */

/* Proof the fixture still carries the shape the gate is about. If a future
 * recording happens to be a single-frame turn, the census below would pass
 * without ever exercising the split - a green reachable without the thing
 * being true - so the recording is asserted before it is trusted. */
test('the recorded turn is a SPLIT assistant message: one API message, two frames', () => {
  const assistants = RECORDED.filter((f) => f.type === 'assistant');
  assert.equal(assistants.length, 2, 'the recording must contain the split');
  const ids = new Set(assistants.map((f) => f.message.id));
  assert.equal(ids.size, 1, 'both frames belong to ONE API message');
  assert.deepEqual(
    assistants.map((f) => f.message.content.map((b) => b.type)),
    [['thinking'], ['text']],
    'thinking arrives in its own frame, text in the next',
  );
  const textStart = RECORDED.find(
    (f) => f.type === 'stream_event' && f.event.type === 'content_block_start' && f.event.content_block.type === 'text',
  );
  assert.equal(textStart.event.index, 1, 'the text block is index 1 on the wire');
});

/* --------------------------------------------------------------- the block ids */

test('the streamed text block and its final event carry the SAME block id', () => {
  const n = new Normalizer();
  const opened = [];
  const finals = [];
  for (const frame of RECORDED) {
    for (const e of n.normalize(frame)) {
      if (e.kind === 'text-open') opened.push(e.blockId);
      if (e.kind === 'text-final' && e.text.trim()) finals.push(e.blockId);
    }
  }
  assert.equal(opened.length, 1, 'one text block opened');
  assert.equal(finals.length, 1, 'one text block finalised');
  assert.equal(
    finals[0],
    opened[0],
    'the final event must land on the block the stream opened, or the renderer builds a second node',
  );
});

/* ------------------------------------------------------------------ the census */

test('one assistant turn renders exactly one message node', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const deadline = Date.now() + 10000;
    let census = null;
    for (;;) {
      census = await chrome.evaluate('window.aicTurn ?? null');
      if (census) break;
      if (Date.now() > deadline) throw new Error('The turn fixture never published a census');
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(
      census.messageNodes,
      1,
      `one assistant turn produced ${census.messageNodes} message nodes ` +
      `(${census.rawNodes} raw, ${census.structuredNodes} structured). ` +
      `Texts: ${JSON.stringify(census.texts)}`,
    );
    // And the one node is the CARD, not the raw block: a census of one that
    // kept the unstyled copy and dropped the card would be the same defect
    // wearing the other shoe.
    assert.equal(census.structuredNodes, 1, 'the surviving node must be the rendered card');
    assert.equal(census.rawNodes, 0, 'no raw unstyled assistant block may remain');
  } finally {
    await chrome.close();
  }
});
