/* THE COMPUTED-STYLE GATE.
 *
 * Every other test in this suite reasons about data. This one reasons about
 * PIXELS, because the defect it guards is invisible to data: the host theme
 * states `button:not(.clickable-icon)` at (0,1,1) and every control this plugin
 * draws by a single class is (0,1,0), so the theme silently repaints the send
 * pill, the badge, the code chip and both approval buttons - and the stylesheet
 * still reads exactly as authored.
 *
 * The gate mounts the SHIPPED components in headless Chrome under a hostile
 * host theme whose sentinel colours appear nowhere in the design system, then
 * reads getComputedStyle. Two claims are asserted separately and neither one
 * implies the other: nothing computes to a sentinel (the plugin won), AND every
 * control computes to its authored token (the plugin won CORRECTLY).
 *
 * The last assertion is the one that matters most: a sweep over EVERY element
 * under .aic-root. Nine control rules were enumerated in the audit; the sweep
 * is what makes the tenth impossible. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Chrome } from './dom/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const CSS = readFileSync(resolve(repo, 'styles.css'), 'utf8');

/* ---------------------------------------------------------- the in-page probe */

/* The colour arithmetic, shared by every probe in this file. Kept as ONE
 * string so a second probe can never drift into a second definition of
 * `ratio` - two instruments disagreeing is how the transition frame got
 * through the first time. */
const HELPERS = `
  /* THE PROBE IS NESTED, and the nesting is the whole guard.
     \`color\` inherits, so a value that is invalid at computed-value time - an
     unresolvable var(), an empty string, a token name with a typo in it - leaves
     the declaration unset and the probe simply INHERITS whatever is above it.
     Read against ONE host colour that is indistinguishable from a real reading.
     Read against TWO, it is a fact. Before this, parse(''), parse('var(--nope)')
     and parse('NOT-A-COLOR') all returned opaque black, and \`token()\` feeds raw
     getPropertyValue() output straight in - so a misspelled or absent token
     measured as a real colour. An instrument that cannot read a value must say
     so; returning zero is worse than returning nothing, because zero is a
     number and the reading looks like data rather than like silence. */
  const probeHost = document.createElement('span');
  probeHost.style.display = 'none';
  const probeEl = document.createElement('span');
  probeHost.appendChild(probeEl);
  document.body.appendChild(probeHost);

  const INHERIT_A = 'rgb(1, 1, 1)';
  const INHERIT_B = 'rgb(2, 2, 2)';
  function paint(value, host) {
    probeHost.style.color = host;
    probeEl.style.color = '';
    probeEl.style.color = value;
    return getComputedStyle(probeEl).color;
  }

  /* A computed colour may serialise as rgb(), rgba() or color(srgb ...) - Chrome
     re-serialises exactly when you change the function you wrote it with, which
     is exactly when you are testing. Parse, never string-compare. And THROW on
     anything else: oklch() and color(display-p3 ...) used to fall through to a
     transparent-black fallback, which as a foreground fails loudly but as a
     BACKGROUND makes the layer vanish out of ground() and understates the
     ground - the direction that eventually passes a real failure. Neither
     function is in styles.css today; this is the trap set for the next author. */
  function parse(value) {
    const s = paint(value, INHERIT_A);
    // One read on the fast path. The second only happens when the first landed
    // on the host colour, which a real rgb(1, 1, 1) also does - and then agrees.
    if (s === INHERIT_A && paint(value, INHERIT_B) !== s) {
      throw new Error('parse(): ' + JSON.stringify(value) + ' is not a colour - the probe INHERITED it, '
        + 'so the value was empty, misspelled, or an unresolvable var(). It used to read as opaque black.');
    }
    let m = s.match(/^rgba?\\(([^)]+)\\)$/);
    if (m) {
      const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    m = s.match(/^color\\(srgb ([^)]+)\\)$/);
    if (m) {
      const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
    throw new Error('parse(): Chrome serialised ' + JSON.stringify(value) + ' as ' + s
      + ', which this parser does not read. Teach it the function rather than letting the layer vanish.');
  }
  const key = (c) => c.a === 0 ? 'transparent'
    : [Math.round(c.r), Math.round(c.g), Math.round(c.b), Math.round(c.a * 1000) / 1000].join(',');

  function over(fg, bg) {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function lum(c) {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  }
  /* The ground under an element: every translucent ancestor composited down to
     the first opaque one. Sampling the ground is what a contrast rule asks for;
     a ratio against a token that was never the visible ground is arithmetic
     about a colour nobody sees. */
  function ground(el) {
    const stack = [];
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0) stack.push(c);
      if (c.a === 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const html = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (html.a === 1) base = html;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }

`;



/* The one definition of "focusable", shared by the forcing driver and the probe
   that reads the result. Two lists would let the gate force a state on a set it
   does not measure, and measure a set it did not force. */
const FOCUSABLE_SEL = 'button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])';

