/* The per-agent half of the manifest. Pure, so the record a session is written
 * with can be asserted against recorded events without a vault. */
import type { ChatEvent } from '../model/types';
import type { ArchiveManifest, ManifestAgentRecord } from './naming';
import type { SubagentTranscript } from '../state/subagents';
import { deriveFromEvents } from '../team/insights';

/**
 * The per-agent record for the manifest: counts from the events, duration and
 * status from the bus. The counts come from `deriveFromEvents` rather than from
 * the bus's own tallies so that a 0.5.x folder, read back through the same
 * function, yields the same numbers a 0.6.0 folder was written with.
 */
export function agentRecords(
  events: readonly ChatEvent[],
  subagents: readonly SubagentTranscript[],
  now = Date.now(),
): Pick<ArchiveManifest, 'agents' | 'tools' | 'mainToolCalls' | 'mainTextBlocks'> {
  const derived = deriveFromEvents(events);
  const byType = new Map<string, SubagentTranscript[]>();
  for (const t of subagents) {
    const list = byType.get(t.agentType) ?? [];
    list.push(t);
    byType.set(t.agentType, list);
  }
  /* Overlay in spawn order per type: the derived list and the bus list are
     both in first-seen order, so the n-th derived agent of a type is the n-th
     transcript of that type. */
  const cursor = new Map<string, number>();
  const agents: ManifestAgentRecord[] = derived.agents.map((a) => {
    const list = byType.get(a.agentType) ?? [];
    const i = cursor.get(a.agentType) ?? 0;
    cursor.set(a.agentType, i + 1);
    const t = list[i];
    if (!t) return a;
    return {
      ...a,
      durationMs: Math.max(0, (t.endedAt ?? now) - t.startedAt),
      status: t.status,
    };
  });
  return { agents, tools: derived.tools, mainToolCalls: derived.mainToolCalls, mainTextBlocks: derived.mainTextBlocks };
}
