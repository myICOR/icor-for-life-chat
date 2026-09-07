/* `splitExtraPath` on its own, with NO import of its own (2026-09-06, mobile
 * hardening). It used to live in `cli.ts` alongside `resolveCliPath` and the
 * rest of the desktop-CLI path resolution, which needs `node:fs` /
 * `node:path` - and `ChatView.ts` / `main.ts` import `splitExtraPath`
 * directly, eagerly, on every platform including Obsidian mobile. An ES
 * module import evaluates the WHOLE file it names regardless of which export
 * a caller wants, so pulling one string-splitting function out of `cli.ts`
 * pulled `node:fs` / `node:path` in right behind it, the instant the plugin
 * loaded, on a platform with no Node runtime to answer.
 *
 * This function needs neither, so it gets its own file: `ChatView.ts` and
 * `main.ts` read it from here, and `cli.ts` (still imported, but only lazily,
 * behind `provider/registry.ts`'s `require('./claude')` / `require('./codex')`
 * boundary) is free to keep its own top-of-file `node:fs` / `node:path`
 * imports exactly as a normal module would - nothing about ITS shape needs
 * to change, only what reaches it eagerly. */

/** One extra-PATH entry per line, trimmed, blanks dropped. */
export function splitExtraPath(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
