/* Mapping the SDK's own `apiKeySource` (carried on the system/init message,
 * `@anthropic-ai/claude-agent-sdk`'s `ApiKeySource` union - `'user' | 'project'
 * | 'org' | 'temporary' | 'oauth'`) onto the plugin's neutral `AuthSource`.
 *
 * Deliberately takes `unknown` rather than the SDK's own type: this file
 * reads one raw string off a wire message before it is trusted, and an
 * orchestrated environment has been measured (2026-09-06, this build) sending
 * a value the SDK's own union does not name (`"none"`). Anything outside the
 * five documented values reads as `'unknown'`, never as a guess in either
 * direction - the same rule `Detection.signedIn` already keeps. */

import type { AuthSource } from '../types';

const API_KEY_VALUES = new Set(['user', 'project', 'org', 'temporary']);

export function authSourceFromApiKeySource(raw: unknown): AuthSource {
  if (raw === 'oauth') return 'subscription';
  if (typeof raw === 'string' && API_KEY_VALUES.has(raw)) return 'api-key';
  return 'unknown';
}
