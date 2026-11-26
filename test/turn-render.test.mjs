/* ONE ASSISTANT TURN IS ONE RENDERED MESSAGE NODE.
 *
 * The defect this closes shipped in 0.1.0: the answer appeared TWICE in the
 * same conversation, once as raw unstyled text and again below it rendered.
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
      `one assistant turn produced ${census.messageNodes} message nodes. ` +
      `Texts: ${JSON.stringify(census.texts)}`,
    );
    assert.equal(census.renderedNodes, 1, 'the one node must be the rendered reply, not the raw stream');
  } finally {
    await chrome.close();
  }
});

/* ------------------------------------------- the reply streams where it ends */

test('a reply streams into the one node it ends in', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const census = await waitForCensus(chrome);
    const mid = census.mid;
    assert.equal(mid.assistantNodes, 1,
      `mid-stream the column held ${mid.assistantNodes} reply nodes`);
    assert.ok(mid.columnText.length > 0, 'nothing was on screen while the reply streamed');
  } finally {
    await chrome.close();
  }
});

test('the working indicator opens onto the reasoning it is named after', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const census = await waitForCensus(chrome);
    // Driven by a real click, not by asserting a class the fixture set itself:
    // a gate whose green is reachable without the control working is worse
    // than no gate.
    assert.equal(census.opened.workingOpen, true,
      'clicking the thinking indicator did not open it');
    assert.ok(census.opened.workingBody.includes('weighing the two options'),
      `the opened box did not carry the reasoning (got ${JSON.stringify(census.opened.workingBody)})`);
  } finally {
    await chrome.close();
  }
});

/* ------------------------------------------- the picture the message carried */

/* Pasted images previewed in the composer and then vanished on send: the
 * conversation showed the question and not the thing the question was about,
 * which reads as a message that failed to send. */
test('a sent image appears in the conversation, not only in the composer', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const census = await waitForCensus(chrome);
    assert.equal(census.user.images, 1, 'the sent image is missing from the user turn');
    assert.equal(census.user.srcPrefix, 'data:image/png;base64,',
      `the image src is not the bytes that were sent (got ${census.user.srcPrefix})`);
    assert.equal(census.user.alt, 'pasted.png', 'the image has no accessible name');
    // The words survive alongside the picture; one must not replace the other.
    assert.ok(census.user.text.length > 0, 'the message text was lost when an image was attached');
  } finally {
    await chrome.close();
  }
});

async function waitForCensus(chrome) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const census = await chrome.evaluate('window.aicTurn ?? null');
    if (census) return census;
    if (Date.now() > deadline) throw new Error('The turn fixture never published a census');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/* ------------------------------------------- everything behind glass */

/* Three controls that looked like controls and were not, plus a transcript
 * that could not be selected. Reported together, and they are the same
 * complaint: the conversation behaved like a picture of a conversation. */

test('a sent image opens full size, and the backdrop closes it', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    // A real <button>, so the keyboard reaches it too. It was a div: no tab
    // stop, no Enter, no way in at all without a pointer.
    assert.equal(c.user.imageTag, 'BUTTON', 'the image is not a control');
    assert.equal(c.lightbox.openedAfterClick, true, 'clicking the image opened nothing');
    assert.equal(c.lightbox.src, 'data:image/png;base64,', 'the lightbox showed something else');
    assert.equal(c.lightbox.closedOnBackdrop, true, 'the lightbox would not close');
  } finally {
    await chrome.close();
  }
});

test('the context pill opens the note it names', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    assert.equal(c.user.pillTag, 'BUTTON', 'the pill is not a control');
    assert.equal(c.user.pillOpened, '00 Daily Scratchpad/2026/08/2026-08-31.md',
      'clicking the pill did not ask for the note it names');
  } finally {
    await chrome.close();
  }
});

test('the conversation is selectable text; its controls are not', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    // Nothing in this plugin ever set user-select, which is exactly why this
    // went unnoticed: there was no rule to find, only an inherited one.
    assert.equal(c.select.stream, 'text',
      `the transcript is not selectable (user-select: ${c.select.stream}), so an answer ` +
      `cannot be copied out of it`);
    // And the split holds: content selects, chrome does not. Dragging across a
    // tool row to read it must not paint it blue.
    assert.equal(c.select.toolRow, 'none', 'a control inside the stream became selectable text');
  } finally {
    await chrome.close();
  }
});

