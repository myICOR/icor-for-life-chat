/* The name Remote Control shows in the member's Claude app: `ICOR: <vault
 * name>`, with the note the session started from appended when there is one.
 * Short on purpose - it is read on a phone screen in a session list, not in
 * this pane - so the note title is capped rather than carried whole. */

/** The note-title portion's own cap; the vault name is never truncated. */
export const NOTE_TITLE_MAX = 40;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, Math.max(0, max - 3)).trimEnd();
  return `${cut}...`;
}

/**
 * `vaultName` is never empty in practice (Obsidian refuses a nameless vault),
 * but an empty string is handled the same as any other: no crash, no
 * fabricated word in its place. `noteTitle` is null for a session with no
 * note behind it; a blank or whitespace-only title is treated the same as
 * null, since the base name alone is a truer answer than a bare separator.
 */
export function remoteControlDisplayName(vaultName: string, noteTitle: string | null): string {
  const base = `ICOR: ${vaultName.trim()}`;
  const title = noteTitle?.trim();
  if (!title) return base;
  return `${base} - ${truncate(title, NOTE_TITLE_MAX)}`;
}
