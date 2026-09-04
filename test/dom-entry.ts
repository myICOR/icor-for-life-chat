/* The computed-style fixture: the shipped view code, mounted in a real browser,
 * under a hostile host theme.
 *
 * Why this exists. The INKLINE theme states
 * `button:not(.clickable-icon)` at specificity (0,1,1). Every control this
 * plugin draws is a <button> stated by class. A single-class rule is (0,1,0),
 * so the HOST wins on background, color, border, box-shadow, font-family and
 * font-weight - silently, in the pixels, on a surface no unit test can see.
 * `test/fixtures/host-theme.css` reproduces that competing rule at the exact
 * specificity and paints it in sentinel colours, so any control that loses the
 * cascade computes to a value nothing in this plugin ever authored. */

import { Component } from 'obsidian';
import type { App } from 'obsidian';
import { Composer } from '../src/view/composer/Composer';
import { StreamRenderer } from '../src/view/stream/StreamRenderer';
import { Statusline } from '../src/view/composer/Statusline';
import { buildPane } from '../src/view/pane';
import { renderChipTray } from '../src/view/SubagentView';
import type { SubagentTranscript } from '../src/state/subagents';
import { renderStructured } from '../src/structured/render';
import { dot } from '../src/view/dom';
import type { StructuredDoc } from '../src/structured/model';
import type { TrackedDecision } from '../src/structured/decisions';
import type { ChatState } from '../src/model/types';
import { emptyState } from '../src/model/types';
import { Normalizer } from '../src/sdk/normalize';
import { DEFAULT_SETTINGS, MEASURED_NOTE, factVisibility } from '../src/model/settings';

import { reduce } from '../src/state/store';

const DOC: StructuredDoc = {
  structured: true,
  segments: [
    {
      kind: 'card',
      header: { name: 'FELIX', scope: 'the specificity sweep', status: 'COMPLETE' },
      blocks: [
        { kind: 'asked', text: 'Does the theme outrank the plugin on any control?' },
        { kind: 'answer', text: 'It did, on six properties and nine selectors.' },
        {
          kind: 'group',
          title: 'CONTROLS',
          rows: [
            { disposition: 'handled', label: 'send pill', value: '1', qualifier: null },
            { disposition: 'owned', label: 'badge', value: '2', qualifier: 'amber' },
            { disposition: 'unowned', label: 'code chip', value: '3', qualifier: null },
            { disposition: 'noted', label: 'agent chip', value: '4', qualifier: null },
          ],
        },
        { kind: 'insight', text: 'A specificity fix not counted against the competing selector is a guess.' },
        /* A FILES block, and it is here to keep a probe honest rather than to
           decorate the fixture. `.aic-icon-btn` used to reach the DOM through
           the composer's attach button, which was removed because it could not
           attach anything - and the hover sweep then had no node to measure,
           even though the class still ships on the file row's copy and open
           controls and on the mention toolbar. The probe now points at markup
           the product actually renders. */
        { kind: 'files', paths: ['/Users/t/vault/04 Inner World/INDEX.md'] },
      ],
    },
    {
      kind: 'decision',
      decision: {
        code: 'a1b2c',
        title: 'Raise every control rule',
        body: 'The two local !important patches were the same defect met twice, and they only ever covered borders.',
        variant: 'decision',
      },
    },
    /* The other two variants. Appended AFTER the plain one so every existing
       first-match selector still reads the block it was written for. */
    {
      kind: 'decision',
      decision: {
        code: 'b2c3d',
        title: 'The focus ring is dead in every room',
        body: 'all: unset resets outline-style, and the control layer now outranks the pen.',
        variant: 'blocked',
      },
    },
    {
      kind: 'decision',
      decision: {
        code: 'c3d4e',
        title: 'The composer border was a tie, not a loss',
        body: 'Four class repetitions clear the host input rule outright.',
        variant: 'cleared',
      },
    },
  ],
};

