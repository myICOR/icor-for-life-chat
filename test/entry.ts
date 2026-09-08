/* The pure surface under test, bundled once so node:test can import it without
 * an Obsidian runtime. Only modules with no Obsidian import belong here. */
export * from '../src/provider/claude/normalize';
export * from '../src/provider/claude/usage';
export * from '../src/provider/tooling';
export * from '../src/provider/types';
export * from '../src/provider/registry';
export * from '../src/provider/cli';
export * from '../src/provider/extraPath';
export * from '../src/provider/claude/permissions';
export * from '../src/state/store';
export * from '../src/model/types';
export * from '../src/model/settings';
export * from '../src/model/contextText';
export * from '../src/model/context';
export * from '../src/model/followups';
export * from '../src/model/pins';
export * from '../src/model/activity';
export * from '../src/view/actions';
export * from '../src/team/memoryParse';
export { STRUCTURED_REPLY_PROMPT, INK_PLUGIN_NAME, PLUGIN_ID } from '../src/constants';
export * from '../src/model/facts';
export * from '../src/model/format';
export * from '../src/structured/model';
export * from '../src/structured/parser';
export * from '../src/structured/decisions';
export * from '../src/structured/rails';
export * from '../src/structured/icons';
export * from '../src/archive/naming';
export * from '../src/archive/resume';
export * from '../src/provider/claude/renderer-compat';
export * from '../src/state/subagents';
export * from '../src/view/leafRoute';
export * from '../src/model/catalogCache';
export { userTextOf } from '../src/provider/claude/normalize';
export * from '../src/view/composer/slash';
export * from '../src/view/composer/mention';
export * from '../src/view/statusbar';
export * from '../src/archive/redact';
export * from '../src/provider/claude/launch';
export * from '../src/settings/definitions';
export * from '../src/team/usage';
export * from '../src/team/insights';
export * from "../src/archive/agents";
export * from '../src/wip/naming';
export * from '../src/provider/codex/normalize';
export * from '../src/provider/codex/modes';
export { modelChoicesOf } from '../src/provider/codex/session';
export { defaultModelFromConfig, signedInFrom } from '../src/provider/codex/index';
export * from '../src/archive/handover';
export * from '../src/archive/resume';
export * from '../src/view/handoff';

/* The own-key engine (`chat-mobile-engine-spec-v1.md`), the pure half: the
 * two adapters, the tool loop, the cost table and the vault-tool
 * implementations all take their I/O as parameters (a `Transports`, a
 * `VaultToolsContext`) rather than importing 'obsidian' or the network
 * themselves, so all of it belongs here. Only `src/engine/transport.ts`
 * (imports `requestUrl`) and `src/engine/index.ts` (re-exports it) are left
 * out, the same way `provider/claude/index.ts`'s filesystem probing is left
 * out of this bundle. */
export * from '../src/engine/types';
export * from '../src/engine/sse';
export * from '../src/engine/approval';
export * from '../src/engine/cost';
export * from '../src/engine/registry';
export * from '../src/engine/providers/anthropic';
export * from '../src/engine/providers/openrouter';
export * from '../src/engine/tools/definitions';
export * from '../src/engine/tools/purpose';
export * from '../src/engine/tools/vaultTools';
export * from '../src/engine/toolLoop';
export * from '../src/engine/credentials';
export * from '../src/engine/testKey';
/* The secrets contract (0.13.0): the env-file parser and writer, and the
 * backend door, both pure - the store and the adapter are parameters. */
export * from '../src/engine/envFile';
export * from '../src/engine/secrets';
