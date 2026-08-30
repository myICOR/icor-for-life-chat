# ICOR AI Chat

Your AI team, inside the vault. Open a conversation next to your notes, ask a
question, and get an answer from a model that is already reading the room: it
knows which note you have open and which lines you have selected, and it works
from your vault's own instructions rather than from anything the plugin puts in
its mouth.

The plugin is a window, not a second brain. Behaviour, identity and context
rules live in your vault's `CLAUDE.md`, `AGENTS.md` and `.claude/`, which the
Claude Code CLI reads natively from the working directory. ICOR AI Chat sends no
system prompt of its own. There is exactly one exception and it is visible in
settings: **Structured replies**, which is ON out of the box, appends a fixed
format instruction so the answer comes back as ICOR cards, which the plugin
then renders as native blocks instead of leaving as terminal text. It is the
format the product is designed around, so it is the shape you get without
opening settings at all. Turn it off and the plugin sends nothing of its own.

**One option, not a lock-in.** This panel is one way to talk to your team, not
the only one, and the vault stays yours either way. Run Claude Code in a
terminal, run it inside the Terminal plugin, or install any other plugin you
like alongside this suite. Nothing here takes that away. That openness is a
reason to build on Obsidian rather than something to work around.

**Beta release.** This plugin works and is in daily use in a real vault,
but you will find rough edges. If something looks off, open an issue on
this repo and it gets fixed fast.

## What it does

- **A conversation per tab.** Open as many as you want; each one is its own
  session and its own process. The robot in the ribbon starts one, and offers
  your recent conversations to pick up instead.
- **Context awareness.** The composer shows a chip for the note you have open
  and the range you have selected, so what the team receives is what you can
  see. Dismiss the chip and nothing is attached.
- **Readable work.** Tool calls collapse into quiet hairline rows whose left
  gutter answers "does this need me". Approvals never hide behind a chevron.
- **Structured replies.** Cards, verdict rows, decision blocks with click-to-
  insert codes, file rows that open in Obsidian or reveal in Finder.
- **Subagents.** When the team spawns a subagent you get a live chip, and its
  full transcript opens in its own tab.
- **Session archive.** Every conversation can be written back into the vault as
  a readable folder with a manifest, so the record is yours and a session can be
  resumed from the folder alone.
- **Resume from the vault.** An archived conversation note carries every session
  id the thread ever had. Right-click it, or run *Resume this conversation with
  the AI team*, and the chat reopens with that session loaded and its own
  history painted above the seam.

## Requirements

- **Desktop Obsidian**, 1.4.0 or newer. The plugin launches a local process,
  which mobile cannot do.
- **The Claude Code command line tool**, installed and signed in on the same
  machine. This is the one that trips people up, so it has its own section.

### The Claude Code command line tool

**ICOR AI Chat needs the Claude Code command line tool, which is a separate
install from Anthropic. The Claude desktop app is not the same thing, and
neither is claude.ai in a browser.** Having either of those gives this plugin
nothing to talk to.

The reason is simple: the plugin has no API key field and makes no network
calls of its own. It finds the `claude` program already installed on your
machine and runs it. If that program is not there, nothing happens, and that
is far and away the most common reason a fresh install appears to do nothing.

#### 1. Install it

**macOS, Linux, WSL**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://claude.ai/install.ps1 | iex
```

Other supported methods: `brew install --cask claude-code` on macOS,
`winget install Anthropic.ClaudeCode` on Windows, or
`npm install -g @anthropic-ai/claude-code`. Anthropic also publishes signed
apt, dnf and apk repositories for Linux.

Anthropic's own setup page is the authority if these ever change:
https://code.claude.com/docs/en/setup

#### 2. Check that it worked

Open a terminal and run:

```bash
claude --version
```

A working install prints a version number followed by `(Claude Code)`. If you
get `command not found`, the command line tool is not installed yet, whatever
else you may have from Anthropic. For a longer read-only diagnostic that does
not start a session, run `claude doctor`.

#### 3. Sign in

Run `claude` once in a terminal and follow the browser prompt.

Claude Code requires a Pro, Max, Team, Enterprise or Console account. The free
Claude.ai plan does not include Claude Code access. You can also point Claude
Code at a third-party API provider instead.

The plugin takes no part in any of this. There is nowhere in its settings to
put a credential, and it never sees, stores or transmits one.

#### 4. If it works in a terminal but not in Obsidian

This is the PATH trap, and it is expected rather than a bug. Obsidian launched
from the Dock, the Start menu or a desktop icon never runs a login shell, so it
starts with the operating system's bare default PATH. Every user-level install
location is missing from it, and a `claude` that works perfectly in your
terminal is invisible to the plugin.

The plugin already handles the ordinary case. Before it looks, it appends the
usual install directories to PATH without reordering or dropping anything
already there, so entries you put first keep their precedence:

- **macOS:** `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `~/.local/bin`,
  `~/.claude/local`, `~/.bun/bin`, `~/.npm-global/bin`, `~/.yarn/bin`,
  `~/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`
