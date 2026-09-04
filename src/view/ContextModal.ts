/* THE GROUP, OPENED. A folder, tag or property chip stands for a set of notes
 * the user did not pick one by one, so the chip has to be able to show its
 * hand: click it and every note in the group is listed, searchable, and one
 * click from open. Obsidian's own Modal chrome, because this is a list and not
 * a design decision. */

import { Modal, TFile, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { ContextRef } from '../model/context';

const ICONS: Record<ContextRef['kind'], string> = {
  active: 'eye',
  note: 'file-text',
  folder: 'folder',
  tag: 'tag',
  property: 'sliders-horizontal',
  wip: 'briefcase',
  tasks: 'list-checks',
  linked: 'link',
};

export function contextIcon(kind: ContextRef['kind']): string {
  return ICONS[kind];
}

export class ContextModal extends Modal {
  private listEl: HTMLElement | null = null;

  constructor(app: App, private readonly ref: ContextRef) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('aic-ctx-modal');
    contentEl.empty();

    const head = contentEl.createDiv({ cls: 'aic-ctx-modal-head' });
    const glyph = head.createSpan({ cls: 'aic-ctx-modal-icon' });
    setIcon(glyph, ICONS[this.ref.kind]);
    head.createSpan({ cls: 'aic-ctx-modal-title', text: this.ref.label });
    head.createSpan({ cls: 'aic-ctx-modal-count', text: `${this.ref.paths.length}` });

    const search = contentEl.createEl('input', { cls: 'aic-ctx-modal-search', type: 'search' });
    search.placeholder = 'Filter these notes';
    search.setAttr('aria-label', `Filter the notes in ${this.ref.label}`);
    search.addEventListener('input', () => this.paint(search.value));

    this.listEl = contentEl.createDiv({ cls: 'aic-ctx-modal-list' });
    this.paint('');
    window.setTimeout(() => search.focus(), 0);
  }

  private paint(query: string): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const needle = query.trim().toLowerCase();
    const paths = this.ref.paths.filter((p) => !needle || p.toLowerCase().includes(needle));
    if (paths.length === 0) {
      list.createDiv({ cls: 'aic-ctx-modal-empty', text: needle ? 'No note matches.' : 'No notes in this group.' });
      return;
    }
    for (const path of paths) {
      const row = list.createEl('button', { cls: 'aic-ctx-modal-row', type: 'button' });
      const icon = row.createSpan({ cls: 'aic-ctx-modal-row-icon' });
      setIcon(icon, 'file-text');
      const text = row.createDiv({ cls: 'aic-ctx-modal-row-text' });
      const slash = path.lastIndexOf('/');
      const base = (slash >= 0 ? path.slice(slash + 1) : path).replace(/\.md$/, '');
      text.createDiv({ cls: 'aic-ctx-modal-row-name', text: base });
      text.createDiv({ cls: 'aic-ctx-modal-row-path', text: slash >= 0 ? path.slice(0, slash) : '' });
      row.setAttr('aria-label', `Open ${base}`);
      row.addEventListener('click', () => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file);
        this.close();
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
