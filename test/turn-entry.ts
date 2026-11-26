/* THE ONE-TURN-ONE-NODE FIXTURE.
 *
 * A recorded turn, replayed through the SHIPPED Normalizer and the SHIPPED
 * StreamRenderer, mounted in a real browser. `test/fixtures/recorded-turn.json`
 * is verbatim wire traffic from the Claude Code CLI (captured by
 * `tools/frames-entry.ts`), not a shape somebody assumed, because the defect it
 * guards lives in the disagreement between two frame kinds and a hand-typed
 * sequence would simply agree with whichever one its author had in mind.
 *
 * The census this exposes is deliberately structural rather than visual: it
 * counts the message nodes the renderer put in the column. One assistant turn
 * is one node. Two nodes means two producers, and the raw one is the streamed
 * block that was never finalised because the final event named a different id. */

import { Component } from 'obsidian';
import type { App } from 'obsidian';
import { buildPane } from '../src/view/pane';
import { StreamRenderer } from '../src/view/stream/StreamRenderer';
import { Normalizer } from '../src/provider/claude/normalize';
import RECORDED from './fixtures/recorded-turn.json';

declare global {
  interface Window {
    aicTurn?: {
      messageNodes: number;
      renderedNodes: number;
      texts: string[];
      /* The state of the column at the moment the LAST text delta had arrived
         and the final event had not: the reply streams into the one node it
         will end in. */
      mid: {
        assistantNodes: number;
        columnText: string;
        working: boolean;
        workingLabel: string;
        workingReadable: boolean;
        workingOpen: boolean;
        workingBody: string;
      };
      /** After clicking the indicator: the reasoning must actually open. */
      opened: { workingOpen: boolean; workingBody: string };
      /** The user's own turn, with the pictures it was sent with. */
      user: { images: number; srcPrefix: string; alt: string; text: string };
    };
  }
}

/** What the column looks like right now, for the mid-stream census. */
function snapshot(column: HTMLElement): Window['aicTurn'] extends undefined ? never : NonNullable<Window['aicTurn']>['mid'] {
  const working = column.querySelector('.aic-thinking');
  const body = column.querySelector('.aic-thinking-body');
  return {
    assistantNodes: column.querySelectorAll(':scope > .aic-assistant').length,
    columnText: (column.textContent ?? '').trim(),
    working: !!working,
    workingLabel: (column.querySelector('.aic-thinking-label')?.textContent ?? '').trim(),
    workingReadable: !!working?.classList.contains('is-readable'),
    workingOpen: !!working?.classList.contains('is-open'),
    workingBody: (body?.textContent ?? '').trim(),
  };
}

