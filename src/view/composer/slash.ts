/* THE SLASH PICKER'S RULES, with no DOM under them.
 *
 * The composer's placeholder has always promised "/ runs commands" and the
 * session event has always carried the list. Nothing ever put the two together,
 * so the promise was made to every user and kept for none: typing `/` produced
 * a literal slash and the command names existed only inside the store.
 *
 * Everything here is a pure function over strings, and deliberately so. Which
 * names match `/ex`, how they rank, and where the caret leaves the text are
 * questions with exactly one right answer each, which makes them a script's
 * job rather than a renderer's - and it makes them assertable without a
 * workspace, a window, or a running CLI. `Composer.ts` owns the pixels and
 * calls in here for every decision. */

/** How many rows the picker will ever show. A list longer than the pane is a
 *  list nobody reads to the end of, and the filter is the real navigation. */
export const SLASH_LIMIT = 8;

/**
 * The query the user is typing, or null when the picker has no business
 * opening.
 *
 * The rule is deliberately narrow: the slash must be the FIRST character of the
 * composer, and the caret must still be inside the word it started. A slash in
 * the middle of a sentence is a slash - dates, paths and fractions all contain
 * one - and a picker that opens on `and/or` would fire on ordinary prose. A
 * space ends it, because a command's arguments are not part of its name.
 */
export function slashQuery(value: string, caret: number): string | null {
  if (!value.startsWith('/')) return null;
  const head = value.slice(0, Math.max(0, caret));
  if (!head.startsWith('/')) return null;
  const word = head.slice(1);
  // Whitespace anywhere before the caret means the name is finished and the
  // user has moved on to arguments.
  if (/\s/.test(word)) return null;
  // The caret must be within the word, never behind text it would not replace.
  if (caret > word.length + 1) return null;
  return word;
}

/** Bare names, deduplicated, with any leading slash and padding removed. */
export function normalizeCommands(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = entry.trim().replace(/^\/+/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The matches for a query, best first, capped.
 *
 * Two tiers and no scoring beyond them: a name that STARTS with what was typed
 * outranks one that merely contains it, and within a tier the provider's own
 * order is kept. `/ex` therefore offers `exit` and `execute` above
 * `plugin:next-export`, which is what the typist meant, while the substring
 * tier is what makes a namespaced command reachable without typing its prefix.
 * An empty query is not a special case: it matches everything, which is exactly
 * what a bare `/` should show.
 */
export function filterCommands(
  commands: readonly string[],
  query: string,
  limit = SLASH_LIMIT,
): string[] {
  const needle = query.toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of commands) {
    const hay = name.toLowerCase();
    if (hay.startsWith(needle)) starts.push(name);
    else if (needle && hay.includes(needle)) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The composer's value and caret after accepting a name. */
export function applyCommand(value: string, name: string): { value: string; caret: number } {
  // Everything after the typed word survives, so accepting a command on a line
  // that already carries arguments does not eat them.
  const rest = value.replace(/^\/[^\s]*/, '');
  // A space after the name unless the text already starts with one: the caret
  // lands where the arguments go, and a command that takes none is trimmed on
  // send anyway.
  const head = rest.startsWith(' ') ? `/${name}` : `/${name} `;
  return { value: `${head}${rest}`, caret: head.length };
}
