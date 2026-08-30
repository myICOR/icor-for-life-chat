# Security Policy

ICOR for Life - Chat runs an AI agent inside your Obsidian vault. It uses the Claude Agent
SDK, it can execute tool calls against your machine, it can run under permission
modes up to and including one that bypasses per-call approval, and it writes
session transcripts back into your vault as notes.

That is a materially larger attack surface than anything else in the ICOR for Life
suite, and we are not going to describe it as anything smaller. If you find a way
to make this plugin do something its user did not ask for, we want to hear about it
before anyone else does.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

Two channels, in order of preference:

1. **GitHub private security advisory** (preferred). Go to the
   [Security tab](https://github.com/myICOR/icor-for-life-chat/security/advisories/new)
   of this repository and open a draft advisory. This keeps the report private
   between you and the maintainer until a fix ships.
2. **Email** `team@myicor.com` with `SECURITY` and `icor-for-life-chat` in the subject line.
   This is a monitored mailbox. If you want to encrypt the report, say so in a
   first message and we will arrange a key.

A useful report contains:

- The plugin version (see `manifest.json`, or Settings, Community plugins).
- Your Obsidian version and operating system.
- What an attacker can do, and what they need in order to do it. For this plugin
  in particular: **state which permission mode you were in**, and whether the
  attack works in the default mode.
- Steps to reproduce, ideally against a throwaway vault. If the finding involves
  crafted note content, include the note.
- **Never send us a real credential or session transcript.** The plugin has no
  key of its own, but the environment it inherits may hold secrets the agent can
  see. Describe the credential rather than pasting it, and redact transcripts
  before attaching them. If a secret of yours was exposed, rotate it at its
  provider first, then report.

## What to expect

This project is maintained by one person, so these are timelines we can actually
keep rather than ones that sound good:

| Stage | Target |
| --- | --- |
| We acknowledge your report | within 5 business days |
| We tell you whether we agree it is a vulnerability, and how severe | within 10 business days |
| We ship a fix for a confirmed critical or high issue | we aim for 30 days |
| We ask you to hold public disclosure until | a fix ships, or 90 days from your report, whichever comes first |

For a confirmed **permission-gate bypass or arbitrary code execution in the default
mode**, we will drop other work and treat it as the only thing that matters. If a
deadline is going to slip we will tell you before it slips, not after. If you do
not hear from us within 10 business days, please chase us: assume the message got
lost rather than ignored.

## Supported versions

**Only the most recent release is supported.** This project has one branch (`main`)
and no long-term-support line. There are no backports to older versions and no
security patches for anything but the current release. If you are running an older
version, the fix is to update.

We are not going to publish a version-support table we would not honour. This
plugin is at 0.x, it is early, and its interfaces are still moving.

## Scope: what this plugin actually touches

This plugin is desktop-only. Its source is published in this repository, so you can
read the parts named below rather than taking our word for them.

**The agent runtime.** The plugin drives the Claude Agent SDK. The model can issue
tool calls that read and write files and run commands on the machine Obsidian is
running on. The gate between a model's request and that request actually happening
is the permission layer, and that gate is the single most important control in the
project.

**Permission modes.** The plugin supports permission modes up to and including one
that bypasses per-call approval. That mode is a deliberate, user-selected choice
for people who understand what they are handing over. It is not the default, and it
should never become the effective mode without the user choosing it.

**Session archiving.** Sessions are written back into the vault as notes. A
transcript can contain anything the model was shown, which includes the content of
notes you had open and text you had selected. Transcripts are as sensitive as the
most sensitive note in the conversation.

**Credentials.** The plugin has none. It stores no API key,
performs no login, exposes no authentication setting, and makes no
network request of its own. It launches the Claude Code CLI
already installed on the machine; that CLI holds whatever
credential you gave it, in Anthropic's own storage, and the plugin
never reads it. Nothing written to `data.json` is a secret. The
plugin does pass its own process environment to the child, so any
secret already present in Obsidian's environment is visible to the
agent under a permissive mode. That is in scope below.

**In scope, and we want to hear about it. In rough order of how much we care:**

- **Permission-gate bypass.** Any path by which a tool call executes without the
  approval the current mode requires. Any path by which the effective permission
  mode escalates without a deliberate user action, including through settings
  loading, session restore, a subagent, or an error path that falls open instead
  of closed. A gate that can be reached in its passing state without the user
  having approved is the highest-value finding in this repository.
- **Prompt injection that reaches a tool call.** Content in a note, a selection, a
  file name, a frontmatter value, a pasted document, or a tool result that steers
  the agent into executing an action the user did not ask for. Injection that
  produces a wrong answer is a quality bug. Injection that produces a **file
  write, a command execution, or a network request** is a vulnerability, and this
  is the report class we most expect and most want.
- **Data exfiltration through the agent.** Any route by which vault content leaves
  the machine to a destination the user did not choose, including a model-authored
  URL, a rendered image or link that fetches on display, or a tool call
  constructed to carry data in its arguments.
- **Arbitrary code execution** from any input that is not the user's own typed
  instruction.
- **Credential exposure.** Any route by which a credential
  belonging to the Claude Code CLI, or any other secret in the
  environment inherited by the child process, reaches a
  transcript, an archived note, a log line, a rendered pane, an
  error message, or the model itself.
- **Archive writer path traversal.** A session title, subagent name, or any
  model-influenced string that causes a write outside the configured archive
  folder, or outside the vault. Anything that lets an archive write overwrite an
  existing note the user did not intend to touch.
- **Sandbox and scope escape.** The plugin reading or writing files outside the
  vault, or outside the folders it is configured to use, when the permission mode
  in force should not allow it.
- **Subagent boundaries.** A subagent inheriting more permission than its parent,
  or a subagent's output being trusted as if it were user input.
- **Rendering injection.** Model output or tool output that executes as script, or
  injects HTML, when rendered into the chat pane.

## Out of scope

These are not vulnerabilities and we will close them as such:

- **The Claude Code CLI storing its own credential.** How that CLI holds the
  authentication you gave it is Anthropic's design and Anthropic's storage. This
  plugin never reads it and never copies it into the vault. Report anything about
  that storage to Anthropic, not here. Any route by which this plugin or the agent
  surfaces such a credential is in scope above.
- **The bypass permission mode doing what it says.** If you select the mode that
  bypasses per-call approval and the agent then acts without asking, that is the
  documented behaviour of a mode you chose. Reports that the mode is dangerous are
  not findings. Reports that the mode can be **entered without you choosing it**,
  or that a *lower* mode behaves like it, absolutely are.
- **Transcripts containing your note content.** Archiving the session is the
  feature. A transcript being as sensitive as the notes in it is expected. A
  transcript being written somewhere you did not configure is not.
- The model being wrong, making things up, giving bad advice, or ignoring an
  instruction. That is a quality issue. Please report it as a normal issue.
- Jailbreaks and safety bypasses that only change what the model *says*. Without a
  tool call, a file write, or a network request behind it, this is a model
  behaviour report and belongs with the model provider.
- Vulnerabilities in the Claude Agent SDK, the model, or the provider's API.
  Report those to Anthropic.
- Bugs in Obsidian itself. Report those to
  [Obsidian](https://github.com/obsidianmd/obsidian-releases/issues).
- Interactions with third-party plugins, or breakage caused by another plugin
  changing shared state. Please report those as normal issues so we can look at
  compatibility, but they are not handled as security reports.
- Anyone with filesystem access to your vault being able to read `data.json` or
  your archived sessions. If an attacker is already reading your vault, this
  plugin is not the control that failed.
- Missing hardening with no demonstrated impact: settings in `data.json` not
  being encrypted at rest, dependency versions with no reachable exploit path, or
  the output of an automated scanner with no working proof of concept.
- Cost. Running up an API bill is not a security vulnerability, though we would
  still like to know if you found a way to make the plugin loop.
- Social engineering, physical access, or attacks that require the user to
  already be running attacker-controlled code.

## Good-faith research

We will not pursue or support legal action against anyone who reports a
vulnerability to us in good faith, follows this policy, gives us reasonable time to
fix the issue before disclosure, and does not access, modify or destroy data that
is not their own.

Please test against a throwaway vault, your own Claude Code sign-in, and your
own machine.
Given what this plugin can execute, that is as much for your protection as ours.

There is no bug bounty. We are a small team and cannot pay for reports. We will
credit you by name and link in the release notes and the advisory unless you would
rather stay anonymous.

## Credit

Thank you for taking the time. This is the project in the suite where a good report
does the most good, and a report that arrives privately and with a reproduction is
worth a great deal more than the effort it costs you to write it.
