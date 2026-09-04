/* OpenAI Codex as a Provider, through the App Server the CLI ships with.
 *
 * Why this route and not the community ACP adapter (Axon, 2026-09-04; Lex,
 * same day): the App Server is OpenAI's own third-party client surface, it
 * lives inside the `codex` binary the member already has, it reads
 * `AGENTS.md` natively, and it answers approvals. The adapter would add a
 * second global install and a bundled copy of `@openai/codex` between the
 * plugin and OpenAI, which reopens the bundling question Lex closed.
 *
 * The plugin spawns the member's own unmodified install, brokers no sign-in
 * (`account/read` is the only account method it calls, and only to say
 * "signed in" or "not signed in, run `codex login`"), sets no credential or
 * identity variable for the child, and ships no binary. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CodexSession, modelChoicesOf } from './session';
import { codexStore } from './store';
import { codexModeLabel } from './modes';
import { configureLaunch, setHandshakeVersion, stopService, withService } from './service';
import { CODEX_INSTALL_HINT } from './host';
import { buildChildEnv, candidatePathsFor, resolveExecutable } from '../cli';
import type { PathEnvironment } from '../cli';
import type { DetectEnvironment, Detection, Provider, SessionConfig, SessionHooks } from '../types';
import type { PermissionModeName } from '../../model/types';

function pathEnvironment(env: DetectEnvironment): PathEnvironment {
  return { platform: env.platform, home: env.home, path: env.path, extra: env.extra };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `codex --version` prints `codex-cli X.Y.Z`; the number alone is the fact. */
function versionOf(cliPath: string, env: Record<string, string>): string | null {
  try {
    const run = spawnSync(cliPath, ['--version'], { env, encoding: 'utf8', timeout: 4000 });
    const line = (run.stdout ?? '').split('\n', 1)[0]?.trim() ?? '';
    const match = /(\d+\.\d+\.\d+)/.exec(line);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The model the CLI would use with no override, from the member's own
 * `~/.codex/config.toml` `model = "..."` line. Null when the file names none:
 * the choice then belongs to the server's `isDefault` row, which only a
 * running server can report. Never a guess.
 */
export function defaultModelFromConfig(home: string, read: (path: string) => string | null = readIfThere): string | null {
  if (!home) return null;
  const text = read(join(home, '.codex', 'config.toml'));
  if (!text) return null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break; // the top-level table ended
    const match = /^model\s*=\s*"([^"]+)"/.exec(trimmed);
    if (match?.[1]) return match[1];
  }
  return null;
}

function readIfThere(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `account/read` answers `{account: null}` when signed out (measured 2026-09-04). */
export function signedInFrom(result: unknown): boolean | null {
  if (!isRecord(result)) return null;
  if (result.account === null) return false;
  return isRecord(result.account) ? true : null;
}

export const codexProvider: Provider = {
  id: 'codex',
  displayName: 'Codex',
  installation: {
    command: 'npm install -g @openai/codex',
    page: 'https://developers.openai.com/codex/cli',
  },
  store: codexStore,

  install(): void {
    // Nothing to prepare on the host; the version is handed to the handshake
    // by main.ts through `setHandshakeVersion` once the manifest is known.
  },

  async detect(env: DetectEnvironment): Promise<Detection> {
    const pathEnv = pathEnvironment(env);
    let cliPath: string;
    try {
      cliPath = resolveExecutable('codex', env.configured, pathEnv, isExecutableFile, CODEX_INSTALL_HINT);
    } catch (error) {
      const searched = candidatePathsFor(pathEnv, 'codex').length;
      return {
        found: false,
        path: null,
        version: null,
        signedIn: null,
        hint: error instanceof Error ? error.message : `Codex was not found in ${searched} locations. ${CODEX_INSTALL_HINT}`,
      };
    }
    const childEnv = buildChildEnv(process.env, pathEnv);
    const version = versionOf(cliPath, childEnv);
    configureLaunch({ cliPath, cwd: env.home || process.cwd(), env: childEnv });
    let signedIn: boolean | null = null;
    try {
      // Read-only: the one account method the plugin ever calls (Lex, 2026-09-04).
      signedIn = signedInFrom(await withService(env.home || process.cwd(), (rpc) => rpc.request('account/read', {})));
    } catch {
      signedIn = null;
    }
    const state = signedIn === true ? 'signed in' : signedIn === false ? 'not signed in: run `codex login` in a terminal' : 'sign-in unknown';
    return {
      found: true,
      path: cliPath,
      version,
      signedIn,
      hint: `${version ? `Codex ${version}` : 'Codex'} at ${cliPath}, ${state}`,
    };
  },

  /* The catalogue the server publishes, from the shared service. Empty when
     the server cannot be started; never a list kept here. */
  async models(cwd: string) {
    try {
      return modelChoicesOf(await withService(cwd, (rpc) => rpc.request('model/list', { limit: 50 })));
    } catch {
      return [];
    }
  },

  async defaultModel(): Promise<string | null> {
    let home = '';
    try {
      home = (await import('node:os')).homedir();
    } catch {
      home = '';
    }
    return defaultModelFromConfig(home);
  },

  modeLabel(mode: PermissionModeName): string {
    return codexModeLabel(mode);
  },

  open(config: SessionConfig, hooks: SessionHooks): CodexSession {
    const pathEnv = pathEnvironment(config.detect);
    const cliPath = resolveExecutable('codex', config.cliPath, pathEnv, isExecutableFile, CODEX_INSTALL_HINT);
    if (config.pluginVersion) setHandshakeVersion(config.pluginVersion);
    return new CodexSession(config, { cliPath, cwd: config.cwd, env: buildChildEnv(process.env, pathEnv) }, hooks);
  },

  dispose(): void {
    stopService();
  },
};
