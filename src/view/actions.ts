/* THE REPLY ACTION REGISTRY, minimal shape.
 *
 * Stream G2 owns the full action bar and this file's final form; this is the
 * contract both streams were briefed on, written here so the memory stream
 * compiles on its own. The integrator keeps G2's version. Nothing below
 * renders anything. */

import type { App } from 'obsidian';
import type IcorChatPlugin from '../main';
import type { ChatView } from './ChatView';

export interface ReplyActionContext {
  app: App;
  plugin: IcorChatPlugin;
  view: ChatView;
  blockId: string;
  /** The reply's markdown source, whole. */
  text: string;
  /** The rendered block, so an action can read the user's selection inside it. */
  el: HTMLElement;
}

export interface ReplyAction {
  id: string;
  icon: string;
  label: string;
  section?: 'primary' | 'more';
  when?(ctx: ReplyActionContext): boolean;
  run(ctx: ReplyActionContext): void | Promise<void>;
}

export class ReplyActionRegistry {
  private readonly actions: ReplyAction[] = [];

  register(action: ReplyAction): () => void {
    this.actions.push(action);
    return () => {
      const i = this.actions.indexOf(action);
      if (i !== -1) this.actions.splice(i, 1);
    };
  }

  list(ctx: ReplyActionContext): ReplyAction[] {
    return this.actions.filter((a) => (a.when ? a.when(ctx) : true));
  }
}
