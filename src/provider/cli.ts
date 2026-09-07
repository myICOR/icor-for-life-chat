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
 * split is what lets the resolution rules be tested headless.
 *
 * This file's own top-level `node:fs` / `node:path` imports are safe on
 * Obsidian mobile (2026-09-06, mobile hardening): this file is no longer
 * imported eagerly by anything mobile loads. `ChatView.ts` and `main.ts` used
 * to import `splitExtraPath` straight from here, which pulled these two
 * builtins in the instant the plugin loaded on every platform; that one
 * function moved to `./extraPath.ts`, which has no import of its own, and
 * this file is now reached only through `provider/registry.ts`'s lazy
 * `require('./claude')` / `require('./codex')` - a call that on mobile is
 * written but never executed. See registry.ts's header for the whole shape. */

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

/**
 * Executable file names for ANY tool, in the order a resolver prefers them.
 * `cliFileNames` below is the Claude special case; a second provider names
 * its own binary and gets the same PATH repair and the same Windows rule.
 */
export function executableNames(platform: Platform, base: string): string[] {
  return platform === 'win32' ? [`${base}.exe`, `${base}.cmd`, `${base}.bat`] : [base];
}

/** Every path a tool named `base` could live at, in search order. */
export function candidatePathsFor(env: PathEnvironment, base: string): string[] {
  const sep = pathSeparator(env.platform);
  const dirs = augmentPath(env).split(sep).filter(Boolean);
  const names = executableNames(env.platform, base);
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

/**
 * Resolve a tool named `base`, preferring an explicit setting. Throws a
 * message a user can act on, naming the tool and where to install it.
 */
export function resolveExecutable(
  base: string,
  configured: string,
  env: PathEnvironment,
  probe: FileProbe = isExecutableFile,
  installHint = '',
): string {
  const explicit = configured.trim();
  if (explicit) {
    if (!probe(explicit)) throw new Error(`The ${base} path in settings does not point at a file: ${explicit}`);
    return explicit;
  }
  const candidates = candidatePathsFor(env, base);
  for (const candidate of candidates) {
    if (probe(candidate)) return candidate;
  }
  throw new Error(
    `${base} was not found. ICOR for Life - AI Chat looked in ${candidates.length} locations on PATH.` +
      (installHint ? ` ${installHint}` : ''),
  );
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

export type FileProbe = (path: string) => boolean;

function isExecutableFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    return statSync(path).isFile();
  } catch {
    return false;
  }
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

/**
 * Desktop auth truth (`chat-mobile-engine-spec-v1.md` section 4): a member's
 * own environment can carry an Anthropic credential meant for some other
 * tool, and Obsidian inherits the launching shell's env by default. Left
 * alone, the Claude child would pick that up ahead of Claude Code's own
 * sign-in with nothing on screen to say so - the exact "am I on my
 * subscription or not" the desktop settings row exists to answer honestly.
 * Stripped by default; `SessionConfig.allowEnvApiKey` re-allows them for a
 * member who has deliberately set Claude Code up with an API key instead.
 */
export const STRIPPED_API_KEY_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

/** The env handed to the child: process env, PATH repaired, user extras
 * merged, the three credential vars stripped unless explicitly re-allowed. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  env: PathEnvironment,
  options: { allowEnvApiKey?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === 'string') out[k] = v;
  }
  if (!options.allowEnvApiKey) {
    for (const key of STRIPPED_API_KEY_ENV_VARS) delete out[key];
  }
  out.PATH = augmentPath({ ...env, path: base.PATH ?? env.path });
  if (env.platform === 'win32') out.Path = out.PATH;
  return out;
}

// `splitExtraPath` moved to `./extraPath.ts` (2026-09-06, mobile hardening) -
// see that file's header for why. Not re-exported from here: the whole point
// was to give `ChatView.ts` / `main.ts` a path to it that never touches this
// file's `node:fs` / `node:path` imports.
