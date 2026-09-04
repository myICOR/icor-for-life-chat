/* The launch table for every runtime that speaks the Agent Client Protocol.
 *
 * One client (`session.ts`, `normalize.ts`) and one row per agent: the
 * command, the arguments that put it into ACP mode, where it tends to be
 * installed, how a member gets it, and the quirks the spec leaves to each
 * agent. A recipe is data, pure, and asserted headless; the day an agent
 * changes its flag, this file changes and nothing else.
 *
 * `measured` is a fact about THIS build, not a promise: true only when
 * `tools/acp-probe.mjs` has a recording under `test/fixtures/` for the agent.
 * On 2026-09-04 that is Gemini CLI 0.58.0 (`test/fixtures/acp-gemini-recorded.
 * json`): the handshake answered with `loadSession: true`, prompt capabilities
 * for image, audio and embedded context, and four auth methods; `session/new`
 * was refused with `Gemini API key is missing or not configured` (-32000)
 * because the probe signs nothing in. Copilot CLI, OpenCode and Qwen Code are
 * written from the specification: none was installed on the recording machine
 * (the VS Code Copilot shim at the globalStorage path offers to download the
 * CLI and is not the CLI), and the probe installs nothing.
 *
 * Auth facts come from Lex's ruling of 2026-09-04
 * (`04-lex-ruling-multi-provider-sign-in.md`): Gemini is permitted on an API
 * key, Vertex AI or Workspace Code Assist; the CLI still ADVERTISES a
 * personal Google login method (recorded), and the plugin neither offers it
 * nor promises it, because Google ended that tier for the CLI on 2026-06-18.
 * Copilot CLI is permitted on any Copilot plan; on the Free, Pro and Pro+
 * plans inputs and outputs train GitHub's models unless the member opts out. */

import type { ProviderId, RuntimeInstall } from '../types';

export type AcpProviderId = Extract<ProviderId, 'gemini' | 'copilot' | 'opencode' | 'qwen'>;

export interface AcpRecipe {
  id: AcpProviderId;
  displayName: string;
  /** The executable's base name, resolved on PATH and in `candidates`. */
  command: string;
  args: string[];
  /** Extra absolute locations to try, per platform, after PATH. */
  candidates: Partial<Record<'darwin' | 'linux' | 'win32', string[]>>;
  installation: RuntimeInstall;
  /** One sentence for the settings row: how the agent expects to be signed in. */
  authHint: string;
  /** One sentence naming the instruction file the agent reads, or how to make it read AGENTS.md. */
  instructionsHint: string;
  /** The agent's model-selection method when it departs from the stabilised config option. */
  modelQuirk: 'config_option' | 'unstable_setSessionModel' | 'session/set_model';
  /** True only when a recording under test/fixtures exists for this agent. */
  measured: boolean;
}

const VSCODE_COPILOT_SHIM_DIR = 'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli';

export const ACP_RECIPES: Record<AcpProviderId, AcpRecipe> = {
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    candidates: {},
    installation: {
      command: 'npm install -g @google/gemini-cli',
      page: 'https://geminicli.com/docs/get-started/installation/',
    },
    authHint: 'Signs in inside the CLI with a Gemini API key (GEMINI_API_KEY), Vertex AI, or a Workspace Code Assist licence. The plugin holds no key.',
    instructionsHint: 'Reads GEMINI.md; add "AGENTS.md" to context.fileName in ~/.gemini/settings.json so the vault\'s own rules are read.',
    modelQuirk: 'unstable_setSessionModel',
    measured: true,
  },
  copilot: {
    id: 'copilot',
    displayName: 'Copilot CLI',
    command: 'copilot',
    args: ['--acp'],
    // VS Code parks a shim here on macOS that downloads the real CLI on first
    // run; the shim is offered as a location, never run by the plugin.
    candidates: { darwin: [VSCODE_COPILOT_SHIM_DIR] },
    installation: {
      command: 'npm install -g @github/copilot',
      page: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    },
    authHint: 'Signs in inside the CLI with your GitHub account on any Copilot plan. On Free, Pro and Pro+, GitHub may train on inputs and outputs unless you opt out in your GitHub settings.',
    instructionsHint: 'Reads AGENTS.md natively.',
    modelQuirk: 'config_option',
    measured: false,
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    candidates: {},
    installation: {
      command: 'curl -fsSL https://opencode.ai/install | bash',
      page: 'https://opencode.ai/docs/',
    },
    authHint: 'Brings its own provider catalogue, local models included; keys are configured inside OpenCode, never here.',
    instructionsHint: 'Reads AGENTS.md natively.',
    modelQuirk: 'session/set_model',
    measured: false,
  },
  qwen: {
    id: 'qwen',
    displayName: 'Qwen Code',
    command: 'qwen',
    args: ['--acp'],
    candidates: {},
    installation: {
      command: 'npm install -g @qwen-code/qwen-code',
      page: 'https://qwenlm.github.io/qwen-code-docs/',
    },
    authHint: 'A Gemini CLI fork: signs in inside the CLI with a Qwen or OpenAI-compatible key. The plugin holds no key.',
    instructionsHint: 'Reads QWEN.md; the same context.fileName setting as Gemini CLI admits AGENTS.md.',
    modelQuirk: 'unstable_setSessionModel',
    measured: false,
  },
};

export const ACP_PROVIDER_IDS: readonly AcpProviderId[] = ['gemini', 'copilot', 'opencode', 'qwen'];

export function isAcpProviderId(id: string): id is AcpProviderId {
  return (ACP_PROVIDER_IDS as readonly string[]).includes(id);
}

/** The recipe's extra locations for a platform, with `home` filled in. */
export function recipeCandidates(recipe: AcpRecipe, platform: 'darwin' | 'linux' | 'win32', home: string): string[] {
  const dirs = recipe.candidates[platform] ?? [];
  const sep = platform === 'win32' ? '\\' : '/';
  return dirs.map((dir) => `${home}${sep}${dir}${sep}${recipe.command}`);
}
