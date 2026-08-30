/* The subagent bus.
 *
 * A subagent's transcript arrives on the main stream, tagged with the tool-use
 * id that spawned it (Options.forwardSubagentText), so there is no file to tail
 * and no sidecar to discover. The bus keeps one append-only log per agent id
 * and lets a view attach to it later - which is what makes "click the chip,
 * open the transcript in its own tab" a lookup rather than a re-read. */

import type { ChatEvent } from '../model/types';

export type SubagentStatus = 'running' | 'done' | 'failed' | 'orphaned' | 'replay';

export interface SubagentTranscript {
  agentId: string;
  agentType: string;
  description: string;
  /** The prompt the orchestrating agent wrote. Not the user's words. */
  task: string;
  status: SubagentStatus;
  startedAt: number;
  endedAt: number | null;
  events: ChatEvent[];
  /** When its transcript was first opened. Null while the chip still has a job. */
  openedAt: number | null;
  /** The session this subagent belongs to, for archive and replay. */
  sessionId: string | null;
  tokens: number;
  toolCalls: number;
}

type Listener = (event: ChatEvent | null, transcript: SubagentTranscript) => void;

export class SubagentBus {
  private readonly transcripts = new Map<string, SubagentTranscript>();
  private readonly listeners = new Map<string, Listener[]>();

  open(input: {
    agentId: string;
    agentType: string;
    description: string;
    task: string;
    sessionId: string | null;
  }): SubagentTranscript {
    const existing = this.transcripts.get(input.agentId);
    if (existing) return existing;
    const transcript: SubagentTranscript = {
      ...input,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      openedAt: null,
      events: [],
      tokens: 0,
      toolCalls: 0,
    };
    this.transcripts.set(input.agentId, transcript);
    return transcript;
  }

  append(agentId: string, event: ChatEvent): void {
    const transcript = this.transcripts.get(agentId);
    if (!transcript) return;
    transcript.events.push(event);
    if (event.kind === 'tool-call') transcript.toolCalls += 1;
    if (event.kind === 'turn-end') transcript.tokens = event.usage.totalTokens;
    this.emit(agentId, event, transcript);
  }

  close(agentId: string, ok: boolean): void {
    const transcript = this.transcripts.get(agentId);
    if (!transcript) return;
    transcript.status = ok ? 'done' : 'failed';
    transcript.endedAt = Date.now();
    this.emit(agentId, null, transcript);
  }

  /** A subagent still running when its parent turn closed never completed. */
  orphanRunning(): void {
    for (const transcript of this.transcripts.values()) {
      if (transcript.status !== 'running') continue;
      transcript.status = 'orphaned';
      transcript.endedAt = Date.now();
      this.emit(transcript.agentId, null, transcript);
    }
  }

  get(agentId: string): SubagentTranscript | null {
    return this.transcripts.get(agentId) ?? null;
  }

  all(): SubagentTranscript[] {
    return Array.from(this.transcripts.values()).sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * What the tray shows. A finished subagent keeps its chip until its output
   * has been opened once or the parent turn is closed by the next user send,
   * whichever comes first: the green dot is a completion the user is meant to
   * be able to act on, and a chip that vanishes the instant the turn ends is a
   * result nobody could reach. A failed chip stays until it is clicked.
   */
  active(): SubagentTranscript[] {
    return this.all().filter((t) => {
      if (t.status === 'running') return true;
      if (t.status === 'failed') return t.openedAt === null;
      return t.openedAt === null;
    });
  }

  /** The transcript was opened; its chip has done its job. */
  markOpened(agentId: string): void {
    const transcript = this.transcripts.get(agentId);
    if (!transcript || transcript.openedAt !== null) return;
    transcript.openedAt = Date.now();
    this.emit(agentId, null, transcript);
  }

  /** The next user send closes the parent turn: finished chips leave the tray. */
  retireFinished(): void {
    const now = Date.now();
    for (const transcript of this.transcripts.values()) {
      if (transcript.status !== 'running' && transcript.openedAt === null) {
        transcript.openedAt = now;
      }
    }
  }

  subscribe(agentId: string, listener: Listener): () => void {
    const list = this.listeners.get(agentId) ?? [];
    list.push(listener);
    this.listeners.set(agentId, list);
    return () => {
      const current = this.listeners.get(agentId);
      if (!current) return;
      const i = current.indexOf(listener);
      if (i !== -1) current.splice(i, 1);
    };
  }

  private emit(agentId: string, event: ChatEvent | null, transcript: SubagentTranscript): void {
    for (const listener of (this.listeners.get(agentId) ?? []).slice()) listener(event, transcript);
  }

  clear(): void {
    this.transcripts.clear();
    this.listeners.clear();
  }
}
