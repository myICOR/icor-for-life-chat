/* THE TWO REPLY ACTIONS THE WIP ROOM ADDS (R1, R5).
 *
 * Both plug into the reply action bar through its registry, so the bar
 * never knows the WiP room exists: `main.ts` registers them at load and the
 * bar lists whatever is registered. That is the seam that keeps a later room
 * (a journal entry, a decision record) a registration and not a rewrite. */

import { Notice } from 'obsidian';
import type { ReplyAction, ReplyActionContext } from '../view/actions';
import { startDeliverable } from './deliverable';
import { captureTask } from './task';
import { titleFromReply } from './naming';
import { hasTasksRoom, hasWipRoom } from '../view/context';

/** Start a `03 WiP` folder from the reply, pin it as context, open the brief. */
export function startDeliverableAction(): ReplyAction {
  return {
    id: 'wip-start-deliverable',
    icon: 'briefcase',
    label: 'Start a deliverable',
    section: 'more',
    when: (ctx: ReplyActionContext) => hasWipRoom(ctx.app) && ctx.text.trim().length > 0,
    run: async (ctx: ReplyActionContext) => {
      const title = titleFromReply(ctx.text);
      const made = await startDeliverable(ctx.app, title, ctx.text, ctx.view.sessionIdsHeld());
      ctx.view.addPick({ kind: 'wip', path: made.folder });
      await ctx.plugin.openPath(made.briefPath);
      new Notice(`Started ${made.folder}`);
    },
  };
}

/** Write the reply into an open task file. */
export function captureTaskAction(): ReplyAction {
  return {
    id: 'wip-capture-task',
    icon: 'list-checks',
    label: 'Capture as task',
    section: 'more',
    when: (ctx: ReplyActionContext) => hasTasksRoom(ctx.app) && ctx.text.trim().length > 0,
    run: async (ctx: ReplyActionContext) => {
      const title = titleFromReply(ctx.text);
      const made = await captureTask(ctx.app, title, ctx.text);
      new Notice(`Captured ${made.id}`);
      await ctx.plugin.openPath(made.path);
    },
  };
}
