/* The pure surface under test, bundled once so node:test can import it without
 * an Obsidian runtime. Only modules with no Obsidian import belong here. */
export * from '../src/provider/claude/normalize';
export * from '../src/provider/claude/usage';
export * from '../src/provider/tooling';
/* The AskUserQuestion surface: parsing a call into questions, the answer the
   CLI's own admitter will take back, and the one place a pending request
   becomes an event. All pure, all measured against the real CLI - see the
   header of src/provider/questions.ts. */
export * from '../src/provider/questions';
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
/* What the vault says about itself (AGENTS.md, skills, schema): the parsers,
 * the prompt and the adapter reader, which takes its adapter as a parameter. */
export * from '../src/vault/vaultContext';
export { INK_PLUGIN_NAME, PLUGIN_ID, ARCHIVE_FOLDER_DEFAULT, ARCHIVE_FOLDER_LEGACY } from '../src/constants';
export * from '../src/model/facts';
export * from '../src/model/format';
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
/* Where "Save as note" puts a reply and how it names it (issue #1; 0.17.1). */
export * from '../src/model/scratchpad';
export * from '../src/provider/codex/normalize';
export * from '../src/provider/codex/modes';
export { modelChoicesOf } from '../src/provider/codex/session';
export { defaultModelFromConfig, signedInFrom } from '../src/provider/codex/index';
export * from '../src/archive/handover';
export * from '../src/archive/resume';
export * from '../src/view/handoff';
export * from '../src/view/paneActions';
export * from '../src/provider/claude/authSource';
export * from '../src/remoteControl/version';
export * from '../src/remoteControl/displayName';
export * from '../src/remoteControl/disqualifiers';
export * from '../src/remoteControl/command';
export * from '../src/remoteControl/launch';
export * from '../src/remoteControl/held';
export * from '../src/model/sessionId';

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
