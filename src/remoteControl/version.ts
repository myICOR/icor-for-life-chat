/* Comparing Claude Code's own version string, the same way every other
 * version-shaped fact in this plugin is read: parsed once, compared as
 * numbers, never as a string ("2.1.9" must not lose to "2.1.100").
 *
 * `null` in means "not measured" and answers false, never a guess: a launch
 * gated on a version nobody could read is the same false claim the rest of
 * this plugin refuses to make (`Detection.signedIn`, `models()` on an empty
 * catalogue). */

/** The leading `X.Y.Z` out of a string like `2.1.263 (Claude Code)`. */
export function parseVersionTuple(version: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True only when `version` parses AND is `min` or newer. */
export function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const v = parseVersionTuple(version);
  const m = parseVersionTuple(min);
  if (!v || !m) return false;
  const [vMajor, vMinor, vPatch] = v;
  const [mMajor, mMinor, mPatch] = m;
  if (vMajor !== mMajor) return vMajor > mMajor;
  if (vMinor !== mMinor) return vMinor > mMinor;
  return vPatch >= mPatch;
}
