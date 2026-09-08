/* THE THREE FACTS ABOUT CLAUDE CODE THAT MUST EXIST WITHOUT REQUIRING THE
 * REST OF THIS FOLDER. `registry.ts` shows an id, a display name and an
 * install line for every runtime the build carries even on a platform where
 * the runtime itself can never launch (Obsidian mobile: no Node runtime, so
 * no child process, so no Claude Code). This file has NO import - not
 * `node:fs`, not the Agent SDK, not even `./index` - so importing it can
 * never be the thing that crashes plugin load on mobile. `index.ts` reads the
 * same three constants, so there is exactly one source for each.
 */

import type { RuntimeInstall } from '../types';

export const CLAUDE_ID = 'claude' as const;
export const CLAUDE_DISPLAY_NAME = 'Claude Code';
export const CLAUDE_INSTALLATION: RuntimeInstall = {
  command: 'curl -fsSL https://claude.ai/install.sh | bash',
  page: 'https://code.claude.com/docs/en/setup',
};
