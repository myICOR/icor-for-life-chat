/* What the team can see without being told: the note that is open, and the
 * text that is selected in it. Tom calls this a core function, so it is
 * tracked continuously and shown before it is sent - the tray is the consent
 * surface. Nothing is attached that the user cannot see in the composer.
 *
 * The text assembly lives in model/contextText.ts, which has no Obsidian
 * import, so what the model receives can be asserted headless. */

import { MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { NoteContext } from '../model/contextText';

export { selectionRangeLabel, contextPreamble, withContext } from '../model/contextText';
export type { NoteContext } from '../model/contextText';

/**
 * The chat view is itself the active view whenever the user is typing in it,
 * so `getActiveViewOfType` returns nothing exactly when the tray matters most.
 * The caller remembers the last markdown view it saw and passes it here; found
 * by driving the real plugin, where the tray was empty in every state a user
 * would actually be in.
 */
/** Any open markdown view, so a fresh window still has context to show. */
function firstMarkdownView(app: App): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    if (leaf.view instanceof MarkdownView) return leaf.view;
  }
  return null;
}

export function readContext(app: App, remembered?: MarkdownView | null): NoteContext | null {
  const active =
    app.workspace.getActiveViewOfType(MarkdownView) ?? remembered ?? firstMarkdownView(app);
  const file = active?.file ?? app.workspace.getActiveFile();
  if (!file) return null;
  const base: NoteContext = {
    path: file.path,
    basename: file.basename,
    selection: null,
    fromLine: null,
    toLine: null,
  };
  const editor = active?.editor;
  if (!editor) return base;
  const selected = editor.getSelection();
  if (!selected) return base;
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  return { ...base, selection: selected, fromLine: from.line + 1, toLine: to.line + 1 };
}
