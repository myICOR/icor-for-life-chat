/* THE REPLY ACTION REGISTRY: one place every action on a message comes from.
 *
 * A reply used to be a dead end - the words arrived and there was nothing to
 * do with them but read. Copy, insert into the note, save as a note, edit and
 * resend, regenerate: each of those is a small function over the same three
 * facts (which block, its text, the view it sits in), and the bar that shows
 * them has to look identical whether an action was born here or in another
 * stream of work. So the bar is drawn from a list, and the list is a registry
 * the plugin owns: an action registered by the WiP stream or the memory stream
 * appears on every reply without the renderer learning its name.
 *
 * The registry knows no Obsidian: `import type` only, so it bundles into the
 * pure test surface and its rules (replace on same id, `when` filters,
 * unregister returns the list to what it was) are asserted headless. */

import type { App } from 'obsidian';
import type IcorChatPlugin from '../main';
import type { ChatView } from './ChatView';

export interface ReplyActionContext {
  app: App;
  plugin: IcorChatPlugin;
  view: ChatView;
  /** The stream block the action was invoked on. A user well carries its transcript key here. */
  blockId: string;
  /** The block's own markdown: the reply source, or the user's words as typed. */
  text: string;
  el: HTMLElement;
  /* Which side of the conversation the block is. Added to the fixed shape
     because "Regenerate" only makes sense under a reply and "Edit and resend"
     only under the user's own words, and an action that cannot tell them
     apart would have to guess from the element. */
  role: 'assistant' | 'user';
  /** The user well's transcript key, or null on an assistant block. */
  key: string | null;
}

export interface ReplyAction {
  id: string;
  icon: string;
  label: string;
  /** `primary` shows as its own button; `more` waits behind the three dots. Default primary. */
  section?: 'primary' | 'more';
  when?(ctx: ReplyActionContext): boolean;
  run(ctx: ReplyActionContext): void | Promise<void>;
}

export class ReplyActionRegistry {
  private actions: ReplyAction[] = [];

  /**
   * Register, replacing any action that already carries the id. Returns the
   * unregister function, which removes exactly this registration and never
   * a later one that reused the id.
   */
  register(action: ReplyAction): () => void {
    this.actions = this.actions.filter((a) => a.id !== action.id);
    this.actions.push(action);
    return () => {
      this.actions = this.actions.filter((a) => a !== action);
    };
  }

  /** The actions that apply to a context, in registration order. */
  list(ctx: ReplyActionContext): ReplyAction[] {
    return this.actions.filter((a) => (a.when ? a.when(ctx) : true));
  }

  /** Every registered action, unfiltered. Tests and the settings tab. */
  all(): ReplyAction[] {
    return [...this.actions];
  }
}

/** One action, already bound to its context: what the renderer draws. */
export interface BoundAction {
  id: string;
  icon: string;
  label: string;
  section: 'primary' | 'more';
  run: () => void | Promise<void>;
}

/** Bind a registry's applicable actions to one context. */
export function bindActions(registry: ReplyActionRegistry, ctx: ReplyActionContext): BoundAction[] {
  return registry.list(ctx).map((a) => ({
    id: a.id,
    icon: a.icon,
    label: a.label,
    section: a.section ?? 'primary',
    run: () => a.run(ctx),
  }));
}