const TRACKED: TrackedDecision[] = [
  { code: 'a1b2c', title: 'Raise every control rule', variant: 'decision', index: 0, at: 0, resolved: false, mentions: [0] },
  { code: 'd3e4f', title: 'Room-split the status fallbacks', variant: 'decision', index: 1, at: 0, resolved: false, mentions: [1] },
];

const STATE = {
  sessionId: 'a-session-that-started',
  contextWindow: 200000,
  contextTokens: 22000,
  usage: { totalTokens: 112100, inputTokens: 84200, outputTokens: 27900, cacheReadTokens: 0, costUsd: 0 },
  subagents: {},
  turnStartedAt: null,
  sessionStartedAt: Date.UTC(2026, 7, 30, 0, 1),
  lastUpdatedAt: Date.UTC(2026, 7, 30, 0, 4),
  rateLimits: { utilization: 0.79, window: 'seven_day', status: 'allowed_warning' },
} as unknown as ChatState;

/* THE ABSENCE STATE. A first-time user's very first session, before any event
   has arrived, which is the state the whole 12 law is about: every readout
   unmeasured, therefore every readout ABSENT - no zero, no dash, no greyed
   digit, no placeholder. It is mounted as a real strip rather than asserted in
   the abstract, because the claim the user meets is a claim about what is on
   the screen. */
const ABSENT_STATE = emptyState();

/* The irreducible strip: the two budgets and nothing else. Its rendered width
   IS the narrow-pane floor, measured against the shipped face rather than
   computed from an advance width. */
const FLOOR_STATE = {
  ...emptyState(),
  sessionId: 'a-session-that-started',
  contextWindow: 100,
  contextTokens: 42,
  rateLimits: { utilization: 0.79, window: 'seven_day', status: 'allowed', resetsAt: null },
} as unknown as ChatState;

/* Every readout measured at once, so the ladder has something to remove. */
const FULL_STATE = {
  ...STATE,
  turnStartedAt: Date.UTC(2026, 7, 30, 0, 4),
  subagents: {
    a1: { agentId: 'a1', agentType: 't', description: '', status: 'running', startedAt: 0, endedAt: null },
  },
} as unknown as ChatState;

