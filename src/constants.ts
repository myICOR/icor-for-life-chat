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

/* THE RENAME STOPPED HERE, and stopping was the decision.
 *
 * `PLUGIN_ID` and `INK_PLUGIN_NAME` moved with the plugin's name because they
 * are its IDENTITY and `test/manifest.test.mjs` ties all three to one string.
 * The four below did not, because they are not names - they are keys other
 * files are already written under:
 *
 *   - The view types are stored in the user's `workspace.json`. Changing one
 *     leaves every saved layout pointing at a view type that no longer exists,
 *     so a rename would silently close the user's open chat tabs.
 *   - `ARCHIVE_SCHEMA` and the `source: icor-chat` frontmatter marker are
 *     written into every session note already on disk, and `resumableSessionId`
 *     reads that exact marker back. Changing it would make every conversation
 *     the user has ever archived unresumable, with nothing on screen to say so.
 *
 * A display name is free to change; a key that something has already been
 * written under is not. If these ever do need to move it is a migration, not a
 * find-and-replace. */
export const VIEW_TYPE_CHAT = 'icor-chat-view';
export const VIEW_TYPE_SUBAGENT = 'icor-chat-subagent-view';

/** The SDK version this build is compiled and tested against. Pre-1.0: pinned exactly. */
export const SDK_VERSION = '0.3.226';

/** Vault-relative archive roots. Scaffold mode nests under the AI Team room. */
export const ARCHIVE_FOLDER_SCAFFOLD = '06 AI Team/AI Sessions';
export const ARCHIVE_FOLDER_STANDALONE = 'AI Sessions';

/** The one prompt the plugin owns. Opt-in, fixed, never user-editable. */
export const STRUCTURED_REPLY_PROMPT = [
  'When you answer, use the ICOR card format.',
  '',
  /* THE ONE INSTRUCTION THAT IS ABOUT THIS SURFACE RATHER THAN THE FORMAT.
   *
   * The card format was designed for a terminal, where the model wraps its own
   * lines to a fixed column because nothing else will. This is not a terminal:
   * it is a resizable pane that wraps text itself, and a hard-wrapped reply
   * arrives here as a row followed by the leftovers of its own value. That is
   * exactly what the user saw - "duplicate fact :: the 2026-07-27 video is",
   * and then "told twice, line 53 and line 57" adrift below the group as loose
   * prose. The parser was not losing the text; the model had already broken it
   * into pieces that are not rows.
   *
   * So this is stated first, loudly, and it has to override a habit the model
   * brings with it from the vault's own terminal-format rules. */
  'You are writing into a resizable panel, not a terminal. Never wrap a line to',
  'a column width, never pad or align with spaces, and never break a row across',
  'two lines. There is no character limit on any line. One row is exactly one',
  'line, however long it is; the panel does the wrapping. If a rule you know',
  'gives a fixed column width or tells you to wrap, it does not apply here.',
  'The limits below on how MANY lines a block may have are editorial and still',
  'hold; what does not hold is any limit on how long a line may be.',
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
  'Every row goes on ONE line of its own, never wrapped and never inside a',
  'paragraph, written as',
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
