# Changelog

Notable changes per release. Older releases are described in their commit
messages (`git log --grep='^0\.'`) and on the GitHub releases page.

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
