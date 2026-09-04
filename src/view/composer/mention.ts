/* THE @ PICKER'S RULES, and the one measurement that shapes them.
 *
 * The placeholder has always promised "@ mentions files". Typing `@` did
 * nothing, exactly as `/` did nothing before it.
 *
 * The interesting half is not the list, it is what gets TYPED. Claude Code
 * resolves `@` references against its cwd, which is the vault, and the obvious
 * thing to insert is the vault-relative path. Driven against the real CLI in
 * this vault on 2026-08-31, four forms, each asked whether the file actually
 * reached the model:
 *
 *   @AGENTS.md                          content arrived, attached
 *   @.claude/hooks/no-em-dash-guard.py  content arrived, read
 *   @06 AI Team/.../INDEX.md            NOTHING arrived
 *   @"06 AI Team/.../INDEX.md"          content arrived, read (twice)
 *   @06\ AI\ Team/.../INDEX.md          NOTHING arrived
 *
 * A bare path with a space in it is not a reference the CLI can parse: it stops
 * at the space. In this vault almost every path has one - `06 AI Team`,
 * `04 Inner World`, `AI Team Knowledge` - so the obvious implementation would
 * have inserted a mention that looked right, sent cleanly, and delivered
 * nothing, on nearly every note in the vault. That is the failure this file
 * exists to avoid, and it is only visible if you go and ask the CLI.
 *
 * So the reference is QUOTED when it has to be and bare when it does not.
 * Deterministic, therefore a script.
 */

export const MENTION_LIMIT = 8;

/** One note the picker can offer. */
export interface MentionFile {
  /** Vault-relative, with extension. What the reference is built from. */
  path: string;
  /** The name a user thinks in, and what the rows are ranked on. */
  basename: string;
  /**
   * Obsidian's own shortest unambiguous link text for the note, supplied by
   * the view from `metadataCache.fileToLinktext`. What a `[[` pick types, so
   * the link the composer writes is the link Obsidian itself would write.
   * Optional so a caller that only ever offers `@` mentions need not supply
   * it; a missing value falls back to the basename.
   */
  linktext?: string;
  /** The folder the note lives in, empty at the root. For the picker's detail. */
  folder?: string;
}

/**
 * The `@` word the caret is inside, or null.
 *
 * Unlike a slash command this may appear anywhere in the line, so the rule is
 * about the character BEFORE the `@` rather than about position: start of line
 * or whitespace. That is what keeps an email address from opening a note
 * picker, which is the obvious way this goes wrong.
 */
export function mentionQuery(value: string, caret: number): string | null {
  const head = value.slice(0, Math.max(0, caret));
  const at = head.lastIndexOf('@');
  if (at === -1) return null;
  const before = at === 0 ? '' : head.charAt(at - 1);
  if (before !== '' && !/\s/.test(before)) return null;
  const word = head.slice(at + 1);
  // A space ends the mention: the note is named, and what follows is prose.
  if (/\s/.test(word)) return null;
  return word;
}

/**
 * Matching notes, best first, capped.
 *
 * Three tiers, and the order is what makes typing feel like it is helping:
 * a NAME that starts with what was typed, then a name that contains it, then
 * anywhere in the path. The path tier is what makes a note reachable by the
 * folder it lives in, and it is last because a query almost always means a
 * name.
 */
export function filterMentions(
  files: readonly MentionFile[],
  query: string,
  limit = MENTION_LIMIT,
): MentionFile[] {
  const needle = query.toLowerCase();
  const nameStarts: MentionFile[] = [];
  const nameHas: MentionFile[] = [];
  const pathHas: MentionFile[] = [];
  for (const file of files) {
    const name = file.basename.toLowerCase();
    if (name.startsWith(needle)) nameStarts.push(file);
    else if (needle && name.includes(needle)) nameHas.push(file);
    else if (needle && file.path.toLowerCase().includes(needle)) pathHas.push(file);
  }
  return [...nameStarts, ...nameHas, ...pathHas].slice(0, limit);
}

/**
 * The reference text for a path.
 *
 * Quoted only when it must be. A blanket quote would work too, but it puts
 * punctuation into every message for the minority of paths that need it, and
 * the bare form is the one the CLI can attach outright.
 */
export function mentionRef(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** The composer's value and caret after accepting a note. */
export function applyMention(
  value: string,
  caret: number,
  path: string,
): { value: string; caret: number } {
  const head = value.slice(0, Math.max(0, caret));
  const at = head.lastIndexOf('@');
  if (at === -1) return { value, caret };
  // Everything from the caret on survives untouched: accepting a note in the
  // middle of a sentence must not eat the rest of the sentence.
  const tail = value.slice(Math.max(0, caret));
  /* A trailing space only when the tail has not already got one. Accepting a
     note mid-sentence otherwise leaves a double space behind the reference,
     which the user then has to go back and delete. `applyCommand` makes the
     same check for the same reason. */
  const ref = tail.startsWith(' ') ? mentionRef(path) : `${mentionRef(path)} `;
  return { value: `${value.slice(0, at)}${ref}${tail}`, caret: at + ref.length };
}

/* ============================================================ [[ links ==
 *
 * The second way to name a note, and the one an Obsidian user already has in
 * their fingers. Where `@` types a CLI reference, `[[` types a WIKILINK: the
 * message keeps the link exactly as Obsidian would write it, and the note it
 * points at travels to the model as context - resolved by the view at send
 * time, never by the composer. The composer only has to know when the caret is
 * inside an unfinished link and what to type when a note is picked. */

/**
 * The text after the last unclosed `[[` before the caret, or null.
 *
 * Unlike a mention, a link's target may contain spaces - most note names in a
 * vault do - so a space does not end the query. What ends it is `]]` (the
 * link is finished) or a newline (the link was abandoned on its line).
 */
export function wikilinkQuery(value: string, caret: number): string | null {
  const head = value.slice(0, Math.max(0, caret));
  const open = head.lastIndexOf('[[');
  if (open === -1) return null;
  const word = head.slice(open + 2);
  if (word.includes(']]') || word.includes('\n')) return null;
  return word;
}

/** The composer's value and caret after accepting a note as a wikilink. */
export function applyWikilink(
  value: string,
  caret: number,
  linktext: string,
): { value: string; caret: number } {
  const head = value.slice(0, Math.max(0, caret));
  const open = head.lastIndexOf('[[');
  if (open === -1) return { value, caret };
  const tail = value.slice(Math.max(0, caret));
  const link = `[[${linktext}]]`;
  const ref = tail.startsWith(' ') ? link : `${link} `;
  return { value: `${value.slice(0, open)}${ref}${tail}`, caret: open + ref.length };
}

/**
 * Every link target in a message, in order, duplicates kept for the caller
 * to dedupe against whatever else it holds. `[[target|alias]]` yields the
 * target, `[[target#heading]]` yields the target, an empty `[[]]` yields
 * nothing. Embeds (`![[...]]`) are links too and are returned the same way.
 */
export function wikilinksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^\]]*?)\]\]/g)) {
    const inner = m[1] ?? '';
    const target = inner.split('|')[0]?.split('#')[0]?.trim() ?? '';
    if (target) out.push(target);
  }
  return out;
}
