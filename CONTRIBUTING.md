# Contributing

Pull requests are welcome.

By submitting a pull request you grant Paperless Movement S.L. the rights
described in Section 7 of the LICENSE.

Keep changes small and describe the behaviour change in the pull request.

Commit messages follow Conventional Commits v1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/):
`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, with a `!` or a `BREAKING CHANGE:` footer for a break.
The version bump, the CHANGELOG entry, the `versions.json` key and the GitHub release are all derived from
those messages by release-please, so a message that lies about its type ships the wrong version number.

Push to `main` directly. The only pull request in this repository is the release one, which release-please opens.

Run the repo's gate (`npm run gate` where it exists) before opening the
pull request.

For security issues, use the process in SECURITY.md instead of a public
pull request.
