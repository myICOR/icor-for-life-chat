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
  loadOwnKeySettings, saveOwnKeySettings, activeApiKey, maskKey,
} from './credentials';
export type { EngineChoice, OwnKeySettings, LocalStorageHost } from './credentials';

export { testProviderKey } from './testKey';
export type { TestKeyResult } from './testKey';

export { runOwnKeyTurn } from './toolLoop';
export type { OwnKeyEngineConfig, OwnKeyHooks, TurnCost, TurnResult } from './toolLoop';
export { OwnKeyApprovalBroker, WriteApprovalGate } from './approval';
export type { ApprovalChoice, PendingApproval } from './approval';

export { MOBILE_TOOLS, WRITE_TOOL_NAMES } from './tools/definitions';
export type { VaultToolsContext, NoteLike, FolderLike, ToolOutcome } from './tools/vaultTools';

export { estimateAnthropicCost, anthropicModelDisplayName, ANTHROPIC_PRICES } from './cost';
