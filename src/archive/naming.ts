/* Archive naming and the manifest shape. Pure, because the retention sweep
 * deletes folders and a sweep that can misidentify a folder is a data-loss bug.
 * The rule it enforces: we only ever delete a folder whose NAME matches our own
 * shape AND which carries our own manifest. */

export const ARCHIVE_SCHEMA = 'icor-chat/session-archive@1';
export const MANIFEST_FILE = 'session-manifest.json';
export const LEGACY_MANIFEST_FILE = 'manifest.json';

export const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9-]*_[a-z0-9]{6}$/;

export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'session';
}

export function shortId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return (cleaned || 'nosess').padEnd(6, '0').slice(0, 6);
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/* CROSS-REPO CONTRACT: THIS NAME MUST START WITH THE YEAR.
 *
 * The ICOR for Life scaffold's `icor-rooms.css` paints every folder inside a
 * room, and excludes date-nested data with `:not(:where([data-path*="/20"]))`.
 * CSS cannot express "path segment", so that is a SUBSTRING test, and it
 * covers these session folders only because the name begins `2026-`. The
 * leading year is therefore load-bearing outside this repository.
 *
 * Prefix it with anything - `session-2026-...` - and the exclusion stops
 * matching, every archived conversation renders as an unstyled room in the
 * file tree, and the scaffold's `validate-scaffold.py` check 6 fails in every
 * user's vault with nothing pointing back at this function. That is a rename
 * here breaking a check over there, silently, which is why the dependency is
 * written down at both ends rather than left to be rediscovered.
 *
 * The snippet carries the matching comment beside the exclusion. Change one
 * end, change both. */
export function folderName(startedAt: number, title: string, sessionId: string): string {
  const d = new Date(startedAt);
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const time = `${two(d.getHours())}${two(d.getMinutes())}`;
  return `${date}_${time}_${slugify(title)}_${shortId(sessionId)}`;
}

/** Ours, by name shape alone. The caller still checks for the manifest. */
export function looksLikeOurArchive(name: string): boolean {
  return FOLDER_PATTERN.test(name);
}

export interface ArchiveManifest {
  schema: typeof ARCHIVE_SCHEMA;
  pluginVersion: string;
  sdkVersion: string;
  title: string;
  startedAt: string;
  endedAt: string;
  vaultPath: string;
  /**
   * Every provider session id this conversation ever had, oldest first. A fork
   * or a resume mints a new id, so carrying only the latest would make the
   * folder unresumable the moment a conversation was forked once.
   */
  sessionIds: string[];
  resume: {
    sessionId: string;
    cwd: string;
    model: string | null;
    permissionMode: string;
  };
  files: {
    transcript: string;
    conversation: string;
    subagents: string[];
  };
  counts: {
    /** Messages in the transcript, user and assistant alike. */
    messages: number;
    subagents: number;
    tokens: number;
  };
}

export function isOurManifest(value: unknown): value is ArchiveManifest {
  if (typeof value !== 'object' || value === null) return false;
  const schema = (value as { schema?: unknown }).schema;
  return schema === ARCHIVE_SCHEMA;
}

/** Folders older than the cut, by their own recorded end time. */
export function expiredFolders(
  entries: Array<{ name: string; endedAt: number }>,
  retentionDays: number,
  now: number,
): string[] {
  if (retentionDays <= 0) return [];
  const cut = now - retentionDays * 86_400_000;
  return entries
    .filter((e) => looksLikeOurArchive(e.name) && e.endedAt > 0 && e.endedAt < cut)
    .map((e) => e.name);
}
