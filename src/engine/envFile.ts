/* THE ENV-FILE BACKEND, pure. The suite-wide secrets contract (task
 * tsk-2026-09-08-005, point 3) gives every ICOR for Life plugin the same
 * second place a key may live: one `KEY=value` file inside the vault, read
 * and written through the vault adapter. This file owns the two text
 * transforms and nothing else - no 'obsidian' import, no I/O of its own -
 * so `test/engine-envfile.test.mjs` can prove the properties the contract
 * names (the rest of the file byte-identical, idempotent, comments
 * untouched) on strings alone.
 *
 * The format, exactly: one `KEY=value` per line; the value is everything
 * after the first `=`, whitespace-trimmed, taken literally - no quote
 * stripping, no `${VAR}` interpolation, no escapes. A line whose first
 * non-blank character is `#` is a comment. A leading `export ` is accepted
 * on read and preserved on write, because a vault env file is often the one
 * a shell also sources. The first line for a key wins; the writer updates
 * that same first line, so read and write agree on which one counts. */

import type { ModelProviderId } from './types';

/** Where the contract puts the file, vault-relative. Keep this string: the
 * whole suite defaults to the same file, and a member who moved it once
 * changes the setting, not this default. */
export const DEFAULT_ENV_FILE_PATH = '06 AI Team/AI Team Knowledge/.env';

/** The variable each provider's key is read under. Named in the README's
 * "Where your keys live" section; renaming one is a documented change. */
export const ENV_KEY_FOR: Record<ModelProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** The three adapter calls the backend needs. A real `App['vault']['adapter']`
 * satisfies it structurally (`DataAdapter.exists` takes an optional second
 * argument, which a narrower signature accepts), and a test hands in a map. */
export interface EnvFileHost {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Lines with their own terminator kept on each one, so joining them back
 * reproduces the input byte for byte. A hand loop rather than a lookbehind
 * split: the directory scanner refuses lookbehinds (iOS before 16.4). */
function splitKeepingEndings(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** A vault-relative path as the adapter wants it: forward slashes, no
 * leading `./` or `/`, trimmed. Empty stays empty so a caller can fall back
 * to the default rather than reading the vault root by accident. */
export function cleanVaultPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '');
}

/** `KEY=value` lines into a map; comments, blanks and malformed lines
 * skipped; the first occurrence of a key wins. */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!KEY_NAME.test(key)) continue;
    if (!out.has(key)) out.set(key, line.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The writer: `text` with exactly one `KEY=value` line for `key`. The first
 * existing line for the key is rewritten in place - its own leading
 * whitespace, `export ` prefix, spacing around `=` and line ending all kept;
 * a missing key is appended as `KEY=value` using the file's own line ending,
 * after a newline if the file did not end with one. Every other byte is
 * returned untouched, which is what makes a key move safe to run against a
 * file other tools also own. Applying the same call twice is a no-op.
 */
export function upsertEnvLine(text: string, key: string, value: string): string {
  if (!KEY_NAME.test(key)) throw new Error(`Not a valid env variable name: ${key}`);
  const clean = value.trim();
  if (/[\r\n]/.test(clean)) throw new Error('An env value cannot span lines');
  // Group 1 keeps everything up to and including the whitespace after `=`,
  // so `KEY = old` becomes `KEY = new` rather than `KEY =new`.
  const lineRe = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=\\s*)(.*)$`);
  const lines = splitKeepingEndings(text);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const body = line.replace(/\r?\n$/, '');
    const ending = line.slice(body.length);
    const m = body.match(lineRe);
    if (!m) continue;
    lines[i] = `${m[1]}${clean}${ending}`;
    return lines.join('');
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const glue = text.length === 0 || text.endsWith('\n') ? '' : eol;
  return `${text}${glue}${key}=${clean}${eol}`;
}

/** The value under `key`, or '' when the file or the line is absent. */
export async function readEnvKey(host: EnvFileHost, path: string, key: string): Promise<string> {
  if (!path || !(await host.exists(path))) return '';
  return parseEnvFile(await host.read(path)).get(key) ?? '';
}

/** Writes `key=value` into the file at `path` (created when missing),
 * touching only that one line. A write that would change nothing is skipped
 * so the file's mtime stays honest for whatever else watches it. */
export async function writeEnvKey(host: EnvFileHost, path: string, key: string, value: string): Promise<void> {
  if (!path) throw new Error('No env file path is set');
  const before = (await host.exists(path)) ? await host.read(path) : '';
  const after = upsertEnvLine(before, key, value);
  if (after !== before) await host.write(path, after);
}