- **Linux:** the same list, plus `/home/linuxbrew/.linuxbrew/bin`
- **Windows:** `%LOCALAPPDATA%\Programs\claude`, `%APPDATA%\npm`,
  `~\.local\bin`, `~\.bun\bin`

If your install lives somewhere else, two settings under **Provider** fix it:

- **Claude Code path.** The executable itself, for example
  `/usr/local/bin/claude`. Leave it empty to search automatically. If you set
  it and it does not point at a file, the plugin tells you exactly that rather
  than failing vaguely.
- **Extra PATH entries.** One directory per line, searched after your own PATH.

To find the value to type in, run `which claude` on macOS or Linux, or
`where claude` on Windows.

When nothing is found at all, the plugin reports how many locations it searched
and points you at the installer, rather than failing silently.

On Windows the plugin prefers `claude.exe`. The `.cmd` and `.bat` shims cannot
be launched without a shell, so an install that provides only a shim is
reported as that specific problem instead of a generic error.

Install commands and account requirements above were verified against
Anthropic's published setup documentation on 30 August 2026. These change from
time to time; the linked page is always the authority.

## Which Claude account does this use?

ICOR AI Chat has no login of its own. It never sees, stores or
transmits a credential of any kind. It runs the Claude Code CLI
already installed on your machine, and that CLI uses whatever
authentication you set up yourself, directly with Anthropic.

A Claude subscription (Pro, Max) and an Anthropic API key
both work, because that choice is made inside Claude Code and not
here. The plugin neither knows nor cares which you picked.

Anthropic permits this. Their Claude Code legal page sets out the
rule that third-party developers may not offer Claude.ai login or
route requests through plan credentials, and then states that it
"does not prevent an end user from signing in to the unmodified
Claude Code binary with their own Claude subscription". This
plugin ships no copy of Claude Code, modifies nothing, brokers no
login and stores no token: you sign in to Anthropic's own CLI, in
your own terminal, before the plugin is ever involved.

Two things stay yours:

- **Usage limits.** Anthropic states that the advertised Pro and
  Max limits "assume ordinary, individual usage of Claude Code and
  the Agent SDK". This plugin makes heavy sessions easy: many
  tabs, subagents, long tool loops. Ordinary interactive work is
  what the plans are for. Leaving it running unattended in a loop
  is not, and that is the pattern that draws attention.
- **Terms change.** This reflects Anthropic's published terms as
  of 30 August 2026. They can change them, and they reserve the
  right to enforce without prior notice. Their position on
  third-party tools moved more than once during 2026, so treat
  the date above as the point this was checked rather than a
  settled answer, and check again if you are relying on it.

If you would rather be billed per token than against a plan,
configure an API key in Claude Code itself. Nothing changes here.

## Safety

- Permission mode starts at **Ask**. Every tool call that wants a decision gets
  one, from you.
- **Bypass is never a saved default.** It is a per-conversation choice, and the
  flag that skips permission checks is only ever set while you are explicitly in
  that mode.
- Sessions are read scoped to this vault. The plugin does not enumerate work
  from your other projects.

## Settings

Plumbing only, by design: executable path, model, reasoning effort, default
permission mode, archive folder and retention, structured replies, vault layout.
There is no prompt box and no context policy, because the vault already has one.
The only default worth naming: **Structured replies is on**, and it is the only
setting that changes what the team is told.

