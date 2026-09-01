# Provenance

Where the code in this repository came from, how it was made, and what was
checked before the repository was published.

This document exists because "we wrote it ourselves" is an assertion, and an
assertion is worth very little. What follows is the record that makes the claim
checkable: the origin of every tracked file, the first-party interfaces this
plugin delegates to instead of implementing, the verification that was run
before publication, and an honest account of what this record does and does not
prove.

**Every check in this document is a check on content.** It is run against the
files in this repository, the published typings of a pinned dependency, and the
shipped build. None of it asks a reader to trust our git history, and section 7
says why that is deliberate. The document ships inside the release it describes,
version 0.1.0, so the tree it is committed in is the tree it is about. Compiled
2026-08-30.

---

## 1. The short claim

**ICOR for Life - AI Chat is an independent implementation, written from a behavioural
specification. No code in this repository is inherited from any other
repository.**

That is the whole claim. It is a claim about what is in these files, and
everything below is the evidence for it.

## 2. How the work was ordered

The plugin was specified before it was written.

A behavioural specification was authored first: what the product does, observed
as a user. Screens, states, interactions, what survives a restart, what happens
on failure, what the keyboard does. The specification names no file, no module,
no class, no function signature, and no type. It is a description of behaviour,
and behaviour is a fact about a product, not an expression of one.

The implementation was then designed from that specification. Architecture,
module decomposition, naming, data shapes and test structure were chosen for
this codebase, against the constraints of the Obsidian API and the Claude Agent
SDK, and are recorded in section 4.

**That ordering is an account of how the work went, and this document does not
ask anyone to take it as proof of anything.** It is stated because it is true
and because it explains the shape of what follows. The claim in section 1 does
not rest on it. It rests on the content of the files, which is measurable, and
which sections 3 through 6 measure.

**The published history of this repository begins at the initial public
release.** Earlier development history is not published. Section 7 states what
that costs and why nothing in this document depends on it.

## 3. What is deliberately not written here

The largest single contribution to independence is the code that does not
exist. Before any subsystem was assigned, the feature list was swept against the
first-party interfaces available at the time, and every subsystem a published
interface already covered was deleted rather than reimplemented.

This matters twice. It removes whole categories of code from the surface where
resemblance to any other implementation could arise, and it supplies a
documented, dated, third-party-verifiable origin for the design of what remains:
the published typings, at a pinned version, which anyone can read.

**Pinned dependency: `@anthropic-ai/claude-agent-sdk@0.3.226`, exactly, no
range.** The package is pre-1.0, so a floating range could move an adopted
symbol underneath an adoption.

Subsystems deleted because the Agent SDK covers them, with the symbol names:

| Category not implemented here | First-party symbols relied on |
|---|---|
| Conversation list, history store, per-conversation metadata | `listSessions`, `getSessionInfo`, `getSessionMessages`, `SDKSessionInfo` |
| Session persistence and store abstraction | `SessionStore`, `InMemorySessionStore`, `importSessionToStore` |
| Rename, delete, tag a conversation | `renameSession`, `deleteSession`, `tagSession` |
| Fork a conversation, and rewind to a message | `forkSession` (one call covers both) |
| Subagent transcript discovery and tailing | `listSubagents`, `getSubagentMessages`, `Options.forwardSubagentText` |
| Conversation summary folding | `foldSessionSummary` |
| Warm process pooling | `startup`, `WarmQuery` |
| Settings and permission-mode resolution | `resolveSettings`, `filterEscalatingDefaultMode`, `ResolvedSettings` |
| Usage-limit and overage message detection | `USAGE_LIMIT_ERROR_PREFIXES`, `USAGE_WARNING_PREFIXES`, `USAGE_TRANSITION_PREFIXES`, `ORG_POLICY_LIMIT_PREFIXES` |
| Plan-usage windows | `SDKRateLimitEvent`, `rate_limits_available` |
| Abort semantics | `AbortError`, `Options.abortController` |
| Tool approval loop | `Options.canUseTool`, `Options.hooks`, `HOOK_EVENTS` |
| Exit classification, streaming partials, checkpointing | `EXIT_REASONS`, `Options.includePartialMessages`, `Options.enableFileCheckpointing` |

