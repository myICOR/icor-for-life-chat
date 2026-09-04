/* The team strip: who did the work, with their faces.
 *
 * One entry per participant, sorted by share. The face is the agent's own
 * avatar when the roster has one, and the initial in a hairline circle when
 * it does not - the same treatment the AI Team dashboard gives an agent
 * without a portrait, so an unmatched `general-purpose` subagent and a
 * portrait-less roster agent read the same way rather than one of them
 * borrowing a face.
 *
 * The percentage is the ONLY number on the strip and it names its basis in
 * the tooltip every time: a share of activity, tool calls and messages. Not
 * tokens, because tokens per subagent are not measured, and a strip that
 * said "42%" with nothing behind the word would be the statusline's old
 * substitution defect on a new surface. */

import { setTooltip } from 'obsidian';
import type { AgentShare } from '../team/usage';
import type { TeamAgent } from '../team/detect';
import { shortDuration } from '../model/format';

export const SHARE_BASIS = 'share of activity this session (tool calls and messages)';

/**
 * A face for a participant. `<img>` when there is a portrait, the initial
 * when there is not. Shared with the insights view so both surfaces draw an
 * agent the same way.
 */
export function renderAvatar(
  parent: HTMLElement,
  name: string,
  avatarPath: string | null,
  resolve: (path: string) => string,
  cls = '',
): HTMLElement {
  const face = parent.createSpan({ cls: `aic-avatar ${cls}`.trim() });
  if (avatarPath) {
    const img = face.createEl('img', { cls: 'aic-avatar-img' });
    img.src = resolve(avatarPath);
    img.alt = '';
    face.addClass('has-image');
    return face;
  }
  face.createSpan({ cls: 'aic-avatar-initial', text: (name.trim().charAt(0) || '?').toUpperCase() });
  return face;
}

export function renderTeamStrip(
  el: HTMLElement,
  shares: readonly AgentShare[],
  roster: readonly TeamAgent[] | null,
  resolve: (path: string) => string,
  onOpen: (share: AgentShare) => void,
): void {
  el.empty();
  el.toggleClass('is-empty', shares.length === 0);
  if (shares.length === 0) return;
  el.setAttr('role', 'list');
  el.setAttr('aria-label', 'Who did the work in this conversation');
  for (const share of shares) {
    const agent = roster?.find((a) => a.slug === share.slug) ?? null;
    const pct = Math.round(share.share * 100);
    const entry = el.createEl('button', { cls: 'aic-team-entry', type: 'button' });
    entry.setAttr('role', 'listitem');
    entry.toggleClass('is-unmatched', !share.matched);
    renderAvatar(entry, share.name, agent?.avatarPath ?? null, resolve, 'aic-team-face');
    entry.createSpan({ cls: 'aic-team-name', text: share.name });
    entry.createSpan({ cls: 'aic-team-pct', text: `${pct}%` });
    const facts = [`${share.name}`, `${share.toolCalls} tool call${share.toolCalls === 1 ? '' : 's'}`];
    if (share.durationMs > 0) facts.push(shortDuration(share.durationMs));
    const tip = `${facts.join(' · ')} · ${SHARE_BASIS}`;
    setTooltip(entry, tip);
    entry.setAttr(
      'aria-label',
      `${share.name}, ${pct} percent, ${facts.slice(1).join(', ')}. ${agent?.bioPath ? 'Open the bio' : 'Open the transcript'}.`,
    );
    entry.addEventListener('click', () => onOpen(share));
  }
}