const PROBE = `(() => {
  const out = {};
${HELPERS}
  const one = (sel) => document.querySelector(sel);
  function read(sel) {
    const el = one(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const g = ground(el);
    return {
      bg: key(parse(cs.backgroundColor)),
      padding: cs.padding,
      radius: cs.borderRadius,
      lineClamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') || 'none',
      borderLeft: key(parse(cs.borderLeftColor)),
      borderLeftWidth: cs.borderLeftWidth,
      fg: key(parse(cs.color)),
      borderTop: key(parse(cs.borderTopColor)),
      borderRight: key(parse(cs.borderRightColor)),
      borderBottom: key(parse(cs.borderBottomColor)),
      borderLeft: key(parse(cs.borderLeftColor)),
      borderLeftStyle: cs.borderLeftStyle,
      borderTopStyle: cs.borderTopStyle,
      borderTopWidth: cs.borderTopWidth,
      borderLeftWidth: cs.borderLeftWidth,
      font: cs.fontFamily,
      weight: cs.fontWeight,
      size: cs.fontSize,
      opacity: cs.opacity,
      boxShadow: cs.boxShadow,
      padding: cs.padding,
      lineClamp: cs.webkitLineClamp || cs['-webkit-line-clamp'] || '',
      display: cs.display,
      text: el.textContent,
      ariaLabel: el.getAttribute('aria-label'),
      disabled: el.disabled === true,
      /* SVG paints with stroke, not background-color, and stroke on an HTML
         element computes to none - which parse() refuses, correctly. So these
         are read only where they exist, and null everywhere else rather than a
         number that looks like a measurement. (No backticks: this is inside a
         template literal.) */
      stroke: el.namespaceURI === 'http://www.w3.org/2000/svg' ? key(parse(cs.stroke)) : null,
      strokeOnGround: el.namespaceURI === 'http://www.w3.org/2000/svg'
        ? ratio(over(parse(cs.stroke), g), g) : null,
      strokeWidth: cs.strokeWidth,
      strokeLinecap: cs.strokeLinecap,
      dashOffset: cs.strokeDashoffset,
      /* every ratio computed from real pixels, against the composited ground */
      fgOnGround: ratio(over(parse(cs.color), g), g),
      borderOnGround: ratio(over(parse(cs.borderTopColor), g), g),
      borderLeftOnGround: ratio(over(parse(cs.borderLeftColor), g), g),
      bgOnGround: ratio(over(parse(cs.backgroundColor), g), g),
      fgOnOwnBg: ratio(over(parse(cs.color), over(parse(cs.backgroundColor), g)), over(parse(cs.backgroundColor), g)),
      ground: key(g),
    };
  }

  /* The resolved value of a token, painted so it normalises the same way the
     control's own computed value does. */
  const root = one('.aic-root');
  function token(name) {
    return key(parse(getComputedStyle(root).getPropertyValue(name).trim()));
  }
  function mix(expr) { return key(parse(expr.replace(/var\\((--aic-[a-z-]+)\\)/g, (_, n) => getComputedStyle(root).getPropertyValue(n).trim()))); }

  /* THE PARSER'S OWN NEGATIVE CONTROL.
     The try/catch here is not a skipped assertion - it is the measurement.
     Each of these four values is one the parser used to answer with a NUMBER:
     three of them as opaque black, oklch() as transparent black, which silently
     removes a background layer from ground(). The test below asserts all four
     now refuse. An instrument is only trustworthy where it has been watched
     failing, and that includes the part of it that reads the colours. */
  out.parserGuard = [];
  for (const [label, value] of [
    ['empty', ''],
    ['unresolvable var', 'var(--aic-no-such-token)'],
    ['garbage', 'NOT-A-COLOR'],
    ['oklch', 'oklch(0.7 0.2 40)'],
    ['display-p3', 'color(display-p3 0.9 0.3 0.1)'],
  ]) {
    let threw = false, got = null;
    try { got = key(parse(value)); } catch (e) { threw = true; }
    out.parserGuard.push({ label, threw, got });
  }

  out.tokens = {};
  out.inkTokens = {};
  for (const n of ['--ink-warning', '--ink-success-dot', '--ink-hand-ink',
                   '--ink-destructive-text', '--ink-marker-fill', '--ink-marker-text']) {
    const raw = getComputedStyle(root).getPropertyValue(n).trim();
    out.inkTokens[n] = raw ? key(parse(raw)) : null;
  }
  for (const n of ['--aic-marker', '--aic-marker-up', '--aic-on-marker', '--aic-paper', '--aic-dim',
                   '--aic-faint', '--aic-hairline', '--aic-warning', '--aic-destructive',
                   '--aic-success-dot', '--aic-hand-ink', '--aic-input', '--aic-wash',
                   '--aic-hairline', '--aic-destructive-text',
                   '--aic-marker-fill', '--aic-marker-text', '--aic-hairline-subtle']) {
    out.tokens[n] = token(n);
  }
  out.mixes = {
    sendDisabled: mix('color-mix(in srgb, var(--aic-marker-fill) 55%, var(--aic-input))'),
    badgeFill: mix('color-mix(in srgb, var(--aic-warning) 22%, var(--aic-input))'),
  };
  out.fonts = {
    mono: getComputedStyle(root).getPropertyValue('--aic-mono').trim(),
    display: getComputedStyle(root).getPropertyValue('--aic-display').trim(),
  };

  out.el = {};
  /* CARDINALITY, RECORDED FOR EVERY SELECTOR IN THE MAP.
     A selector matching zero elements must FAIL before any property on it is
     examined. This is the general cure for the defect the ring found: when the
     budget's state dot became a ring, the old map still named the dot class,
     and read() answers null for a miss - so every assertion that reached for a
     property on it would have been skipped, or would have compared undefined
     to undefined, and the amber measurement would have reported green forever.
     The count is taken first, and the test below asserts all of them non-zero,
     so a dead selector is a red build rather than a silent one. */
  out.counts = {};
  for (const [name, sel] of Object.entries({
    root: '.aic-root',
    composer: '.aic-composer',
    send: '.aic-send',
    badge: '.aic-badge',
    codeChip: '.aic-code-chip',
    agentChip: '.aic-agent-chip',
    chipX: '.aic-chip-x',
    approveOnce: '.aic-approve-once',
    approveAlways: '.aic-approve-always',
    approveDeny: '.aic-approve-deny',
    /* There is no INACTIVE mode chip any more. The control is one always-active
       trigger, so the :not(.is-active) selector matched nothing and every
       assertion that named it was measuring a state the product cannot reach.
       The trigger's own ground and ink are covered by segActive and by the
       four per-tone rows the state probe mounts, so nothing was lost with it.
       (No backticks in here: this map is inside a template literal.) */
    segActive: '.aic-seg-btn.is-active',
    textBtn: '.aic-text-btn',
    providerBtn: '.aic-provider-btn',
    iconBtn: '.aic-icon-btn',
    textarea: 'textarea.aic-input',
    insight: '.aic-insight',
    decision: '.aic-decision',
    decisionBody: '.aic-decision-body',
    warnDot: '.aic-probe .aic-dot-warning',
    successDot: '.aic-probe .aic-dot-success',
    destructiveDot: '.aic-probe .aic-dot-destructive',
    rail: '.aic-rail',
    /* The warning DOT is gone from this strip and its absence is the ruling,
       not an omission: the ring REPLACES the state dot on a budget fact,
       because the dot job was already "how bad is this" and the ring is that
       dot with a magnitude. Only budgets escalate, so no fact here can carry a
       dot any more - a selector left aimed at the old dot class would have
       matched nothing and taken the amber measurement down with it silently.
       (No backticks in here: this map is inside a template literal.) */
    thinkingLabel: '.aic-thinking-probe .aic-thinking-label',
    thinkingHead: '.aic-thinking-probe .aic-thinking.is-readable .aic-thinking-head',
    bandAsked: '.aic-band-asked',
    bandAnswer: '.aic-band-answer',
    askedText: '.aic-asked-text',
    bandAnswerIcon: '.aic-band-answer .aic-band-icon',
    statusWarnArc: '.aic-facts .aic-fact.is-warning .aic-ring-arc',
    statusWarnTrack: '.aic-facts .aic-fact.is-warning .aic-ring-track',
    statusWarnFact: '.aic-facts .aic-fact.is-warning',
    statusWarnState: '.aic-facts .aic-fact.is-warning .aic-fact-state',
    /* The STATES. Every one of these is a surface the product reaches and the
       fixture never used to build; three of the four findings in one review
       lived in here. */
    segPlan: ".aic-seg-btn.is-active[data-tone='plan']",
    segAsk: ".aic-seg-btn.is-active[data-tone='default']",
    segAuto: ".aic-seg-btn.is-active[data-tone='acceptEdits']",
    segBypass: ".aic-seg-btn.is-active[data-tone='bypassPermissions']",
    sendStop: '.aic-stop',
    sendQueue: '.aic-send.is-queue',
    userQueued: '.aic-user.is-queued .aic-user-queued',
    toolRunningName: '.aic-tool.is-running .aic-tool-purpose',
    toolFailedName: '.aic-tool.is-failed .aic-tool-purpose',
    toolFailedGlyph: '.aic-tool.is-failed .aic-glyph-fail',
    toolSummary: '.aic-tool-summary',
    decisionBlocked: '.aic-decision.is-blocked',
    decisionCleared: '.aic-decision.is-cleared',
    dangerArc: '.aic-facts-probe .aic-fact.is-danger .aic-ring-arc',
    dangerFact: '.aic-facts-probe .aic-fact.is-danger',
    dangerLabel: '.aic-facts-probe .aic-fact.is-danger .aic-fact-label',
    dangerDir: '.aic-facts-probe .aic-fact.is-danger .aic-fact-dir',
    dangerValue: '.aic-facts-probe .aic-fact.is-danger .aic-fact-value',
    dangerState: '.aic-facts-probe .aic-fact.is-danger .aic-fact-state',
    settingsIndex: '.aic-settings-index',
    /* The attachment strip: new controls, and a new control that is not in this
       map is a control the loser sweep walks past by name even though it still
       walks it by element.

       This entry used to be the bare chevron class, aimed at the pickers. The
       pickers no longer draw one, and the class survives on the TOOL ROW - so
       the bare selector would have gone on matching, gone on measuring, and
       gone on reporting green while the thing it named had been deleted. It is
       scoped to the element that still has the job. (No backticks in here:
       this map is inside a template literal.) */
    toolChevron: '.aic-tool-summary .aic-chevron',
    toolRowExpandable: '.aic-tool.is-expandable',
    /* The reply surface: the action bar's buttons under a reply and under
       the user's own well, and the sentence a collapsed group now says. */
    actionBar: '.aic-assistant .aic-actions',
    actionBtn: '.aic-assistant .aic-reply-btn',
    actionMore: '.aic-action-more',
    userActionBtn: '.aic-user .aic-reply-btn',
    toolSummaryText: '.aic-tool-summary-text',
    toolSummaryCount: '.aic-tool-summary-count',
    thumb: '.aic-thumb',
    thumbX: '.aic-thumb-x',
  })) {
    out.counts[name] = document.querySelectorAll(sel).length;
    out.el[name] = read(sel);
  }

  /* The pane census as a NESTING property: no rung may be a DESCENDANT
     of another, and their document order must be 1, 2, 3, 4. Bare groundless
     wrappers between rungs are legal, so this can never be a direct-children
     check. */
  {
    const RUNGS = [['stream', '.aic-stream'], ['chips', '.aic-chips'],
                   ['composer', '.aic-composer'], ['facts', '.aic-facts']];
    const nodes = RUNGS.map(([n, sel]) => [n, one(sel)]).filter(([, el]) => el);
    const ordered = nodes.slice().sort((a, b) =>
      (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const nested = [];
    for (const [n1, e1] of nodes) for (const [n2, e2] of nodes) {
      if (e1 !== e2 && e1.contains(e2)) nested.push(n2 + ' inside ' + n1);
    }
    const factsEl = one('.aic-facts');
    const composerEl = one('.aic-composer');
    const fcs = factsEl ? getComputedStyle(factsEl) : null;
    out.facts = {
      censusOrder: ordered.map(([n]) => n).join(','),
      nested,
      insideComposer: !!(factsEl && composerEl && composerEl.contains(factsEl)),
      borderTopStyle: fcs ? fcs.borderTopStyle : null,
      borderTop: fcs ? key(parse(fcs.borderTopColor)) : null,
      height: fcs ? fcs.height : null,
      padding: fcs ? fcs.padding : null,
      marginTop: fcs ? fcs.marginTop : null,
      margin: fcs ? fcs.margin : null,
      dockPaddingBottom: (() => {
        const dock = one('.aic-dock');
        return dock ? getComputedStyle(dock).paddingBottom : null;
      })(),
    };
  }

  /* THE SETTINGS NOTE and the tool row's motion fence. */
  {
    const note = one('.aic-settings-note');
    const row = document.querySelector('.aic-tool.is-expandable');
    const rcs = row ? getComputedStyle(row) : null;
    out.measuredNote = note ? {
      text: (note.textContent || '').trim(),
      size: getComputedStyle(note).fontSize,
      family: getComputedStyle(note).fontFamily,
      transform: getComputedStyle(note).textTransform,
    } : null;
    /* The DURATION is read pre-freeze by MOTION_PROBE; only the resting cursor
       belongs in this pass. A field read here that the freeze has already
       zeroed would be a measurement of the harness. */
    out.rowMotion = rcs ? { cursor: rcs.cursor } : null;
  }

  /* THE TOOL ROWS, and whether the one thing a user came to read is reachable.
     Two claims that only mean something together: a row with a BODY (a raw
     argument or a result) opens, and a row with neither does not pretend to.
     And a third that is the whole point of the row: the closed row shows the
     PURPOSE sentence, never the command. */
  out.toolRows = Array.from(document.querySelectorAll('.aic-tool')).map((r) => {
    const p = r.querySelector('.aic-tool-purpose');
    return {
      purpose: (p?.textContent || '').trim(),
      hasBody: r.classList.contains('is-expandable'),
      role: r.getAttribute('role'),
      tabindex: r.getAttribute('tabindex'),
      expanded: r.getAttribute('aria-expanded'),
      name2: r.getAttribute('aria-label') || '',
      cursor: getComputedStyle(r).cursor,
      glyphs: r.querySelectorAll('.aic-chevron').length,
      icons: r.querySelectorAll('.aic-tool-icon .svg-icon').length,
      wrap: p ? getComputedStyle(p).whiteSpace : null,
      /* The command must NOT be in the closed row. The body element exists
         but is empty while closed; anything with text in it is a leak. */
      bodyText: (r.querySelector('.aic-tool-body')?.textContent || '').trim(),
      bodyDisplay: r.querySelector('.aic-tool-body') ? getComputedStyle(r.querySelector('.aic-tool-body')).display : null,
    };
  });
  /* And the same row OPENED, which is the state the click produces. Read after
     the closed pass so the numbers above are not the ones the click changed. */
  {
    const long = Array.from(document.querySelectorAll('.aic-tool')).find(
      (r) => r.classList.contains('is-expandable') && (r.querySelector('.aic-tool-purpose')?.textContent || '').startsWith('Check every'),
    );
    if (long) {
      const collapsedHeight = Math.round(long.getBoundingClientRect().height);
      long.click();
      const t = long.querySelector('.aic-tool-target');
      const pre = long.querySelector('.aic-tool-body-pre');
      const right = long.querySelector('.aic-tool-right');
      out.toolExpanded = {
        expanded: long.getAttribute('aria-expanded'),
        wrap: t ? getComputedStyle(t).whiteSpace : null,
        overflowX: t ? getComputedStyle(t).overflowX : null,
        collapsedHeight,
        expandedHeight: Math.round(long.getBoundingClientRect().height),
        cut: t ? t.scrollWidth > t.clientWidth + 1 : null,
        commandText: (t?.textContent || '').trim(),
        resultText: (pre?.textContent || '').trim(),
        lines: (long.querySelector('.aic-tool-lines')?.textContent || '').trim(),
        kickers: Array.from(long.querySelectorAll('.aic-tool-body-kicker')).map((k) => (k.textContent || '').trim()),
        purposeVisible: !!long.querySelector('.aic-tool-purpose'),
        rightVisible: !!right,
        rowRight: Math.round(long.getBoundingClientRect().right),
        cellRight: t ? Math.round(t.getBoundingClientRect().right) : 0,
        preMaxHeight: pre ? getComputedStyle(pre).maxHeight : null,
        preOverflowY: pre ? getComputedStyle(pre).overflowY : null,
      };
      /* THE EXPANDED STATE SURVIVES A RE-RENDER. These rows sit in a stream
         that keeps updating, and a row that snapped shut every time a later
         tool finished would be unusable. Driven through the shipped renderer
         with a real event, not by calling a paint method. */
      window.aicStream.apply(window.aicEvent({
        kind: 'tool-call', toolUseId: 't6', name: 'Read', target: 'later.md', purpose: 'Read later.md', input: {},
      }));
      window.aicStream.apply(window.aicEvent({ kind: 'tool-result', toolUseId: 't6', ok: true, detail: '', output: '' }));
      out.toolStillOpen = long.getAttribute('aria-expanded');
      /* AND the repaint-every-row path, which is the one that can undo it. */
      window.aicStream.remeasureTools();
      out.toolOpenAfterRemeasure = long.getAttribute('aria-expanded');

      long.click();
      out.toolReCollapsed = long.getAttribute('aria-expanded');
      out.toolBodyAfterClose = (long.querySelector('.aic-tool-body')?.textContent || '').trim();

      /* THE RAIL. A running long row, opened: its status dot must stretch into
         a left rail that brackets the block, and a collapsed running row's dot
         must stay a 6px circle. Driven through the shipped renderer: t7 is
         RUNNING (no result), so its gutter still holds the marker dot. */
      window.aicStream.apply(window.aicEvent({
        kind: 'tool-call', toolUseId: 't7', name: 'Bash',
        target: 'cd /Users/tom/My-Life-Folder/06-AI-Team/Guidelines && python3 check-every-guideline-for-stale-notes.py --verbose --since 2026-08-01 --report wide --and-a-tail-long-enough-to-wrap-in-any-pane',
        purpose: 'Check every guideline for stale notes',
        input: {},
      }));
      const rows = Array.from(document.querySelectorAll('.aic-tool'));
      const runningLong = rows[rows.length - 1];
      runningLong.click();
      const railDot = runningLong.querySelector('.aic-tool-gutter .aic-dot');
      const shortRunning = rows.find((r) => (r.querySelector('.aic-tool-purpose')?.textContent || '') === 'Read note.md' && r.querySelector('.aic-dot'));
      const roundDot = shortRunning?.querySelector('.aic-tool-gutter .aic-dot') ?? null;
      const geo = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return { width: cs.width, radius: cs.borderRadius, tall: box.height > box.width * 3 };
      };
      out.toolRail = {
        expanded: runningLong.classList.contains('is-expanded'),
        rail: geo(railDot),
        round: geo(roundDot),
      };
    } else {
      out.toolExpanded = null;
      out.toolReCollapsed = null;
      out.toolRail = null;
    }
  }

  out.modelFaces = {
    fresh: one('.aic-model-preset-probe')?.getAttribute('data-face') ?? null,
    late: one('.aic-model-late-probe')?.getAttribute('data-face') ?? null,
    bare: one('.aic-model-bare-probe')?.getAttribute('data-face') ?? null,
  };

  /* THE PICKERS, after the chevrons came off. Two claims, and the second is the
     one that makes the first safe: no glyph, and the fact that these open a
     menu is still stated somewhere a screen reader reaches. The arrow never
     carried that - it was aria-hidden - so removing it revealed that the
     affordance had never been built rather than breaking one that had. */
  /* Scoped to the PRIMARY composer, because the fixture mounts six of them -
     one per mode state, plus the streaming one - and a document-wide count
     would be a number about the fixture rather than about the control row.
     The document-wide claim is the glyph sweep on the next line, which is the
     one that has to hold everywhere. */
  out.pickerGlyphsAnywhere = document.querySelectorAll('.aic-action .aic-chevron').length;
  const primaryAction = document.querySelector('.aic-composer .aic-action');
  out.pickers = Array.from(primaryAction ? primaryAction.querySelectorAll('.aic-seg-btn, .aic-text-btn') : []).map((b) => ({
    sel: b.className,
    text: (b.textContent || '').trim(),
    glyphs: b.querySelectorAll('svg, .aic-chevron').length,
    haspopup: b.getAttribute('aria-haspopup'),
    name: b.getAttribute('aria-label') || '',
  }));

  /* THE 12 READOUT STRIP, measured rather than reasoned about.
     Four claims live here and none of them can be checked from data:
     the ABSENCE law as a claim about characters on a screen, the narrow-pane
     FLOOR as a real width in the shipped face, the LADDER as a set of whole
     facts that fit, and rung 4's TAB-STOP COUNT, which the spec fixes at
     zero. */
  {
    const FOCUSABLE = ${JSON.stringify(FOCUSABLE_SEL)};
    const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true);
    const cellsOf = (el) => Array.from(el.querySelectorAll('.aic-fact-cell')).filter(visible);
    const idsOf = (el) => cellsOf(el).map((c) => c.getAttribute('data-fact'));
    const strip = (sel) => {
      const el = one(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const cells = cellsOf(el);
      const last = cells[cells.length - 1];
      return {
        display: cs.display,
        text: (el.textContent || '').trim(),
        cells: cells.length,
        allCells: el.querySelectorAll('.aic-fact-cell').length,
        ids: idsOf(el),
        width: Math.round(rect.width * 100) / 100,
        focusables: el.querySelectorAll(FOCUSABLE).length,
        tabindexed: el.querySelectorAll('[tabindex]').length,
        roles: Array.from(el.querySelectorAll('[role]')).map((n) => n.getAttribute('role')),
        /* Measured removal, never clipping: whatever survived has to END inside
           the strip's content box. 84.2K clipped to 84 is a wrong number
           rendered with full authority, so this reads geometry rather than
           trusting the ladder that produced the set. */
        overhang: last
          ? Math.round((last.getBoundingClientRect().right - (rect.right - parseFloat(cs.paddingRight || '0'))) * 100) / 100
          : 0,
      };
    };
    /* Every ring in the document, with the digits printed beside it. The
       reviewer check in 12.4 is arithmetic - arc === printed on a USED fact,
       arc === 1 minus printed on a LEFT fact - and this is that arithmetic off
       the pixels rather than off the model. */
    const rings = [];
    for (const cell of document.querySelectorAll('.aic-fact-cell')) {
      const arc = cell.querySelector('.aic-ring-arc');
      const svg = cell.querySelector('.aic-ring');
      if (!svg) continue;
      const acs = arc ? getComputedStyle(arc) : null;
      rings.push({
        fact: cell.getAttribute('data-fact'),
        direction: (cell.querySelector('.aic-fact-dir')?.textContent || '').trim(),
        value: (cell.querySelector('.aic-fact-value')?.textContent || '').trim(),
        hasArc: !!arc,
        offset: acs ? parseFloat(acs.strokeDashoffset) : null,
        cap: acs ? acs.strokeLinecap : null,
        strokeWidth: acs ? acs.strokeWidth : null,
        box: Math.round(svg.getBoundingClientRect().width * 100) / 100,
        digitsInside: (svg.textContent || '').trim(),
        hidden: svg.getAttribute('aria-hidden'),
      });
    }
    out.strip = {
      primary: strip('.aic-facts'),
      absent: strip('.aic-facts-absent'),
      liveEmpty: strip('.aic-facts-live-empty'),
      liveTurn: strip('.aic-facts-liveturn'),
      allOff: strip('.aic-facts-all-off'),
      floor: strip('.aic-facts-floor'),
      /* NULL when the probe is gone, never an object of zeroes. A reading of
         zero arcs is indistinguishable from a correct sub-3% result, so a
         missing probe would have satisfied the very assertion it feeds. */
      speck: one('.aic-facts-speck') ? {
        arcs: document.querySelectorAll('.aic-facts-speck .aic-ring-arc').length,
        tracks: document.querySelectorAll('.aic-facts-speck .aic-ring-track').length,
        value: (document.querySelector('.aic-facts-speck .aic-fact-value')?.textContent || '').trim(),
      } : null,
      full: strip('.aic-facts-full'),
      crushed: strip('.aic-facts-crushed'),
      recovered: strip('.aic-facts-recovered'),
      narrow: strip('.aic-facts-narrow'),
      narrowHostWidth: one('.aic-narrow-host') ? one('.aic-narrow-host').getBoundingClientRect().width : null,
      rings,
      /* The long form reaches AT through aria-describedby, so the target must
         EXIST and carry words - a described-by pointing at nothing is a tooltip
         only a mouse can read. */
      /* Every described-by id in the document, so a COLLISION is visible. More
         than one chat pane can be open at once, and two strips minting the same
         id would leave the second pane's readouts described by the first
         pane's node. */
      describeIds: Array.from(document.querySelectorAll('[aria-describedby]')).map((f) => f.getAttribute('aria-describedby')),
      described: Array.from(document.querySelectorAll('.aic-facts .aic-fact')).map((f) => {
        const id = f.getAttribute('aria-describedby');
        const target = id ? document.getElementById(id) : null;
        return {
          fact: f.parentElement.getAttribute('data-fact'),
          id,
          found: !!target,
          words: target ? (target.textContent || '').trim().length : 0,
          visible: target ? getComputedStyle(target).display : null,
          tooltip: f.getAttribute('data-tooltip') || f.getAttribute('title') || '',
          name: f.getAttribute('aria-label') || '',
        };
      }),
    };
  }

  /* THE TEXT SWEEP.
     The loser sweep below asks "did any element lose the cascade". This one
     asks the question that actually reached the user: "is any string under the
     legible floor". It walks every element carrying its own text, in every
     state the fixture now mounts, and it is scoped to .aic-settings as well as
     .aic-root because the settings page is a second root and nothing ever
     swept it. Large-scale per WCAG: 24px, or 18.66px at weight 700. */
  out.text = [];
  for (const el of document.querySelectorAll('.aic-root, .aic-root *, .aic-settings, .aic-settings *')) {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    if (!own.trim()) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3.0 : 4.5;
    /* The element's OWN background composited over its ancestors', because a
       string on a filled control is read against that control's fill and never
       against the card behind it. Measuring against the ancestor ground alone
       reported the send pill at 1.05:1 - an instrument that is wrong in the
       accusing direction is still wrong. */
    const g = over(parse(cs.backgroundColor), ground(el));
    const r = ratio(over(parse(cs.color), g), g);
    if (r < floor) {
      out.text.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
        text: own.trim().slice(0, 32),
        size: cs.fontSize, weight: cs.fontWeight, ratio: r, floor, ground: key(g),
        fg: key(parse(cs.color)),
      });
    }
  }

  /* The sweep. Nine siblings were enumerated in the audit; this is what makes
     the tenth impossible. */
  const SENTINELS = new Set(['1,2,3,1', '4,5,6,1', '7,8,9,1']);
  out.losers = [];
  for (const el of document.querySelectorAll('.aic-root, .aic-root *')) {
    const cs = getComputedStyle(el);
    const hits = [];
    for (const prop of ['backgroundColor', 'color']) {
      if (SENTINELS.has(key(parse(cs[prop])))) hits.push(prop);
    }
    for (const [prop, style] of [['borderTopColor', 'borderTopStyle'], ['borderRightColor', 'borderRightStyle'],
                                 ['borderBottomColor', 'borderBottomStyle'], ['borderLeftColor', 'borderLeftStyle']]) {
      if (cs[style] !== 'none' && SENTINELS.has(key(parse(cs[prop])))) hits.push(prop);
    }
    if (/HostSentinelFace/.test(cs.fontFamily)) hits.push('fontFamily');
    if (cs.boxShadow && cs.boxShadow !== 'none' && /rgb\\(1, 2, 3\\)/.test(cs.boxShadow)) hits.push('boxShadow');
    if (hits.length) {
      out.losers.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
        lost: hits,
      });
    }
  }
  return out;
})()`;

