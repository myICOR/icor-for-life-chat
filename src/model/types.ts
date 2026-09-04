/* The plugin's own vocabulary. Nothing here imports the Agent SDK: this is the
 * shape the view consumes, and `sdk/normalize.ts` is the only translator. */

export type PermissionModeName =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions';

/* The reasoning-effort levels this plugin offers, and they are a SUBSET of the
 * SDK's on purpose. The SDK also accepts 'max', which its own docs mark as
 * select-models-only and session-scoped; offering it on a model that does not
 * carry it would put a control in the composer that silently downgrades, which
 * is the same defect class as a label that is technically true and practically
 * useless. The four below are the levels the persisted `effortLevel` setting
 * accepts, so every one of them survives a reload. */
export type EffortName = 'low' | 'medium' | 'high' | 'xhigh';

/** One row of the SDK's own model catalogue. Never assembled locally. */
export interface ModelChoice {
  /** The id passed to the CLI. */
  value: string;
  /** The provider's own display name. The composer never invents one. */
  displayName: string;
  description: string;
  supportedEffortLevels: EffortName[] | null;
}

/** One image the user attached to a turn. The renderer rebuilds a data URL. */
export interface TurnImage {
  name: string;
  mediaType: string;
  /** Raw base64, no `data:` prefix. The same payload the SDK's image block took. */
  data: string;
}

/** One context chip on a sent turn. The label is what the chip says. */
export interface TurnContext {
  kind: 'active' | 'note' | 'folder' | 'tag' | 'property';
  label: string;
  count: number;
  /** For a single note, so the chip opens it. Null for a group. */
  path: string | null;
}

/** Where a run of events belongs: the main thread, or one subagent's transcript. */
export type StreamId = string | null;

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface RateLimitFacts {
  /** Only ever set from a provider rate_limit_event. Never computed locally. */
  window: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage' | 'unknown';
  utilization: number | null;
  resetsAt: number | null;
  status: 'allowed' | 'allowed_warning' | 'rejected';
}

export type ToolStatus = 'running' | 'done' | 'failed' | 'awaiting-approval';

