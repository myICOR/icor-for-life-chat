/* Finding the Claude Code CLI, and giving the child process a PATH it can
 * actually work in.
 *
 * The failure this file exists for: Obsidian launched from the Dock or the
 * Start menu never runs a login shell, so `process.env.PATH` is the OS's bare
 * default. Every user-level install location (~/.local/bin, Homebrew, nvm,
 * bun) is missing, and the CLI that works fine in a terminal is invisible.
 *
 * Everything here is a pure function over an explicit environment except
 * `resolveCliPath`, which is the one place that touches the filesystem. That
 * split is what lets the resolution rules be tested headless. */

import { existsSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** Join for the TARGET platform, not the host, so the Windows rules are
 * assertable from a Mac and the resolver has one code path. */
function joinFor(platform: Platform, ...parts: string[]): string {
  return platform === 'win32' ? win32.join(...parts) : posix.join(...parts);
}

export type Platform = 'darwin' | 'win32' | 'linux';

export interface PathEnvironment {
  platform: Platform;
  home: string;
  path: string;
  /** Extra entries the user typed into settings, already split. */
  extra?: string[];
}

/** Directories a CLI install lands in that a GUI-launched app never sees. */
export function defaultPathAdditions(platform: Platform, home: string): string[] {
  if (platform === 'win32') {
    return [
      joinFor(platform, home, 'AppData', 'Local', 'Programs', 'claude'),
      joinFor(platform, home, 'AppData', 'Roaming', 'npm'),
      joinFor(platform, home, '.local', 'bin'),
      joinFor(platform, home, '.bun', 'bin'),
    ];
  }
  const unix = [
    joinFor(platform, home, '.local', 'bin'),
    joinFor(platform, home, '.claude', 'local'),
    joinFor(platform, home, '.bun', 'bin'),
    joinFor(platform, home, '.npm-global', 'bin'),
    joinFor(platform, home, '.yarn', 'bin'),
    joinFor(platform, home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/opt/homebrew/sbin', ...unix];
  }
  return ['/home/linuxbrew/.linuxbrew/bin', ...unix];
}

export function pathSeparator(platform: Platform): string {
  return platform === 'win32' ? ';' : ':';
}

/**
 * Append the missing install directories to PATH without reordering or
 * dropping anything already there. Existing entries keep their precedence,
 * which is the whole point: a user who put a specific CLI first still wins.
 */
export function augmentPath(env: PathEnvironment): string {
  const sep = pathSeparator(env.platform);
  const present = new Set<string>();
  const out: string[] = [];
  const push = (raw: string): void => {
    const entry = raw.trim();
    if (!entry) return;
    const key = env.platform === 'win32' ? entry.toLowerCase() : entry;
    if (present.has(key)) return;
    present.add(key);
    out.push(entry);
  };
  for (const entry of (env.path ?? '').split(sep)) push(entry);
  for (const entry of env.extra ?? []) push(entry);
  for (const entry of defaultPathAdditions(env.platform, env.home)) push(entry);
  return out.join(sep);
}

/** Executable file names, in the order a resolver should prefer them. */
export function cliFileNames(platform: Platform): string[] {
  // On Windows the .cmd shim cannot be spawned without a shell, and the SDK
  // spawns without one. Prefer the real executable; the shim is last so the
  // caller can report the specific problem instead of a generic ENOENT.
  return platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];
}

export function candidatePaths(env: PathEnvironment): string[] {
  const sep = pathSeparator(env.platform);
  const dirs = augmentPath(env).split(sep).filter(Boolean);
  const names = cliFileNames(env.platform);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const full = joinFor(env.platform, dir, name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(full);
    }
  }
  return out;
}

export type CliKind = 'native' | 'node-script' | 'windows-shim';

/** How the SDK will have to launch this path. */
export function classifyCli(path: string): CliKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return 'windows-shim';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].some((e) => lower.endsWith(e))) {
    return 'node-script';
  }
  return 'native';
}

export class CliNotFoundError extends Error {
  constructor(searched: number) {
    super(
      `Claude Code was not found. ICOR for Life - AI Chat looked in ${searched} locations on PATH. ` +
        'Install it (https://claude.com/claude-code), or set the executable path in ' +
        'the plugin settings under Provider.',
    );
    this.name = 'CliNotFoundError';
  }
}

/**
 * The one question the resolver asks the outside world: is there a usable
 * file at this path? It is a PARAMETER of `resolveCliPath` rather than a
 * private helper, because half the candidate list is absolute system
 * directories (/opt/homebrew/bin, /usr/local/bin) that no fake HOME or PATH
 * can redirect. A test that fakes the environment but not the probe is
 * measuring the MACHINE: the no-install assertion held on every machine
 * without Claude Code and went green-by-leak the day a real install landed
 * at /opt/homebrew/bin. The verdict must depend only on what the test
 * constructs, so the test constructs the filesystem too.
 */
export type FileProbe = (path: string) => boolean;

function isExecutableFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the executable, preferring an explicit setting. Returns the first
 * path that exists; throws a message a user can act on when none does.
 * Production callers omit `probe` and get the real filesystem.
 */
export function resolveCliPath(
  configured: string,
  env: PathEnvironment,
  probe: FileProbe = isExecutableFile,
): string {
  const explicit = configured.trim();
  if (explicit) {
    if (!probe(explicit)) {
      throw new Error(
        `The Claude Code path in settings does not point at a file: ${explicit}`,
      );
    }
    return explicit;
  }
  const candidates = candidatePaths(env);
  for (const candidate of candidates) {
    if (probe(candidate)) return candidate;
  }
  throw new CliNotFoundError(candidates.length);
}

/** The env handed to the child: process env, PATH repaired, user extras merged. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  env: PathEnvironment,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === 'string') out[k] = v;
  }
  out.PATH = augmentPath({ ...env, path: base.PATH ?? env.path });
  if (env.platform === 'win32') out.Path = out.PATH;
  return out;
}

export function splitExtraPath(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