async function mount(): Promise<void> {
  /* The pane as Obsidian builds it: the view's contentEl carries `view-content`
     and sits inside `.workspace-leaf-content`, which is what makes app.css's
     `.workspace-leaf-content .view-content { padding }` a real competitor to the
     plugin's own root rule. Without the wrapper the root's specificity claim is
     untested and its passing state is reachable without being true. */
  const leaf = document.body.createDiv({ cls: 'workspace-leaf-content' });
  const root = leaf.createDiv({ cls: 'view-content' });

  /* THE PANE ITSELF, FROM SHIPPED CODE.
   *
   * This used to be hand-assembled here, so every assertion about the pane -
   * the rung order, and the nesting property that keeps the statusline strip
   * outside the composer card - was pointed at a replica. Proved by mutation:
   * undoing that nesting in `ChatView.ts` left the suite 144/144 green, and
   * only the same edit HERE went red. The
   * two trees did not agree either, this file put the chip tray on the root
   * and dropped `is-empty`.
   *
   * `buildPane` is the function `ChatView.onOpen` calls, so the skeleton under
   * test is now the skeleton that ships. Everything below mounts INTO it. */
  const pane = buildPane(root, {
    composer: { streaming: false, mode: 'default', model: 'opus', effort: 'medium' },
    callbacks: {
      onSubmit: () => {}, onStop: () => {}, onModeChange: () => {},
      onModelChange: () => {}, onEffortChange: () => {},
    },
    badge: { navigate: () => {} },
  });
  const column = pane.column;
  renderStructured(
    column,
    DOC,
    {
      home: '/',
      insertCode: () => {},
      openFile: () => {},
      revealFile: () => {},
      openUrl: () => {},
      copy: () => {},
      decisionState: (code) => TRACKED.find((d) => d.code === code) ?? null,
    },
    (el, text) => { el.setText(text); },
  );

  /* THE TOOL-ROW STATES, driven through the SHIPPED StreamRenderer.
   *
   * It is the difference between preventing the tenth ELEMENT and
   * preventing the tenth STATE. The previous fixture hand-typed one approval
   * row, so the sweep walked every element that EXISTED and reported clean
   * while `is-failed`, `is-running`, `.aic-send.is-stop` and three of the four
   * mode chips were never built at all - and all three of the HIGH findings
   * lived in exactly those states. A gate bounded by what the fixture mounts
   * reads as exhaustive and is not.
   *
   * Real events, real state machine: a row's class comes from `paintTool`
   * here, so it cannot drift from the product the way re-typed markup can. */
  /* THE WORKING INDICATOR, in its readable state, so the accent ink is
     MEASURED. It carries `--aic-marker` as text now, and a text ink that no
     fixture mounts is a text ink the contrast sweep never sees. Driven through
     the shipped renderer with real events - a hand-typed replica would only
     ever agree with itself. */
  const thinkingHost = document.body.createDiv({ cls: 'aic-root aic-thinking-probe' });
  const thinkingCol = thinkingHost.createDiv({ cls: 'aic-column' });
  const thinkingStream = new StreamRenderer(
    {} as App,
    new Component() as never,
    thinkingCol,
    '',
    {
      onApproval: () => {},
      structured: () => true,
      renderHost: {
        home: '/', insertCode: () => {}, openFile: () => {}, revealFile: () => {},
        openUrl: () => {}, copy: () => {}, decisionState: () => null,
      },
      onDecisions: () => {},
    },
  );
  thinkingStream.apply({ kind: 'thinking-open', blockId: 'tp0', stream: null });
  thinkingStream.apply({ kind: 'thinking-delta', blockId: 'tp0', text: 'weighing the options', stream: null });

  const stream2 = new StreamRenderer(
    {} as App,
    new Component() as never,
    column,
    '',
    {
      onApproval: () => {},
      structured: () => false,
      renderHost: {
        home: '/', insertCode: () => {}, openFile: () => {}, revealFile: () => {},
        openUrl: () => {}, copy: () => {}, decisionState: () => null,
      },
      onDecisions: () => {},
    },
  );
  const ev = <T extends Record<string, unknown>>(body: T): never =>
    ({ ...body, stream: 'main' }) as never;
  stream2.apply(ev({ kind: 'tool-call', toolUseId: 't1', name: 'Read', target: 'note.md', purpose: 'Read note.md', input: {} }));
  stream2.apply(ev({ kind: 'tool-call', toolUseId: 't2', name: 'Bash', target: 'ls', purpose: 'List the vault root', input: {} }));
  stream2.apply(ev({ kind: 'tool-result', toolUseId: 't2', ok: true, detail: '', output: '' }));
  stream2.apply(ev({ kind: 'tool-call', toolUseId: 't3', name: 'Edit', target: 'locked.md', purpose: 'Edited locked.md', input: {} }));
  stream2.apply(ev({ kind: 'tool-result', toolUseId: 't3', ok: false, detail: 'permission denied', output: 'permission denied' }));
  stream2.apply(ev({ kind: 'tool-approval', toolUseId: 't4', name: 'Write', target: '06 AI Team/note.md', purpose: 'Wrote 06 AI Team/note.md' }));
  /* THE ROW THE EXPANSION EXISTS FOR: a Bash call whose command is long and
     whose result has a body. The closed row says what it DID (the purpose)
     and never the command; the opened row shows both. */
  stream2.apply(ev({
    kind: 'tool-call', toolUseId: 't5', name: 'Bash',
    target: 'cd "/Users/tom/Desktop/ICOR for Life" && python3 "06 AI Team/AI Team Knowledge/Scripts/check-every-open-task-against-the-index.py" --verbose --since 2026-08-01',
    purpose: 'Check every open task against the index',
    input: {},
  }));
  stream2.apply(ev({
    kind: 'tool-result', toolUseId: 't5', ok: true, detail: '12 tasks checked',
    output: '12 tasks checked\n0 stale\n2 without an owner\ndone',
  }));
  /* AND THE ROW THAT MUST STAY INERT: no argument, no output, so nothing to
     open. The claim is not "rows expand", it is "rows with a body expand and
     rows without one do not pretend to". */
  stream2.apply(ev({ kind: 'tool-call', toolUseId: 't8', name: 'TodoWrite', target: '', purpose: 'Updated the plan', input: {} }));
  stream2.apply(ev({ kind: 'tool-result', toolUseId: 't8', ok: true, detail: '', output: '' }));

  /* Handed to the gate so it can drive the SHIPPED renderer for one more
     event after opening a row. "Does an expanded row survive a re-render" is a
     question about the stream, and the only honest way to ask it is to make
     the stream render again. */
  Object.assign(window, { aicStream: stream2, aicEvent: ev });

  /* The state-dot strip. Built with the shipped `dot()` helper so the classes
     under test are the classes the product emits; the strip exists because the
     dots are the amber, green and red devices 11.2 and 4 measure, and three of
     them only appear on states a static fixture cannot reach. */
  const probe = column.createDiv({ cls: 'aic-probe' });
  for (const tone of ['marker', 'warning', 'destructive', 'success', 'faint'] as const) dot(probe, tone);

  /* The subagent header, back-chevron-less since 2026-09-01: the tab is the
     wayfinding, and the chevron's reveal opened a second chat from some
     workspaces. The kicker row stays measured. */
  const subHeader = column.createDiv({ cls: 'aic-sub-header' });
  const subKicker = subHeader.createDiv({ cls: 'aic-sub-kicker' });
  subKicker.createSpan({ cls: 'aic-kicker aic-sub-type', text: 'AGENT' });

  /* Rung 2, painted by the shipped `renderChipTray` rather than hand-typed:
     the chip's markup, its status dot and its `is-empty` toggle all come from
     the function the view calls. `.aic-chips.is-empty` is `display: none`, so
     a hand-built tray that never cleared the class would have hidden the agent
     chip from the visibility-filtered text sweep. */
  renderChipTray(pane.chipTray, [{
    agentId: 'a1', agentType: 'IRIS', description: '', task: '',
    status: 'running', startedAt: Date.now() - 120000, endedAt: null,
    events: [], openedAt: null, sessionId: null, tokens: 0, toolCalls: 0,
  } as SubagentTranscript], () => {});

  const composer = pane.composer;
  pane.badge.render(TRACKED);
  /* Rung 4, mounted by `buildPane`: the pane's last child, outside the composer
     card and outside its :focus-within scope. */
  pane.statusline.render(STATE, Date.UTC(2026, 7, 30, 0, 6));
  composer.renderTray([{ icon: 'file-text', label: 'note.md', detail: '2 SEL', onDismiss: () => {} }]);

  /* The frame that decides the enabled-send case: a composer with TEXT IN IT.
     The enabled send
     pill is the view's one marker moment, and it is the state no capture had. */
  const textarea = composer.el.querySelector('textarea.aic-input') as HTMLTextAreaElement;
  textarea.value = 'Sweep the control rules above the theme.';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  /* AN ATTACHED IMAGE, through the shipped attach path.
     The thumbnail and its remove control are a surface a static fixture cannot
     reach: they exist only after a file has been decoded, so before this the
     text sweep and the focus sweep both went green over a strip that was never
     built. `attachFiles` is the same method paste and drop call. */
  await composer.attachFiles([probeImage()]);

  await mountStates(root);
  mountSettings();
}