async function mount(): Promise<void> {
  const leaf = document.body.createDiv({ cls: 'workspace-leaf-content' });
  const root = leaf.createDiv({ cls: 'view-content' });
  const pane = buildPane(root, {
    composer: { streaming: false, mode: 'default', model: 'opus', effort: 'high' },
    callbacks: {
      onSubmit: () => {}, onStop: () => {}, onModeChange: () => {},
      onModelChange: () => {}, onEffortChange: () => {},
    },
  });

  /* Every path the context pill asked to open. The pill named a note and did
     nothing before this: a dead end that looks like a link. */
  const opened: string[] = [];
  const stream = new StreamRenderer(
    {} as App,
    new Component() as never,
    pane.column,
    '',
    {
      onApproval: () => {},
      renderHost: { openFile: (path: string) => { opened.push(path); } },
    },
  );
  /* THE USER'S OWN TURN, with a picture on it. A 1x1 PNG is enough: the census
     is that an <img> exists carrying the bytes that were sent, not that the
     bytes are interesting. */
  const PNG_1X1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  stream.appendUserWell(
    'Tell me about yourself.',
    '2026-08-31',
    [{ name: 'pasted.png', mediaType: 'image/png', data: PNG_1X1 }],
    '00 Daily Scratchpad/2026/08/2026-08-31.md',
  );

  const normalizer = new Normalizer();
  /* The census is taken at the LAST moment before the final event, so it
     can say the streamed text is already in the node the final lands on. */
  const events = [];
  for (const frame of RECORDED as unknown[]) {
    for (const event of normalizer.normalize(frame)) {
      if (event.stream === null) events.push(event);
    }
  }
  const lastFinal = events.findLastIndex((e) => e.kind === 'text-final' && e.text.trim());
  let mid = snapshot(pane.column);
  events.forEach((event, i) => {
    if (i === lastFinal) mid = snapshot(pane.column);
    stream.apply(event);
  });
  // finalizeMarkdown is async; let its microtasks settle before the census.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const raw = Array.from(pane.column.querySelectorAll(':scope > .aic-assistant'));
  const rendered = raw.filter((el) => el.classList.contains('is-rendered'));

  /* THE DISCLOSURE ACTUALLY OPENS. Re-shown deliberately: the indicator is
     removed when the turn ends, so this drives it the way a user does mid-turn -
     reasoning has arrived, the head is clicked, the box shows it. Asserting the
     class without clicking would be a gate whose green is reachable without the
     control working. */
  stream.apply({ kind: 'thinking-open', blockId: 'probe', stream: null });
  stream.apply({ kind: 'thinking-delta', blockId: 'probe', text: 'weighing the two options', stream: null });
  const head = pane.column.querySelector('.aic-thinking-head') as HTMLElement | null;
  head?.click();
  const openedEl = pane.column.querySelector('.aic-thinking');
  const thinkingOpened = {
    workingOpen: !!openedEl?.classList.contains('is-open'),
    workingBody: (pane.column.querySelector('.aic-thinking-body')?.textContent ?? '').trim(),
  };

  const well = pane.column.querySelector('.aic-user');
  const img = well?.querySelector('.aic-user-image-img') as HTMLImageElement | null;
  const imageBtn = well?.querySelector('.aic-user-image') as HTMLElement | null;
  const pill = well?.querySelector('.aic-user-context .aic-chip') as HTMLElement | null;

  /* THE PILL OPENS ITS NOTE, driven by a real click. */
  pill?.click();

  /* THE IMAGE OPENS FULL SIZE, and the backdrop closes it again. Both driven,
     because an assertion on the class alone would pass on an overlay that is
     mounted and inert. */
  imageBtn?.click();
  const box = document.querySelector('.aic-lightbox');
  const lightbox = {
    openedAfterClick: !!box,
    src: (box?.querySelector('.aic-lightbox-img') as HTMLImageElement | null)?.getAttribute('src')?.slice(0, 22) ?? '',
    closedOnBackdrop: false,
    onBody: box?.parentElement === document.body,
    insidePane: !!(box && pane.root.contains(box)),
    position: box ? getComputedStyle(box).position : '',
  };
  (box as HTMLElement | null)?.click();
  lightbox.closedOnBackdrop = !document.querySelector('.aic-lightbox');

  /* THE CONVERSATION IS SELECTABLE. Obsidian's chrome is not, and a custom
     view inherits that: the whole transcript behaved like a picture of one. */
  /* A SECOND, ISOLATED RENDERER for the redacted-reasoning case. Isolated
     because the recorded turn may or may not carry reasoning text. Here there
     is provably none, so the indicator must not offer to open onto nothing. */
  const redactedHost = document.body.createDiv({ cls: 'aic-root' });
  const redactedCol = redactedHost.createDiv({ cls: 'aic-column' });
  const redactedStream = new StreamRenderer({} as App, new Component() as never, redactedCol, '', {
    onApproval: () => {},
    renderHost: { openFile: () => {} },
  });
  // Exactly what the provider sends: a thinking block that carries no words.
  redactedStream.apply({ kind: 'thinking-open', blockId: 'r0', stream: null });
  redactedStream.apply({ kind: 'thinking-delta', blockId: 'r0', text: '', stream: null });
  redactedStream.apply({ kind: 'text-open', blockId: 'r1', stream: null });
  redactedStream.apply({ kind: 'text-delta', blockId: 'r1', text: 'FELIX · the draft so far', stream: null });
  (redactedCol.querySelector('.aic-thinking-head') as HTMLElement | null)?.click();
  const redacted = {
    readable: !!redactedCol.querySelector('.aic-thinking')?.classList.contains('is-readable'),
    body: (redactedCol.querySelector('.aic-thinking-body')?.textContent ?? '').trim(),
  };

  /* THE BUSY LADDER, walked step by step. The defect: between send and the
     model's first signal - and again between a tool's result and the model's
     next move - the pane held perfectly still, and fifteen still seconds read
     as a stalled session. The label at each rung is read straight off the DOM
     after the exact event that should set it. */
  const busyHost = document.body.createDiv({ cls: 'aic-root aic-busy-probe' });
  const busyCol = busyHost.createDiv({ cls: 'aic-column' });
  const busyStream = new StreamRenderer({} as App, new Component() as never, busyCol, '', {
    onApproval: () => {},
    renderHost: { openFile: () => {} },
  });
  const busyLabel = (): string =>
    (busyCol.querySelector('.aic-thinking-label')?.textContent ?? '').trim();
  busyStream.apply({ kind: 'user-turn', text: 'go', contextNote: null, contextPath: null, images: [], stream: null });
  const afterSend = busyLabel();
  busyStream.apply({ kind: 'tool-call', toolUseId: 'bt1', name: 'Bash', target: 'ls', purpose: 'List the vault', input: {}, stream: null });
  const duringTool = busyLabel();
  busyStream.apply({ kind: 'tool-result', toolUseId: 'bt1', ok: true, detail: '', output: '', stream: null });
  const afterResult = busyLabel();
  busyStream.apply({ kind: 'thinking-open', blockId: 'bth', stream: null });
  const whileThinking = busyLabel();
  busyStream.apply({ kind: 'text-open', blockId: 'btx', stream: null });
  busyStream.apply({ kind: 'text-delta', blockId: 'btx', text: 'the answer so far', stream: null });
  const whileWriting = busyLabel();
  busyStream.apply({
    kind: 'turn-end', stream: null, durationMs: 1, isError: false, text: '',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, totalTokens: 2, costUsd: 0 },
    contextWindow: null,
  });
  const afterEnd = busyLabel();
  /* And the one place the indicator must NOT be: under visibly streaming
     text, where the caret is already the signal. */
  const plainHost = document.body.createDiv({ cls: 'aic-root' });
  const plainCol = plainHost.createDiv({ cls: 'aic-column' });
  const plainStream = new StreamRenderer({} as App, new Component() as never, plainCol, '', {
    onApproval: () => {},
    renderHost: { openFile: () => {} },
  });
  plainStream.apply({ kind: 'user-turn', text: 'go', contextNote: null, contextPath: null, images: [], stream: null });
  plainStream.apply({ kind: 'text-open', blockId: 'p1', stream: null });
  plainStream.apply({ kind: 'text-delta', blockId: 'p1', text: 'visible words', stream: null });
  const busy = {
    afterSend, duringTool, afterResult, whileThinking, whileWriting, afterEnd,
    plainStreamShows: (plainCol.querySelector('.aic-thinking-label')?.textContent ?? '').trim(),
  };

  /* THE SUBAGENT REPLAY SHAPE. A stored log ends with nothing: the lifecycle
     close is a bus signal, not an event in the log. `settleReplay` closes the
     run, and the words must be on screen before and after it. */
  const subHost = document.body.createDiv({ cls: 'aic-root aic-subreplay-probe' });
  const subCol = subHost.createDiv({ cls: 'aic-column' });
  const subStream = new StreamRenderer({} as App, new Component() as never, subCol, '', {
    onApproval: () => {},
    renderHost: { openFile: () => {} },
  });
  subStream.apply({ kind: 'text-open', blockId: 's1', stream: null });
  subStream.apply({ kind: 'text-delta', blockId: 's1', text: 'Counted 281 notes; ', stream: null });
  subStream.apply({ kind: 'text-delta', blockId: 's1', text: 'four carry the stale tag.', stream: null });
  const beforeSettle = subCol.querySelectorAll(':scope > .aic-assistant').length;
  subStream.settleReplay();
  await new Promise((r) => setTimeout(r, 0));
  const subagentReplay = {
    beforeSettle,
    afterSettle: subCol.querySelectorAll(':scope > .aic-assistant').length,
    text: (subCol.textContent ?? '').trim().slice(0, 80),
  };

  const streamEl = pane.root.querySelector('.aic-stream') as HTMLElement;
  const toolRow = pane.column.querySelector('.aic-tool') ?? streamEl.createEl('button');
  const select = {
    stream: getComputedStyle(streamEl).userSelect,
    toolRow: getComputedStyle(toolRow as HTMLElement).userSelect,
  };
  window.aicTurn = {
    messageNodes: raw.length,
    renderedNodes: rendered.length,
    texts: raw.map((el) => (el.textContent ?? '').slice(0, 80)),
    mid,
    opened: thinkingOpened,
    user: {
      images: well?.querySelectorAll('.aic-user-image-img').length ?? 0,
      srcPrefix: (img?.getAttribute('src') ?? '').slice(0, 22),
      alt: img?.getAttribute('alt') ?? '',
      text: (well?.querySelector('.aic-user-text')?.textContent ?? '').trim(),
      imageTag: imageBtn?.tagName ?? '',
      pillTag: pill?.tagName ?? '',
      pillOpened: opened.join(','),
    },
    lightbox,
    select,
    redacted,
    subagentReplay,
    busy,
  };
}

void mount();
