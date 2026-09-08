/* THE FACADE. Everything Felix's mobile view needs to open and drive an
 * own-key conversation, in one place, so wiring the settings UI and the view
 * (`chat-mobile-engine-spec-v1.md` sections 3 and 4's display) means reading
 * this file rather than the six behind it. Nothing here is new logic - every
 * export is re-exported from the module that owns it. */

export type {
  EngineContentPart, EngineMessage, EngineToolDef, EngineUsage,
  ModelProvider, ModelProviderId, SendParams, Transports, TransportRequest, EngineDelta,
} from './types';

export {
  MODEL_PROVIDER_IDS, MODEL_PROVIDER_NAMES, DEFAULT_MODEL_FOR, GET_KEY_URL_FOR,
  createModelProvider, isModelProviderId,
} from './registry';

export { resolveTransports, StreamHttpError } from './transport';

export {
  OWN_KEY_STORAGE_KEY, DEFAULT_OWN_KEY_SETTINGS,
  loadOwnKeySettings, saveOwnKeySettings,
} from './credentials';
export type { EngineChoice, OwnKeySettings, LocalStorageHost } from './credentials';

/* Where the keys live (0.13.0, the suite-wide secrets contract): the two
 * backends, the ids, and the one door for read / write / move / migrate. */
export {
  SECRETS_BACKENDS, BACKEND_LABEL, BACKEND_OPTIONS, SECRET_ID_FOR, SECRET_ID_RULE,
  isSecretsBackend, secretStorageOf, effectiveBackend, readProviderKey, writeProviderKey, moveProviderKey,
  keyPresence, presentIn, otherBackend, keyStatusLine, missingKeyMessage, migratePlaintextKeys,
} from './secrets';
export type { SecretsBackend, SecretStore, KeyHosts, KeyPresence, PlaintextMigration } from './secrets';
export { DEFAULT_ENV_FILE_PATH, ENV_KEY_FOR, cleanVaultPath, parseEnvFile, upsertEnvLine, readEnvKey, writeEnvKey } from './envFile';
export type { EnvFileHost } from './envFile';

export { testProviderKey } from './testKey';
export type { TestKeyResult } from './testKey';

export { runOwnKeyTurn } from './toolLoop';
export type { OwnKeyEngineConfig, OwnKeyHooks, TurnCost, TurnResult } from './toolLoop';
export { OwnKeyApprovalBroker, WriteApprovalGate } from './approval';
export type { ApprovalChoice, PendingApproval } from './approval';

export { MOBILE_TOOLS, WRITE_TOOL_NAMES } from './tools/definitions';
export type { VaultToolsContext, NoteLike, FolderLike, ToolOutcome } from './tools/vaultTools';

export { estimateAnthropicCost, anthropicModelDisplayName, ANTHROPIC_PRICES } from './cost';
