# Architecture

For a developer joining this repo. Every section names the files that carry the thing, so the doc can be checked against the tree and corrected when they drift. Written at 0.7.1.

## The one sentence

The plugin is a window onto a session provider running with the vault as its working directory. It contributes no system prompt of its own beyond one fixed, visible append: the structured-replies format in `src/constants.ts` (`STRUCTURED_REPLY_PROMPT`), which is on by default and switchable off. Identity, context rules and behaviour live in the vault's own `CLAUDE.md`, `AGENTS.md` and `.claude/`, which the runtime reads from cwd.

## The event spine

`ChatEvent` in `src/model/types.ts` is the only vocabulary the view speaks. It imports nothing from any SDK. Everything else is a stage on one line:

- A provider translates its wire format into `ChatEvent` in exactly one file. For Claude that is `src/provider/claude/normalize.ts`.
- `src/state/store.ts` reduces events into `ChatState` (session id, model, usage, rate limits, subagents).
- `src/view/stream/StreamRenderer.ts` renders events append-mostly: every event appends a node or mutates the one node it names. No diffing, no framework.
- `src/archive/writer.ts` stores the events, the turns and a manifest in the vault.

Three rules hold at every stage. An unknown frame yields no events and never throws. A tool call is read from the completed message, never from a partial stream, so a call whose input arrives in fragments renders once. No number is shown that was not measured: a missing fact is absent, never a zero, a dash or an estimate (`src/view/composer/Statusline.ts` carries the law and `src/model/facts.ts` the facts).

## The Provider seam

`src/provider/types.ts` declares the seam: `Provider` (detect, models, defaultModel, open, store), `ProviderSession` (start, send, interrupt, answerApproval, setPermissionMode, setModel, supportedModels, dispose, drain) and `SessionStore` (list, createdAt, exists, read, optional fork, rename, delete). `SessionConfig` and `SessionHooks` are the two shapes a session is opened with. `ReplayEntry` is how a stored conversation comes back: already translated into `ChatEvent`, so the view never learns a wire format even on replay.

`src/provider/registry.ts` is the only door. It maps every `ProviderId` (`claude`, `codex`, `acp`) to an implementation or to `null`, which means "not in this build" rather than "unknown id". `providerFor(id)` falls back to Claude.

