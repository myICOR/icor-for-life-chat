# Changelog

Notable changes per release. Older releases are described in their commit
messages (`git log --grep='^0\.'`) and on the GitHub releases page.

## 0.15.1

- **Fourteen controls now state their own height instead of taking
  Obsidian's.** The three approval pills, the mode pills, the provider
  buttons, the question card's Send, the Team Insights chips, the code
  keycap and the remove button on a context chip each say how tall they
  are: 24px for a control standing in a row, 22px for the code keycap
  because it is inline type in a sentence rather than a control, and 18px
  for the small remove disc. They used to compute to 30px, which is
  Obsidian's bare `button` rule and not a size this plugin ever chose, so
  controls that agree on paper drew at two different sizes and the question
  card's Send sat at 17px beside pills at 30px.
- **Rows grow to their content instead of clipping it.** A row in the
  context picker holds a note's name and its path, two lines of content in
  a box that was cut to 30px and centred in it, so the text hung out of the
  row at the top and the bottom. The Team Insights session rows and the
  history rows carried the same cut. Each row's text still truncates with
  an ellipsis where it has to; what stopped is the row itself being cut.
- **The cell that holds a screenshot you paste into a message stated no
  height.** Under Obsidian's bare-button rule it computed to 30px in the
  test fixture in all four rooms while holding a 150px picture; it now
  grows to the picture, capped at 240 by 180 as before. Measured in the
  fixture, not yet confirmed on a live vault. Found by Iris while
  reviewing the question card Holger Schwan reported in 0.14.0.
- **The gate counts the controls now rather than listing them.** A test
  fails the build if any button under a plugin root computes to a height
  the stylesheet never stated, checked in dark and light on both the stock
  theme and INKLINE, with the context picker's modal swept as a root of its
  own because Obsidian paints a modal outside the pane. A named list of
  fourteen would have repeated the mistake that produced it.
- **CONTRIBUTING describes the flow this repository actually has.** Changes
  land as direct commits on `main`, because pull requests are disabled
  here, and the contribution rights grant now names the act of contributing
  through any channel instead of the one door that is not there. The
  release section is unchanged.
- **The lockfile agrees with the manifest about which version this is.**
  `package-lock.json` was left at 0.14.0 when 0.15.0 was cut, so the
  repository stated two different versions of itself. Version string only,
  no dependency moves.

## 0.15.0

- **A conversation now starts knowing where your life stands.** When you
  send the first message of a chat, the plugin reads the life snapshot your
  vault's own script writes (`.icor-for-life/scripts/snapshot.json`) and
  puts it in front of that message, so the team answers the six everyday
  questions from the file: your goals, the projects you put in focus, this
  week's priorities, today's highlight, your key elements, and the topics
  that have had your attention. It used to walk the folders and guess, on
  every single conversation.
- **The plugin reads that file, and never writes it and never runs the
  script.** It checks the file's schema before trusting a field, and a file
  from a newer script is refused rather than half-read.
- **A snapshot that is old, absent or incomplete says so, in one fixed
  sentence.** Old: the team names the date it is answering from and the
  command for a fresh one. Absent: it says the snapshot has not been made on
  this device, gives you the line to run, and offers to read the folders
  instead. It never answers the six questions from memory and never reads a
  missing file as an empty life. Incomplete: it answers what is there and
  names what is missing in the file's own words.
- **One line in the chat header says which of those four states you are in**,
  beside the engine line that was already there. No new panel, no new tab.
- **Every conversation gets the block, not just the first one in the tab.**
  Starting a new conversation in a pane that has already sent once, and
  editing the very first message of a chat (which starts the tab over rather
  than forking it), both count as new conversations and both get the snapshot
  in front of their first message. Resuming an archived thread gets the
  **current** snapshot rather than the one the thread was given on the day it
  started, because a snapshot is as old as its thread.
