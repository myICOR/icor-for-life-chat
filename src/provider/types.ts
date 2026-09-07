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

/* One id per RUNTIME, never per protocol. Two runtimes are in the build:
 * Claude Code, the one the plugin was built on, and Codex, measured against
 * a real signed-in recording and offered as Alpha. The four Agent Client
 * Protocol runtimes (Gemini CLI, Copilot CLI, OpenCode, Qwen Code) joined on
 * 2026-09-04 and left on 2026-09-06 (Tom, on Axon's audit): three of them had
 * never been measured against their agent, and a runtime nobody can test is
 * a runtime nobody can maintain. A manifest or a note written on one of them
 * still names it, and the reader keeps the name as a string so the session
 * is refused in that runtime's words rather than resumed on Claude. */
export type ProviderId = 'claude' | 'codex';

export const PROVIDER_IDS: readonly ProviderId[] = ['claude', 'codex'];

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

/**
 * Where the runtime's credential came from, in the plugin's own words -
 * never the SDK's own `ApiKeySource` type, which stays inside
 * `provider/claude/` per the hygiene gate. `'unknown'` for a provider that
 * cannot say (nothing here is guessed): Codex reports none today, so its
 * session simply leaves `ProviderSession.authSource` unset.
 * `chat-mobile-engine-spec-v1.md` section 4.
 */
export type AuthSource = 'subscription' | 'api-key' | 'unknown';

/**
 * The desktop auth-truth line, computed rather than left to whichever call
 * site needs it next (`chat-mobile-engine-spec-v1.md` section 4, Felix,
 * 2026-09-06). Lives here, not in `provider/claude/authSource.ts`, because
 * `ChatView.ts` and `SettingsTab.ts` both show it and neither is allowed to
 * import anything from `provider/claude/` (the hygiene gate that keeps the
 * Agent SDK behind one seam). `AuthSource` already lived here for the same
 * reason.
 *
 * Four states, and every one is a real, measured fact rather than a guess:
 * - `not-found`: `Detection.found === false` for Claude Code. Not the same
 *   claim as "not signed in" - `Detection.signedIn` is ALWAYS null for
 *   Claude (only a live session can ever know that), so this function never
 *   says "not signed in" for a fact it cannot see. The Providers section
 *   already carries the install row for this case; this state exists so the
 *   engine line never goes silent instead of lying.
 * - `unknown`: Claude Code is on the machine but no session in this
 *   Obsidian session has connected yet, so `apiKeySource` has never arrived.
 * - `subscription` / `api-key`: read straight from `ProviderSession.authSource`
 *   once a session's `system`/`init` message has answered it.
 */
export type AuthTruthState =
  | { kind: 'not-found' }
  | { kind: 'unknown' }
  | { kind: 'subscription' }
  | { kind: 'api-key' };

/** `found` is `Detection.found` for Claude Code, or `undefined` before
 * detection has run at all (settings tab, first paint). */
export function describeAuthTruth(found: boolean | undefined, authSource: AuthSource): AuthTruthState {
  if (found === false) return { kind: 'not-found' };
  if (authSource === 'subscription') return { kind: 'subscription' };
  if (authSource === 'api-key') return { kind: 'api-key' };
  return { kind: 'unknown' };
}

/** The words for `AuthTruthState`, exactly once, so Settings and the chat
 * header can never say something different for the same fact. */
export function authTruthLine(state: AuthTruthState): string {
  switch (state.kind) {
    case 'subscription':
      return 'Signed in through Claude Code: subscription';
    case 'api-key':
      return 'Signed in through Claude Code: API key (billed per use)';
    case 'not-found':
      return "Claude Code is not signed in on this computer. Install it under Settings → Providers, then run `claude` in a terminal to sign in.";
    case 'unknown':
      return 'Signed in through Claude Code. Send a message to see whether it is your subscription or an API key.';
  }
}

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
  /** The plugin's own version, for a runtime that identifies its client on a handshake. */
  pluginVersion?: string;
  /**
   * Desktop auth truth (`chat-mobile-engine-spec-v1.md` section 4). Off by
   * default: the Claude child's spawn env is stripped of `ANTHROPIC_API_KEY`,
   * `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` so it falls back to
   * whatever sign-in Claude Code itself keeps on the machine - normally the
   * member's subscription. True re-allows those three through, for a member
   * who has deliberately set Claude Code up with an API key instead. Read
   * only by the Claude provider; every other provider ignores it.
   */
  allowEnvApiKey?: boolean;
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
  /**
   * Where THIS session's credential came from, once the runtime has said -
   * absent until then, and absent forever for a provider that never learns
   * one. Settings and the chat header read this to show the desktop auth
   * truth (`chat-mobile-engine-spec-v1.md` section 4); nothing computes it
   * from anything but the runtime's own report.
   */
  readonly authSource?: AuthSource;
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

/**
 * How a member gets the runtime onto the machine. The plugin never runs it:
 * Obsidian's policy forbids a plugin installing its own dependencies, and the
 * vault's rule is that a runtime is started by the user, never by an agent.
 * The plugin hands the line to a terminal pane or to the clipboard and opens
 * the vendor's page; the user presses Enter.
 */
export interface RuntimeInstall {
  /** The vendor's documented one-line install. */
  command: string;
  /** The vendor's own setup page. */
  page: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** The vendor's install line and page, for a runtime that was not found. */
  readonly installation: RuntimeInstall;
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
  /** Null for a provider whose protocol has no session list. */
  readonly store: SessionStore | null;
  /**
   * The runtime's own words for one of the plugin's four modes, shown beside
   * ours so the mode chip never claims a name the process does not carry.
   * Absent when the runtime uses the same four names (Claude).
   */
  modeLabel?(mode: PermissionModeName): string | null;
  /** Release anything shared across sessions (a service process). Plugin unload. */
  dispose?(): void;
}
