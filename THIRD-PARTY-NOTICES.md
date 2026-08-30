# Third-party notices

The built `main.js` bundles one third-party component.

## @anthropic-ai/claude-agent-sdk

- Version: 0.3.226 (pinned exactly; the package is pre-1.0)
- Copyright (c) Anthropic PBC
- License: see `node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md` in a
  development checkout, and Anthropic's Commercial Terms of Service.
- Used for: launching and talking to the locally installed Claude Code CLI,
  session listing and resume, subagent message forwarding, and permission
  callbacks.

The plugin does not bundle the Claude Code CLI itself. It talks to the copy
already installed on the machine and never handles, stores, or transmits any
credential: authentication is whatever the local CLI is already using.

Everything else in this plugin is written for it: no other runtime dependency
is bundled, and the plugin is an independent implementation from a behavioural
specification; no code is inherited from any other repository.

## Icons

Lucide icon names are resolved through Obsidian's own `setIcon` API at
runtime. No icon assets are bundled.
