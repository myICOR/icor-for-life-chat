/* THE ENGINE-STATUS LINE. `chat-mobile-engine-spec-v1.md` section 4: "one
 * line in Settings and in the chat header" for the desktop auth truth, and
 * section 3's own-key engine needs the same real estate to say which
 * provider and model a conversation is actually running on, now that the
 * composer hides its runtime chip for that engine (`Composer.ts`'s
 * `hideRuntimeControls`).
 *
 * Deliberately a single line of plain text, not a control: every actionable
 * thing this line could ask for (install Claude Code, sign in, paste a key)
 * already has its own row in Settings. This is the fact, always visible,
 * never a placeholder - see `pane.ts` for why it is a root-level sibling
 * outside the four-rung census rather than a fact in the Statusline strip
 * (it is a standing POLICY statement, not a measured number, and the eight
 * readout switches are for the latter only). */

export function renderEngineStatus(el: HTMLElement, text: string | null): void {
  el.toggleClass('is-empty', !text);
  el.setText(text ?? '');
}
