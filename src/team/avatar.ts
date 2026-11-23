/* Which picture an agent gets in the team strip, as a vault path or null.
 *
 * Pure: the caller says which vault paths exist, so the choice is asserted in
 * node without an Obsidian vault. The order is the rule: the agent's own
 * `avatar.png` first, then the shared Avatars folder under the agent's slug,
 * then the picture the agent ships under its slug in its own folder (the
 * myPKA 7.0.1 agents, where the Avatars copy may be absent). */

export function pickAvatar(
  agentFolder: string,
  slug: string,
  avatarsFolder: string,
  exists: (path: string) => boolean,
): string | null {
  const candidates = [
    `${agentFolder}/avatar.png`,
    `${avatarsFolder}/${slug}.png`,
    `${agentFolder}/${slug}.png`,
  ];
  return candidates.find((path) => exists(path)) ?? null;
}
