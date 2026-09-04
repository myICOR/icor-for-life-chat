/* THE PROVIDER SEAM. The one interface the view talks to, and the one every
 * agent runtime implements.
 *
 * Why it exists (Axon's study, 2026-09-04, Tom decision c0x): the plugin's
 * event vocabulary in `model/types.ts` never knew a wire format, and the
 * Claude normaliser was already the only translator - three quarters of a
 * provider abstraction by accident. The missing quarter was that the view
 * constructed the Claude session, the Claude session store and the Claude
 * PATH resolver by name. This file is the quarter. Nothing below imports a
 * provider SDK; `test/hygiene.test.mjs` proves the view never reaches past
 * it, so a second provider is a second folder under `provider/`, not a
 * second view.
 *
 * Two rules every implementation inherits:
 *   - A fact the provider cannot measure is reported as absent (`null`), never
 *     guessed. `Detection.signedIn` is null for a runtime that cannot say;
 *     `models()` returns an empty list rather than a hand-typed one.
 *   - The view's own vocabulary is the contract. A provider that cannot express
 *     something in `ChatEvent` degrades to fewer events, never to a new kind
 *     the renderer has to learn per provider. */

import type { ChatEvent, EffortName, ModelChoice, PermissionModeName } from '../model/types';

/** `acp` is one provider that carries an agent recipe (Gemini, Copilot, OpenCode). */
export type ProviderId = 'claude' | 'codex' | 'acp';

export const PROVIDER_IDS: readonly ProviderId[] = ['claude', 'codex', 'acp'];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** What a provider found on this machine. Every field is a measurement or null. */
export interface Detection {
  found: boolean;
  path: string | null;
  version: string | null;
  /** Null when the runtime has no way to report it without starting a session. */
  signedIn: boolean | null;
  /** One sentence the settings tab can print: where to install, or what was found. */
  hint: string;
}

/** The host the provider is asked to find its runtime in. */
export interface DetectEnvironment {
  platform: 'darwin' | 'win32' | 'linux';
  home: string;
  path: string;
  /** Extra PATH entries the user typed, already split. */
  extra: string[];
  /** An explicit executable path from settings; empty means search. */
  configured: string;
}

export type ApprovalChoice = 'deny' | 'allow-once' | 'allow-always';

export interface PendingApproval {
  toolUseId: string;
  toolName: string;
  target: string;
  /** What the call would DO, in one sentence. See `toolPurpose`. */
  purpose?: string;
  title: string;
  resolve: (choice: ApprovalChoice) => void;
}

/** One image on its way to the model, already base64 and already type-checked. */
export interface SessionImage {
  mediaType: string;
  data: string;
}

export interface SessionConfig {
  provider: ProviderId;
  /** The explicit executable path from settings; empty means the provider searches. */
  cliPath: string;
  cwd: string;
  /** Where to look for the runtime, and what the child inherits. */
  detect: DetectEnvironment;
  model: string;
  effort: EffortName;
  permissionMode: PermissionModeName;
  structuredReplies: boolean;
  resumeSessionId: string | null;
}

export interface SessionHooks {
  onEvent: (event: ChatEvent) => void;
  onApprovalRequest: (request: PendingApproval) => void;
  onApprovalSettled: (toolUseId: string, choice: ApprovalChoice) => void;
  onStderr?: (line: string) => void;
  /** Every wire frame before normalisation. Measurement tools only. */
  onRawMessage?: (raw: unknown) => void;
  /** The provider refused a mid-session mode switch, in its own words. */
  onModeRefused?: (mode: PermissionModeName, message: string) => void;
}

/** One live conversation with one runtime process behind it. */
export interface ProviderSession {
  start(): void;
  send(text: string, images?: SessionImage[]): void;
  interrupt(): Promise<void>;
  answerApproval(toolUseId: string, choice: ApprovalChoice): void;
  /** True only when the provider confirmed the switch. */
  setPermissionMode(mode: PermissionModeName): Promise<boolean>;
  setModel(model: string): Promise<void>;
  /** The provider's own catalogue, or an empty list. Never assembled locally. */
  supportedModels(): Promise<ModelChoice[]>;
  dispose(): void;
  /** Resolves when the message pump has finished. Tests and unload. */
  drain(): Promise<void>;
  readonly aborted: boolean;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  lastModified: number;
  createdAt: number | null;
}

/**
 * A stored conversation, already in the plugin's own vocabulary.
 *
 * The provider does the translation, because the stored shape is the
 * provider's wire format and the view must never learn one. Each entry is one
 * stored message: the user's own words when it was the user typing, and the
 * events the message produces when replayed through the provider's normaliser.
 */
export interface ReplayEntry {
  /** The user's own words, or null when the message was not a person typing. */
  spoken: string | null;
  events: ChatEvent[];
  /**
   * The provider's own id for this stored message, when it has one. It is
   * what `SessionStore.fork` takes as `upToMessageId`, so "edit and resend"
   * can rewind to the message before the one being edited. Null for a
   * provider whose store carries no ids, and the view then forks whole.
   */
  messageId?: string | null;
}

export interface SessionReplay {
  entries: ReplayEntry[];
  /** Messages that existed before the slice returned. Told, never hidden. */
  omitted: number;
}

/** The provider's own record of past conversations, scoped to one directory. */
export interface SessionStore {
  /** Recent conversations for `cwd`, newest first. Never machine-wide. */
  list(cwd: string, limit: number): Promise<SessionSummary[]>;
  createdAt(sessionId: string, cwd: string): Promise<number | null>;
  exists(sessionId: string, cwd: string): Promise<boolean>;
  read(sessionId: string, cwd: string, cap: number): Promise<SessionReplay>;
  fork?(sessionId: string, cwd: string, upToMessageId?: string): Promise<string | null>;
  rename?(sessionId: string, cwd: string, title: string): Promise<void>;
  delete?(sessionId: string, cwd: string): Promise<void>;
}

export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** One-time host preparation before any session can launch. Optional. */
  install?(): void;
  detect(env: DetectEnvironment): Promise<Detection>;
  models(cwd: string): Promise<ModelChoice[]>;
  defaultModel(cwd: string): Promise<string | null>;
  /**
   * Open a session. May throw a user-facing Error when the runtime cannot be
   * found; the caller shows the words, because a launch that fails silently
   * is a pane that sits on Stop forever.
   */
  open(config: SessionConfig, hooks: SessionHooks): ProviderSession;
  /** Null for a provider whose protocol has no session list (ACP). */
  readonly store: SessionStore | null;
}
