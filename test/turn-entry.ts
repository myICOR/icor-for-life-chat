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
import { Normalizer } from '../src/sdk/normalize';
import RECORDED from './fixtures/recorded-turn.json';

declare global {
  interface Window {
    aicTurn?: {
      messageNodes: number;
      rawNodes: number;
      structuredNodes: number;
      texts: string[];
    };
  }
}

async function mount(): Promise<void> {
  const leaf = document.body.createDiv({ cls: 'workspace-leaf-content' });
  const root = leaf.createDiv({ cls: 'view-content' });
  const pane = buildPane(root, {
    composer: { streaming: false, mode: 'default', model: 'opus', effort: 'high' },
    callbacks: {
      onSubmit: () => {}, onStop: () => {}, onModeChange: () => {},
      onModelChange: () => {}, onEffortChange: () => {}, onAttach: () => {},
    },
    badge: { navigate: () => {} },
  });

  const stream = new StreamRenderer(
    {} as App,
    new Component() as never,
    pane.column,
    '',
    {
      onApproval: () => {},
      // Structured replies are the shipped default, and the format is the whole
      // point of the product: the census runs in the mode users are actually in.
      structured: () => true,
      renderHost: {
        home: '/', insertCode: () => {}, openFile: () => {}, revealFile: () => {},
        openUrl: () => {}, copy: () => {}, decisionState: () => null,
      },
      onDecisions: () => {},
    },
  );
  stream.appendUserWell('Give me a structured reply about yourself.', null);

  const normalizer = new Normalizer();
  for (const frame of RECORDED as unknown[]) {
    for (const event of normalizer.normalize(frame)) {
      if (event.stream === null) stream.apply(event);
    }
  }
  // finalizeMarkdown is async; let its microtasks settle before the census.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const raw = Array.from(pane.column.querySelectorAll(':scope > .aic-assistant'));
  const structured = Array.from(pane.column.querySelectorAll(':scope > .aic-structured'));
  window.aicTurn = {
    messageNodes: raw.length + structured.length,
    rawNodes: raw.length,
    structuredNodes: structured.length,
    texts: [...raw, ...structured].map((el) => (el.textContent ?? '').slice(0, 80)),
  };
}

void mount();