export type ChatEventBody =
  | {
      kind: 'session';
      sessionId: string;
      model: string;
      cwd: string;
      permissionMode: PermissionModeName;
      slashCommands: string[];
      contextWindow: number | null;
    }
  /* The turn as the user sent it, PICTURES INCLUDED.
   *
   * The images used to stop at the composer: they were handed to the session
   * and never to the renderer, so a pasted screenshot previewed while it was
   * being composed and then vanished the moment it was sent. The conversation
   * showed the question and not the thing the question was about, which reads
   * as a message that failed to send. They travel on the event because the
   * event is what the stream renders. */
  | {
      kind: 'user-turn';
      text: string;
      contextNote: string | null;
      /* Where that note IS, so the pill can open it. The event carried only the
       * basename, which is enough to print a label and not enough to do
       * anything with it - so the one reference to that note in the whole
       * conversation was a dead end. Null when there was no context. */
      contextPath: string | null;
      images: TurnImage[];
      /* True when this message was sent while a turn was running, so the CLI
         holds it for the next turn. Optional: 0.5.x transcripts carry no flag. */
      queued?: boolean;
      /* Everything ELSE the message carried: notes named with `[[`, notes and
         groups picked from the `+` menu. One chip each above the words. A
         single note keeps its path so its chip can open it; a group keeps a
         count so the chip can say how much it stands for. Optional because a
         0.5.x transcript never wrote it, and a replay must not lose the turn. */
      contexts?: TurnContext[];
      /* The turn's transcript index as a string, so the well can carry a pin
         control that the pin tray recognises. Optional for the same reason
         `contexts` is: older transcripts never wrote it. */
      key?: string;
    }
  | { kind: 'text-open'; blockId: string }
  | { kind: 'text-delta'; blockId: string; text: string }
  | { kind: 'text-final'; blockId: string; text: string }
  | { kind: 'thinking-open'; blockId: string }
  | { kind: 'thinking-delta'; blockId: string; text: string }
  | { kind: 'thinking-final'; blockId: string; text: string }
  | {
      kind: 'tool-call';
      toolUseId: string;
      name: string;
      /** The raw argument: the command, the path, the pattern. What the row OPENS onto. */
      target: string;
      /* WHAT WAS DONE, in one plain sentence, and it is what the row SHOWS.
       * "Read 04 Inner World/Contacts/People/bernd-martin.md", "Ran Open the
       * demo note in Obsidian". A row that printed the shell command said what
       * the agent typed and never what it meant; every Bash row in a session
       * began with the same cd and the part that differed was the part cut
       * off. Derived by `toolPurpose`, a script: two people given the same
       * input cannot disagree about it. */
      purpose: string;
      input: Record<string, unknown>;
    }
  | {
      kind: 'tool-result';
      toolUseId: string;
      ok: boolean;
      /** The first line, for a tooltip. */
      detail: string;
      /** The result body, capped at `RESULT_OUTPUT_CAP` characters. The opened row reads it. */
      output: string;
    }
  /* `purpose` is optional here only because two producers exist: the live
   * broker, which knows the input and can derive it, and a stored transcript
   * from before 0.6, which cannot. The renderer falls back to the name. */
  | { kind: 'tool-approval'; toolUseId: string; name: string; target: string; purpose?: string }
  | { kind: 'tool-approval-resolved'; toolUseId: string; allowed: boolean }
  | {
      kind: 'subagent-start';
      agentId: string;
      agentType: string;
      description: string;
      /** The prompt the orchestrating agent wrote, when the CLI reports it. */
      task: string;
    }
  | { kind: 'subagent-end'; agentId: string; ok: boolean }
  | { kind: 'compact-boundary'; preTokens: number; postTokens: number | null }
  | { kind: 'rate-limit'; facts: RateLimitFacts }
  /* A RESUMED conversation's own start, read back from the stored session
   * record. It exists because `session` arrives on a resume too, and stamping
   * that moment would print the time the user REOPENED the thread under a label
   * that says the thread began then. `startedAt` is null when the record does
   * not carry one, and null means the readout is absent - never a substitute. */
  | { kind: 'session-restored'; startedAt: number | null }
  | {
      kind: 'turn-end';
      usage: TurnUsage;
      /** From the provider's own modelUsage record, or null. Never a guess. */
      contextWindow: number | null;
      durationMs: number;
      isError: boolean;
      text: string;
    }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string };

export type ChatEvent = ChatEventBody & { stream: StreamId };

export type ChatStatus = 'idle' | 'streaming' | 'error';

export interface SubagentState {
  agentId: string;
  agentType: string;
  description: string;
  status: 'running' | 'done' | 'failed' | 'orphaned';
  startedAt: number;
  endedAt: number | null;
}

export interface ChatState {
  sessionId: string | null;
  status: ChatStatus;
  model: string | null;
  permissionMode: PermissionModeName;
  /** Cumulative for the conversation; the SDK's result totals are running totals. */
  usage: TurnUsage | null;
  contextWindow: number | null;
  contextTokens: number | null;
  rateLimits: RateLimitFacts | null;
  subagents: Record<string, SubagentState>;
  slashCommands: string[];
  turnStartedAt: number | null;
  /**
   * When the conversation began, and it has exactly one writer: the `session`
   * event on a fresh session, or the stored record on a resumed one. Never
   * `Date.now()` at plugin load, never at view open, never at first render.
   */
  sessionStartedAt: number | null;
  /**
   * True once this tab has been pointed at a stored conversation. It exists so
   * the later `session` event cannot stamp the reopen time over an absent
   * original start: on a resumed thread the start is the record's or it is
   * nothing.
   */
  resumed: boolean;
  lastUpdatedAt: number | null;
  lastError: string | null;
}

export function emptyState(): ChatState {
  return {
    sessionId: null,
    status: 'idle',
    model: null,
    permissionMode: 'default',
    usage: null,
    contextWindow: null,
    contextTokens: null,
    rateLimits: null,
    subagents: {},
    slashCommands: [],
    turnStartedAt: null,
    sessionStartedAt: null,
    resumed: false,
    lastUpdatedAt: null,
    lastError: null,
  };
}