`src/provider/claude/` is the reference implementation: `index.ts` (detection through `src/provider/cli.ts`, the PATH resolver that is provider-neutral), `session.ts` (one `query()` in streaming-input mode for the life of the tab), `normalize.ts`, `store.ts` (the SDK's own session list, scoped to the vault directory), `launch.ts` and `permissions.ts` (mode plumbing and the approval broker), `renderer-compat.ts` (the one host shim, installed through `Provider.install`). `src/provider/tooling.ts` holds the provider-neutral tool vocabulary: `toolPurpose`, `fallbackPurpose`, `resultOutput`, `relativeTo`.

Three hygiene gates in `test/hygiene.test.mjs` keep the seam a seam: the Agent SDK is imported under `src/provider/claude/` and nowhere else; `src/view/`, `src/state/`, `src/model/` and `src/main.ts` import nothing from `src/provider/claude/`; the registry answers every declared id.

A new provider implements the whole `ProviderSession`, a `detect` that reports what it found or `found: false` with a hint, and `models` from the runtime's own catalogue or an empty list. It may leave `store` null (a protocol with no session list), `signedIn` null (a runtime that cannot say without a session), `fork`, `rename` and `delete` absent, and `messageId` absent on replay entries (edit and resend then forks whole).

Before a provider is listed in the picker it passes the conformance list: one recorded wire fixture replayed through its normaliser renders one assistant turn as one node; an approval round-trips and a denied tool never runs; an interrupt leaves no orphaned process and no hung promise; a resume replays history above the seam; an unknown frame yields zero events; a refused mode switch is surfaced in the provider's words; the not-found detection path is exercised against a bare PATH. Structured replies ship on by default for a model only when its measured parse rate on a fixed prompt set is 90 percent or better.

Two implementations are planned on this seam: Codex through OpenAI's App Server protocol, in progress, and one generic Agent Client Protocol client that carries a launch recipe per agent, next. Neither is described here until its code exists.

## Context

`ContextRef` in `src/model/context.ts` names what the user attached: `kind` is one of `active`, `note`, `folder`, `tag`, `property`, `wip`, `tasks`, `linked`; `id` is stable per thing; `paths` are the vault-relative notes it resolved to. `ATTACH_CAP` (12) bounds how many notes travel as attachments across all refs of one message.

`src/view/context.ts` lists and resolves against the metadata cache only: `listFolders`, `listTags`, `listProperties`, `listWipFolders`, `listOpenTasks`, `linkedFromNote`, `linksToNote`, and the matching `resolveFolder`, `resolveTag`, `resolveProperty`, `resolveWip`, `resolveTasks`, `resolveWikilink`. A group ref re-resolves at send time, so a note created meanwhile is included.

`src/model/contextText.ts` builds the preamble: the open note and selection first, then one block per ref with the first `ATTACH_CAP` notes as quoted `@"path"` references (the runtime attaches those; a bare path with a space in it is not parsed, measured against the real CLI and recorded at the head of `src/view/composer/mention.ts`) and the rest as bare paths to read on demand.

Rendering: the tray above the composer (`Composer.renderTray`, a group chip carries its count), the chips on the sent turn (`StreamRenderer.appendUserWell` from `user-turn.contexts`), and the group modal `src/view/ContextModal.ts` listing every note in a group with a search field. `ChatView` owns the list of refs per message (`addPick`, `resolvePick`, `refreshRef`, `removeRef`) and clears it on send.

To add a kind, touch five places: the `ContextKind` union and its pick shape in `src/model/context.ts`; a list function and a resolve function in `src/view/context.ts`; a menu view or row in the `+` menu of `src/view/composer/Composer.ts` plus its entry in `ContextSources`; `resolvePick` and `chipFor` in `src/view/ChatView.ts`; and the icon in `contextIcon` (`src/view/ContextModal.ts`) and `CONTEXT_ICON` (`src/view/stream/StreamRenderer.ts`).

## The reply action registry

`src/view/actions.ts` declares `ReplyAction` (id, icon, label, optional section `primary` or `more`, optional `when`, `run`) and `ReplyActionContext` (app, plugin, view, blockId, text, el, role, key). `ReplyActionRegistry` registers by id (replacing on the same id), lists the actions whose `when` passes, and `bindActions` binds them to one block. The instance is `plugin.replyActions` in `src/main.ts`.

The built-ins are registered by `ChatView.registerBuiltInActions`: copy, insert at cursor, save as note, edit and resend (forks through `store.fork` up to the message before the edited turn when the store carries message ids), regenerate. The rooms register theirs from `main.ts` `onload`: `src/wip/actions.ts` (start a deliverable, capture as task) and `src/team/memory.ts` (remember this).

The bar is drawn by `StreamRenderer` from `StreamCallbacks.actionsFor(target)`, which the view answers with the bound list. Primary actions are icon buttons; `more` waits behind an ellipsis that opens an Obsidian `Menu`. A future stream adds an action by calling `plugin.replyActions.register(...)` from anywhere; the renderer is never touched.

## The AI team layer

`src/team/detect.ts` finds `06 AI Team/Agents` and builds the roster: one agent per subfolder holding `AGENT.md`, with role, bio path and avatar (`<folder>/avatar.png`, then `AI Team Knowledge/Avatars/<slug>.png`). Detection re-runs on vault changes under `06 AI Team/`.

`src/team/usage.ts` computes shares for the strip (`src/view/TeamStrip.ts`, mounted by `src/view/pane.ts` between the chip tray and the composer). The units are honest: activity is tool calls plus messages where the runtime forwards them; every agent that ran is listed; an agent with nothing measured reads `RAN` instead of a percentage. The main thread is attributed to Larry when the roster has one, else `Team`. Subagent token counts are not published by the SDK and are never shown.

`src/team/setup.ts` writes the eight starter agents into a bare vault from `src/team/bundle.ts`, a generated file. `tools/embed-team.mjs` reads the public ICOR for Life Scaffold repo (`ICOR_SCAFFOLD_DIR`) and the 256px avatars, and fails loudly on a missing file. `npm run embed:team` regenerates it.

`src/team/load.ts` reads every archive folder under the archive root and the vault counts (roster, session logs, tasks); `src/team/insights.ts` aggregates them (`aggregate`: sessions per day, tokens per day, agents by runs, tools, models; `deriveFromEvents` for folders written before the manifest carried agents); `src/view/InsightsRender.ts` draws the page without an `App` so the fixture can mount it; `src/view/InsightsView.ts` is the tab. `src/team/memory.ts` and `src/team/memoryParse.ts` read the last session logs and the agent journals.

The archive manifest (`src/archive/naming.ts`, written by `src/archive/writer.ts`, per-agent records from `src/archive/agents.ts`) carries `agents`, `tools`, `mainToolCalls`, `mainTextBlocks` and `wip`. Schema `icor-chat/session-archive@1` folders are read as Claude; `@2` carries `provider` and `resume.provider`. `isOurManifest` accepts both.

## The composer and its pickers

`src/view/composer/Composer.ts` owns one picker with three sources: `/` (`src/view/composer/slash.ts`, column zero only), `@` and `[[` (`src/view/composer/mention.ts`). The mention and wikilink sources show a preview of the highlighted note above the list, read through `ComposerCallbacks.readPreview`, debounced and sequence-guarded so a stale answer never paints over a newer highlight.

The `+` menu is a popover with views (root, notes, folders, tags, properties, values, WiP folders, open tasks, linked notes). Its lists arrive lazily through `setContextSources`, one function per list, so a tag scan runs only when that view opens. The outside-click guard is a document `mousedown` listener registered in the capture phase: a row answers on mousedown by rebuilding the menu, so a bubbling listener would see a detached target, decide "outside", and close the menu on the click that opened its submenu. That was a live defect and the capture phase is the fix.

Follow-ups: Enter while a turn runs sends the message into the running session and marks the well `QUEUED`; Stop is a separate click-only control. The CLI was measured twice (`src/provider/claude/session.ts` header): under plain text it answers a queued message as its own turn, under a tool loop it answers it inside the running turn. `src/model/followups.ts` therefore treats every turn end as idle and re-arms the busy state on the first signal of a turn the CLI starts on its own.

Pinned prompts: `src/model/pins.ts` (pure), `src/view/PinTray.ts` (rung 0 above the scroller). The first prompt is pinned by the plugin; any well can be pinned from its corner; pins persist in the leaf state through `ChatView.getState` and `setState`.

## The surfaces

`src/view/ChatView.ts` is one tab, one session, one provider for its whole life. `src/view/SubagentView.ts` opens a subagent transcript from `src/state/subagents.ts` in its own tab. `src/view/InsightsView.ts` is the team dashboard. `src/view/leafRoute.ts` decides reveal, reuse or create when a chat is opened.

The empty state (`StreamRenderer.renderEmptyState`) carries blocks: the resume rows, the team block (`renderEmptyTeam`: agent count and the Insights link, or the one-click setup in a bare vault) and the memory block (`renderEmptyMemory`: the last session logs and the task count).

`src/view/pane.ts` builds the pane skeleton once for every caller, view and fixture alike, because the census (pin tray, stream, chip tray, team strip, composer with the statusline as its last child) was once asserted against a replica and the replica passed while the product was wrong.

## Style contract

`styles.css` opens with the token block on `.aic-root, .aic-settings, .aic-menu, .aic-lightbox, .aic-ctx-modal`: every colour rides an `--ink-*` token with a stock Obsidian fallback, six families carry a light and a dark rung, and a raw hex outside that block is a defect. Every root the plugin owns carries `data-ink-plugin="icor-for-life-chat"` (`src/constants.ts`), which the INKLINE theme reads to skin the subtree at zero specificity.

Control rules are stated at `.aic-root.aic-root .aic-*`, (0,3,0), because the host's `button:not(.clickable-icon)` is (0,1,1). The focus pen is stated last at (0,4,0) and carries two declarations and no third. A rule that must outrank the host's input family, (0,5,1), repeats its class four times and states no `outline`, so the pen still wins.

Each stream writes only between its own `/* ==== REGION X ... */` and `/* ==== END REGION X ==== */` markers at the end of the file; nothing else in the stylesheet is touched by a feature branch, which is what lets branches merge without a single CSS conflict.

The gates in `test/hygiene.test.mjs` and `test/computed-style.test.mjs`: no rule declares a property twice, no `:has()`, no partially supported text-decoration longhands, no control under `.aic-root` loses a property to the host theme (both stock rooms and both INKLINE rooms, sentinel colours), no string under the legible text floor in any state, the focus ring reaches every focusable control and changes no geometry, and the reduced-motion override outranks every motion carrier.

## How work is done here

One stream per feature, in its own git worktree cut from `publish`, with file ownership written into the brief and one reserved CSS region. Streams that touch the same file own different methods. Where two streams need one shared contract (the action registry was one), the contract is fixed in both briefs and the integrator keeps one file.

`npm run gate` is the merge condition: typecheck, production build, lint (source and stylesheet), and the tests, including the headless-Chrome sweeps (`test/dom/chrome.mjs`, a Chrome binary on the usual paths or `CHROME_BIN`; the gate never skips). After a merge the integrator runs the gate again and drives one real turn through the installed plugin, reading a screenshot, because a green suite has passed while the pane was wrong.

Release: the version in `manifest.json`, `package.json` and `versions.json`; `git tag <version>`; `git push origin publish:main <tag>`; `gh release create <tag> main.js manifest.json styles.css`. The Obsidian directory reads the release assets.

Sideload into a vault: copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/icor-for-life-chat/`, then `obsidian plugin:disable id=icor-for-life-chat` and `obsidian plugin:enable id=icor-for-life-chat`. The plugin list shows the boot-time version until Obsidian restarts; the new code runs regardless.

The measurement harnesses under `tools/` (`smoke-entry.ts`, `abort-entry.ts`, `frames-entry.ts`, `followup-entry.ts`, `structured-entry.ts`, `subagent-entry.ts`, built by `tools/build-smoke.mjs`) run against the real CLI. A behaviour of the runtime is measured there before the plugin relies on it, and the finding is written as a dated comment at the head of the file that depends on it.

## Extension points

- New provider: a folder under `src/provider/<id>/` with `index.ts`, `session.ts`, `normalize.ts`, `store.ts`; the id in `ProviderId`; the entry in `src/provider/registry.ts`; a recorded fixture under `test/fixtures/` and the conformance tests; a Providers row in `src/settings/definitions.ts`; a README section stating what the provider needs and whose terms govern the data.
- New context kind: the five places in the Context section.
- New reply action: a `ReplyAction` registered on `plugin.replyActions`, from any module. Nothing else.
- New empty-state block: a `render<Block>` method in `StreamRenderer` next to `renderEmptyTeam`, called from `ChatView.onOpen` after the resume rows, mounted in the fixture (`test/dom-entry.ts`).
- New Insights section: an aggregation in `src/team/insights.ts` with a pure test in `test/team.test.mjs`, a section in `src/view/InsightsRender.ts`, data through `src/team/load.ts`.
- New setting: a key in `ChatSettings` and `DEFAULT_SETTINGS` (`src/model/settings.ts`) and exactly one row in `settingDefinitions` (`src/settings/definitions.ts`); the hygiene test fails on a setting without a row or a row without a setting.
- New event kind: the union in `src/model/types.ts`, the reducer in `src/state/store.ts`, a case in `StreamRenderer.apply`, the archive (events are stored as they are), and every provider's normaliser that can produce it. The renderer learns a kind once, never per provider.
- New CSS: a reserved region for the stream, tokens only, the gates above.
