/* PICKING A VAULT FOLDER for a setting: the saved-conversations folder.
 *
 * Two ways in, one value. Typing in the field suggests the vault's folders
 * (Obsidian's own inline suggest), and the button beside it opens a fuzzy
 * list of every folder, the same picker Obsidian uses for "Move file to".
 * Either way the field ends up holding a vault-relative path, which is what
 * the setting stores. A folder that does not exist yet is allowed: the
 * archive writer creates it on the first save. */

import { AbstractInputSuggest, FuzzySuggestModal, Setting, TFolder } from 'obsidian';
import type { App } from 'obsidian';

function vaultFolders(app: App): TFolder[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
    .sort((a, b) => a.path.localeCompare(b.path));
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, private readonly input: HTMLInputElement, private readonly pick: (path: string) => void) {
    super(app, input);
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.trim().toLowerCase();
    return vaultFolders(this.app).filter((f) => f.path.toLowerCase().includes(q)).slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  override selectSuggestion(folder: TFolder): void {
    this.input.value = folder.path;
    this.pick(folder.path);
    this.close();
  }
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly pick: (path: string) => void) {
    super(app);
    this.setPlaceholder('Choose a folder for saved conversations');
  }

  getItems(): TFolder[] {
    return vaultFolders(this.app);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.pick(folder.path);
  }
}

/**
 * Turn a setting row into a folder field. `save` receives the new path
 * (trimmed, empty for "use the default") on every change.
 */
export function addFolderPicker(
  app: App,
  row: Setting,
  value: string,
  placeholder: string | undefined,
  save: (path: string) => void,
): void {
  let field: HTMLInputElement | null = null;
  row.addText((t) => {
    if (placeholder) t.setPlaceholder(placeholder);
    t.setValue(value).onChange((v) => save(v.trim()));
    field = t.inputEl;
    new FolderSuggest(app, t.inputEl, (path) => save(path));
  });
  row.addExtraButton((b) =>
    b
      .setIcon('folder-open')
      .setTooltip('Choose a folder')
      .onClick(() => {
        new FolderPickerModal(app, (path) => {
          if (field) field.value = path;
          save(path);
        }).open();
      }),
  );
}
