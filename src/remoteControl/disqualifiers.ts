/* Whether the "Continue on your phone" button is offered as enabled, and the
 * plain-word reason when it is not. Three independent checks, each answering
 * on its own: an API-key session, a telemetry env var Remote Control's own
 * traffic depends on, and a Claude Code older than the version Remote
 * Control shipped in. A fact this file cannot measure never disqualifies by
 * itself except where NOT knowing is itself the safe default (the version:
 * see below) - the same absent-is-absent rule the rest of this plugin keeps
 * (`Detection.signedIn`, an empty model catalogue). */

import type { AuthSource } from '../provider/types';
import { versionAtLeast } from './version';

/** Remote Control shipped in the CLI at this version; older builds do not carry the flag. */
export const MIN_CLI_VERSION = '2.1.154';

/**
 * Set by the member (or their shell profile) to turn off some of the CLI's
 * own network traffic. Remote Control rides that traffic, so any one of
 * these, set to anything but empty/`0`/`false`, disqualifies. Order is the
 * order reasons are read back in.
 */
export const TELEMETRY_DISQUALIFYING_VARS = [
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_GROWTHBOOK',
] as const;

export interface EligibilityInput {
  authSource: AuthSource;
  /** The env the launched child would inherit - in practice, `process.env` itself. */
  childEnv: Record<string, string | undefined>;
  /** `claude --version`'s leading number (the plugin's own cached `Detection.version`), or null unmeasured. */
  cliVersion: string | null;
}

export interface Eligibility {
  enabled: boolean;
  /** One plain sentence per disqualifier that applies. Empty when enabled. */
  reasons: string[];
}

function isSet(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

export function remoteControlEligibility(input: EligibilityInput): Eligibility {
  const reasons: string[] = [];

  if (input.authSource === 'api-key') {
    reasons.push('Signed in with an API key: Remote Control needs a claude.ai sign-in.');
  }

  const setVars = TELEMETRY_DISQUALIFYING_VARS.filter((name) => isSet(input.childEnv[name]));
  if (setVars.length > 0) {
    reasons.push(
      `${setVars.join(', ')} ${setVars.length === 1 ? 'is' : 'are'} set, which turns off the traffic Remote Control needs.`,
    );
  }

  /* Unmeasured reads as disqualified, not as passed: a button that can launch
     a Remote Control session on a CLI too old to carry the flag would fail
     silently in the terminal it just opened, and the member would have no
     way to tell the launch from the flag simply doing nothing (the exact
     shape measured in the headless spike this feature followed). */
  if (!input.cliVersion) {
    reasons.push(`Couldn't read your Claude Code version (Remote Control needs ${MIN_CLI_VERSION} or newer).`);
  } else if (!versionAtLeast(input.cliVersion, MIN_CLI_VERSION)) {
    reasons.push(`Claude Code ${input.cliVersion} is older than ${MIN_CLI_VERSION}.`);
  }

  return { enabled: reasons.length === 0, reasons };
}
