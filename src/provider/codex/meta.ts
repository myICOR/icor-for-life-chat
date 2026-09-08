/* Codex's own no-import counterpart to `../claude/meta.ts`. See that file's
 * header - the reason is identical, one folder over. */

import type { RuntimeInstall } from '../types';

export const CODEX_ID = 'codex' as const;
export const CODEX_DISPLAY_NAME = 'Codex';
export const CODEX_INSTALLATION: RuntimeInstall = {
  command: 'npm install -g @openai/codex',
  page: 'https://developers.openai.com/codex/cli',
};