/* A 1x1 PNG, which is the smallest thing the attach path accepts as real. The
   gate measures the CELL and its control, never the pixels inside. */
function probeImage(): File {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], 'probe.png', { type: 'image/png' });
}

/* ---------------------------------------------------------------- the states */

/* Mounted LAST, and that position is load-bearing: every `document.querySelector`
 * in the probe reads a first match, so the primary composer, the primary facts
 * strip and the plain decision block must all stay earlier in the document than
 * their state twins. A state probe placed higher would silently retarget half
 * the gate. */
async function mountStates(root: HTMLElement): Promise<void> {
  const probe = root.createDiv({ cls: 'aic-state-probe' });

  /* The four mode chips, each ACTIVE in turn. Three of the four were never
     built before, and two of them carried round-2 HIGHs. Real Composers, so the
     `is-active` + `data-tone` pair comes from `paint()` rather than from here. */
  const noop = {
    onSubmit: () => {}, onStop: () => {}, onModeChange: () => {},
    onModelChange: () => {}, onEffortChange: () => {},
  };
  for (const mode of ['plan', 'default', 'acceptEdits', 'bypassPermissions'] as const) {
    const host = probe.createDiv({ cls: `aic-mode-probe is-${mode}` });
    new Composer(host, { streaming: false, mode, model: 'opus', effort: 'medium' }, noop);
  }

  /* THE FRESH PANE'S MODEL TRIGGER. Tom's directive, verbatim: "don't show
     'default' model but the actual model that is active." A fresh pane has no
     session, so the actual model comes from the CLI's own settings cascade,
     resolved without one, and presetModel() is the seam it arrives through.
     Three probes: the resolved face, the precedence rule (a session's word
     always outranks the preset, in either arrival order), and the unresolved
     fallback - which must be the RARE path, not the fresh-vault default. */
  const face = (host: HTMLElement): string =>
    (host.querySelector('.aic-text-btn')?.textContent ?? '').trim();
  const freshHost = probe.createDiv({ cls: 'aic-model-preset-probe' });
  const fresh = new Composer(freshHost, { streaming: false, mode: 'default', model: '', effort: 'medium' }, noop);
  fresh.presetModel('fable');
  freshHost.setAttr('data-face', face(freshHost));

  const lateHost = probe.createDiv({ cls: 'aic-model-late-probe' });
  const late = new Composer(lateHost, { streaming: false, mode: 'default', model: '', effort: 'medium' }, noop);
  late.setModel('claude-opus-4-6');
  late.presetModel('fable');
  lateHost.setAttr('data-face', face(lateHost));

  const bareHost = probe.createDiv({ cls: 'aic-model-bare-probe' });
  new Composer(bareHost, { streaming: false, mode: 'default', model: '', effort: 'medium' }, noop);
  bareHost.setAttr('data-face', face(bareHost));

  /* The Stop pill: `.aic-send.is-stop`, which only exists mid-turn. */
  const stopHost = probe.createDiv({ cls: 'aic-stop-probe' });
  new Composer(stopHost, { streaming: true, mode: 'default', model: 'opus', effort: 'medium' }, noop);

  /* An escalated-to-DANGER statusline fact: `rejected` is the provider status
     that produces it, so the tone comes from facts.ts and not from a class. */
  const dangerFacts = probe.createDiv({ cls: 'aic-facts aic-facts-probe' });
  new Statusline(dangerFacts).render(
    { ...STATE, rateLimits: { utilization: 0.97, window: 'seven_day', status: 'rejected' } } as unknown as ChatState,
    Date.UTC(2026, 7, 30, 0, 6),
  );

  /* THE ABSENCE CASE, as a real strip. With no event there are no digits, no
     cells and no height - the strip is not rendered rather than rendered
     empty. A build that printed a zero here would put a character in this
     element, which is what the gate reads. */
  const absent = probe.createDiv({ cls: 'aic-facts aic-facts-absent' });
  new Statusline(absent).render(ABSENT_STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* THE WHOLE PATH, from raw provider messages to rendered digits. Every other
     strip on this page is driven from a state this file wrote; this one is
     driven by the shipped Normalizer and the shipped reducer, so it answers the
     question the absence law makes unanswerable by looking: a first-run strip
     and a broken strip are the same picture, and only a real turn tells them
     apart. */
  const liveTurn = probe.createDiv({ cls: 'aic-facts aic-facts-liveturn' });
  {
    const n = new Normalizer();
    let st = emptyState();
    for (const raw of [
      {
        type: 'system', subtype: 'init', session_id: '7f3c1a2e-0000-4000-8000-0123456789ab',
        model: 'claude-opus-4-6', cwd: '/vault', permissionMode: 'default', slash_commands: [],
      },
      {
        type: 'result', subtype: 'success', is_error: false, duration_ms: 72000, result: 'done',
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 24200, output_tokens: 27900,
          cache_read_input_tokens: 811000, cache_creation_input_tokens: 60000,
        },
        modelUsage: { 'claude-opus-4-6': { contextWindow: 1000000 } },
      },
    ]) {
      for (const event of n.normalize(raw)) st = reduce(st, event);
    }
    /* The DEFAULT switches, not every readout on. This probe is meant to be
       what a user sees out of the box after one turn, so the combination is the
       shipped one. */
    new Statusline(liveTurn, () => factVisibility(DEFAULT_SETTINGS)).render(st, Date.UTC(2026, 7, 30, 0, 6));
  }

  /* A LIVE SESSION WITH NOTHING MEASURED YET, which is every first-run
     session. The bar is 24px and carries its hairline from the first session
     event onward, and it prints nothing at all - the strip reflows once, not
     again at the first turn-end. */
  const live = probe.createDiv({ cls: 'aic-facts aic-facts-live-empty' });
  new Statusline(live).render(
    { ...emptyState(), sessionId: 'a-session-that-started' } as unknown as ChatState,
    Date.UTC(2026, 7, 30, 0, 6),
  );

  /* EVERY READOUT SWITCHED OFF on a live session: back to zero height and no
     hairline. Absence, not an empty bar. */
  const allOff = probe.createDiv({ cls: 'aic-facts aic-facts-all-off' });
  new Statusline(allOff, () => ({
    context: false, plan: false, tokensIn: false, tokensOut: false,
    elapsed: false, agents: false, sessionStart: false, sessionUpdated: false,
  })).render(STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* THE FLOOR, measured rather than trusted. `width: max-content` makes the
     strip report its own natural width, so the number the gate prints is the
     narrowest pane the two budgets fit in, padding included. */
  const floorHost = probe.createDiv({ cls: 'aic-floor-host' });
  const floor = floorHost.createDiv({ cls: 'aic-facts aic-facts-floor' });
  floor.setCssStyles({ width: 'max-content' });
  new Statusline(floor).render(FLOOR_STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* A BUDGET BARELY TOUCHED: 1% consumed. The arc renders NOTHING and the
     track stands alone, because a round-capped speck at a 1.5px stroke asserts
     a magnitude the measurement does not have. It is a branch, so it is a
     surface, so the fixture builds it. */
  const speck = probe.createDiv({ cls: 'aic-facts aic-facts-speck' });
  new Statusline(speck).render(
    { ...emptyState(), sessionId: 'a-session-that-started', contextWindow: 1000, contextTokens: 10 } as unknown as ChatState,
    Date.UTC(2026, 7, 30, 0, 6),
  );

  /* THE SAME EIGHT FACTS in a pane wide enough for all of them. It is the
     control for the ladder below: without it, "the narrow strip has fewer
     facts" is a claim with no baseline, and a build that simply stopped
     rendering four readouts would satisfy it. */
  const fullHost = probe.createDiv({ cls: 'aic-full-host' });
  fullHost.setCssStyles({ width: '900px' });
  const full = fullHost.createDiv({ cls: 'aic-facts aic-facts-full' });
  new Statusline(full).render(FULL_STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* NARROWER THAN THE FLOOR. The ladder runs out of readouts to remove and the
     two budgets still do not fit whole, so the strip renders NOTHING - not a
     clipped `CTX USED 4`. This is the state that makes the measured floor safe
     to state as a band: a wider face cannot produce a clipped number, it can
     only empty the strip one pane-width earlier. */
  const crushHost = probe.createDiv({ cls: 'aic-crush-host' });
  crushHost.setCssStyles({ width: '90px' });
  const crushed = crushHost.createDiv({ cls: 'aic-facts aic-facts-crushed' });
  new Statusline(crushed).render(FLOOR_STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* AND BACK AGAIN, THROUGH THE RESIZE PATH ALONE. The crush hides the strip,
     and a hidden box never resizes, so a strip watching its own size can go
     dark once and stay dark - and a user who narrows a leaf and widens it
     again never sends an event, so nothing would re-render it.

     It is widened and then LEFT ALONE. An earlier version of this probe called
     render() again after widening, which restores the strip through a path
     that was never in question: it went green against a build watching its own
     box with no restore-before-measure, which is the exact defect it is here
     to catch. A recovery probe that re-renders is testing render. */
  const recoverHost = probe.createDiv({ cls: 'aic-recover-host' });
  recoverHost.setCssStyles({ width: '90px' });
  const recovered = recoverHost.createDiv({ cls: 'aic-facts aic-facts-recovered' });
  new Statusline(recovered).render(FLOOR_STATE, Date.UTC(2026, 7, 30, 0, 6));
  /* TWO cycles, and the second one is the measurement. A ResizeObserver
     delivers an entry for a newly observed element no matter what its box is,
     so the FIRST widen recovers even for a strip watching its own box - that
     initial delivery is still pending when the crush happens. Only from the
     second cycle on does a hidden element stop being reported at all. A
     one-cycle probe went green against exactly the build this exists to
     catch. */
  for (const width of ['600px', '90px', '600px']) {
    await frame();
    await frame();
    recoverHost.setCssStyles({ width });
  }

  /* THE LADDER, in a pane too narrow for eight facts. Measured removal, never
     clipping: whatever survives must fit whole. */
  const narrowHost = probe.createDiv({ cls: 'aic-narrow-host' });
  narrowHost.setCssStyles({ width: '260px' });
  const narrow = narrowHost.createDiv({ cls: 'aic-facts aic-facts-narrow' });
  new Statusline(narrow).render(FULL_STATE, Date.UTC(2026, 7, 30, 0, 6));

  /* A ResizeObserver delivers BEFORE paint but AFTER the current task, so the
     widened host above has not been observed yet. Two frames, then the marker
     the driver waits on - and it is set last, so no probe can read a
     half-built page. Waiting on readyState alone measures a fixture that is
     still mounting and calls it green. */
  await frame();
  await frame();
  recovered.addClass('is-settled');
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/* The settings page is its own root, outside `.aic-root`, so nothing in the
   sweep ever reached it. `.aic-settings-index` spends the marker as 11px mono
   text and measured 4.57:1 in the paper room - it cleared the 4.5:1 floor by
   0.07, and a floor is a minimum rather than a target. */
function mountSettings(): void {
  const settings = document.body.createDiv({ cls: 'aic-settings' });
  const head = settings.createDiv({ cls: 'aic-settings-section' });
  head.createSpan({ cls: 'aic-settings-index', text: '01' });
  head.createSpan({ cls: 'aic-settings-name', text: 'PROVIDER' });
  /* The one prose line the STATUSLINE section carries. It is the whole answer
     to "why is my strip empty", so it is swept for legibility like every other
     string: documentation nobody can read is the same as no documentation. The
     text comes from the shipped constant rather than being re-typed here. */
  const kicker = settings.createDiv({ cls: 'aic-settings-section' });
  kicker.createSpan({ cls: 'aic-settings-index', text: '03' });
  kicker.createSpan({ cls: 'aic-settings-name', text: 'STATUSLINE' });
  settings.createDiv({ cls: 'aic-settings-note', text: MEASURED_NOTE });
}

void mount();
