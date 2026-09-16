/* The Obsidian DOM surface the view code uses, implemented for a real browser.
 *
 * esbuild aliases the `obsidian` import to this file when it builds the
 * computed-style fixture, so the gate mounts the SHIPPED components - the real
 * Composer, the real DecisionBadge, the real structured renderer - rather than
 * a hand-written copy of their markup. A fixture that re-types the DOM is a
 * fixture that can agree with a stylesheet the product disagrees with. */

interface ElOptions {
  cls?: string;
  text?: string;
  type?: string;
  attr?: Record<string, string>;
  href?: string;
  title?: string;
  value?: string;
}

type AnyEl = HTMLElement & Record<string, unknown>;

function install(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.__aicShimmed) return;
  proto.__aicShimmed = true;

  function apply(el: HTMLElement, o?: ElOptions): HTMLElement {
    if (!o) return el;
    if (o.cls) for (const c of o.cls.split(/\s+/).filter(Boolean)) el.classList.add(c);
    if (o.text !== undefined) el.textContent = o.text;
    if (o.type) el.setAttribute('type', o.type);
    if (o.href) el.setAttribute('href', o.href);
    if (o.title) el.setAttribute('title', o.title);
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
    return el;
  }

  proto.createEl = function (this: HTMLElement, tag: string, o?: ElOptions): HTMLElement {
    const el = document.createElement(tag);
    this.appendChild(el);
    return apply(el, o);
  };
  proto.createDiv = function (this: HTMLElement, o?: ElOptions): HTMLElement {
    return (this as AnyEl).createEl('div', o) as HTMLElement;
  };
  proto.createSpan = function (this: HTMLElement, o?: ElOptions): HTMLElement {
    return (this as AnyEl).createEl('span', o) as HTMLElement;
  };
  /* Obsidian's cross-realm instanceof, which `remeasureDecisionBodies` calls
     from the column's ResizeObserver. It was never exercised because nothing
     in the fixture resized the column after mount; a block appended after
     the observer attached made it fire, and a shim without the method threw
     out of the observer callback. The prototype method is the honest twin. */
  proto.instanceOf = function (this: HTMLElement, ctor: abstract new (...args: never[]) => unknown): boolean {
    return this instanceof ctor;
  };
  proto.empty = function (this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.detach = function (this: HTMLElement): void {
    this.remove();
  };
  proto.setText = function (this: HTMLElement, text: string): void {
    this.textContent = text;
  };
  /* Obsidian's read side of setText. The product has always called it - the
     tool-row painter reads a row's name back out - and this file did not
     implement it, so the fixture threw the moment a code path reached it. It
     did not show up sooner because the one existing caller only runs when a
     tool-use id is seen twice, which no fixture did. */
  proto.getText = function (this: HTMLElement): string {
    return this.textContent ?? '';
  };
  proto.addClass = function (this: HTMLElement, ...cls: string[]): void {
    for (const c of cls) this.classList.add(c);
  };
  proto.removeClass = function (this: HTMLElement, ...cls: string[]): void {
    for (const c of cls) this.classList.remove(c);
  };
  proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean): void {
    this.classList.toggle(cls, on);
  };
  proto.hasClass = function (this: HTMLElement, cls: string): boolean {
    return this.classList.contains(cls);
  };
  proto.setAttr = function (this: HTMLElement, key: string, value: string): void {
    this.setAttribute(key, String(value));
  };
  proto.setCssStyles = function (this: HTMLElement, styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  };
}

install();

/* Obsidian injects a lucide <svg class="svg-icon">. Shape, not artwork: the
   stylesheet only ever sizes and colours `.svg-icon`. */
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `svg-icon lucide-${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  el.appendChild(svg);
}

export function setTooltip(el: HTMLElement, text: string): void {
  el.setAttribute('data-tooltip', text);
}

export class Notice {
  constructor(readonly message: string) {}
}

/* Obsidian's Modal, reduced to what `ContextModal` actually touches: an app, the
   two elements it paints into, and open/close. It appends `modalEl` to
   `document.body`, which is where the real one lives too - and that placement is
   the point rather than an approximation. The group modal's rows are plugin
   controls that sit OUTSIDE `.aic-root`, so a sweep bounded by the pane's root
   never saw them, and `.aic-ctx-modal-row` was one of the fourteen controls
   taking the host's `height: 30px` unmeasured. */
export class Modal {
  readonly modalEl = document.createElement('div');
  readonly contentEl = document.createElement('div');

  constructor(readonly app: unknown) {
    this.modalEl.appendChild(this.contentEl);
  }

  open(): void {
    document.body.appendChild(this.modalEl);
    this.onOpen();
  }

  close(): void {
    this.modalEl.remove();
    this.onClose();
  }

  onOpen(): void {}
  onClose(): void {}
}

/* Named so `ContextModal`'s `instanceof TFile` compiles and answers false here.
   Nothing in this fixture opens a note, and a stub that answered true would
   invite an assertion about the vault, which this gate does not have. */
export class TFile {
  constructor(readonly path: string = '') {}
}

/* StreamRenderer's two remaining Obsidian dependencies, so the fixture can
   drive the SHIPPED tool-row state machine with real events instead of
   re-typing its markup. */
export class Component {
  load(): void {}
  unload(): void {}
  register(): void {}
  registerEvent(): void {}
}

/* `renderChipTray` is a free function, but it lives in the module that also
   declares `SubagentView`, so importing the shipped tray drags `ItemView` in.
   The stub carries no behaviour on purpose: nothing in the fixture constructs a
   view, and a stub with methods would invite one. It exists so rung 2 comes
   from shipped code rather than from hand-typed markup. */
export class ItemView extends Component {
  constructor(readonly leaf: unknown) {
    super();
  }
}

/* Markdown, rendered as paragraphs and nothing more.
 *
 * It is NOT a markdown implementation and must never grow into one: the gates
 * that reach it count NODES, and a renderer that emits nothing is how a fixture
 * starts agreeing with itself - a `text-final` that painted no DOM would let a
 * double-render census read as clean while the second block sat there empty.
 * So the one contract is that real text produces real elements. */
export const MarkdownRenderer = {
  render(_app: unknown, text: string, host: HTMLElement): Promise<void> {
    for (const para of String(text).split(/\n{2,}/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const p = document.createElement('p');
      p.textContent = trimmed;
      host.appendChild(p);
    }
    return Promise.resolve();
  },
};

/* `Menu` exists here only so the composer's pickers can be IMPORTED. The
   fixture never opens one: a menu renders into `document.body` as host chrome,
   outside `.aic-root`, so it is not a surface this gate measures. A stub with
   working behaviour would invite an assertion about a popup the plugin does
   not style, which is how a gate starts guarding someone else's CSS. */
export class Menu {
  readonly dom = document.createElement('div');
  addItem(_cb: unknown): this { return this; }
  showAtMouseEvent(_evt: unknown): this { return this; }
  showAtPosition(_pos: unknown): this { return this; }
}
