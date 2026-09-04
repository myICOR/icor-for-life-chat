/* Claude Code as a Provider: the native path, and the reference implementation
 * every later provider is measured against.
 *
 * Claude stays on the Agent SDK rather than behind an ACP adapter on purpose
 * (Axon, 2026-09-04): the SDK publishes facts no other surface does - the
 * rate-limit events, the per-model context window, the session list, fork
 * and rename - and the arrangement where the plugin spawns the member's own
 * unmodified CLI is the one Lex ruled on. What this file adds over the
 * pre-seam code is only the door: where the executable is found, and how a
 * neutral `SessionConfig` becomes a Claude launch. */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { installRendererCompat } from './renderer-compat';
import { ChatSession } from './session';
import { claudeStore, resolvedDefaultModel } from './store';
import { CliNotFoundError, buildChildEnv, candidatePaths, resolveCliPath } from '../cli';
import type { PathEnvironment } from '../cli';
import type { DetectEnvironment, Detection, Provider, SessionConfig, SessionHooks } from '../types';

function pathEnvironment(env: DetectEnvironment): PathEnvironment {
  return { platform: env.platform, home: env.home, path: env.path, extra: env.extra };
}

/** `claude --version` prints `X.Y.Z (Claude Code)`; the number alone is the fact. */
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

function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export const claudeProvider: Provider = {
  id: 'claude',
  displayName: 'Claude Code',
  installation: {
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    page: 'https://code.claude.com/docs/en/setup',
  },
  store: claudeStore,

  /* Before anything can launch a query. See renderer-compat.ts for why: the
     renderer's AbortSignal fails Node's realm check inside the SDK. */
  install(): void {
    installRendererCompat();
  },

  async detect(env: DetectEnvironment): Promise<Detection> {
    const pathEnv = pathEnvironment(env);
    try {
      const cliPath = resolveCliPath(env.configured, pathEnv);
      const version = versionOf(cliPath, buildChildEnv(process.env, pathEnv));
      return {
        found: true,
        path: cliPath,
        version,
        // Sign-in is only ever learned from a live session; nothing here can say.
        signedIn: null,
        hint: version ? `Claude Code ${version} at ${cliPath}` : `Found at ${cliPath}`,
      };
    } catch (error) {
      const searched = error instanceof CliNotFoundError ? candidatePaths(pathEnv).length : 0;
      return {
        found: false,
        path: null,
        version: null,
        signedIn: null,
        hint: error instanceof Error
          ? error.message
          : `Claude Code was not found in ${searched} locations. Install it from https://claude.com/claude-code.`,
      };
    }
  },

  /* The catalogue is the SESSION's to answer: the SDK only publishes
     `supportedModels()` on a live query. Empty here is honest; the composer
     asks the session once it has one. */
  async models(): Promise<never[]> {
    return [];
  },

  defaultModel(cwd: string): Promise<string | null> {
    return resolvedDefaultModel(cwd);
  },

  /* The one place the executable is resolved for a launch. The view used to
     do this itself, which pinned the view to this provider by name; a
     resolution that fails still throws a message the user can act on, and
     the view still shows the words. */
  open(config: SessionConfig, hooks: SessionHooks): ChatSession {
    const pathEnv = pathEnvironment(config.detect);
    const cliPath = resolveCliPath(config.cliPath, pathEnv, isExecutableFile);
    return new ChatSession(config, { cliPath, env: buildChildEnv(process.env, pathEnv) }, hooks);
  },
};
