/* THE PURPOSE LINE for the six mobile tools, same rule as
 * `provider/tooling.ts`'s `toolPurpose`/`toolTarget`: deterministic, so two
 * people reading the same input cannot disagree about the sentence - a
 * script, not a model. Not reused from `provider/tooling.ts` because that
 * file's table is keyed to the desktop CLI's own tool names (Bash, Read,
 * Grep...); these are the plugin's own six mobile tool names and need their
 * own table, in the same one-line-purpose shape the row already renders. */

import {
  APPEND_TO_NOTE, CREATE_NOTE, CURRENT_NOTE, LIST_FOLDER, READ_NOTE, SEARCH_NOTES,
} from './definitions';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The raw argument worth showing on the row: one line, no JSON dump. */
export function mobileToolTarget(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case READ_NOTE:
    case LIST_FOLDER:
      return str(input.path) ?? '';
    case SEARCH_NOTES:
      return str(input.query) ?? '';
    case CURRENT_NOTE:
      return '';
    case APPEND_TO_NOTE:
    case CREATE_NOTE:
      return str(input.path) ?? '';
    default:
      return str(input.path) ?? str(input.query) ?? '';
  }
}

/** What the call did, in one plain sentence. What the row SHOWS. */
export function mobileToolPurpose(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case READ_NOTE: {
      const path = str(input.path);
      return path ? `Read ${path}` : 'Read a note';
    }
    case SEARCH_NOTES: {
      const query = str(input.query);
      return query ? `Searched notes for ${query}` : 'Searched notes';
    }
    case LIST_FOLDER: {
      const path = str(input.path);
      return path ? `Listed ${path}` : 'Listed the vault root';
    }
    case CURRENT_NOTE:
      return 'Read the open note';
    case APPEND_TO_NOTE: {
      const path = str(input.path);
      return path ? `Appended to ${path}` : 'Appended to a note';
    }
    case CREATE_NOTE: {
      const path = str(input.path);
      return path ? `Created ${path}` : 'Created a note';
    }
    default:
      return `Used ${name}`;
  }
}