test('with the reasoning encrypted, the indicator offers nothing to open', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    /* The default model does not send the words: a thinking block arrives as
     * {thinking: "", signature: "..."}. A disclosure that opened onto that
     * would be an affordance over an empty promise. */
    assert.equal(c.redacted.readable, false,
      'the indicator offered to open with no reasoning to show');
    assert.equal(c.redacted.body, '', `the box carried text it had no reasoning for: ${JSON.stringify(c.redacted.body)}`);
  } finally {
    await chrome.close();
  }
});

test('the lightbox covers the app, not the sidebar it was opened from', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    /* Scoping it to the pane was a fair argument and the wrong answer: the chat
     * is usually a narrow right sidebar, so "full size" was barely bigger than
     * the thumbnail. Three assertions, because any one of them alone can be
     * satisfied while the image still opens inside the sidebar. */
    assert.equal(c.lightbox.onBody, true, 'the overlay is still mounted inside the pane');
    assert.equal(c.lightbox.insidePane, false, 'the overlay is a descendant of the chat pane');
    assert.equal(c.lightbox.position, 'fixed',
      `the overlay is ${c.lightbox.position}, so it is bounded by an ancestor rather than the window`);
  } finally {
    await chrome.close();
  }
});

test('the lightbox can still read its own design tokens off the body', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    // Moving it out of .aic-root moved it out of the selector that DEFINES
    // every --aic-* token. Without adding it back, each var() in the overlay
    // resolves to nothing and the failure is invisible in a diff.
    assert.match(CSS_TEXT(), /\.aic-root, \.aic-settings, \.aic-menu, \.aic-lightbox(, [^{]*)? \{/,
      'the lightbox left .aic-root and was not added to the token-defining selector');
  } finally {
    await chrome.close();
  }
});

function CSS_TEXT() {
  return readFileSync(resolve(here, '..', 'styles.css'), 'utf8');
}


/* ------------------------------------- the subagent transcript, replayed */

test('a replayed log with no ending still renders once settled', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    /* Tom once opened a finished subagent onto a blank pane. The stored log
       ends with nothing - the lifecycle close is a bus signal, not an event -
       and the words must be there all the same. */
    assert.equal(c.subagentReplay.beforeSettle, 1, 'the streamed words were not on screen');
    assert.equal(c.subagentReplay.afterSettle, 1,
      `settling rendered ${c.subagentReplay.afterSettle} blocks, so the replay is still blank`);
    assert.ok(c.subagentReplay.text.includes('four carry the stale tag'),
      `the settled block lost the words (got ${JSON.stringify(c.subagentReplay.text)})`);
  } finally {
    await chrome.close();
  }
});


/* ------------------------------------------------------- the busy ladder */

test('the turn is never silently busy: every stage names itself', async () => {
  const chrome = await Chrome.launch();
  try {
    await chrome.open(pathToFileURL(resolve(here, 'dom/turn-fixture.html')).href);
    const c = await waitForCensus(chrome);
    /* Fifteen seconds of nothing between send and the model's first signal
       read as a stalled session. The SDK already brackets the turn - user-turn
       to turn-end - so busy needs no new provider surface, only showing. */
    assert.equal(c.busy.afterSend, 'working', 'the send-to-first-signal gap is silent again');
    assert.equal(c.busy.duringTool, '', 'two pulses at once: the running tool row already says busy');
    assert.equal(c.busy.afterResult, 'working', 'the result-to-next-move gap is silent again');
    assert.equal(c.busy.whileThinking, 'thinking');
    assert.equal(c.busy.whileWriting, '', 'visibly streaming text is its own signal');
    assert.equal(c.busy.afterEnd, '', 'the indicator outlived its turn');
    assert.equal(c.busy.plainStreamShows, '',
      'the indicator sat under visibly streaming text, repeating what the caret says');
  } finally {
    await chrome.close();
  }
});
