# ICOR AI Chat

**A chat, right beside your notes.**

Ask a question next to the note you are working on, and get an answer from a
model that already knows which note is open and which lines you selected.

Part of the [ICOR for Life](https://myicor.com) suite.

## What it is for

Copying a note into a chat window strips the context that made it worth
asking about. You paste the paragraph and lose the project it belongs to, the
person it is about and the six other notes that would have changed the
answer.

This is a window onto a model that is already in your vault. It reads your
vault's own instructions, so it behaves the way your vault says, not the way
a plugin decided. Anyone who wants a chat next to their notes can use it.

**The plugin is a window, not a second brain.** Behaviour and context rules
live in your vault's own files. The plugin sends no instructions of its own.

## What it reads

Everything the chat knows about how to work comes from the vault:

- **`AGENTS.md`** at the vault root (or `CLAUDE.md` when there is no
  `AGENTS.md`): the principles and where things live.
- **Skills**, one folder each in `_System/Skills/<name>/SKILL.md`: how to do a
  piece of work, step by step. The copies in `.agents/skills/` and
  `.claude/skills/` count too, so a vault set up before `_System/` existed
  still works.
- **`_System/schema.json`** (in older vaults `.icor-for-life/schema.json`):
  the top folders grouped by stage (Input, Control, Output; Refine has no
  folder), every type of note, its folder, its fields, the values a field
  allows and which type a link points to.
- **The note you have open**, the text you selected, and the notes you name
  with `[[`, `@` or the `+` menu.

The ICOR for Life vault ships all three files. In any other vault the chat
works with whatever is there, and with none of them it is a plain chat with
your notes as context. The empty chat lists what it found, for example
`AGENTS.md · 9 skills · schema, 19 types`.

Claude Code and Codex read `AGENTS.md`, `CLAUDE.md` and their skill folders
themselves, because they run with your vault as their working folder. With
your own API key, the plugin reads the three files (through Obsidian's file
adapter, which also reaches the older hidden folders Obsidian does not index)
and sends them as the instructions with every message; the model reads a
skill's full text when it needs it.

## Before you start

**You need the Claude Code command line tool**, installed and signed in on
this machine. This is the one thing that trips people up:

- The **Claude desktop app** is not the same thing.
- **claude.ai** in a browser is not the same thing.

The plugin has no API key field on this engine. It finds the `claude` program
already on your machine and talks to that. If it is not installed, nothing
happens, and that is far and away the most common reason a fresh install
appears to do nothing.

Desktop Obsidian 1.8.7 or newer. Mobile cannot run a local program, so this
engine is desktop only. Your own API key runs on a phone or tablet too; see
"Where your keys live".

Optionally, the Codex command line tool as a second engine.

## Getting started

1. Install the Claude Code command line tool and sign in.
2. Enable the plugin and open the chat pane from the robot in the ribbon on
   the left (or **New conversation** in the command palette).
3. Ask something about the note you have open.

## Continue on your phone

Hand a conversation to your phone and pick it up there. From that point
permissions follow your own command line tool's settings rather than this
plugin's.

## Safety

- **Permission mode starts at Ask.** Every tool call that wants a decision
  gets one, from you.
- **Bypass is never a saved default.** It is a choice you make for one
  conversation, never a setting that quietly stays on.
- **Sessions are scoped to this vault.** The plugin does not go looking at
  your other projects.

## Where your keys live

One setting decides whether keys stay on this device or follow the vault.
Most people need nothing here: on the default engine there is no key at all,
because your command line tool is already signed in.

If you pick **My own API key** under *Settings, AI engine on this device*,
two things change:

- **You need an account** at Anthropic (`console.anthropic.com`) or
  OpenRouter (`openrouter.ai`), and a key from there. Use is billed to
  that account.
- **The plugin talks to the internet itself.** Your messages, the notes
  you attach and tool results go over HTTPS to `api.anthropic.com` or
  `openrouter.ai`, and nowhere else. Nothing goes to myICOR.

The key lives where you choose:

- **Obsidian's keychain** (the default; Obsidian 1.11.4 or newer; see
  *Settings, General, Keychain*). Keys in Obsidian's keychain stay on
  this device. Obsidian Sync does not carry them; enter the key once per
  device. Any plugin in the vault can read any keychain entry, which is
  why this plugin's entries carry its name:
  `icor-for-life-chat-anthropic-api-key` and
  `icor-for-life-chat-openrouter-api-key`.
- **An env file in the vault**, by default `.icor-for-life/.env`, as
  `ANTHROPIC_API_KEY=` and `OPENROUTER_API_KEY=`. A vault set up before
  November 2026 (ICOR for Life 2.x) keeps its keys in
  `06 AI Team/AI Team Knowledge/.env`; the
  plugin reads that file too when the new one has no key, and writes to
  whichever of the two exists. Keep the file out of anything that syncs or
  publishes your vault.

The plugin reads only the place you chose. The settings tab shows where
each key is and can move it. No key is ever shown back.

## Settings

Plumbing only, by design, and few of them: where the program is, which
model, how hard it thinks, the default permission mode, whether the open note
travels with a message, and whether conversations are saved, where and for
how long. Saving is off until you turn it on. Pick the folder with the folder
field or its folder button; left empty, an ICOR for Life vault saves in
`05 Databases/AI Sessions/`, any other vault in `AI Sessions/`, and a 2.x
vault that already has `06 AI Team/AI Sessions/` keeps using it.

There is no prompt box, because your vault already has one: its `AGENTS.md`.

## What it touches

- **Runs the command line tool you already installed**, in your vault folder.
- **Reads and writes notes in your vault**, with your permission, the same as
  you would.
- **Saves your conversations** as notes in a folder you choose, once you turn saving on.
- **Saves a reply as a note** when you ask, in your Daily notes folder as
  `YYYY/MM/YYYYMMDDHHmm.md`: the folder Obsidian's Daily notes setting names,
  else `00 Daily Notes/` when the vault has it, else the vault root. A 2.x
  vault's `00 Daily Scratchpad/` keeps working while it exists.
- **Reads your vault's `AGENTS.md`, skills and schema**, never writes them
  (see "What it reads").

**The plugin itself makes no network calls on the default engine.** Your
command line tool talks to Anthropic under your own account.

## Good to know

- **Desktop, plus phones and tablets on your own API key.**
- **Beta.** If something looks off, open an issue.

## Support

What myICOR supports: the plugin as published in a tagged release, on the
current version, installed from that release. Bugs go to this repo's issues,
security reports to the process in `SECURITY.md`.

What the community maintains: anything marked community-maintained, including
community source adapters. We review it before it is merged. We do not support
it, we cannot promise it keeps working, and it can be disabled or removed in
any release.

What is yours: your own changes, your fork, your local patch. Please reproduce
the problem on a clean install of the current release before reporting it.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice.
Releases before 0.16.0 stay under the ICOR for Life
Source-Available License (Code) v1.0 they were published with.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L.; a fork needs
its own plugin id and name. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
The built `main.js` also contains `@anthropic-ai/claude-agent-sdk`,
Copyright (c) Anthropic PBC, which is not under MIT; forks that
redistribute `main.js` redistribute it on Anthropic's terms.
