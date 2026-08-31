/* A sent image, at the size it was actually sent.
 *
 * The thumbnails in the transcript are capped at 240x180 so a screenshot does
 * not take over the column, and a capped screenshot is unreadable: the whole
 * reason to send one is usually the small text in it. So the transcript keeps
 * the thumbnail and a click opens the full thing.
 *
 * IT COVERS THE APP, not the pane. It was scoped to the leaf on the reasoning
 * that a chat is one pane among several, which is a fair argument and the wrong
 * answer: the chat pane is usually a narrow sidebar, so a screenshot opened
 * "full size" inside it was barely larger than the thumbnail it came from. The
 * point of opening an image is to see it. Obsidian's own full-screen affordances
 * take the window, and this matches them.
 *
 * It mounts on the pane's OWN document body rather than on the global one. A
 * chat can be open in a popout window, where `document.body` is another realm's
 * body entirely, and an overlay appended to the wrong document is an overlay
 * nobody ever sees. `ownerDocument` is what makes it app-level and realm-correct
 * at the same time.
 */

export interface LightboxImage {
  src: string;
  alt: string;
}

export class Lightbox {
  private el: HTMLElement | null = null;
  private onKey: ((ev: KeyboardEvent) => void) | null = null;

  constructor(private readonly anchor: HTMLElement) {}

  open(image: LightboxImage): void {
    this.close();
    const host = this.anchor.ownerDocument.body ?? this.anchor;
    const el = host.createDiv({ cls: 'aic-lightbox' });
    /* A dialog, and a labelled one: without the role this is a div that happens
       to cover the screen, and a screen reader would go on reading the
       transcript underneath it as though nothing had opened. */
    el.setAttr('role', 'dialog');
    el.setAttr('aria-modal', 'true');
    el.setAttr('aria-label', image.alt || 'Attached image');
    el.tabIndex = -1;

    const img = el.createEl('img', { cls: 'aic-lightbox-img' });
    img.src = image.src;
    img.alt = image.alt;

    /* THE BACKDROP CLOSES, THE IMAGE DOES NOT. Clicking the picture you just
       opened in order to look at it must not take it away again, which is what
       a close handler on the whole overlay would do. */
    el.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === img) return;
      this.close();
    });

    this.onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      this.close();
    };
    /* Bound on the OVERLAY, not on the document. The overlay holds focus while
       it is open, so it receives the key; a document listener would also fire
       for a chat in another leaf and close an overlay the user is not looking
       at. */
    el.addEventListener('keydown', this.onKey);
    this.el = el;
    el.focus();
  }

  close(): void {
    if (!this.el) return;
    if (this.onKey) this.el.removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.el = null;
    this.onKey = null;
  }

  get isOpen(): boolean {
    return this.el !== null;
  }
}
