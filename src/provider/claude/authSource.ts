/* THE DESKTOP AUTH TRUTH. `chat-mobile-engine-spec-v1.md` section 4: "code
 * reads what Claude Code reports and shows it." The CLI's `system`/`init`
 * message carries `apiKeySource: 'user' | 'project' | 'org' | 'temporary' |
 * 'oauth'` (checked against the installed SDK's own `sdk.d.ts`, 2026-09-06).
 * `'oauth'` is the member's Claude subscription; every other value is some
 * form of API key. This file is the one-line translation into the plugin's
 * own words - never the SDK's `ApiKeySource` type itself, which stays inside
 * this folder per the hygiene gate. */

export type AuthSource = 'subscription' | 'api-key' | 'unknown';

/** `raw` is `unknown` on purpose: it comes off a raw wire message before any
 * SDK type has been trusted. A value the SDK has not documented (a future
 * `apiKeySource` this build predates) reports 'unknown' rather than being
 * guessed into one bucket or the other. */
export function mapAuthSource(raw: unknown): AuthSource {
  if (raw === 'oauth') return 'subscription';
  if (typeof raw === 'string' && raw.length > 0) return 'api-key';
  return 'unknown';
}