/* THE FOCUS PROBE.
 *
 * The pen is stated once and has to survive ten `all: unset` control rules.
 * `all: unset` resets `outline-style` to `none`, so a pen stated BELOW the
 * control layer inspects correctly in the stylesheet and paints nothing - the
 * exact shape of the cascade defect above, one rule further in.
 *
 * Two things make this a measurement rather than an assertion about a list.
 * It is a SWEEP over every focusable element under .aic-root, so the eleventh
 * control cannot quietly go dark. And it carries a NEGATIVE CONTROL: a bare
 * <button> injected under .aic-root that no plugin rule touches. If the pen
 * fires there and nowhere else, the plugin is outranking its own focus ring;
 * if it fires nowhere at all, the instrument is broken and says so. A gate that
 * cannot tell those two apart proves neither. */
const FOCUS_PROBE = `(() => {
  const out = { rows: [], control: null, textarea: null, composerBorder: null };
${HELPERS}
  const FOCUSABLE = ${JSON.stringify(FOCUSABLE_SEL)};
  function name(el) {
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  }
  function pen(el) {
    const cs = getComputedStyle(el);
    const g = ground(el);
    return {
      sel: name(el),
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      color: key(parse(cs.outlineColor)),
      offset: cs.outlineOffset,
      /* The control's OWN geometry, read in the same pass as the pen.
         The pen used to restate border-radius, and at (0,4,0) that declaration
         beat every control - a 999px send pill became a 4px rectangle the
         moment a keyboard user reached it. Read at rest and under
         :focus-visible; the assertion is that they are equal. */
      radius: cs.borderRadius,
      /* SC 1.4.11 measures the ring against what is ADJACENT to it, and
         with outline-offset: 2px the ground is on both sides of it, so the
         element's own fill is never the adjacency - its ground is the whole
         measurement. The gate asserted the pen PAINTS and never that it can be
         SEEN, and a single-room --aic-marker put 52 of 58 rings at 2.80:1 in
         stock light while every existence assertion stayed green. */
      ringOnGround: ratio(over(parse(cs.outlineColor), g), g),
      ground: key(g),
    };
  }
  for (const el of document.querySelectorAll('.aic-root, .aic-root *')) {
    if (!el.matches(FOCUSABLE)) continue;
    const row = pen(el);
    if (el.dataset.aicFocusControl === '1') { out.control = row; continue; }
    if (el.matches('textarea.aic-input')) { out.textarea = row; continue; }
    out.rows.push(row);
  }
  const composer = document.querySelector('.aic-composer');
  out.composerBorder = key(parse(getComputedStyle(composer).borderTopColor));
  return out;
})()`;

/* THE COMPOSER PROBE.
 *
 * Line 569 used to assert `composerBorder === tokens['--aic-marker-border']`
 * and stop there - the token arrived, therefore the affordance works. It did
 * not: at 38% alpha the step measured 1.26:1 against its own resting state.
 * This probe replaces that assertion rather than amending it, and it measures
 * three adjacencies instead of naming one token, because a border sits BETWEEN
 * the card's fill and the page and has to be seen against both, and because
 * the thing a user perceives is the STEP from rest.
 *
 * It also reads which element actually holds focus, because the trigger is
 * a class the composer sets on the textarea's own focus (it was `:has(> textarea:focus)`
 * until the directory's CSS lint flagged `:has`), and the whole point of narrowing it is that the card
 * must NOT light up for the eight focusable controls inside it that are not the
 * input. That is a claim about a specific element having focus, so the probe
 * uses real `.focus()` rather than a forced pseudo-class. */
const composerProbe = (restBorderRaw) => `(() => {
${HELPERS}
  const c = document.querySelector('.aic-composer');
  const ta = document.querySelector('textarea.aic-input');
  const cs = getComputedStyle(c);
  const g = ground(c);
  const fill = over(parse(cs.backgroundColor), g);
  const b = parse(cs.borderTopColor);
  const restRaw = ${JSON.stringify(restBorderRaw)};
  const caretRaw = getComputedStyle(ta).caretColor;
  const a = document.activeElement;
  return {
    borderRaw: cs.borderTopColor,
    border: key(b),
    width: cs.borderTopWidth,
    style: cs.borderTopStyle,
    shadow: cs.boxShadow,
    fill: key(fill),
    onFill: ratio(over(b, fill), fill),
    onGround: ratio(over(b, g), g),
    step: restRaw ? ratio(over(b, fill), over(parse(restRaw), fill)) : null,
    caret: caretRaw === 'auto' ? 'auto' : key(parse(caretRaw)),
    active: a ? a.tagName.toLowerCase() + (a.className && typeof a.className === 'string'
      ? '.' + a.className.trim().split(/\\s+/).join('.') : '') : null,
  };
})()`;

/* -------------------------------------------------------------------- driver */

const ROOMS = [
  { name: 'stock dark', file: 'fixture.html', body: 'theme-dark', inkline: false },
  { name: 'stock light', file: 'fixture.html', body: 'theme-light', inkline: false },
  { name: 'INKLINE dark', file: 'fixture-inkline.html', body: 'theme-dark', inkline: true },
  { name: 'INKLINE light', file: 'fixture-inkline.html', body: 'theme-light', inkline: true },
];

/*
 * Freeze every transition before reading anything.
 *
 * Found by this gate disagreeing with itself: the decision rail measured
 * `#8a6f33` in the INK room, which is the PAPER room's amber. The token was
 * correct at every level - `getComputedStyle(rail).getPropertyValue()` returned
 * the ink value - and `border-left-color` still computed the paper one, because
 * `.aic-decision` transitions `border-color` over 240ms and the room class had
 * just changed. getComputedStyle during a transition returns the INTERPOLATED
 * value, so the reading was a frame of an animation between two correct states.
 *
 * A sleep would have hidden it and stayed flaky. This is deterministic: the
 * `!important` is the harness's, and the settled value it exposes is the one
 * the cascade always meant.
 */
/* Durations, read live. Kept tiny and separate on purpose: it is the only
   probe in this file that must run before the freeze, so it cannot quietly
   grow assertions that belong in the frozen pass. */
const MOTION_PROBE = `(() => {
  const row = document.querySelector('.aic-tool.is-expandable');
  const arc = document.querySelector('.aic-ring-arc');
  return {
    row: row ? {
      duration: getComputedStyle(row).transitionDuration,
      property: getComputedStyle(row).transitionProperty,
    } : null,
    arc: arc ? {
      duration: getComputedStyle(arc).transitionDuration,
      property: getComputedStyle(arc).transitionProperty,
    } : null,
  };
})()`;

const FREEZE = `(() => {
  const st = document.createElement('style');
  st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.appendChild(st);
  return 1;
})()`;

