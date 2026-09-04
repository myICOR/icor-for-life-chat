/* The ACP runtimes as Providers: one `Provider` per recipe, one client
 * underneath.
 *
 * Why one client and many ids (Axon, 2026-09-04): written once, the ACP
 * client covers Gemini CLI, Copilot CLI, OpenCode and Qwen Code with a launch
 * recipe each, and each keeps its own id so a manifest names the runtime that
 * had the session. Why not ACP for Claude or Codex: both reach ACP only
 * through adapters that bundle the vendor's own package, and both have a
 * richer native surface (session lists, usage, rate limits) that ACP does not
 * carry.
 *
 * The plugin spawns the member's own install with the vault as cwd, brokers
 * no sign-in (the `authenticate` method exists in the protocol and is never
 * called: the settings row says how the agent itself signs in), advertises
 * no filesystem or terminal capability, sets no credential variable, and
 * ships no binary. */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AcpSession } from './session';
import { archiveStoreFor } from './store';
import { ACP_PROVIDER_IDS, ACP_RECIPES, recipeCandidates } from './recipes';
import type { AcpProviderId, AcpRecipe } from './recipes';
import { buildChildEnv, candidatePathsFor, resolveExecutable } from '../cli';
import type { PathEnvironment } from '../cli';
import type { DetectEnvironment, Detection, Provider, SessionConfig, SessionHooks } from '../types';

export { configureArchiveIndex } from './store';
export type { ArchiveIndex, ArchivedSession } from './store';
export { ACP_PROVIDER_IDS, ACP_RECIPES, isAcpProviderId } from './recipes';
export type { AcpProviderId, AcpRecipe } from './recipes';

function pathEnvironment(env: DetectEnvironment): PathEnvironment {
  return { platform: env.platform, home: env.home, path: env.path, extra: env.extra };
}

function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `<agent> --version` prints a version somewhere on its first line, or nothing usable. */
function versionOf(cliPath: string, env: Record<string, string>): string | null {
  try {
    const run = spawnSync(cliPath, ['--version'], { env, encoding: 'utf8', timeout: 6000 });
    const line = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split('\n').find((l) => /\d+\.\d+/.test(l)) ?? '';
    const match = /(\d+\.\d+(?:\.\d+)?)/.exec(line);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function installHint(recipe: AcpRecipe): string {
  return `Install ${recipe.displayName} (${recipe.installation.page}), or set its path in the plugin settings under Providers.`;
}

/**
 * Where the runtime is, trying the recipe's own locations after PATH. The
 * probe is a parameter so the not-found path is assertable without a machine.
 */
export function resolveAcpExecutable(recipe: AcpRecipe, env: DetectEnvironment, probe: (p: string) => boolean = isExecutableFile): string {
  const pathEnv = pathEnvironment(env);
  try {
    return resolveExecutable(recipe.command, env.configured, pathEnv, probe, installHint(recipe));
  } catch (error) {
    if (env.configured.trim()) throw error;
    for (const candidate of recipeCandidates(recipe, env.platform, env.home)) {
      if (probe(candidate)) return candidate;
    }
    throw error;
  }
}

function providerFor(recipe: AcpRecipe): Provider {
  return {
    id: recipe.id,
    displayName: recipe.displayName,
    installation: recipe.installation,
    store: archiveStoreFor(recipe.id),

    async detect(env: DetectEnvironment): Promise<Detection> {
      let cliPath: string;
      try {
        cliPath = resolveAcpExecutable(recipe, env);
      } catch (error) {
        const searched = candidatePathsFor(pathEnvironment(env), recipe.command).length + recipeCandidates(recipe, env.platform, env.home).length;
        return {
          found: false,
          path: null,
          version: null,
          signedIn: null,
          hint: error instanceof Error ? error.message : `${recipe.displayName} was not found in ${searched} locations. ${installHint(recipe)}`,
        };
      }
      const version = versionOf(cliPath, buildChildEnv(process.env, pathEnvironment(env)));
      /* Sign-in is NOT probed: knowing it means opening a session, and a
         session is a process the user did not start. The hint carries how the
         agent signs in; the first conversation reports the agent's own words
         if it is not. */
      return {
        found: true,
        path: cliPath,
        version,
        signedIn: null,
        hint: `${version ? `${recipe.displayName} ${version}` : recipe.displayName} at ${cliPath}. ${recipe.authHint}${recipe.measured ? '' : ' Written from the ACP specification, not yet measured against this agent.'}`,
      };
    },

    /* No catalogue: ACP v1 publishes none on the handshake, and a list kept
       here would be the invented catalogue the composer forbids. */
    async models() {
      return [];
    },

    async defaultModel() {
      return null;
    },

    open(config: SessionConfig, hooks: SessionHooks): AcpSession {
      const cliPath = resolveAcpExecutable(recipe, config.detect);
      return new AcpSession(recipe, config, { cliPath, cwd: config.cwd, env: buildChildEnv(process.env, pathEnvironment(config.detect)) }, hooks);
    },

    modeLabel() {
      // The agent names its modes on the handshake, per session; there is
      // no static name to print beside ours before one has opened.
      return null;
    },
  };
}

export const acpProviders: Record<AcpProviderId, Provider> = Object.fromEntries(
  ACP_PROVIDER_IDS.map((id) => [id, providerFor(ACP_RECIPES[id])]),
) as Record<AcpProviderId, Provider>;
