/* The name Remote Control shows in the member's Claude app: `ICOR: <vault
 * name>`, with the note the session started from appended when there is one.
 * Short on purpose - it is read on a phone screen in a session list, not in
 * this pane - so the note title is capped rather than carried whole. */

import type { CommandPlatform } from './command';

/** The note-title portion's own cap; the vault name is never truncated. */
export const NOTE_TITLE_MAX = 40;

/** A hard ceiling on the WHOLE rendered name (Vex M3, "cap length"). Nothing
 * in practice gets near this - a vault name would need to run past 150
 * characters - but a name this plugin hands to a real terminal window has no
 * business being unbounded just because nothing has hit the ceiling yet. */
export const DISPLAY_NAME_MAX = 200;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, Math.max(0, max - 3)).trimEnd();
  return `${cut}...`;
}

/**
 * C0 controls, DEL, and - spelled out because it is the concrete attack Vex
 * demonstrated (M3) - CR and LF: a vault or note name carrying a newline
 * survives `quotePosix`/`quoteWindows`/the AppleScript literal untouched
 * (none of the three strips a control character, only shell/AppleScript
 * syntax) and reaches a REAL, VISIBLE terminal window able to repaint or
 * hide text right before the command runs. The display name is cosmetic
 * text read on a phone screen; it has no functional need for a control
 * character, so dropping them outright is safe.
 */
function stripControls(text: string): string {
  // eslint-disable-next-line no-control-regex -- the C0 range is the point.
  return text.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * cmd.exe expands `%VAR%` wherever it appears in a command line, quoted or
 * not - documented, longstanding behavior, not a gap in `quoteWindows`
 * (Vex H3). A name reading only `%USERPROFILE%\Desktop` (no space, no other
 * cmd metacharacter) comes back from `quoteWindows` bare and unescaped,
 * because there is no cmd.exe escape for `%` that survives a second parse.
 * The display name is cosmetic text with no functional need for a literal
 * `%`, so dropping the character is simpler and safer than trying to
 * neutralize something cmd.exe never lets you neutralize.
 */
function stripWindowsPercent(text: string): string {
  return text.replace(/%/g, '');
}

function sanitize(text: string, platform: CommandPlatform): string {
  const controlsStripped = stripControls(text);
  return platform === 'win32' ? stripWindowsPercent(controlsStripped) : controlsStripped;
}

/**
 * `vaultName` is never empty in practice (Obsidian refuses a nameless vault),
 * but an empty string is handled the same as any other: no crash, no
 * fabricated word in its place. `noteTitle` is null for a session with no
 * note behind it; a blank or whitespace-only title is treated the same as
 * null, since the base name alone is a truer answer than a bare separator.
 * `platform` defaults to `darwin` (no `%` stripping, the same behaviour this
 * function always had) so every existing call site not yet passing it keeps
 * working; `ChatView.continueOnPhone` passes the real platform.
 */
export function remoteControlDisplayName(
  vaultName: string,
  noteTitle: string | null,
  platform: CommandPlatform = 'darwin',
): string {
  const base = `ICOR: ${sanitize(vaultName, platform)}`;
  const title = sanitize(noteTitle ?? '', platform).trim();
  const full = title ? `${base} - ${truncate(title, NOTE_TITLE_MAX)}` : base;
  return truncate(full, DISPLAY_NAME_MAX);
}
