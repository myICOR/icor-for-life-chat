/* Stored events, cut into one replay entry per user turn. Pure, so the
 * archive-backed session store (the ACP runtimes' record) is assertable
 * without a vault. */

import type { ChatEvent } from '../model/types';
import type { ReplayEntry } from '../provider/types';

export function entriesFromEvents(events: readonly ChatEvent[]): ReplayEntry[] {
  const out: ReplayEntry[] = [];
  let current: ReplayEntry | null = null;
  for (const event of events) {
    if (event.kind === 'user-turn') {
      if (current) out.push(current);
      current = { spoken: event.text, events: [], messageId: null };
      continue;
    }
    if (!current) current = { spoken: null, events: [], messageId: null };
    current.events.push(event);
  }
  if (current) out.push(current);
  return out;
}