## Install

Copy `main.js`, `manifest.json` and `styles.css` into
`.obsidian/plugins/icor-for-life-chat/` and enable the plugin.

## Development

```
npm install      # pins the Agent SDK exactly; it is pre-1.0
npm run dev      # esbuild watch
npm run gate     # typecheck, production build, tests
```

`npm run gate` is the bar for a commit. The suite protects the behaviours that
bite in the wild rather than the ones that are easy to assert: `PATH` for a
GUI-launched Obsidian, an abort that leaves no orphaned process and no hung
promise, a tool whose input arrives in fragments rendering once instead of
repeatedly half-formed, a result that arrives before its own call, and unknown
SDK message types passing through without throwing.

One test in the suite is not about behaviour at all. `test/computed-style.test.mjs`
launches headless Chrome, mounts the shipped view components under a
reproduction of both hosts this plugin renders inside - Obsidian's own `app.css`
and the myICOR INKLINE theme - and reads `getComputedStyle`. It exists because
the failure it guards is invisible to every other kind of test: a host rule like
`button:not(.clickable-icon)` computes to (0,1,1) and outranks a plugin rule
stated by a single class, so the send pill, the badge, the chips and the code
chip render in theme chrome while the stylesheet still reads exactly as
authored. The host fixture paints in sentinel colours that appear nowhere in the
design system, and the gate's last assertion sweeps EVERY element under
`.aic-root` - so the control nobody thought to enumerate is covered too. It also
measures the contrast ratios the design system fixes, from real pixels, in all
four rooms.

It needs a Chrome or Chromium binary. It finds one on the usual paths, or set
`CHROME_BIN`. It does not skip when it cannot find one; a gate whose passing
state is reachable without the thing being true is worse than no gate.

`test/turn-render.test.mjs` uses the same headless browser for a different
claim: one assistant turn renders exactly ONE message node. It replays
`test/fixtures/recorded-turn.json`, verbatim CLI wire traffic recorded by
`tools/frames-entry.ts`, because the defect it guards lives in a disagreement
between two frame kinds about what a content block's index means, and a
hand-typed sequence would only ever agree with whichever one its author had in
mind. The census counts nodes rather than hunting for the unstyled one: an
assertion that no raw block is visible is satisfied by hiding a node, and a
hidden node leaves the thing that produced it alive.

## ICOR for Life Obsidian Edition

ICOR AI Chat is the AI surface of the **ICOR for Life Obsidian Edition**: ICOR
(Input, Control, Output, Refine), the productivity methodology by Paperless
Movement / myICOR, implemented as a ready-to-use Obsidian vault. Best to be used
in combination with:

- **[myICOR INKLINE theme](https://community.obsidian.md/themes/icor-for-life-inkline)**, the
  hand-drawn ICOR look every surface of the Edition is designed against. It is one of
  the two hosts the shipped style gate measures this plugin against, so cards, tool
  rows and decision blocks hold their shape in ink and paper mode alike.
- **[ICOR Planner](https://obsidian.md/plugins?id=icor-for-life-planner)**, the weekly planning
  board: Todoist, ClickUp, starred email and Google Calendar synced into the vault,
  planned by drag and drop. Talk a week through here, run it there.
- **[ICOR Focus](https://obsidian.md/plugins?id=icor-for-life-focus)**, the gravity map of your
  vault: what you touched today sits close, older work ripples outward.
- **[myICOR Connect](https://obsidian.md/plugins?id=icor-for-life-connect)**, your
  app.myicor.com account inside the vault: the ICOR Journey courses from myicor.com
  next to your notes.
- **[ICOR Diagrams](https://obsidian.md/plugins?id=icor-for-life-diagrams)**, a fullscreen viewer
  with zoom and pan for the mermaid diagrams in your notes, including the ones this
  plugin drafts.

The complete, preconfigured experience ships free at https://myicor.com

## License

Please note that while the source can be read and modified for your personal
use, this plugin is not open source. It is licensed under the ICOR for Life
Source-Available License (Code) - see the `LICENSE` file for the full terms.
Third-party notices live in `THIRD-PARTY-NOTICES.md`.
