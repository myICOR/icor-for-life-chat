/* THE REPLY ACTION REGISTRY, the contract stream G2 builds the action bar on.
 *
 * STUB (stream G1). G2 ships the bar and the real registry with exactly this
 * shape; the integrator keeps G2's file. It exists here so the WiP room's two
 * actions compile and register against the contract they were written for. */

import type { App } from 'obsidian';
import type IcorChatPlugin from '../main';
import type { ChatView } from './ChatView';

export interface ReplyActionContext {
  app: App;
  plugin: IcorChatPlugin;
  view: ChatView;
  blockId: string;
  /** The reply's markdown source, as the model wrote it. */
  text: string;
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
