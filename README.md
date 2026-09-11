# ICOR for Life - AI Chat

**Your AI team, in the room with your notes.**

Ask a question next to the note you are working on, and get an answer from a
model that already knows which note is open and which lines you selected.

Part of the [ICOR for Life](https://myicor.com) suite.

## What it is for

Copying a note into a chat window strips the context that made it worth
asking about. You paste the paragraph and lose the project it belongs to, the
person it is about and the six other notes that would have changed the
answer.

This is a window onto a model that is already in your vault. It reads your
vault's own instructions, so your team behaves the way you wrote it, not the
way a plugin decided.

**The plugin is a window, not a second brain.** Behaviour, identity and context
rules live in your vault's own files. It sends no instructions of its own,
with one visible exception in settings, which makes answers come back as ICOR
cards instead of terminal text.

## Before you start

**You need the Claude Code command line tool**, installed and signed in on
this machine. This is the one thing that trips people up:

- The **Claude desktop app** is not the same thing.
- **claude.ai** in a browser is not the same thing.

The plugin has no API key field on this engine. It finds the `claude` program
already on your machine and talks to that. If it is not installed, nothing
happens, and that is far and away the most common reason a fresh install
appears to do nothing.

Desktop Obsidian 1.4.0 or newer. Mobile cannot run a local program, so the
plugin is desktop only.

Optionally, the Codex command line tool as a second engine.

## Getting started

1. Install the Claude Code command line tool and sign in.
2. Enable the plugin and open the chat pane.
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

## Settings

Plumbing only, by design: where the program is, which model, how hard it
thinks, the default permission mode, where conversations are archived and for
how long.

There is no prompt box, because your vault already has one.

## What it touches

- **Runs the command line tool you already installed**, in your vault folder.
- **Reads and writes notes in your vault**, with your permission, the same as
  you would.
- **Archives your conversations** as notes in a folder you choose.

**The plugin itself makes no network calls on the default engine.** Your
command line tool talks to Anthropic under your own account.

## Good to know

- **Desktop only.**
- **Beta.** If something looks off, open an issue.

## Support

Open an issue on this repository. For security problems, see `SECURITY.md`.

## Licence

Source-available, see `LICENSE`. Not open source. Bundled third-party
components: see `THIRD-PARTY-NOTICES.md`.
