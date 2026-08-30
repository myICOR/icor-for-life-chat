/* The per-extension icon map for FILES rows, and the readability rule that
 * decides whether a row opens in Obsidian or reveals in the file manager.
 * Pure, exhaustive, and the fallback is always `file`. */

const MAP: Record<string, string> = {
  md: 'file-text', txt: 'file-text',
  canvas: 'layout-dashboard',
  ts: 'file-code', tsx: 'file-code', js: 'file-code', jsx: 'file-code',
  py: 'file-code', css: 'file-code', sh: 'file-code', rb: 'file-code',
  go: 'file-code', rs: 'file-code', swift: 'file-code', html: 'file-code',
  yaml: 'file-code', yml: 'file-code', toml: 'file-code',
  json: 'file-json',
  csv: 'file-spreadsheet', xlsx: 'file-spreadsheet',
  png: 'file-image', jpg: 'file-image', jpeg: 'file-image',
  gif: 'file-image', webp: 'file-image', svg: 'file-image',
  mp4: 'file-video', mov: 'file-video',
  mp3: 'file-audio', wav: 'file-audio', m4a: 'file-audio',
  pdf: 'file-type',
  zip: 'file-archive', tar: 'file-archive', gz: 'file-archive',
  db: 'database', sqlite: 'database',
};

/** Extensions Obsidian itself can open in a workspace tab. */
const READABLE = new Set([
  'md', 'canvas', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
]);

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function iconForPath(path: string): string {
  return MAP[extensionOf(path)] ?? 'file';
}

export function isReadableInObsidian(path: string): boolean {
  return READABLE.has(extensionOf(path));
}

export function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function parentOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at > 0 ? path.slice(0, at + 1) : '';
}

/** Split a URL into the host the eye lands on and the rest. */
export function splitUrl(url: string): { host: string; rest: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, rest: `${parsed.pathname}${parsed.search}`.replace(/\/$/, '') };
  } catch {
    return { host: url, rest: '' };
  }
}