- **The week's items are called priorities and the day's is the daily
  highlight**, following the naming ruling of 2026-09-15, so one word does
  not carry both a Planner task and a My Life goal.
- **The README says what the snapshot read means for you**, under "What it
  touches": which file is read, that it is per device because Obsidian Sync
  skips dot folders, and that on the own API key engine the brief travels to
  the provider with the first message the same way pinned note context does.

## 0.14.0

- **A question from the team is now a question you can answer.** When the
  team asks a multiple-choice clarifying question, the pane draws the
  questions it asked: one card per question, the choices as rows, a field
  for an answer that is not on the list, and one Send for the whole stack,
  so an early click cannot settle the rest. It used to draw a bare
  permission card over Allow once, Always allow and Deny, with the
  questions nowhere on screen and no way to answer them. Reported by
  Holger Schwan.
- **A long FINDINGS claim opens like every other card row.** A claim too
  long to fit now carries the chevron, takes a tab stop, and opens to show
  the rest of the sentence. It used to clip with an ellipsis and no way to
  reach what was cut. Reported by Daniel Piatk.
- **Team Insights no longer reads a Codex session as one in which no
  specialist ran.** A runtime that cannot report its subagents now says so
  on its own session row, and that session leaves the agent ranking and
  its denominator instead of sitting in them carrying a zero. The number
  of excluded sessions is printed beside the ranking. Sessions archived
  before this release get the same treatment from their manifest, so no
  archive is rewritten. Reported by Antonio Bradley.
- **What Codex cannot tell you yet.** The Codex provider forwards no
  subagent boundary, so a Codex session carries no specialist detail
  anywhere in Team Insights and its tool calls all read as the main
  thread. This is a missing measurement, not a measurement of zero, and
  the plugin now says so rather than drawing a number it did not measure.
  What it would take to fix is written in `docs/architecture.md`, section
  "The AI team layer".
- **The key-storage and network disclosure is back in the README**, under
  "Where your keys live": the two keychain ids, that keys in Obsidian's
  keychain stay on the device and Obsidian Sync does not carry them, the
  env file and its two variables, and that the plugin reads only the
  backend you chose and never the other one. `SECURITY.md` now describes
  the own-key engine as well, engine by engine, including which two hosts
  the plugin talks to on your own key and that nothing is proxied through
  myICOR.
- **Known: iOS below 16.4 cannot load the plugin bundle.** The Claude
  Agent SDK the plugin bundles contains regex lookbehind literals, which
  the JavaScript engine on those versions rejects when the bundle is
  parsed. This has been true since 0.13.0, the first release that ran on
  mobile at all, and is not new in 0.14.0. Desktop, and iOS and iPadOS
  16.4 or newer, are unaffected.

## 0.13.0

- **Keys move to Obsidian secret storage.** The own-key engine's Anthropic
  and OpenRouter keys live in Obsidian's keychain (Settings, General,
  Keychain; Obsidian 1.11.4 or newer) under
  `icor-for-life-chat-anthropic-api-key` and
  `icor-for-life-chat-openrouter-api-key`, or, by choice, in an env file in
  the vault (default `06 AI Team/AI Team Knowledge/.env`, variables
  `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY`). One dropdown picks the
  place; the plugin reads that place only. The settings tab says where each
  key is and moves it between the two on a button. The paste field is
  write-only and empties after Save; no key is ever shown back. A key left
  in the pre-release local-storage record is moved into the keychain on
  load. README section "Where your keys live" carries the ids, the file
  format and the account and network disclosures.
- **Minimum Obsidian version is now 1.8.7** (was 1.7.2 for 0.12.0 and
  0.12.1, which keep that floor in `versions.json`). The own-key engine's
  per-device settings are kept with `App.loadLocalStorage` and
  `App.saveLocalStorage`, both added in Obsidian 1.8.7 and called at load.
  The keychain needs 1.11.4; below that the env file is the only backend and
  the settings tab says so.
