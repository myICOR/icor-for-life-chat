/* Tool vocabulary that is the PLUGIN'S, not any provider's.
 *
 * What a call was for, what to show on its row, how to bound its result: none
 * of that depends on which agent runs the tool. Claude Code, Codex and an ACP
 * agent all send a Bash command with a description and a Read with a path,
 * and the sentence the row prints has to be the same sentence whichever of
 * them sent it. So the rules live here, above the provider seam, and every
 * provider's normaliser imports them. Nothing in this file knows a wire
 * format: it takes a tool name and its input record and gives words back. */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The argument of a tool call worth showing on the row: one line, no JSON dump. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  const first = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = str(input[k]);
      if (v) return v;
    }
    return null;
  };
  switch (name) {
    case 'Bash':
      return first('command') ?? '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return first('file_path', 'notebook_path') ?? '';
    case 'Glob':
    case 'Grep':
      return first('pattern') ?? '';
    case 'WebFetch':
    case 'WebSearch':
      return first('url', 'query') ?? '';
    case 'Task':
    case 'Agent':
      return first('description', 'subagent_type') ?? '';
    case 'TodoWrite':
      return '';
    default:
      return first('description', 'path', 'file_path', 'command', 'query', 'pattern', 'url') ?? '';
  }
}

/* THE PURPOSE LINE: what the call did, said once, in words a person reads.
 *
 * The row used to print the tool's raw argument, and for Bash that is the
 * shell command. In this vault every command begins with `cd "/Users/tom/My
 * Life Folder - TR" &&`, so a run of ten rows read identically for sixty
 * characters and the part that differed was the part the pane cut off. A
 * user scanning what the agent actually did learned nothing without opening
 * every row. The CLI already carries the answer: every Bash call arrives with
 * a `description` the model wrote for exactly this purpose, and every other
 * tool's argument is a path, a pattern or a query that a verb turns into a
 * sentence. Deterministic, therefore a script; the raw argument survives as
 * `target` and is what the row opens onto. */

/** `path` with the vault prefix removed, so a row reads the way the file tree does. */
export function relativeTo(path: string, cwd: string): string {
  if (!cwd) return path;
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function toolPurpose(name: string, input: Record<string, unknown>, cwd: string): string {
  try {
    const first = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = str(input[k]);
        if (v && v.trim()) return v.trim();
      }
      return null;
    };
    const path = (): string | null => {
      const p = first('file_path', 'notebook_path', 'path');
      return p ? relativeTo(p, cwd) : null;
    };
    switch (name) {
      case 'Bash':
        return first('description') ?? 'Ran a command';
      case 'Read':
        return path() ? `Read ${path()}` : 'Read a file';
      case 'Write':
        return path() ? `Wrote ${path()}` : 'Wrote a file';
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return path() ? `Edited ${path()}` : 'Edited a file';
      case 'Glob': {
        const pattern = first('pattern');
        return pattern ? `Searched files matching ${pattern}` : 'Searched files';
      }
      case 'Grep': {
        const pattern = first('pattern');
        const where = path();
        if (!pattern) return 'Searched the vault';
        return where ? `Searched for ${pattern} in ${where}` : `Searched for ${pattern}`;
      }
      case 'WebFetch': {
        const url = first('url');
        return url ? `Fetched ${hostOf(url)}` : 'Fetched a page';
      }
      case 'WebSearch': {
        const query = first('query');
        return query ? `Searched the web for ${query}` : 'Searched the web';
      }
      case 'Task':
      case 'Agent': {
        const who = first('subagent_type');
        const what = first('description');
        if (who && what) return `Sent ${who} to ${what}`;
        if (who) return `Sent ${who} on a task`;
        if (what) return `Sent a subagent to ${what}`;
        return 'Sent a subagent on a task';
      }
      case 'TodoWrite':
        return 'Updated the plan';
      case 'AskUserQuestion':
        return 'Asked a question';
      default:
        return first('description') ?? `Used ${name}`;
    }
  } catch {
    return `Used ${name}`;
  }
}

/**
 * A purpose for a call that arrived WITHOUT one: a transcript stored by a
 * build before 0.6, or an approval event a producer forgot to label. It is
 * built from the row's target through the same table, so a Read still reads
 * as "Read <path>"; a Bash target is the command, not a description, and
 * stays "Ran a command" rather than pretending the command is prose.
 */
export function fallbackPurpose(name: string, target: string): string {
  const key: Record<string, string> = {
    Read: 'file_path', Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path',
    NotebookEdit: 'notebook_path', Glob: 'pattern', Grep: 'pattern',
    WebFetch: 'url', WebSearch: 'query', Task: 'description', Agent: 'description',
  };
  const field = key[name];
  return toolPurpose(name, field && target ? { [field]: target } : {}, '');
}

/* The result body the opened row shows. Bounded, because a `cat` of a large
 * file is a legitimate tool result and an unbounded copy of it in every
 * transcript.json would be the archive growing by the size of the vault. The
 * cut is announced in the text itself so a reader never mistakes the end of
 * the cap for the end of the output. */
export const RESULT_OUTPUT_CAP = 4000;

export function resultOutput(content: unknown): string {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && part.type === 'text') {
        const t = str(part.text);
        if (t) parts.push(t);
      }
    }
    text = parts.join('\n');
  }
  if (text.length <= RESULT_OUTPUT_CAP) return text;
  const more = text.length - RESULT_OUTPUT_CAP;
  return `${text.slice(0, RESULT_OUTPUT_CAP)}\n[... ${more} more characters]`;
}

/** A one-line gloss of a tool result. Never the whole payload. */
export function resultDetail(content: unknown): string {
  if (typeof content === 'string') return firstLine(content);
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (isRecord(part) && part.type === 'text') {
      const text = str(part.text);
      if (text) return firstLine(text);
    }
  }
  return '';
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
