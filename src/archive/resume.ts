/* Reading a resumable session id out of an archived conversation note.
 *
 * The archive writer puts every provider session id the conversation ever had
 * into the note's own frontmatter, oldest first, precisely so the folder can
 * outlive the plugin's memory of it. This is the read side of that promise, and
 * it is pure so the shapes can be tested: Obsidian's metadata cache hands back
 * a YAML value, and `session_ids: [ "a", "b" ]`, `session_ids: a` and a list
 * written across several lines are all the same fact wearing different clothes.
 */

import { isProviderId } from '../provider/types';
import type { ProviderId } from '../provider/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every session id in a frontmatter value, in order, ids only. */
export function sessionIdsFromFrontmatter(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    // A single string may itself be a written-out list.
    for (const part of entry.split(/[\s,[\]"']+/)) {
      const id = part.trim();
      if (UUID.test(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * The one to resume: the LAST id, not the first.
 *
 * A fork or a resume mints a new id and the older ones are ancestors, so the
 * newest is the only one that carries the whole conversation. Returns null
 * rather than a guess when the note carries none.
 */
export function resumableSessionId(value: unknown): string | null {
  const ids = sessionIdsFromFrontmatter(value);
  return ids.length > 0 ? (ids[ids.length - 1] ?? null) : null;
}

/**
 * The provider an archived note names, with an unnamed one read as Claude:
 * every note written before 0.7.0 came from a build that only spoke to it.
 */
export function providerFromFrontmatter(value: unknown): ProviderId {
  return isProviderId(value) ? value : 'claude';
}