async function snapshot(chrome, room) {
  /* The thumbnail's remove control, not the send pill: it is the LAST thing
     this fixture mounts and the only one behind an async decode, so waiting on
     it is what proves the whole page is built. Waiting on the send pill would
     let every probe below run against an empty attachment strip. */
  /* The LAST thing the fixture sets, after the attachment decode AND after two
     frames have let the ResizeObserver deliver the recovery probe's widen.
     `.aic-thumb-x` used to be the marker; it appears mid-mount, so every state
     probe after it was read on a race that happened to win. */
  await chrome.open(pathToFileURL(resolve(here, 'dom', room.file)).href, '.aic-facts-recovered.is-settled');
  /* THE ONE READING TAKEN BEFORE THE FREEZE.
     Everything below is measured with transitions frozen, because
     getComputedStyle mid-transition returns an INTERPOLATED value and this gate
     once measured a frame of an animation between two correct states. But a
     DURATION only exists before that freeze - read after it, every transition
     in the plugin measures 0s, and an assertion on 140ms would be asserting the
     harness's own override. So it is taken here, first, and nowhere else. */
  const motion = await chrome.evaluate(MOTION_PROBE);
  await chrome.evaluate(FREEZE);
  await chrome.evaluate(`document.body.className = ${JSON.stringify(room.body)}; 1`);
  const base = await chrome.evaluate(PROBE);

  /* `.aic-seg-btn` unqualified, and the qualifier's removal is a measurement.
     It used to read `:not(.is-active)`, because the mode control was a row of
     four chips of which three were inactive. It is one always-active trigger
     now, so that selector matched nothing, and `forcePseudos` threw rather than
     skipping - which is the only reason this was caught. A driver that had
     shrugged at an empty match would have left the mode control's hover state
     unmeasured in all four rooms and every assertion still green. */
  const HOVERED = ['.aic-thinking-probe .aic-thinking-head',
                   '.aic-send', '.aic-approve-always', '.aic-badge', '.aic-seg-btn',
                   '.aic-code-chip', '.aic-agent-chip', '.aic-icon-btn', '.aic-text-btn',
                   '.aic-provider-btn',
                   '.aic-chip-x', '.aic-thumb-x',
                   /* The expandable tool row. `forcePseudos` THROWS on a selector
                      that matches nothing, so listing it here is itself a guard:
                      if the row ever stops being expandable, the driver says so
                      instead of the hover measurement quietly disappearing. */
                   '.aic-tool.is-expandable'];
  await chrome.forcePseudos(HOVERED.map((s) => [s, ['hover']]));
  const hover = await chrome.evaluate(PROBE);
  await chrome.forcePseudos(HOVERED.map((s) => [s, []]));

  await chrome.evaluate('document.querySelector(".aic-send").disabled = true; 1');
  const disabled = await chrome.evaluate(PROBE);
  await chrome.evaluate('document.querySelector(".aic-send").disabled = false; 1');

  /* The focus-probe control group is injected HERE rather than in the fixture
     on purpose: it is a <button> with no plugin rule, so it is meant to lose
     the cascade to the host, and mounting it earlier would make it a false
     loser in the cascade sweep above. It exists for exactly one read. */
  await chrome.evaluate(`(() => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'control';
    b.dataset.aicFocusControl = '1';
    document.querySelector('.aic-root').appendChild(b);
    return 1;
  })()`);
  /* Three reads of the composer card: at rest, with the TEXTAREA focused,
     and with the SEND PILL focused. Real focus, not a forced pseudo, because
     the card's trigger names one specific descendant and the send-pill read is
     the assertion that the trigger is actually narrow. */
  const composerRest = await chrome.evaluate(composerProbe(null));
  await chrome.evaluate('document.querySelector("textarea.aic-input").focus(); 1');
  const composerInput = await chrome.evaluate(composerProbe(composerRest.borderRaw));
  await chrome.evaluate('document.querySelector(".aic-composer .aic-send").focus(); 1');
  const composerSend = await chrome.evaluate(composerProbe(composerRest.borderRaw));
  await chrome.evaluate('if (document.activeElement) document.activeElement.blur(); 1');

  /* One selector list, not four calls: the union is always non-empty, so the
     driver's "no nodes" throw stays a real guard instead of a tripwire that
     fires whenever the fixture happens not to mount a <select>. */
  /* The SAME sweep, unforced, and taken AFTER the control button is injected so
     the two row lists are the same elements in the same order. The geometry
     check is a difference between two readings, so one reading cannot decide
     it. */
  const focusRest = await chrome.evaluate(FOCUS_PROBE);

  /* `.aic-composer` is no longer forced here: the card's trigger replaced `:focus-within` with
     a class stamped on real textarea focus (formerly `:has(> textarea.aic-input:focus)`), and a forced pseudo on a rule that no
     longer exists is a state nothing reads. The card is measured above, with
     real focus, where the trigger can actually be tested. */
  await chrome.forcePseudosAll([
    [FOCUSABLE_SEL.split(', ').map((s) => `.aic-root ${s}`).join(', '), ['focus-visible']],
  ]);
  const focus = await chrome.evaluate(FOCUS_PROBE);
  await chrome.evaluate('document.querySelector("[data-aic-focus-control]").remove(); 1');

  return { base, hover, disabled, focusRest, focus, composerRest, composerInput, composerSend, motion };
}

/* The browser is closed in a `finally`, and that is not tidiness.
 * When a probe threw, the throw propagated out of this module with the CDP
 * socket and the Chrome process still open, so node:test never reached its
 * exit and the run HUNG instead of failing. A gate that hangs is worse than a
 * gate that goes red, because a red run is read and a hung one is killed. */
const chrome = await Chrome.launch();
const shots = {};
try {
  for (const room of ROOMS) shots[room.name] = await snapshot(chrome, room);
} finally {
  await chrome.close();
}

const forEachRoom = (fn) => { for (const room of ROOMS) fn(shots[room.name], room.name, room); };

/* ---------------------------------------------------------------- the cascade */

test('host cascade - no control under .aic-root loses any property to the host theme', () => {
  forEachRoom((s, room) => {
    assert.deepEqual(
      s.base.losers, [],
      `${room}: the host theme repainted these. Every control rule must be stated ` +
      `at (0,2,0) or better: ${JSON.stringify(s.base.losers, null, 2)}`,
    );
    assert.deepEqual(s.hover.losers, [], `${room}: lost on :hover - a two-class rule ties the theme's (0,2,1)`);
    assert.deepEqual(s.disabled.losers, [], `${room}: lost while disabled`);
  });
});

