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

/** Where conversations are archived when the settings name no folder. */
export const ARCHIVE_FOLDER_DEFAULT = 'AI Sessions';
/** Where 0.16 and older archived them in an ICOR for Life vault; kept while the folder exists. */
export const ARCHIVE_FOLDER_LEGACY = '06 AI Team/AI Sessions';