Subsystems deleted because the Obsidian API covers them: fuzzy matching and
result ranking (`prepareFuzzySearch`, `sortSearchResults`, `renderResults`),
suggestion popovers (`AbstractInputSuggest`, `SuggestModal`), frontmatter
parsing (`parseYaml`, `getFrontMatterInfo`), path normalisation
(`normalizePath`, `FileSystemAdapter`), markdown rendering
(`MarkdownRenderer`), HTML sanitisation (`sanitizeHTMLToDom`), syntax and math
loading (`loadPrism`, `loadMathJax`), menus and modals, link parsing, icons
(`setIcon`), network (`requestUrl`), debouncing, tooltips, and component
lifecycle.

**Every symbol in the table above was confirmed present in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` at 0.3.226 on
2026-08-30.** A reader can install that exact version and confirm the same, and
section 8 gives the command. **This is the strongest check in the document that
does not depend on us at all:** the typings are published by a third party at a
version this repository pins, so a reader who wants to know whether a subsystem
was adopted rather than written can read somebody else's file to find out.

The plugin's own contact with the SDK is deliberately narrow. Exactly two files
import from it, `src/sdk/session.ts` and `src/sdk/sessions.ts`, and between them
they import eleven symbols: `query`, `Query`, `Options`, `SDKUserMessage`,
`AbortError`, `listSessions`, `getSessionInfo`, `getSessionMessages`,
`forkSession`, `renameSession`, `deleteSession`. Nothing else in `src/` touches
the SDK. This is verifiable with one grep.

## 4. What is ours, file by file

70 tracked files. 68 of them carry code, tests, build tooling or the files
the plugin format fixes; the other two are this document and `SECURITY.md`.
5,628 lines of TypeScript under `src/`, 1,373 lines of CSS in `styles.css`,
3,347 lines of test, fixture and build-tool code under `test/` and `tools/`,
151 tests.

Every one of those numbers is a count over the files in this repository, and
section 8 gives the commands that reproduce them.

Origin classes used below:

- **spec** written from the behavioural specification for this repository.
- **sdk** a thin layer over the named first-party symbols in section 3.
- **own design** a component whose design this team authored, expressed here
  from the specification. These were written into this repository, not moved
  into it: no file was copied from anywhere.
- **design system** INKLINE, this project's own design system, authored by this
  team's design lane and consumed here as tokens.
- **harness** build tooling and tests, written for this repository.
- **scaffold** files whose name and shape the Obsidian plugin format fixes.
- **documentation** written for this repository by this team.

| File | Lines | Origin |
|---|---|---|
| `src/main.ts` | 214 | spec |
| `src/constants.ts` | 60 | spec |
| `src/sdk/session.ts` | 268 | sdk |
| `src/sdk/sessions.ts` | 128 | sdk |
| `src/sdk/normalize.ts` | 394 | sdk |
| `src/sdk/permissions.ts` | 89 | sdk |
| `src/sdk/cli.ts` | 183 | sdk |
| `src/sdk/renderer-compat.ts` | 59 | sdk |
| `src/model/types.ts` | 129 | spec |
| `src/model/settings.ts` | 56 | spec |
| `src/model/contextText.ts` | 43 | spec |
| `src/model/facts.ts` | 220 | spec |
| `src/model/format.ts` | 36 | spec |
| `src/state/store.ts` | 109 | spec |
| `src/state/subagents.ts` | 148 | spec |
| `src/view/ChatView.ts` | 646 | spec |
| `src/view/SubagentView.ts` | 189 | spec |
| `src/view/stream/StreamRenderer.ts` | 477 | spec |
| `src/view/composer/Composer.ts` | 229 | spec |
| `src/view/composer/Statusline.ts` | 49 | spec |
| `src/view/composer/DecisionBadge.ts` | 161 | own design |
| `src/view/context.ts` | 50 | spec |
| `src/view/dom.ts` | 46 | spec |
| `src/view/pane.ts` | 96 | spec |
| `src/structured/parser.ts` | 442 | own design |
| `src/structured/render.ts` | 348 | own design |
| `src/structured/decisions.ts` | 93 | own design |
| `src/structured/model.ts` | 80 | own design |
| `src/structured/icons.ts` | 59 | own design |
| `src/structured/rails.ts` | 26 | own design |
| `src/archive/writer.ts` | 238 | own design |
| `src/archive/naming.ts` | 95 | own design |
| `src/settings/SettingsTab.ts` | 168 | spec |
| `styles.css` | 1,373 | design system |
| `test/computed-style.test.mjs` | 1,120 | harness |
| `test/dom-entry.ts` | 266 | harness |
| `test/normalize.test.mjs` | 225 | harness |
| `test/structured.test.mjs` | 216 | harness |
| `test/facts.test.mjs` | 213 | harness |
| `test/lifecycle.test.mjs` | 175 | harness |
| `test/dom/chrome.mjs` | 170 | harness |
| `test/dom/shim.ts` | 125 | harness |
| `test/fixtures/host-theme.css` | 123 | harness |
| `test/fixtures/inkline-tokens.css` | 95 | design system |
| `test/archive.test.mjs` | 90 | harness |
| `test/cli.test.mjs` | 79 | harness |
| `test/replay.test.mjs` | 79 | harness |
| `test/render-rules.test.mjs` | 60 | harness |
| `test/compat.test.mjs` | 49 | harness |
| `test/build.mjs`, `test/entry.ts`, `test/dom/*.html` | 71 | harness |
| `tools/*` (5 files) | 191 | harness |
| `esbuild.config.mjs`, `tsconfig.json`, `manifest.json`, `versions.json`, `.gitignore` | 150 | scaffold |
| `LICENSE`, `README.md`, `THIRD-PARTY-NOTICES.md` | | scaffold |
| `docs/provenance.md`, `SECURITY.md` | | documentation |

**The origin class is the claim; the line count is what makes the row
checkable.** Run `wc -l` on any file in this table and the number is either
there or it is not. A reader who wants to test whether a row is honest should
read the file itself, which is the only thing that can actually settle it, and
which is why the file is here.

The tests are this repository's own. They were written against this
architecture, from the behavioural statements in the specification. A test suite
that exercised a decomposition other than this one would be evidence that the
decomposition came from somewhere else, so this was not treated as optional.
The suite is the most readable single piece of evidence in the repository for
anyone assessing whether the architecture in section 4 is native to this code:
151 tests that only make sense against this decomposition.

## 5. Dependencies

One runtime dependency is bundled into `main.js`:
`@anthropic-ai/claude-agent-sdk@0.3.226`, Anthropic PBC. Build-time only:
`esbuild`, `typescript`, the `obsidian` typings, `@types/node`,
`builtin-modules`. `package.json` declares exactly that and nothing else, which
a reader can confirm in one file.

**No third-party source is vendored into this repository.** There is no
`vendor/`, no `third_party/`, no bundled or checked-in copy of anyone else's
code. Every tracked file is listed in section 4, and the tracked file list is
one command.

The Claude Code CLI itself is **not** bundled. The plugin talks to the copy
already installed on the user's machine, unmodified, and never handles, stores,
or transmits a credential of any kind. Authentication is whatever the local CLI
is already using, through Anthropic's own flow. No authentication method is
removed, disabled, or restricted by this plugin.

Icons are resolved through Obsidian's `setIcon` at runtime. No icon assets are
bundled. See `THIRD-PARTY-NOTICES.md`.

## 6. What was verified before publication

Before this repository was made public, an independence verification was run
over its code. It was mechanical, not editorial, and every step of it is a
content comparison:

- exact path-set intersection,
- git blob hash intersection, to detect byte-identical files,
- identical-line set intersection over all substantive source lines,
- exported-symbol name intersection,
- directory-structure intersection.

It was run by the project's compliance reviewer, not by anyone who wrote the
code, and it was run after the code was frozen for release, so no finding of it
could flow back into the artifact it was measuring.

**The method is stated in full here on purpose.** Every step of it operates on
file content, so anyone can run the same comparison, using nothing but standard
git and shell tools, between this repository and any repository they wish to
compare it against. The result does not depend on our history, our commit
messages, our authorship metadata, or our word. It depends on the bytes, and the
bytes are published.

**Two honest qualifications about what was measured.**

First, the full comparison was run against a tree that differs from the shipped
tree in one string literal and one comment describing it. Nothing else. That
literal is written to a DOM attribute and is never read by the plugin, the
tests, the styles or the host, so it cannot change behaviour or rendered output.
The same reviewer then re-ran the residual scan over the shipped tree and over
both shipped build assets, with the same result.

Second, that earlier tree is not in this repository's published history, so a
reader cannot reproduce that one intermediate step. **What a reader can
reproduce is the comparison itself, over the shipped tree, which is the tree
that matters**, because the shipped tree is what anyone installs and it is what
the claim in section 1 is about.

The result supported the claim in section 1. The report is retained. It is
available in full to Obsidian's reviewers, and to any rightsholder with a
question about this repository, on request through the address in
`SECURITY.md`. It is not published here, because publishing a comparison names
the thing compared against, and this project does not make claims, favourable or
otherwise, about anybody else's work.

Independently of that, the shipped build passed 151 tests and a four-round
quality gate, including a headless-browser gate that mounts the shipped
components under both hosts this plugin renders inside and reads
`getComputedStyle` from real pixels. That gate runs from this repository, on any
machine with a Chrome or Chromium binary, and section 8 gives the command.

## 7. What this record does not prove

An honest provenance document has to say where it is weak, because a reader will
find it anyway and it is better found here.

**This repository's history is one commit, and it is evidence of nothing.** The
published history begins at the initial release. A repository with a single
commit is, from its history alone, indistinguishable from one assembled by any
means whatever, and this document does not pretend otherwise. **No claim made
anywhere above rests on the git history, and none of the checks in section 8
reads it.** That is a deliberate narrowing rather than a repair: an argument
from history would in any case have been an argument a stranger could not
falsify, and the arguments that remain are ones he can.

**What that costs, stated rather than glossed.** An incremental history is weak
evidence that code was built rather than dropped in, and this document no longer
offers even that. A reader who wants that particular comfort will not find it
here and should not pretend to have found it.

**Authorship in git is a team working identity.** Commit authorship here uses
this team's shared working identities at `team@myicor.com` and `tom@myicor.com`.
It is not a record of who held the keyboard for which subsystem. This record
therefore cannot be used to demonstrate that any particular person or process
wrote any particular file. It can only demonstrate what the files are.

**The specification and the internal rulebook were committed to their own
private repository at gate time, not before the first code was written.** They
existed on disk beforehand and their content is what the code follows, but the
strongest form of that evidence, a record predating all code, was not created,
and it cannot be manufactured after the fact. Nothing in this record is
back-dated, and nothing will be.

**This manifest was compiled at gate time**, rather than maintained continuously
as each file landed. It is a measurement of the tree it ships in, taken once,
not a live artifact of the build.

The consequence of all four is the same and it is stated plainly: **the
independence claim in section 1 rests on the measured properties of the code,
and on nothing else.** That is a narrow position and it is deliberately narrow.
It is also the only kind of position a reader can actually test, since the code
is the thing he can check, and it is the thing that matters, because the
question anyone would ask is what is in this repository, not who typed it or in
what order.

## 8. How to check this yourself

Nothing here needs to be taken on trust. From a clone of this repository, every
command below reads content, and none of them reads the history:

```
git ls-files | wc -l                   # 70 tracked files, section 4
git ls-files | xargs wc -l             # the line counts in section 4
grep -rn "claude-agent-sdk" src/       # every SDK contact point, exactly two files
npm ci && npm ls @anthropic-ai/claude-agent-sdk    # resolves to 0.3.226, section 3
grep -c "listSessions\|forkSession\|foldSessionSummary" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
npm run gate                           # typecheck, production build, 151 tests
```

The last one needs a Chrome or Chromium binary for the computed-style gate. It
does not skip when it cannot find one, by design.

To go further than we have gone, run the section 6 method yourself. It needs
nothing from us: `git hash-object` over both trees for byte-identical files,
`sort`-and-`comm` over trimmed source lines for identical lines, and set
intersection over path names, exported symbol names and directory names. It is
a few lines of shell, it works against any two repositories, and it produces a
number rather than an opinion.

## 9. Maintenance

This document is updated when the answer changes. Specifically: every further
first-party API adoption is recorded in section 3 with its symbol names and the
pinned version at the moment it is made, and any file added to the repository is
added to section 4 with its origin at the moment it lands. Adoptions recorded
afterwards are worth less than adoptions recorded at the time, which is the
whole reason the record exists.

Questions about anything in this document: see `SECURITY.md` for the contact
route.
