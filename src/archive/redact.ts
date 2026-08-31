/* What the archive is allowed to keep. No Obsidian import, on purpose: the rule
 * is a pure function over events, so it is assertable without a vault.

 *
 * A user turn now carries the images it was sent with, because the stream has
 * to draw them. The archive must not: a single pasted screenshot is up to 5 MB
 * raw, which is about 6.8 MB once base64 has inflated it by a third, written
 * into a JSON file inside the user's vault and re-written after every turn of
 * the conversation. That is a note the vault cannot open and a sync the user
 * did not ask for. The name and the type survive, so the record still says a
 * picture was sent and what it was called.
 *
 * Stripping happens HERE rather than at the call site on purpose. A caller that
 * has to remember to sanitise is a caller that will one day forget, and the
 * forgetting is silent - it looks like a slightly larger file.
 */
import type { ChatEvent } from '../model/types';

export function withoutImageBytes(events: readonly ChatEvent[]): ChatEvent[] {
  return events.map((event) => {
    if (event.kind !== 'user-turn' || event.images.length === 0) return event;
    return { ...event, images: event.images.map((i) => ({ ...i, data: '' })) };
  });
}
