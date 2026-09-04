/* Who did the work in this conversation, as a share. Pure: no Obsidian import,
 * so the attribution rule is assertable without a vault.
 *
 * THE BASIS IS ACTIVITY, and it is named as such wherever the number appears.
 * Activity is tool calls plus finished text blocks, because those are the two
 * things the transport actually reports per participant. Tokens would be the
 * better basis and are NOT available: the SDK's usage record is per turn for
 * the main loop only, a subagent's `result` frame never reaches the plugin, and
 * a percentage built on a number nobody measured is the substitution defect
 * this plugin already refused once for the statusline.
 *
 * The main thread is Larry when the roster has a Larry. That is the scaffold's
 * own rule (AGENTS.md: "you are Larry, the team orchestrator"), not a guess by
 * this file. Without a roster, or with a roster that has no Larry, the main
 * thread is `Team` and marked unmatched so the renderer can draw an initial
 * rather than pretend to know a face. */

export interface RosterRef {
  name: string;
  slug: string;
}

export interface SubagentActivity {
  /** The `subagent_type` the spawn carried, e.g. `pax` or `general-purpose`. */
  agentType: string;
  toolCalls: number;
  textBlocks: number;
  durationMs: number;
  status: string;
}

export interface ShareInput {
  main: { toolCalls: number; textBlocks: number };
  subagents: SubagentActivity[];
  roster: RosterRef[] | null;
}

export interface AgentShare {
  name: string;
  slug: string;
  /** 0..1, never rounded here. The renderer rounds to whole percents. */
  share: number;
  activity: number;
  toolCalls: number;
  durationMs: number;
  /** True when a roster entry was found for this participant. */
  matched: boolean;
}

export const MAIN_UNMATCHED_NAME = 'Team';

/** The roster entry a raw agent type names, by slug or by name, case-insensitively. */
export function matchRoster(agentType: string, roster: RosterRef[] | null): RosterRef | null {
  if (!roster) return null;
  const needle = agentType.trim().toLowerCase();
  if (!needle) return null;
  return roster.find((r) => r.slug === needle || r.name.toLowerCase() === needle) ?? null;
}

interface Bucket {
  name: string;
  slug: string;
  activity: number;
  toolCalls: number;
  durationMs: number;
  matched: boolean;
}

export function agentShares(input: ShareInput): AgentShare[] {
  const buckets = new Map<string, Bucket>();
  const add = (key: string, seed: Omit<Bucket, 'activity' | 'toolCalls' | 'durationMs'>, activity: number, toolCalls: number, durationMs: number): void => {
    const existing = buckets.get(key);
    if (existing) {
      existing.activity += activity;
      existing.toolCalls += toolCalls;
      existing.durationMs += durationMs;
      return;
    }
    buckets.set(key, { ...seed, activity, toolCalls, durationMs });
  };

  const larry = matchRoster('larry', input.roster);
  const mainActivity = input.main.toolCalls + input.main.textBlocks;
  if (mainActivity > 0) {
    if (larry) add(larry.slug, { name: larry.name, slug: larry.slug, matched: true }, mainActivity, input.main.toolCalls, 0);
    else add('team', { name: MAIN_UNMATCHED_NAME, slug: 'team', matched: false }, mainActivity, input.main.toolCalls, 0);
  }

  for (const sub of input.subagents) {
    const activity = sub.toolCalls + sub.textBlocks;
    if (activity <= 0) continue;
    const hit = matchRoster(sub.agentType, input.roster);
    const raw = sub.agentType.trim() || 'agent';
    const key = hit ? hit.slug : raw.toLowerCase();
    add(
      key,
      hit ? { name: hit.name, slug: hit.slug, matched: true } : { name: raw, slug: raw.toLowerCase(), matched: false },
      activity,
      sub.toolCalls,
      Math.max(0, sub.durationMs),
    );
  }

  const total = Array.from(buckets.values()).reduce((sum, b) => sum + b.activity, 0);
  if (total <= 0) return [];
  return Array.from(buckets.values())
    .map((b) => ({ ...b, share: b.activity / total }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}
