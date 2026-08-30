/* Names that cross module boundaries. Nothing here computes. */

export const PLUGIN_ID = 'icor-for-life-chat';

/**
 * The declaration every root this plugin owns carries. The ICOR for Life - INKLINE
 * theme reads it and stands its own element-level
 * control skins down inside the subtree, at ZERO specificity, so the plugin's
 * controls stop having to out-rank the host on every property forever.
 *
 * It is an opt-in, never a substitute: the plugin ships to vaults running other
 * themes, and a control that is only correct under one theme is not correct.
 * Every control rule in styles.css is stated at (0,3,0) whether this attribute
 * is honoured or not, and `test/computed-style.test.mjs` measures that with the
 * attribute absent.
 */
export const INK_PLUGIN_ATTR = 'data-ink-plugin';
export const INK_PLUGIN_NAME = 'icor-for-life-chat';
/* The view types moved into the new namespace WITH the plugin id, and the
 * choice was deliberate rather than mechanical: registerView throws on a type
 * another plugin already claimed, so keeping the old strings would make this
 * plugin fail to load in any vault where the retired predecessor build is still
 * enabled - which includes the vaults it was developed in. The public reset
 * means there are no third-party workspaces to migrate, so the rename costs a
 * stale workspace.json leaf a one-time empty pane and prevents a load failure. */
export const VIEW_TYPE_CHAT = 'icor-for-life-chat-view';
export const VIEW_TYPE_SUBAGENT = 'icor-for-life-chat-subagent-view';

/** The SDK version this build is compiled and tested against. Pre-1.0: pinned exactly. */
export const SDK_VERSION = '0.3.226';

/** Vault-relative archive roots. Scaffold mode nests under the AI Team room. */
export const ARCHIVE_FOLDER_SCAFFOLD = '06 AI Team/AI Sessions';
export const ARCHIVE_FOLDER_STANDALONE = 'AI Sessions';

/** The one prompt the plugin owns. Opt-in, fixed, never user-editable. */
export const STRUCTURED_REPLY_PROMPT = [
  'When you answer, use the ICOR card format.',
  '',
  'Open with at most two lines of plain prose. Then one card per specialist or',
  'topic. A card starts with a header line, alone on its line, in exactly this',
  'shape: `NAME · scope · STATUS`, where STATUS is one of COMPLETE, PARTIAL,',
  'BLOCKED or IN FLIGHT and nothing else.',
  '',
  'Under the header come blocks, each introduced by its own kicker word alone on',
  'its line, in this order: ASKED, ANSWER, then any number groups or finding',
  'rows, then INSIGHT, then NOT COVERED, then NEXT. A group of rows may be',
  'introduced by its own short all-caps sub-head.',
  '',
  'Every row goes on its own line, never inside a paragraph, written as',
  '`<disposition> <label> :: <value>`, where disposition is one of 🟢 handled ·',
  '🟡 real and someone owns it · 🔴 nobody owns it, you act · ⚪ noted or',
  'dismissed. The disposition answers "does this need me", never "how bad is',
  'this". Never invent a number to fill a row: no measurement means no row.',
  'INSIGHT is exactly one line and appears at most once per card.',
  '',
  'End with FILES (bare absolute paths, one per line), LINKS (bare https URLs,',
  'one per line), and then any decisions, each in this shape:',
  '`DECISION <code> · <short title>` followed by the question and your',
  'recommendation in at most three lines. A code is EXACTLY five lowercase',
  'alphanumeric characters, like `a1b2c` or `4a3fk` - never four, never six. It',
  'is unique within the conversation and stays the same whenever that decision',
  'is surfaced again. A blocker only the user can clear uses `BLOCKED <code> ·',
  '<title>`; a gate already cleared uses `CLEARED <code> · <title>`.',
  '',
  'If a reply carries no result, answer in plain prose and use no card at all.',
].join('\n');
