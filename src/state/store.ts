/* One store per tab. A pure reducer plus a listener list; no framework.
 * The view renders the delta the event names and reads the store for context,
 * which is why the stream can be append-mostly. */

import { emptyState } from '../model/types';
import type { ChatEvent, ChatState, SubagentState } from '../model/types';

export type StoreListener = (event: ChatEvent, state: ChatState) => void;

export function reduce(prev: ChatState, e: ChatEvent): ChatState {
  const now = Date.now();
  switch (e.kind) {
    case 'session':
      return {
        ...prev,
        sessionId: e.sessionId,
        model: e.model,
        permissionMode: e.permissionMode,
        slashCommands: e.slashCommands,
        contextWindow: e.contextWindow,
        /* The session start has ONE writer and this is it, on a fresh thread
           only. On a resumed one the start came from the stored record before
           this event arrived, and if the record carried none the fact stays
           ABSENT - stamping `now` here would print the reopen time under a
           label that says the conversation began then, which is the 2026-08-29
           substitution defect wearing a different field name. */
        sessionStartedAt: prev.resumed ? prev.sessionStartedAt : prev.sessionStartedAt ?? now,
        lastUpdatedAt: now,
      };
    case 'session-restored':
      /* Deliberately does NOT touch `lastUpdatedAt`: reopening a thread is
         something the user did to the window, not something the conversation
         did. UPD stays absent until a real event arrives. */
      return { ...prev, resumed: true, sessionStartedAt: e.startedAt };
    case 'user-turn':
      return { ...prev, status: 'streaming', turnStartedAt: now, lastUpdatedAt: now, lastError: null };
    case 'subagent-start': {
      const sub: SubagentState = {
        agentId: e.agentId,
        agentType: e.agentType,
        description: e.description,
        status: 'running',
        startedAt: now,
        endedAt: null,
      };
      return { ...prev, subagents: { ...prev.subagents, [e.agentId]: sub }, lastUpdatedAt: now };
    }
    case 'subagent-end': {
      const existing = prev.subagents[e.agentId];
      if (!existing) return prev;
      return {
        ...prev,
        subagents: {
          ...prev.subagents,
          [e.agentId]: { ...existing, status: e.ok ? 'done' : 'failed', endedAt: now },
        },
        lastUpdatedAt: now,
      };
    }
    case 'rate-limit':
      return { ...prev, rateLimits: e.facts, lastUpdatedAt: now };
    case 'turn-end': {
      // The SDK's result totals are running totals for the session, not per-turn
      // deltas: read the latest, never sum across results.
      const contextTokens = e.usage.inputTokens + e.usage.cacheReadTokens + e.usage.outputTokens;
      return {
        ...prev,
        status: e.isError ? 'error' : 'idle',
        usage: e.usage,
        contextWindow: e.contextWindow ?? prev.contextWindow,
        contextTokens,
        subagents: markOrphans(prev.subagents),
        turnStartedAt: null,
        lastUpdatedAt: now,
      };
    }
    case 'aborted':
      return { ...prev, status: 'idle', subagents: markOrphans(prev.subagents), turnStartedAt: null, lastUpdatedAt: now };
    case 'error':
      return { ...prev, status: 'error', lastError: e.message, turnStartedAt: null, lastUpdatedAt: now };
    default:
      return { ...prev, lastUpdatedAt: now };
  }
}

/** A subagent still running when the turn closed never completed. Marked, not spinning. */
function markOrphans(subs: Record<string, SubagentState>): Record<string, SubagentState> {
  let touched = false;
  const next: Record<string, SubagentState> = {};
  for (const [id, s] of Object.entries(subs)) {
    if (s.status === 'running') {
      next[id] = { ...s, status: 'orphaned', endedAt: Date.now() };
      touched = true;
    } else {
      next[id] = s;
    }
  }
  return touched ? next : subs;
}

export class ChatStore {
  private listeners: StoreListener[] = [];
  state: ChatState = emptyState();

  apply(event: ChatEvent): void {
    this.state = reduce(this.state, event);
    for (const l of this.listeners.slice()) l(event, this.state);
  }

  subscribe(l: StoreListener): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  dispose(): void {
    this.listeners = [];
  }
}
