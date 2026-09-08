/* THE MOBILE TOOL SET, as data. `chat-mobile-engine-spec-v1.md` section 5:
 * "Vault-scoped, all through the Obsidian Vault and MetadataCache APIs, which
 * work on mobile: read note, search notes, list folder, current note and
 * selection as context, append to a note, create a note (write tools ask
 * once per session). No shell, no filesystem outside the vault, no MCP on
 * mobile."
 *
 * Six tools, one definition each, vendor-neutral (`EngineToolDef`). Each
 * adapter converts the whole set into its own wire shape once per call;
 * neither vendor's schema shape leaks back into this file. */

import type { EngineToolDef } from '../types';

export const READ_NOTE = 'read_note';
export const SEARCH_NOTES = 'search_notes';
export const LIST_FOLDER = 'list_folder';
export const CURRENT_NOTE = 'current_note';
export const APPEND_TO_NOTE = 'append_to_note';
export const CREATE_NOTE = 'create_note';

/** The two tools whose call needs the write-approval gate before it runs. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([APPEND_TO_NOTE, CREATE_NOTE]);

export const MOBILE_TOOLS: readonly EngineToolDef[] = [
  {
    name: READ_NOTE,
    description:
      'Read the full text of one note in the vault. Path is vault-relative, with the .md extension, ' +
      'case-sensitive (e.g. "04 Inner World/My Life/Topics/example.md").',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path to the note.' } },
      required: ['path'],
    },
  },
  {
    name: SEARCH_NOTES,
    description:
      'Search note titles and content for a query and return the matching paths with a short snippet ' +
      'each. Use this to find a note before reading it, when the exact path is not known.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for.' },
        limit: { type: 'integer', description: 'Maximum results. Defaults to 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: LIST_FOLDER,
    description:
      'List the notes and subfolders directly inside one folder. Path is vault-relative; an empty ' +
      'string or "/" lists the vault root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative folder path, or empty for the root.' } },
      required: [],
    },
  },
  {
    name: CURRENT_NOTE,
    description:
      'Read the note the member currently has open, and the text they have selected, if any. Takes no ' +
      'arguments; call it to answer "this note" or "what I selected".',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: APPEND_TO_NOTE,
    description:
      'Add text to the end of an existing note. The member is asked to confirm the first time this or ' +
      'create_note runs in a conversation; approved once, both run without asking again for the rest of it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to the note.' },
        text: { type: 'string', description: 'Text to add at the end of the note.' },
      },
      required: ['path', 'text'],
    },
  },
  {
    name: CREATE_NOTE,
    description:
      'Create a new note at a vault-relative path with the given content. Fails if a note already ' +
      'exists there. The member is asked to confirm the first time this or append_to_note runs in a ' +
      'conversation; approved once, both run without asking again for the rest of it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path for the new note, with the .md extension.' },
        content: { type: 'string', description: 'The note\'s content.' },
      },
      required: ['path', 'content'],
    },
  },
];

/** Anthropic Messages API tool shape: `input_schema`, snake_case. */
export function toAnthropicTools(defs: readonly EngineToolDef[]): unknown[] {
  return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema }));
}

/** OpenAI-compatible (OpenRouter) tool shape: `{type: 'function', function: {...parameters}}`. */
export function toOpenAiTools(defs: readonly EngineToolDef[]): unknown[] {
  return defs.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.inputSchema },
  }));
}