test('the ENABLED send pill is the view one marker moment', () => {
  forEachRoom((s, room) => {
    const send = s.base.send ?? s.base.el.send;
    assert.equal(send.disabled, false, `${room}: typing into the composer did not enable the send pill`);
    // The FILL rung, not the MARK rung. This assertion used to
    // name --aic-marker and therefore certified the defect it was written to
    // catch: an expectation copied from the code cannot fail the code.
    assert.equal(send.bg, s.base.tokens['--aic-marker-fill'], `${room}: send pill fill is not --aic-marker-fill`);
    assert.equal(send.fg, s.base.tokens['--aic-on-marker'], `${room}: send pill label is not --aic-on-marker`);
    assert.equal(send.weight, '600', `${room}: send pill weight`);
    assert.ok(send.font.includes(s.base.fonts.display.split(',')[0].replace(/['"]/g, '')),
      `${room}: send pill is not on the display face (got ${send.font})`);
    assert.equal(s.hover.el.send.bg, s.base.tokens['--aic-marker-up'], `${room}: send pill hover fill`);
  });
});

test('the disabled send pill carries no opacity dial, only a token step', () => {
  forEachRoom((s, room) => {
    const send = s.disabled.el.send;
    assert.equal(send.opacity, '1', `${room}: the host's disabled-button opacity dial is compositing this control; quiet is a token step, never an opacity dial`);
    assert.equal(send.bg, s.base.mixes.sendDisabled, `${room}: disabled fill is not the 55% marker/input mix`);
    assert.equal(send.fg, s.base.tokens['--aic-paper'], `${room}: disabled label is not --aic-paper`);
    assert.ok(send.fgOnOwnBg >= 4.5, `${room}: disabled label measures ${send.fgOnOwnBg}:1, under the 4.5 floor - the quiet step has to stay readable`);
  });
});

test('the open-decisions badge renders as authored, border included', () => {
  forEachRoom((s, room) => {
    const b = s.base.el.badge;
    const warning = s.base.tokens['--aic-warning'];
    for (const side of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']) {
      assert.equal(b[side], warning, `${room}: badge ${side} is not full-strength --aic-warning`);
    }
    assert.equal(b.bg, s.base.mixes.badgeFill, `${room}: badge fill is not the 22% warning/input mix`);
    assert.equal(b.fg, s.base.tokens['--aic-paper'], `${room}: badge label is not --aic-paper`);
    assert.ok(b.font.includes(s.base.fonts.mono.split(',')[0].replace(/['"]/g, '')),
      `${room}: badge count left the mono voice (got ${b.font})`);
    // The badge is a <button> that opens the popover, so its boundary is a
    // component boundary: SC 1.4.11, 3:1, measured against the composer card.
    assert.ok(b.borderOnGround >= 3.0,
      `${room}: badge boundary measures ${b.borderOnGround}:1 against the card, SC 1.4.11 needs 3:1`);
  });
});

test('the decision code chip keeps its amber boundary and mono voice', () => {
  forEachRoom((s, room) => {
    const c = s.base.el.codeChip;
    assert.equal(c.borderTop, s.base.tokens['--aic-warning'], `${room}: code-chip border`);
    assert.equal(c.fg, s.base.tokens['--aic-paper'], `${room}: code-chip text`);
    assert.ok(c.font.includes(s.base.fonts.mono.split(',')[0].replace(/['"]/g, '')), `${room}: code-chip voice`);
    assert.ok(c.borderOnGround >= 3.0, `${room}: code-chip boundary ${c.borderOnGround}:1 (button, SC 1.4.11)`);
  });
});

test('V5b - the wider grant sits one visual step quieter than the narrow one', () => {
  forEachRoom((s, room) => {
    const once = s.base.el.approveOnce;
    const always = s.base.el.approveAlways;
    assert.equal(once.fg, s.base.tokens['--aic-paper'], `${room}: Allow once is not --aic-paper`);
    assert.equal(always.fg, s.base.tokens['--aic-dim'], `${room}: Always allow is not --aic-dim`);
    assert.notEqual(once.fg, always.fg, `${room}: the V5b step collapsed to no step at all`);
    assert.equal(once.borderTop, s.base.tokens['--aic-hairline'], `${room}: Allow once border`);
    assert.equal(always.borderTop, s.base.tokens['--aic-hairline'], `${room}: Always allow border`);
    assert.equal(s.base.el.approveDeny.fg, s.base.tokens['--aic-dim'], `${room}: Deny colour`);
    assert.equal(s.base.el.approveDeny.borderTopStyle, 'none', `${room}: Deny carries no border`);
    assert.equal(s.hover.el.approveAlways.fg, s.base.tokens['--aic-paper'], `${room}: Always allow hover`);
  });
});

test('the quiet controls keep their transparent grounds', () => {
  forEachRoom((s, room) => {
    /* `textBtn` LEFT THIS LIST when the three pickers became one pill. Mode,
       model and effort do the same job and were drawn three ways - a chip in a
       bordered track and two runs of bare text - so the row read as one control
       and two labels. A pill is a shape made of its fill, so these two now
       carry a ground on purpose and are asserted below instead. */
    for (const name of ['agentChip', 'chipX', 'iconBtn']) {
      assert.equal(s.base.el[name].bg, 'transparent', `${room}: ${name} took the theme panel fill`);
    }
    assert.equal(s.base.el.agentChip.borderTop, s.base.tokens['--aic-hairline'], `${room}: agent chip border`);
    assert.equal(s.base.el.chipX.fg, s.base.tokens['--aic-faint'], `${room}: chip dismiss colour`);
    assert.equal(s.base.el.segActive.bg, s.base.tokens['--aic-wash'], `${room}: active mode chip ground`);
    /* THE THREE PICKERS ARE ONE CONTROL, measured rather than eyeballed: same
       ground, same padding, same radius, same type size. The first version of
       this change looked right in the source and did nothing on screen - the
       pill's ground was stated at (0,3,0) where the control layer's
       `background-color: transparent` beat it by source order at (0,4,0) - and
       the suite stayed green throughout, because nothing was asserting the
       ground on the two controls that had just been given one. */
    assert.equal(s.base.el.textBtn.bg, s.base.tokens['--aic-wash'],
      `${room}: the model and effort pills have no fill, so they are not pills`);
    for (const prop of ['padding', 'radius', 'size']) {
      assert.equal(s.base.el.textBtn[prop], s.base.el.segActive[prop],
        `${room}: the pickers disagree on ${prop} - the mode chip says ` +
        `${s.base.el.segActive[prop]}, the model and effort say ${s.base.el.textBtn[prop]}`);
    }
    assert.equal(s.base.el.iconBtn.fg, s.base.tokens['--aic-faint'], `${room}: icon button colour`);
    /* The tool row's DISCLOSURE arrow, which is the only chevron left in the
       plugin: it reports open or closed rather than advertising a menu. Faint,
       one rung under the row's own label. */
    assert.equal(s.base.el.toolChevron.fg, s.base.tokens['--aic-faint'], `${room}: tool row chevron colour`);
  });
});

/* ----------------------------------------------------------------- the pen */

test('the focus ring reaches every focusable control, in every room', () => {
  forEachRoom((s, room) => {
    // The negative control first. If THIS is dark the instrument is broken and
    // every other assertion below it is meaningless, so it is read before them.
    const ctl = s.focus.control;
    assert.equal(ctl.style, 'solid',
      `${room}: the pen does not fire on a bare <button> under .aic-root - the instrument is broken, not the plugin`);
    assert.equal(ctl.width, '2px', `${room}: control-group pen width`);
    assert.equal(ctl.color, s.base.tokens['--aic-marker'], `${room}: control-group pen colour`);

    // The sweep. Nine controls were named in the audit; this is what makes the
    // tenth impossible - and the tenth is what the specificity raise walked past.
    const dark = s.focus.rows.filter((r) => r.style === 'none' || r.width !== '2px');
    assert.deepEqual(dark, [],
      `${room}: SC 2.4.7 - a keyboard user cannot see these. \`all: unset\` resets ` +
      `outline-style, so the pen has to be stated ABOVE the control layer: ` +
      `${JSON.stringify(dark, null, 2)}`);
    for (const r of s.focus.rows) {
      assert.equal(r.color, s.base.tokens['--aic-marker'], `${room}: ${r.sel} pen is not --aic-marker`);
      assert.equal(r.offset, '2px', `${room}: ${r.sel} pen offset`);
    }
    assert.ok(s.focus.rows.length >= 10, `${room}: only ${s.focus.rows.length} focusables swept - the fixture shrank`);
  });
});

/* The pen exists, the pen is the right colour, the pen is the right width -
 * and none of that says a keyboard user can SEE it. This is the assertion the
 * gate did not carry: a guard that tests only for EXISTENCE goes green while
 * the thing it names is unusable, and only a containment test catches that.
 * Watched RED against a30afe6 before the token split landed: 52 of 58 rings at
 * 2.80:1 in stock light, both launcher-shaped rows included. */
test('every focus ring clears 3:1 against its own ground, in every room', () => {
  forEachRoom((s, room) => {
    // The negative control is read first here too: a ring that is not painted
    // has no contrast to measure, and a zero would be the instrument's, not the
    // plugin's.
    assert.equal(s.focus.control.style, 'solid',
      `${room}: the pen does not fire on the bare <button> control - the instrument is broken`);
    const faint = s.focus.rows
      .filter((r) => r.style !== 'none')
      .filter((r) => r.ringOnGround < 3.0)
      .map((r) => ({ sel: r.sel, ratio: r.ringOnGround, ground: r.ground }));
    assert.deepEqual(faint, [],
      `${room}: SC 1.4.11 - the focus indicator is the visual information that ` +
      `identifies the focused state, and with outline-offset: 2px its ground is ` +
      `its only adjacency. A marker token with no room split paints the ink ` +
      `room's #FF5A2D on paper: ${JSON.stringify(faint, null, 2)}`);
    assert.ok(s.focus.control.ringOnGround >= 3.0,
      `${room}: the control-group ring measures ${s.focus.control.ringOnGround}:1`);
  });
});

/* The pen may change what is drawn AROUND a control and nothing about the
 * control. A third declaration on a rule raised to (0,4,0) collapsed the
 * whole radius ladder onto --aic-r-control: the send pill, the badge, all four
 * mode chips, the agent chip and the approval buttons went from 999px capsules
 * to 4px rectangles on keyboard focus, and the icon button from 10px. */
test('the focus pen changes no control own geometry', () => {
  forEachRoom((s, room) => {
    assert.equal(s.focusRest.rows.length, s.focus.rows.length,
      `${room}: the rest sweep and the focused sweep read different element sets`);
    const changed = [];
    for (let i = 0; i < s.focus.rows.length; i++) {
      const rest = s.focusRest.rows[i];
      const on = s.focus.rows[i];
      assert.equal(rest.sel, on.sel, `${room}: sweep order drifted at row ${i}`);
      if (rest.radius !== on.radius) changed.push({ sel: on.sel, rest: rest.radius, focused: on.radius });
    }
    assert.deepEqual(changed, [],
      `${room}: border-radius is the ELEMENT's geometry, never the outline's. ` +
      `Chrome has followed the element's radius with the outline since 94, so a ` +
      `radius on the pen buys nothing and costs the ladder: ` +
      `${JSON.stringify(changed, null, 2)}`);
    // And the ring itself still paints, so the deletion is a fix and not a
    // second regression: the whole reason the declaration was there is the
    // claim it was load-bearing.
    assert.equal(s.focus.rows.filter((r) => r.style === 'none').length, 0,
      `${room}: a control went dark while its radius was being checked`);
  });
});

/* The instrument's own parser, watched failing. Every one of these used to
 * come back as a NUMBER - three as opaque black and two as transparent black,
 * which deletes a layer from ground() and understates it. */
test('the colour parser refuses what it cannot read, in every room', () => {
  forEachRoom((s, room) => {
    const silent = s.base.parserGuard.filter((g) => !g.threw);
    assert.deepEqual(silent, [],
      `${room}: parse() answered an unreadable value with a colour. A value it ` +
      `cannot read has to throw - zero is a number, so a silent zero reads as ` +
      `data rather than as silence: ${JSON.stringify(silent, null, 2)}`);
  });
});

test('the composer keeps its focus on the CARD, never a ring on the textarea', () => {
  forEachRoom((s, room) => {
    // The composer's focus lives on the card border. The focus-ring fix must
    // not reach it: a pen on the textarea would draw a second ring inside the
    // card and spend the marker whisper twice.
    assert.equal(s.focus.textarea.style, 'none',
      `${room}: the textarea drew its own focus ring inside the card`);
  });
});

/* Six assertions, and they REPLACE the one that used
 * to sit here rather than amending it: `composerBorder === --aic-marker-border`
 * asserted that a token arrived and never what arriving bought. It bought
 * 1.26:1 against the card's own resting state, on a 1px line at 38% alpha, and
 * that number is why the assertion had to go rather than get a threshold bolted
 * onto it. Two of these six were watched RED against the shipped build before
 * the fix landed: the send-pill trigger and the caret. */

test('the composer card is the focus carrier, at full strength', () => {
  forEachRoom((s, room) => {
    const rest = s.composerRest;
    const on = s.composerInput;
    // 1. The card steps to the FULL mark, not to a muted mix of it. The chip
    //    family follows the same rule for the same reason: muting mixes a
    //    border toward the very ground it has to contrast against.
    assert.equal(on.border, s.base.tokens['--aic-marker'],
      `${room}: the focused card border is ${on.border}, not the full --aic-marker`);
    // 2. And the rest state is the hairline, so there is a step at all.
    assert.equal(rest.border, s.base.tokens['--aic-hairline'],
      `${room}: the card border at rest is not --aic-hairline`);
    assert.notEqual(rest.border, on.border, `${room}: the step is invisible - both states are the same colour`);
    // 3. ONE device. A second carrier is how a focus treatment stops being
    //    measurable: the ratios below only mean anything if the border is the
    //    whole of it.
    assert.equal(on.width, '1px', `${room}: the focused card border is ${on.width}, not 1px`);
    assert.equal(on.style, 'solid', `${room}: the focused card border style`);
    assert.equal(on.shadow, 'none', `${room}: the focused card grew a second focus device (box-shadow)`);
  });
});

test('the composer focus step is SEEN, not merely taken', () => {
  forEachRoom((s, room) => {
    const on = s.composerInput;
    // A border sits BETWEEN two grounds, so both are adjacencies under SC
    // 1.4.11, and the third number is the one a user actually perceives: the
    // step away from the resting border. 3.0 on all three.
    for (const [what, r] of [['the card fill', on.onFill], ['the page ground', on.onGround],
                             ['its own resting border', on.step]]) {
      assert.ok(r >= 3.0,
        `${room}: the focused card border measures ${r}:1 against ${what}. ` +
        `--aic-marker-border's 38% alpha measured 1.26:1 against rest, which is ` +
        `which is why the focused card spends the FULL mark instead.`);
    }
  });
});

test('the card lights up for the INPUT, and for nothing else in it', () => {
  forEachRoom((s, room) => {
    // THE TRIGGER, and it is the larger half of this fix. `:focus-within` fired on
    // any descendant, and the card holds nine fixed focus stops of which eight
    // are not the textarea - each already wearing the 2px pen. So the card
    // announced "your keystrokes land here" while focus sat on the send pill.
    // Narrowing the trigger is what makes strengthening it honest.
    assert.ok(s.composerInput.active.startsWith('textarea'),
      `${room}: the input read did not have the textarea focused (got ${s.composerInput.active})`);
    assert.ok(s.composerSend.active.includes('aic-send'),
      `${room}: the send read did not have the send pill focused (got ${s.composerSend.active})`);
    assert.equal(s.composerSend.border, s.base.tokens['--aic-hairline'],
      `${room}: focus on the SEND PILL lit the composer card. The card's affordance ` +
      `claims keystrokes land in the input; with focus on a button they do not, and ` +
      `at full strength that lie is loud.`);
  });
});

test('the caret is the marker, and it exists at all', () => {
  forEachRoom((s, room) => {
    // Specified 2026-08-28, grep returned zero, so the one focus device INSIDE
    // the field was the host's default for the whole build. `auto` is the
    // shipped state this assertion was written to fail against.
    assert.notEqual(s.composerInput.caret, 'auto',
      `${room}: caret-color is 'auto' - the composer's in-field focus device was never built`);
    assert.equal(s.composerInput.caret, s.base.tokens['--aic-marker'],
      `${room}: the caret is ${s.composerInput.caret}, not --aic-marker`);
  });
});

test('the composer border is the card, never a second ring on the textarea', () => {
  forEachRoom((s, room) => {
    const t = s.base.el.textarea;
    assert.equal(t.borderTopStyle, 'none', `${room}: the textarea drew its own border inside the card`);
    assert.equal(t.bg, 'transparent', `${room}: the textarea took a form-well fill`);
    assert.equal(t.boxShadow, 'none', `${room}: the textarea drew a ring`);
    assert.equal(t.padding, '0px', `${room}: the textarea took the host padding`);
  });
});

/* ------------------------------------ the stock fallbacks, measured on white */

test('the insight line clears the AA text floor in every room', () => {
  forEachRoom((s, room) => {
    const i = s.base.el.insight;
    assert.ok(i.fgOnGround >= 4.5,
      `${room}: the hand voice measures ${i.fgOnGround}:1 on ${i.ground}; ` +
      `20px/500 takes the 4.5:1 tier and a fallback below AA is a broken fallback`);
  });
});

test('every amber device clears the 3:1 non-text tier in every room', () => {
  forEachRoom((s, room) => {
    assert.ok(s.base.el.warnDot.bgOnGround >= 3.0,
      `${room}: the owned-disposition dot measures ${s.base.el.warnDot.bgOnGround}:1 and is the sole carrier of that state`);
    /* The RING ARC, which replaced the dot. It is a meaningful non-text graphic
       and takes the same 3:1 tier the dot took. The TRACK deliberately does not
       appear here: it composites near the ground, it does not clear 3:1, and SC
       1.4.11 is not engaged on it, because the printed percentage sits one
       character-width away at the 4.5:1 text floor and is always there. The
       ring is a redundant encoding, never a sole carrier. */
    assert.ok(s.base.el.statusWarnArc.strokeOnGround >= 3.0,
      `${room}: the statusline warning arc measures ${s.base.el.statusWarnArc.strokeOnGround}:1`);
    assert.ok(s.base.el.dangerArc.strokeOnGround >= 3.0,
      `${room}: the CRIT arc measures ${s.base.el.dangerArc.strokeOnGround}:1`);
    assert.ok(s.base.el.decision.borderLeftOnGround >= 3.0,
      `${room}: the decision rail measures ${s.base.el.decision.borderLeftOnGround}:1`);
  });
});

test('the success dot and the red rail clear the same non-text tier', () => {
  forEachRoom((s, room) => {
    assert.ok(s.base.el.successDot.bgOnGround >= 3.0,
      `${room}: success dot ${s.base.el.successDot.bgOnGround}:1 - the floor is not a target`);
    assert.ok(s.base.el.destructiveDot.bgOnGround >= 3.0,
      `${room}: destructive dot ${s.base.el.destructiveDot.bgOnGround}:1`);
    assert.ok(s.base.el.rail.borderLeftOnGround >= 3.0,
      `${room}: the unowned rail measures ${s.base.el.rail.borderLeftOnGround}:1`);
  });
});

/* ------------------------------ every STATE, not merely every element */

test('no string under the legible floor, in any state, in any room', () => {
  // Aggregated across all four rooms before asserting: a per-room assert stops
  // at the first room and hides the shape of the defect, which is exactly how
  // "one stock-light failure" reads as a different problem from "the same three
  // controls in three rooms".
  const all = [];
  forEachRoom((s, room) => { for (const row of s.base.text) all.push({ room, ...row }); });
  assert.deepEqual(all, [],
    `below the 4.5:1 text floor (3.0 at large scale). The sweep now walks the ` +
    `STATES the fixture mounts, not only the elements it happens to build:\n` +
    JSON.stringify(all, null, 2));
});

test('every selector in the map matches at least one element', () => {
  /* Iris's rule, and it is the one this file keeps re-learning: a selector
     matching ZERO elements must fail before any property on it is examined. A
     guard whose passing state is reachable without the thing being true is
     worse than no guard, because its green prevents the check a missing guard
     would have prompted.
     It is a SWEEP over the map rather than a list of the selectors somebody
     remembered, so the next control that changes shape cannot take its
     measurement down with it quietly. */
  forEachRoom((s, room) => {
    const dead = Object.entries(s.base.counts).filter(([, n]) => n === 0).map(([name]) => name);
    assert.deepEqual(dead, [],
      `${room}: ${dead.length} selector(s) in the probe map match nothing, so every assertion ` +
      `that reads them is measuring a surface the product does not have: ${dead.join(', ')}`);
  });
});

test('the fixture actually builds the states the sweep claims to cover', () => {
  // A sweep is only a claim about what exists. If the fixture stops mounting a
  // state the sweep goes green by absence, which is the failure a state sweep
  // exists to prevent.
  forEachRoom((s, room) => {
    for (const name of ['segPlan', 'segAsk', 'segAuto', 'segBypass', 'sendStop', 'sendQueue', 'userQueued', 'toolRunningName',
                        'toolFailedName', 'toolFailedGlyph', 'decisionBlocked', 'decisionCleared',
                        'dangerFact', 'dangerDir', 'settingsIndex', 'toolChevron', 'toolRowExpandable', 'thumb', 'thumbX',
                        /* The ring, in both escalated bands, plus its track. These replaced
                           the statusline's warning DOT, and the dot's selector is exactly the
                           kind that goes on matching nothing while every assertion around it
                           stays green. */
                        'statusWarnArc', 'statusWarnTrack', 'statusWarnState', 'dangerArc']) {
      assert.ok(s.base.el[name], `${room}: the fixture no longer mounts ${name} - the sweep is guarding nothing`);
    }
    /* And the five READOUT STRIPS the 12 assertions read. Each is a different
       STATE of one component, and four of them are states a single mounted
       strip cannot be in at once, so a fixture that stops building one leaves
       its law unguarded while every other assertion stays green. */
    for (const name of ['primary', 'absent', 'liveEmpty', 'liveTurn', 'allOff', 'floor', 'speck',
                        'full', 'narrow', 'crushed', 'recovered']) {
      assert.ok(s.base.strip[name], `${room}: the fixture no longer mounts the ${name} strip`);
    }
  });
});

/* ------------------------------------------ the fills and the status inks */

test('the send pill is a FILL and rides the fill ramp, never the mark ramp', () => {
  forEachRoom((s, room) => {
    // The durable half: a token that NAMES AN ON-COLOUR is a FILL. .aic-send
    // sets background AND color, so it is a fill and takes marker_fill_on_paper
    // in the paper room. Rest and hover must come from ONE ramp; they did not.
    assert.equal(s.base.el.send.bg, s.base.tokens['--aic-marker-fill'],
      `${room}: the send pill fill is not --aic-marker-fill`);
    assert.ok(s.base.el.send.fgOnOwnBg >= 4.5,
      `${room}: send label measures ${s.base.el.send.fgOnOwnBg}:1 on its own fill; the mark ramp measured 4.35 here, which is the number the fill split exists to kill`);
  });
});

test('the destructive ink carries a room split, and every red string clears AA', () => {
  const stock = { 'stock dark': '227,99,80,1', 'stock light': '179,58,43,1' };
  forEachRoom((s, room, def) => {
    if (def.inkline) {
      assert.equal(s.base.tokens['--aic-destructive-text'], s.base.inkTokens['--ink-destructive-text'],
        `${room}: --aic-destructive-text did not defer to the theme's channel`);
    } else {
      assert.equal(s.base.tokens['--aic-destructive-text'], stock[room],
        `${room}: outside INKLINE this inherited Obsidian's --text-error, which is not a design-system value and was never swept`);
    }
    for (const name of ['toolFailedName', 'toolFailedGlyph']) {
      assert.equal(s.base.el[name].fg, s.base.tokens['--aic-destructive-text'], `${room}: ${name} ink`);
      assert.ok(s.base.el[name].fgOnGround >= 4.5,
        `${room}: ${name} measures ${s.base.el[name].fgOnGround}:1 on ${s.base.el[name].ground}`);
    }
    assert.equal(s.base.el.sendStop.fg, s.base.tokens['--aic-destructive-text'], `${room}: Stop label ink`);
    assert.ok(s.base.el.sendStop.fgOnGround >= 4.5,
      `${room}: Stop label measures ${s.base.el.sendStop.fgOnGround}:1 - it is on a NEUTRAL ground, so red is legal there`);
  });
});

test('a status ink never rides its own hue tint', () => {
  // Measured across the whole active-chip family: Ask (wash, quiet ink) and
  // Auto-accept (amber tint, quiet ink) clear by an order of magnitude; Plan
  // and Bypass put a coloured ink on their OWN coloured tint and were the only
  // two that failed. Both take the quiet ink. The hue is carried by the tint,
  // and on Bypass also by the full-strength border - two devices, not one.
  const quiet = (s) => new Set([s.base.tokens['--aic-paper'], s.base.tokens['--aic-dim']]);
  forEachRoom((s, room) => {
    for (const name of ['segPlan', 'segAsk', 'segAuto', 'segBypass']) {
      const chip = s.base.el[name];
      assert.ok(quiet(s).has(chip.fg),
        `${room}: ${name} label is ${chip.fg}, not a quiet ink - a status ink on its own tint`);
      assert.ok(chip.fgOnOwnBg >= 4.5,
        `${room}: ${name} label measures ${chip.fgOnOwnBg}:1 on its own composited tint`);
    }
    // Bypass keeps its red, carried by the two devices that can afford it.
    assert.equal(s.base.el.segBypass.borderTop, s.base.tokens['--aic-destructive'],
      `${room}: Bypass lost the full-strength border that carries its hue`);
    assert.ok(s.base.el.segBypass.borderOnGround >= 3.0,
      `${room}: Bypass boundary ${s.base.el.segBypass.borderOnGround}:1 (SC 1.4.11)`);
  });
});

test('the settings index rides the small-marker-text rung', () => {
  forEachRoom((s, room) => {
    assert.equal(s.base.el.settingsIndex.fg, s.base.tokens['--aic-marker-text'],
      `${room}: the settings index spends --aic-marker as 11px mono text`);
    assert.ok(s.base.el.settingsIndex.fgOnGround >= 4.5,
      `${room}: settings index measures ${s.base.el.settingsIndex.fgOnGround}:1 - 4.57 cleared by 0.07 and the floor is not a target`);
  });
});

/* ------------------------------ the statusline rung and the hover wash --- */

/* THE STRIP MOVED INTO THE CARD, and this assertion moved with it rather than
 * being deleted.
 *
 * It used to read "rung 4 may not be a descendant of rung 3", and it was right
 * for a reason that has since been retired: `.aic-composer` triggered its focus
 * treatment on `:focus-within`, so a non-focusable readout inside it lit up as
 * part of the input's focus state. That trigger is now
 * `.is-input-focused`, stamped by the composer on the TEXTAREA's own focus (it was
 * `:has(> textarea.aic-input:focus)` until the directory lint flagged `:has`) - and the property is
 * enforced by the SELECTOR instead of by the coordinates. Which means the
 * nesting was never the real guard, only a proxy for one, and the real guard is
 * the send-pill focus read above: `composerSend.border === --aic-hairline`
 * proves that focusing a non-textarea descendant of the card does not step the
 * card. That test is what protects this move, and it is asserted independently.
 *
 * What forced the move is Obsidian's own status bar painting over the bottom of
 * a right-sidebar leaf: outside the card, the strip rendered perfectly and was
 * invisible. */
test('the statusline is the CARD\'s last child, and the card keeps its focus scope', () => {
  forEachRoom((s, room) => {
    assert.equal(s.base.facts.insideComposer, true,
      `${room}: rung 4 left the card. Outside it, Obsidian's status bar covers the strip ` +
      `on a right sidebar - it renders correctly and cannot be seen.`);
    assert.equal(s.base.facts.censusOrder, 'stream,chips,composer,facts',
      `${room}: the pane's four rungs are out of order or missing (got ${s.base.facts.censusOrder})`);
    /* THE PROPERTY THE OLD NESTING RULE WAS PROXYING FOR, asserted directly and
       in the same breath as the move that would have broken it. If the card's
       trigger ever widens back to :focus-within, this goes red with the strip
       still legally inside the card - which is the whole point of measuring the
       property instead of its old coordinates. */
    assert.equal(s.composerSend.border, s.base.tokens['--aic-hairline'],
      `${room}: the card steps for a focused descendant that is not the textarea, so the ` +
      `readout strip now inside it has rejoined the input's focus affordance`);
    assert.equal(s.base.facts.borderTopStyle, 'solid', `${room}: 4's hairline separator is missing`);
    assert.equal(s.base.facts.borderTop, s.base.tokens['--aic-hairline-subtle'], `${room}: separator colour`);
    assert.equal(s.base.facts.height, '24px', `${room}: 4 specifies 24px; the build had 12`);
    /* The card's own 12px padding is pulled back and re-applied, so the hairline
       spans the card edge to edge and the first character still lines up with
       the text above it. */
    assert.equal(s.base.facts.padding, '0px 12px', `${room}: 4 specifies padding 0 12px inside the card`);
    assert.equal(s.base.facts.margin, '8px -12px -12px',
      `${room}: the strip must pull back the card's padding, or its hairline stops short of both edges`);
  });
});

/* WITH NO STATUS BAR THERE IS NO CLEARANCE, and the fixture has no status bar.
 * The fallback in the custom property is what this measures: an unmeasured bar
 * must cost zero, because the alternative - a guessed constant - would put a
 * permanent empty band under every composer in every vault. What the clearance
 * is when a bar IS present is geometry, and it is asserted headless against
 * `overlapPx` in statusbar.test.mjs. */
test('an unmeasured status bar costs the dock nothing', () => {
  forEachRoom((s, room) => {
    assert.equal(s.base.facts.dockPaddingBottom, '12px',
      `${room}: the dock reserved ${s.base.facts.dockPaddingBottom} with no status bar to clear`);
  });
});

test('the icon button hover wash survives the plugin own reset', () => {
  forEachRoom((s, room) => {
    // The shared reset listed `.aic-icon-btn:hover` at (0,5,0) and declared
    // `background-color: transparent`; the leaf that paints the wash is
    // (0,4,0). The plugin outranked itself - the same shape as the two cascade
    // defects above.
    assert.equal(s.hover.el.iconBtn.bg, s.base.tokens['--aic-wash'],
      `${room}: 6.2 gives the attachment control "hover --aic-paper on --aic-wash"; the ground half is dead`);
    assert.equal(s.hover.el.iconBtn.fg, s.base.tokens['--aic-paper'], `${room}: icon button hover ink`);
  });
});

test('the attachment thumbnail keeps a ground its remove control can be read on', () => {
  forEachRoom((s, room) => {
    /* The remove control sits ON an image, so it is the one control in this
       plugin whose ground is arbitrary photo pixels. It therefore carries its
       OWN fill and is deliberately absent from the transparent-grounds list
       above; a transparent glyph here has no contrast anyone can predict. */
    assert.notEqual(s.base.el.thumbX.bg, 'transparent',
      `${room}: the thumbnail's remove control went transparent over the image`);
    assert.ok(s.base.el.thumbX.fgOnOwnBg >= 4.5,
      `${room}: remove glyph measures ${s.base.el.thumbX.fgOnOwnBg}:1 on its own fill`);
    assert.equal(s.base.el.thumb.borderTop, s.base.tokens['--aic-hairline'],
      `${room}: the thumbnail cell lost its hairline, so a pale image has no edge`);
  });
});

test('the danger fact steps its whole label cell, direction word included', () => {
  forEachRoom((s, room) => {
    const red = s.base.tokens['--aic-destructive-text'];
    for (const name of ['dangerLabel', 'dangerValue', 'dangerDir']) {
      assert.equal(s.base.el[name].fg, red,
        `${room}: ${name} did not step - the direction word is IN the label cell, so it steps with it`);
    }
    assert.equal(s.base.el.dangerState.fg, s.base.tokens['--aic-faint'],
      `${room}: the state word rides the quiet ink voice, never the red`);
  });
});

/* ------------------------------------- the statusline dot, the clamp, residue */

test('the escalated budget names its state in words, not only in the arc hue', () => {
  forEachRoom((s, room) => {
    const state = s.base.el.statusWarnState;
    assert.ok(state, `${room}: the escalated fact has no state carrier - hue is the sole carrier (SC 1.4.1)`);
    assert.ok((state.text ?? '').trim().length > 0, `${room}: the state carrier renders no word`);
    assert.equal(state.fg, s.base.tokens['--aic-faint'],
      `${room}: the state word must ride the quiet ink voice - amber never carries the string`);
    const label = s.base.el.statusWarnFact.ariaLabel ?? '';
    assert.match(label, /warning/i, `${room}: the accessible name does not name the elevated state (got "${label}")`);
  });
});

test('a REAL turn puts digits on the screen', () => {
  forEachRoom((s, room) => {
    /* The other half of the absence law, and the half that cannot be checked by
       looking: an empty strip on a fresh session is CORRECT, so a strip that
       stayed empty after real data arrived would look exactly the same. This
       one is driven by the shipped Normalizer and reducer from raw provider
       messages, straight into the shipped renderer. */
    const t = s.base.strip.liveTurn;
    assert.equal(t.display, 'flex', `${room}: a completed turn left the strip hidden`);
    assert.deepEqual(t.ids, ['context', 'tokensIn', 'tokensOut'],
      `${room}: a completed turn rendered ${JSON.stringify(t.ids)}`);
    assert.ok(/[0-9]/.test(t.text),
      `${room}: a completed turn put no digit on the screen - the readouts are absent while the ` +
      `data exists, which is the opposite failure to the one the law was written for`);
    assert.ok(t.overhang <= 0.5, `${room}: the live strip overhangs by ${t.overhang}px`);
  });
});

test('the empty strip explains itself in settings, not in the strip', () => {
  forEachRoom((s, room) => {
    const n = s.base.measuredNote;
    assert.ok(n, `${room}: the settings note is not mounted, so the one answer to "why is my strip empty" is unmeasured`);
    assert.equal(n.text, 'Each readout appears once it has been measured. Nothing here is estimated.',
      `${room}: the note text drifted`);
    /* Body face, not the mono kicker's. It is a sentence to read, not a label
       to scan, and 11px uppercase mono would make documentation look like
       chrome. */
    assert.equal(n.transform, 'none', `${room}: the note is uppercased like a kicker`);
    assert.ok(parseFloat(n.size) >= 12, `${room}: the note is ${n.size}`);
    /* And the other half of the ruling: the explanation is HERE and nowhere
       else. A line in the strip saying facts appear later is the placeholder
       defect wearing words. */
    for (const strip of ['absent', 'liveEmpty']) {
      assert.equal(s.base.strip[strip].text, '',
        `${room}: the ${strip} strip carries prose - chrome apologising for itself`);
    }
  });
});

test('the row wash is fenced: the ground alone, 140ms, and not hover-only', () => {
  forEachRoom((s, room) => {
    const m = s.motion.row;
    assert.ok(m, `${room}: no expandable row to measure`);
    assert.equal(m.duration, '0.14s', `${room}: the wash runs at ${m.duration}, not 140ms`);
    assert.match(m.property, /background/, `${room}: the transition names ${m.property}`);
    /* And the ring's own rung, read in the same pre-freeze pass: 240ms, the
       underline's rung. NOT the 1600ms hero-gauge token, which would be a
       permanent animation at the pane's edge. */
    assert.equal(s.motion.arc.duration, '0.24s',
      `${room}: the ring arc runs at ${s.motion.arc.duration}, not 240ms`);
    assert.match(s.motion.arc.property, /stroke-dashoffset/,
      `${room}: the ring transitions ${s.motion.arc.property}`);
    /* THE GROUND ALONE. The hover state may change the background and nothing
       else: a second device on the same cue teaches the eye two things and
       makes neither reliable. */
    const rest = s.base.el.toolRowExpandable;
    const hov = s.hover.el.toolRowExpandable;
    assert.notEqual(hov.bg, rest.bg, `${room}: the hover ground never arrives - the cue is dead`);
    assert.equal(hov.bg, s.base.tokens['--aic-wash'], `${room}: the hover ground is not the wash`);
    for (const prop of ['borderTop', 'boxShadow', 'fg']) {
      assert.equal(hov[prop], rest[prop],
        `${room}: hovering the row also changed ${prop} - the ruling is the ground ALONE`);
    }
    /* NOT HOVER-ONLY, and it is asserted in two places because the two halves
       can fail independently. The STYLESHEET half: the wash rule names
       `:focus-visible` beside `:hover`. Source-level, because the frozen pass
       cannot force a pseudo-class and read a background in the same read, and
       an assertion that cannot fail is worse than none - dropping the selector
       left every other line in this test green. */
    assert.match(
      CSS.replace(/\/\*[\s\S]*?\*\//g, ''),
      /\.aic-tool\.is-expandable:hover,\s*\n?\s*\.aic-tool\.is-expandable:focus-visible/,
      `${room}: the wash is stated for :hover alone, so a keyboard user never sees the cue`,
    );
    /* And the DOM half: the row is focusable and reports its state, so the cue
       is reachable without a mouse at all. */
    const openable = s.base.toolRows.filter((r) => r.hasBody);
    for (const r of openable) {
      assert.equal(r.tabindex, '0', `${room}: the cue is hover-only - the row takes no focus`);
      assert.ok(r.expanded === 'true' || r.expanded === 'false',
        `${room}: the row does not report aria-expanded`);
    }
  });
});

test('a tool row says what was done, never the command, and stays on one line', () => {
  forEachRoom((s, room) => {
    const rows = s.base.toolRows;
    assert.ok(rows.length >= 5, `${room}: only ${rows.length} tool rows - the fixture shrank`);
    const bash = rows.find((r) => r.purpose === 'Check every open task against the index');
    assert.ok(bash, `${room}: the Bash row does not show its purpose sentence`);
    for (const r of rows) {
      assert.equal(r.icons, 1, `${room}: the "${r.purpose}" row carries ${r.icons} family icons, not one`);
      assert.equal(r.wrap, 'nowrap', `${room}: the "${r.purpose}" row wraps; the closed row is one line`);
      assert.ok(!r.purpose.includes('cd "'), `${room}: the closed row leaks the command: ${r.purpose}`);
      assert.equal(r.bodyText, '', `${room}: a closed row already holds body text: ${r.bodyText}`);
      assert.equal(r.bodyDisplay, 'none', `${room}: a closed row's body takes a grid line (${r.bodyDisplay})`);
    }
  });
});

test('a tool row with a body opens, and a row without one does not pretend to', () => {
  forEachRoom((s, room) => {
    const rows = s.base.toolRows;
    const withBody = rows.filter((r) => r.hasBody);
    const without = rows.filter((r) => !r.hasBody);
    // Cardinality on BOTH sides: one empty list makes half the claim vacuous.
    assert.ok(withBody.length >= 1, `${room}: no row has a body, so the expansion is guarding nothing`);
    assert.ok(without.length >= 1, `${room}: every row has a body, so "inert rows stay inert" is untested`);
    assert.ok(without.some((r) => r.purpose === 'Updated the plan'), `${room}: the TodoWrite row grew a body from nothing`);

    for (const r of withBody) {
      assert.equal(r.role, 'button', `${room}: the "${r.purpose}" row is clickable but not a control`);
      assert.equal(r.tabindex, '0', `${room}: the "${r.purpose}" row has no tab stop`);
      assert.equal(r.expanded, 'false', `${room}: the "${r.purpose}" row does not report its state`);
      assert.ok(r.name2.length > 3, `${room}: the "${r.purpose}" row's control has no accessible name`);
      assert.equal(r.cursor, 'pointer', `${room}: the "${r.purpose}" row does not look clickable`);
      // The disclosure chevron is the ONE glyph a row with a body carries.
      assert.equal(r.glyphs, 1, `${room}: the "${r.purpose}" row carries ${r.glyphs} chevrons`);
    }
    for (const r of without) {
      assert.equal(r.role, null, `${room}: a row with nothing to reveal took a tab stop`);
      assert.equal(r.tabindex, null, `${room}: a row with nothing to reveal took a tab stop`);
      assert.equal(r.glyphs, 0, `${room}: a row with nothing to reveal grew a chevron - an empty promise`);
      assert.equal(r.cursor, 'auto', `${room}: a row with nothing to reveal looks clickable`);
    }
  });
});

test('an opened tool row shows the command and the result, wraps, and closes again', () => {
  forEachRoom((s, room) => {
    const e = s.base.toolExpanded;
    assert.ok(e, `${room}: no row with a body to open`);
    assert.equal(e.expanded, 'true', `${room}: the click did not open the row`);
    /* THE BODY IS THE COMMAND AND THE RESULT, each under its kicker, and the
       purpose line stays put above them. */
    assert.deepEqual(e.kickers, ['COMMAND', 'RESULT'], `${room}: the body's kickers are ${e.kickers}`);
    assert.ok(e.commandText.startsWith('cd "/Users/tom/Desktop/ICOR for Life"'),
      `${room}: the opened row does not show the command: ${e.commandText}`);
    assert.equal(e.resultText.split('\n')[0], '12 tasks checked', `${room}: the opened row does not show the result`);
    assert.equal(e.lines, '4 lines', `${room}: the line count reads "${e.lines}" - it is measured, and the fixture has four`);
    assert.ok(e.purposeVisible, `${room}: opening the row lost its purpose line`);
    assert.ok(e.rightVisible, `${room}: opening the row lost its right cell`);
    /* WRAP, NOT SCROLL. A horizontal scrollbar inside a chat row hides the end
       of the string behind a gesture. Two signals, because either alone can be
       satisfied by the wrong fix: the row grew taller, and the command box does
       not extend past the row's own right edge. */
    assert.notEqual(e.wrap, 'nowrap', `${room}: the opened command still refuses to wrap`);
    assert.equal(e.cut, false, `${room}: the opened command is still cutting its payload`);
    assert.ok(e.expandedHeight > e.collapsedHeight,
      `${room}: the opened row is still ${e.expandedHeight}px tall, the same as closed`);
    assert.ok(e.cellRight <= e.rowRight + 1,
      `${room}: the opened command runs ${e.cellRight - e.rowRight}px past the row's right edge`);
    /* The result is bounded in HEIGHT with its own scroll, never in width. */
    assert.equal(e.preMaxHeight, '280px', `${room}: the result box has no height cap (${e.preMaxHeight})`);
    assert.equal(e.preOverflowY, 'auto', `${room}: the result box does not scroll vertically`);
    assert.equal(s.base.toolStillOpen, 'true',
      `${room}: a later tool event snapped the open row shut`);
    assert.equal(s.base.toolOpenAfterRemeasure, 'true',
      `${room}: the repaint-every-row pass closed the open row`);
    assert.equal(s.base.toolReCollapsed, 'false', `${room}: a second click did not close the row`);
    assert.equal(s.base.toolBodyAfterClose, '', `${room}: the closed row kept its body text in the DOM`);
  });
});

test('a fresh pane shows the ACTUAL model, and truth outranks the preset', () => {
  forEachRoom((s, room) => {
    const f = s.base.modelFaces;
    assert.ok(f, `${room}: the preset probes are not mounted`);
    assert.equal(f.fresh, 'fable',
      `${room}: the fresh pane's trigger reads "${f.fresh}" - the resolved model never reached the face`);
    /* Precedence: the session reported a model BEFORE the resolve landed, and
       the preset must not overwrite it - a slow resolve clobbering a session
       fact would be the substitution defect on a new surface. */
    assert.equal(f.late, 'claude-opus-4-6',
      `${room}: the preset overwrote the session's own model (face reads "${f.late}")`);
    /* And the fallback: no resolve, no session, no plugin choice - the
       trigger says WHOSE default will answer, which is true, where it used to
       read the bare word "Model" (a placeholder wearing a control's clothes).
       Still the rare path, never a fresh-vault default now that the resolver
       exists. */
    assert.equal(f.bare, 'Claude Code default model', `${room}: the unresolved fallback face changed`);
  });
});

test('the pickers carry no glyph, and still say they open a menu', () => {
  forEachRoom((s, room) => {
    const p = s.base.pickers;
    // Cardinality first: an empty list makes every claim below vacuous.
    assert.equal(p.length, 3, `${room}: expected mode, model and effort; got ${p.length} pickers`);
    // Every composer the fixture mounts, in every mode state, not only the one
    // the count above reads.
    assert.equal(s.base.pickerGlyphsAnywhere, 0,
      `${room}: ${s.base.pickerGlyphsAnywhere} picker chevron(s) survive somewhere in the document`);
    for (const b of p) {
      assert.equal(b.glyphs, 0,
        `${room}: the picker "${b.text}" still draws a glyph. Three arrows in one thin row is ` +
        `three glyphs saying the same thing.`);
      /* And the half that must NOT go with it. A control that opens a menu and
         says so only by drawing an arrow says nothing at all to a screen
         reader, because the arrow is correctly aria-hidden. */
      assert.equal(b.haspopup, 'menu',
        `${room}: the picker "${b.text}" no longer announces that it opens a menu`);
      assert.ok(b.name.length > 3,
        `${room}: the picker "${b.text}" has no accessible name, so it reads as its VALUE and ` +
        `never says what choosing it changes`);
    }
  });
});

/* ============================ 12 the readout strip, measured in the browser */

test('ABSENCE LAW: with no event the strip prints NO CHARACTER at all', () => {
  forEachRoom((s, room) => {
    const a = s.base.strip.absent;
    assert.ok(a, `${room}: the fixture no longer mounts the absent strip - this law is unguarded`);
    /* The claim as the user meets it. Not "no facts" but no CHARACTER: a zero,
       a dash, an em-dash, a greyed digit and a "not yet" all survive a
       length-of-array check and all die here. */
    assert.equal(a.text, '',
      `${room}: a session with no measurement printed "${a.text}" - that is the 2026-08-29 CRITICAL, ` +
      `where the strip rendered plan figures with no event behind them`);
    assert.equal(/[0-9]/.test(a.text), false, `${room}: the unmeasured strip printed a digit`);
    assert.equal(a.allCells, 0, `${room}: an unmeasured readout reserved a slot`);
    /* And it takes no HEIGHT either: absent, not empty. A bar under the empty
       state is chrome announcing that it has nothing to say. */
    assert.equal(a.display, 'none', `${room}: the empty strip still occupies the pane`);
  });
});

test('the strip has TWO heights and no third', () => {
  forEachRoom((s, room) => {
    /* Zero while no session event has arrived, and 24px from the first one
       onward whether or not a fact has been MEASURED. Governed by the session
       and not by the fact count, so the strip reflows ONCE - at the moment the
       empty state is being replaced by the stream anyway - instead of popping
       open again at the first turn-end. */
    assert.equal(s.base.strip.absent.display, 'none',
      `${room}: a pane with no session event already carries a chrome bar`);
    const live = s.base.strip.liveEmpty;
    assert.equal(live.display, 'flex',
      `${room}: a live session with nothing measured has no strip - it will pop open at the first turn-end`);
    assert.equal(live.text, '', `${room}: the live-but-unmeasured strip printed "${live.text}"`);
    assert.equal(live.cells, 0, `${room}: a slot was reserved for an unmeasured readout`);
    /* And the one case that returns a LIVE session to zero: every readout
       switched off. Absence, not an empty bar, hairline included. */
    assert.equal(s.base.strip.allOff.display, 'none',
      `${room}: every readout is off and the strip still draws a bar and a hairline`);
  });
});

test('rung 4 contributes ZERO tab stops', () => {
  forEachRoom((s, room) => {
    for (const [name, strip] of Object.entries(s.base.strip)) {
      if (!strip || typeof strip !== 'object' || !('focusables' in strip)) continue;
      assert.equal(strip.focusables, 0,
        `${room}: ${name} carries ${strip.focusables} focusable elements. A readout that can be ` +
        `clicked has stopped being a readout and belongs in rung 3.`);
      assert.equal(strip.tabindexed, 0, `${room}: ${name} carries a tabindex`);
      assert.deepEqual(strip.roles, [], `${room}: ${name} claims an interactive role`);
    }
  });
});

test('THE FLOOR: the two budgets fit, and the width is measured not computed', () => {
  forEachRoom((s, room) => {
    const f = s.base.strip.floor;
    assert.deepEqual(f.ids, ['context', 'plan'],
      `${room}: the irreducible strip is the two BUDGETS and nothing else`);
    // 12.8 computes ~214px from a 6.0px advance and asks for a measurement
    // against the shipped face. This is that measurement. It is bounded rather
    // than pinned to one number, because a font substitution moves it and a
    // hard equality would fail for the wrong reason.
    assert.ok(f.width > 120 && f.width < 320,
      `${room}: the measured floor is ${f.width}px, which is nowhere near the ~214px 12.8 computed - ` +
      `either the strip grew a fact or the face changed`);
    assert.equal(f.overhang <= 0.5, true, `${room}: the floor strip overhangs its own content box`);
  });
});

test('THE LADDER: a narrow pane removes WHOLE facts, and never a budget', () => {
  forEachRoom((s, room) => {
    const n = s.base.strip.narrow;
    const full = s.base.strip.full;
    assert.equal(full.ids.length, 8,
      `${room}: the CONTROL strip, at 900px with every readout measured, rendered ${full.ids.length} ` +
      `facts instead of 8 - without it "the narrow one has fewer" proves nothing`);
    assert.ok(full.overhang <= 0.5, `${room}: even at 900px the strip overhangs`);
    assert.ok(n.ids.length < full.ids.length,
      `${room}: a 260px pane kept all ${n.ids.length} facts - nothing was measured`);
    for (const id of ['context', 'plan']) {
      assert.ok(n.ids.includes(id),
        `${room}: the ${id} BUDGET dropped. The strip answers "am I about to hit a wall", ` +
        `so a budget never drops before a readout.`);
    }
    // The pair goes as one: IN standing alone reads as the total.
    assert.equal(n.ids.includes('tokensIn'), n.ids.includes('tokensOut'),
      `${room}: half the token pair survived - ${JSON.stringify(n.ids)}`);
    // The order never changes, whatever was removed.
    const ORDER = ['context', 'plan', 'tokensIn', 'tokensOut', 'elapsed', 'agents', 'sessionStart', 'sessionUpdated'];
    assert.deepEqual(n.ids, ORDER.filter((id) => n.ids.includes(id)), `${room}: the ladder reordered the strip`);
    // And the survivors fit WHOLE. This is geometry, not a re-run of the
    // arithmetic that chose them: a fact clipped mid-value is a wrong number
    // rendered with full authority.
    assert.ok(n.overhang <= 0.5,
      `${room}: the last surviving fact overhangs the strip by ${n.overhang}px - it is being clipped`);
  });
});

test('BELOW THE FLOOR: no strip at all, never a clipped budget', () => {
  forEachRoom((s, room) => {
    const c = s.base.strip.crushed;
    /* "A budget never drops" is a PRIORITY, not an exemption from fitting. At
       90px the ladder has no readouts left to remove and the two budgets still
       do not fit whole, so the honest render is nothing. CTX USED 42% cut off
       at CTX USED 4 is a wrong number with full authority, and it being the
       most important number on the strip makes that worse, not better. */
    assert.equal(c.display, 'none',
      `${room}: a pane below the floor still drew a strip - the budgets are being clipped`);
    assert.equal(c.cells, 0, `${room}: ${c.cells} facts survived a pane too narrow for any of them`);
    assert.equal(c.overhang <= 0.5, true, `${room}: the crushed strip overhangs by ${c.overhang}px`);
    /* And this is what makes the measured floor safe to state as a BAND rather
       than an exact width: a face wider than the one it was measured against
       cannot produce a clipped number, only an empty strip one pane-width
       sooner. The law does not depend on the number. */
    const r = s.base.strip.recovered;
    assert.equal(r.display, 'flex',
      `${room}: a strip crushed and then widened stayed dark. A hidden box never resizes, so a ` +
      `strip that watched its own size could go dark once and never come back.`);
    assert.deepEqual(r.ids, ['context', 'plan'], `${room}: the widened strip came back wrong`);
  });
});

test('THE RING: earned by a budget, drawn as consumption, never a dial', () => {
  forEachRoom((s, room) => {
    const rings = s.base.strip.rings;
    assert.ok(rings.length > 0, `${room}: no ring rendered at all`);
    for (const r of rings) {
      assert.ok(r.fact === 'context' || r.fact === 'plan',
        `${room}: ${r.fact} wears a ring and has no denominator for an arc to be a fraction of`);
      assert.equal(r.hidden, 'true', `${room}: the arc carries its own accessible name - the number said twice`);
      assert.equal(r.digitsInside, '', `${room}: a number inside the ring makes it a dial`);
      assert.ok(r.box <= 12.5, `${room}: the ring is ${r.box}px - a state indicator is never larger than 12px`);
      if (!r.hasArc) continue;
      assert.equal(r.cap, 'butt',
        `${room}: a round cap at 1.5px draws a visible lozenge at 1% and asserts a magnitude ` +
        `the measurement does not have`);
      assert.equal(r.strokeWidth, '1.5px', `${room}: the arc stroke is ${r.strokeWidth}`);
      /* The arithmetic, off the pixels. On a USED fact the arc agrees with the
         digits; on a LEFT fact it is their complement. Under "arc = printed
         number" the two rings would invert each other, and a dial is read
         before its label is. */
      const printed = Number.parseInt(r.value, 10) / 100;
      const consumed = r.direction === 'LEFT' ? 1 - printed : printed;
      const expected = Math.round(32.99 * (1 - consumed) * 100) / 100;
      assert.ok(Math.abs(r.offset - expected) < 0.05,
        `${room}: ${r.fact} prints ${r.value} ${r.direction} and draws offset ${r.offset}, ` +
        `not ${expected}. The arc depicts CONSUMPTION on every ring, always.`);
    }
    /* And the floor on the arc itself: below 3% consumed the track stands
       alone. An empty ring is the honest picture of an empty budget; a drawn
       speck is not, and it is the same class of defect as marking an unmeasured
       value. */
    const speck = s.base.strip.speck;
    assert.equal(speck.value, '1%', `${room}: the speck probe is not at 1% any more`);
    assert.equal(speck.tracks, 1, `${room}: the 1% budget lost its track as well as its arc`);
    assert.equal(speck.arcs, 0,
      `${room}: a 1% budget drew an arc. At a 1.5px stroke that is a visible mark asserting a ` +
      `magnitude the measurement does not have.`);

    // The ceiling is DERIVED from the budget count, never allowed as a number.
    const perStrip = {};
    for (const r of rings) perStrip[r.fact] = (perStrip[r.fact] ?? 0) + 1;
    assert.deepEqual(Object.keys(perStrip).sort(), ['context', 'plan']);
  });
});

test('every readout names itself twice: a short name and a reachable long form', () => {
  forEachRoom((s, room) => {
    const rows = s.base.strip.described;
    assert.ok(rows.length >= 8, `${room}: only ${rows.length} facts carried a description`);
    const ids = s.base.strip.describeIds;
    // Cardinality first: an empty id list makes the uniqueness check below
    // pass by having nothing to collide.
    assert.ok(ids.length >= 8, `${room}: only ${ids.length} described elements - nothing to check for collisions`);
    assert.equal(new Set(ids).size, ids.length,
      `${room}: two readouts share an aria-describedby id. With more than one chat pane open ` +
      `the second pane's facts would be described by the first pane's node.`);
    for (const d of rows) {
      assert.ok(d.name.length > 3, `${room}: ${d.fact} has no accessible name`);
      assert.ok(d.found, `${room}: ${d.fact} points aria-describedby at nothing`);
      assert.ok(d.words > 40, `${room}: ${d.fact} long form is ${d.words} characters - it is not the three-line form`);
      assert.equal(d.visible, 'none', `${room}: the long form renders in the strip; it belongs in the tooltip`);
      // ONE string, two consumers. Two copies would be two things to keep true.
      assert.ok(d.tooltip.length > 40, `${room}: ${d.fact} carries no tooltip`);
      assert.ok(d.tooltip.length !== d.name.length,
        `${room}: ${d.fact} tooltip is the short name - the long form never got authored`);
    }
  });
});

test('the decision body is clamped to three lines', () => {
  forEachRoom((s, room) => {
    assert.equal(s.base.el.decisionBody.lineClamp, '3', `${room}: 11.8 caps the body at 3 lines`);
  });
});

/* --------------------------------------- source-level companions to the sweep */

test('no !important and no all-property reset anywhere in the stylesheet', () => {
  /* 0.1 bans `!important` flat, and the directory's scanner bans both it and
     `all:` - the reduced-motion block, the one former exemption, now wins by
     tripled specificity instead. Comments are blanked across the WHOLE file
     before scanning (a per-line strip misses continuation lines of a block
     comment, and this file discusses both banned tokens in prose). */
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const hits = [];
  code.split('\n').forEach((line, i) => {
    if (/!important/.test(line)) hits.push(`${i + 1}: !important`);
    if (/(?:^|[{;])\s*all\s*:/.test(line)) hits.push(`${i + 1}: all:`);
  });
  assert.deepEqual(hits, [],
    'the flag is the tell that a specificity problem was met and patched instead of counted:\n' + hits.join('\n'));
});

test('the reduced-motion override outranks every motion carrier without the flag', () => {
  /* The block wins on specificity plus position now, so its SHAPE is the
     guarantee: the tripled selectors at (0,3,0), and no animation or
     transition carrier anywhere in the file heavier than that. A carrier at
     (0,4,0) would escape the override silently - this is the assertion that
     stops it happening quietly. */
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(code, /@media \(prefers-reduced-motion: reduce\) \{\s*\.aic-root\.aic-root\.aic-root \*,\s*\.aic-menu\.aic-menu\.aic-menu \*/,
    'the reduced-motion block lost its tripled selector - without !important that specificity IS the mechanism');
  // Every rule carrying live animation/transition, measured for class count.
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    const decl = body.match(/(?:^|;)\s*(animation|transition)\s*:([^;]*)/);
    if (!decl || /^\s*none\b/.test(decl[2])) continue;
    const sel = m[1].trim().split(',').map((x) => x.trim());
    for (const one of sel) {
      if (one.startsWith('@') || /^\d/.test(one)) continue; // keyframe steps
      const classish = (one.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
      assert.ok(classish <= 3,
        `"${one}" carries ${decl[1]} at ${classish} class-level steps - the reduced-motion ` +
        `override is (0,3,0) plus last position and this rule would escape it`);
    }
  }
});

test('the root beats the host pane padding on weight, not on !important', () => {
  forEachRoom((s, room) => {
    assert.equal(s.base.el.root.padding, '0px',
      `${room}: the host's .workspace-leaf-content .view-content padding won`);
  });
});

test('no !important survives in the control layer', () => {
  const offenders = CSS.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /!important/.test(line) && /aic-approve|aic-badge|aic-code-chip|aic-send|aic-agent-chip|aic-chip-x/.test(line));
  assert.deepEqual(offenders, [],
    'A local !important patch is the tell that a specificity problem was met and not diagnosed');
});

test('the fixture still names the classes StreamRenderer actually renders', () => {
  const src = readFileSync(resolve(repo, 'src/view/stream/StreamRenderer.ts'), 'utf8');
  for (const cls of ["cls: 'aic-approve-deny'", "cls: 'aic-approve-once'", "cls: 'aic-approve-always'"]) {
    assert.ok(src.includes(cls), `StreamRenderer no longer renders ${cls}; the fixture is guarding a dead class`);
  }
});

test('the status and hand tokens carry a room split, not one room twice', () => {
  // The design system names both rungs of each of these ramps. A single
  // fallback means one room paints the other room's value, which is how the
  // amber landed at 2.42:1 on stock white and the hand ink at 3.11:1.
  const stock = {
    // Both rungs of each ramp.
    'stock dark': { '--aic-warning': '194,163,92,1', '--aic-success-dot': '125,154,127,1', '--aic-hand-ink': '255,90,45,1' },
    'stock light': { '--aic-warning': '138,111,51,1', '--aic-success-dot': '94,122,96,1', '--aic-hand-ink': '185,54,19,1' },
  };
  forEachRoom((s, room, def) => {
    if (!def.inkline) {
      for (const [token, want] of Object.entries(stock[room])) {
        assert.equal(s.base.tokens[token], want, `${room}: ${token} resolved to the wrong room's rung`);
      }
      return;
    }
    // Inside a theme that maps the channel, the fallbacks must be INERT: the
    // room split is a fallback fix, and a fallback that changes a themed value
    // is a fork of the brand, not a repair of it. Asserted against the theme's
    // own values rather than a copy of them.
    for (const [aic, ink] of Object.entries({
      '--aic-warning': '--ink-warning',
      '--aic-success-dot': '--ink-success-dot',
      '--aic-hand-ink': '--ink-hand-ink',
    })) {
      assert.equal(s.base.tokens[aic], s.base.inkTokens[ink],
        `${room}: ${aic} did not defer to the theme's ${ink}`);
    }
  });
});

/* ------------------------------------------- the two bands the eye looks for */

test('ASKED and ANSWER are banners, and ANSWER carries the hue', () => {
  forEachRoom((s, room) => {
    /* They were three kickers over three runs of text, so the two blocks that
       answer "does this need me at all" read at the same speed as every other
       label on the card. They are the first thing on it and often the only two
       the user reads. */
    for (const name of ['bandAsked', 'bandAnswer']) {
      assert.notEqual(s.base.el[name].bg, 'transparent',
        `${room}: ${name} has no ground, so it is a label and not a banner`);
      assert.equal(s.base.el[name].borderLeftWidth, '2px', `${room}: ${name} lost its rail`);
    }
    // ANSWER is the payload, so it is the one that takes the accent. ASKED
    // restates what the user already knows and stays neutral.
    assert.equal(s.base.el.bandAnswer.borderLeft, s.base.tokens['--aic-marker'],
      `${room}: the ANSWER rail is not the marker, so nothing distinguishes it from ASKED`);
    assert.equal(s.base.el.bandAsked.borderLeft, s.base.tokens['--aic-hairline'],
      `${room}: ASKED took an accent it has no claim to`);
    /* THE HOUSE RULE, one block up from the mode chips: a status ink never
       rides its own hue's tint. The rail is the colour and the ground stays
       neutral, so the text keeps every point of its contrast. */
    assert.equal(s.base.el.bandAnswer.bg, s.base.el.bandAsked.bg,
      `${room}: the ANSWER banner tinted its own ground, which is where contrast goes to die`);
  });
});

test('an opened tool row turns its dot into a rail that brackets the block', () => {
  forEachRoom((s, room) => {
    const t = s.base.toolRail;
    assert.ok(t && t.expanded, `${room}: the running long row did not open, so nothing here was measured`);
    /* A 6px dot centred beside a twelve-line command floats mid-air, attached
       to nothing. Stretched to a rail it brackets the content, the way the
       decision blocks' rail already does. Same element, same tone, one
       carrier changing shape. */
    assert.equal(t.rail?.width, '2px', `${room}: the expanded row's dot is not a rail`);
    assert.ok(t.rail?.tall, `${room}: the rail does not span the block (height <= 3x width)`);
    assert.equal(t.rail?.radius, '1px', `${room}: the rail kept the circle's rounding`);
    // And the collapsed running row keeps its circle - the reshape is the
    // OPEN state's, never the status's.
    assert.equal(t.round?.width, '6px', `${room}: the collapsed dot lost its size`);
    assert.equal(t.round?.radius, '50%', `${room}: the collapsed dot is not a circle`);
  });
});

test('the working indicator speaks in the accent, and its hover stays in it', () => {
  forEachRoom((s, room) => {
    /* The line is the only thing on screen saying the turn is alive, and in
       the faint ink the eye skipped exactly the element that answers "is it
       stuck". The ratio itself is covered by the ink sweep, which measures
       every text node this fixture mounts - this test pins WHICH ink, so a
       future tidy-up cannot quietly hand the pulse back to the chrome voice. */
    assert.equal(s.base.el.thinkingLabel.fg, s.base.tokens['--aic-marker-text'],
      `${room}: the thinking label must ride the marker's TEXT rung - the bare ` +
      `marker measured 4.19:1 as 20px text on the INKLINE light ground`);
    /* And the hover steps WITHIN the accent. The old hover went to the quiet
       grey, which on an accent base reads as the control dimming under the
       pointer - de-emphasis at the exact moment of interest. */
    assert.equal(s.hover.el.thinkingHead.fg, s.base.tokens['--aic-marker-up'],
      `${room}: the head's hover left the accent family`);
  });
});

test('no text on a card is clipped to a line count', () => {
  forEachRoom((s, room) => {
    /* `-webkit-line-clamp: 2` on ASKED was the terminal format's "at most two
       lines" rule pressed into CSS - and in a terminal that rule was about what
       the model WRITES. Here it cut the question in half after the model had
       already written it, with no affordance to see the rest: text that exists,
       is on the page, and cannot be read. */
    assert.equal(s.base.el.askedText.lineClamp, 'none',
      `${room}: the ASKED text is clamped to ${s.base.el.askedText.lineClamp} lines and the ` +
      `remainder is unreachable - the panel scrolls, there is nothing to save space for`);
  });
});
