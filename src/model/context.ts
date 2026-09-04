/* THE VAULT AS CONTEXT, the pure half.
 *
 * A message can carry more than the note that happens to be open: a note the
 * user named with `[[`, a note picked from the `+` menu, or a whole GROUP of
 * notes - everything in a folder, everything carrying a tag, everything whose
 * frontmatter has a given property value. One shape holds all of them, and
 * the composer, the tray and the sent turn all read it.
 *
 * Nothing here imports Obsidian. The view resolves a group into paths when it
 * is picked (and again at send time, so a note created in between is in); this
 * file only decides what the model is told. That split is what lets the
 * preamble be asserted headless, cap and dedupe included. */

export type ContextKind = 'active' | 'note' | 'folder' | 'tag' | 'property';

export interface ContextRef {
  kind: ContextKind;
  /**
   * Stable within a conversation, so a second pick of the same thing is a
   * no-op rather than a second chip: the path for a note, the folder path for
   * a folder, `#tag` for a tag, `key: value` for a property.
   */
  id: string;
  /** What the chip says. A basename, a folder name, `#tag`, `key: value`. */
  label: string;
  /** The faint line under the label: the folder, the full path, the key. */
  detail: string;
  /** Vault-relative note paths, resolved by the view. Never guessed here. */
  paths: string[];
}

/**
 * How many notes are ATTACHED outright, across every ref on a message.
 *
 * An attachment is a `@"path"` reference the CLI reads in full before the
 * model answers. Twelve of those is a generous message; a tag with two hundred
 * notes under it would be two hundred files read up front, most of them for
 * nothing. The rest are LISTED, and the model reads what it needs. The list is
 * still the whole group, so nothing the user added is silently dropped - the
 * cap changes how a note arrives, never whether it is named.
 */
export const ATTACH_CAP = 12;

/** The CLI reference form, always quoted: see the measurement in mention.ts. */
function attachRef(path: string): string {
  return `@"${path}"`;
}

/**
 * The context blocks for a message's refs, after the open-note block.
 *
 * `exclude` is the path of the open note, which the preamble has already
 * named; naming it again as an attachment would send it twice. Paths are
 * deduped across refs in encounter order, and the attachment budget is spent
 * in that same order, so the note the user named first is the one attached
 * when the budget runs out.
 */
export function contextRefsBlock(refs: readonly ContextRef[], exclude: string | null = null): string {
  if (refs.length === 0) return '';
  const seen = new Set<string>(exclude ? [exclude] : []);
  let attached = 0;
  const lines: string[] = [];
  for (const ref of refs) {
    const fresh = ref.paths.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    if (fresh.length === 0) continue;
    lines.push(`Context: ${ref.label} (${fresh.length} ${fresh.length === 1 ? 'note' : 'notes'})`);
    const listed: string[] = [];
    for (const path of fresh) {
      if (attached < ATTACH_CAP) {
        lines.push(attachRef(path));
        attached += 1;
      } else {
        listed.push(path);
      }
    }
    if (listed.length > 0) {
      lines.push('More notes in this context, read them on demand:');
      for (const path of listed) lines.push(path);
    }
  }
  return lines.join('\n');
}

/**
 * WHAT THE `+` MENU PICKS, before the view has resolved it.
 *
 * The composer knows what was chosen - a folder path, a tag, a key and value -
 * and nothing about which notes that means; that is the metadata cache's
 * business and the view's. So the menu hands over a pick, and the view turns
 * it into a ContextRef with real paths. `active` carries nothing because the
 * view already knows which note is open.
 */
export type ContextPick =
  | { kind: 'active' }
  | { kind: 'note'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'property'; key: string; value: string };

/** The stable id a pick resolves to. One place, so a chip and a dedupe agree. */
export function contextPickId(pick: ContextPick): string {
  switch (pick.kind) {
    case 'active':
      return 'active';
    case 'note':
    case 'folder':
      return pick.path;
    case 'tag':
      return pick.tag.startsWith('#') ? pick.tag : `#${pick.tag}`;
    case 'property':
      return `${pick.key}: ${pick.value}`;
  }
}

/** The name part of a vault path, extension dropped. */
export function baseOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return (slash >= 0 ? path.slice(slash + 1) : path).replace(/\.md$/, '');
}

/** The folder part of a vault path, empty at the root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

/**
 * The first ~600 characters of a note as a glance: frontmatter stripped,
 * whitespace runs collapsed to single blank lines, cut at a word. This is a
 * PREVIEW and not a render: the reader is deciding which note they meant,
 * not reading it.
 */
export const PREVIEW_CHARS = 600;

export function previewText(source: string, limit = PREVIEW_CHARS): string {
  let body = source;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  body = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
