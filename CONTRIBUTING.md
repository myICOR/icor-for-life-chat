# Contributing

Changes land as direct commits on `main`. This repository has pull requests
disabled, so there is no branch to open: commit to `main` with a Conventional
Commits message and push.

By submitting a pull request you grant Paperless Movement S.L. the rights
described in Section 7 of the LICENSE.

Keep changes small and describe the behaviour change in the commit message.

Commit messages follow Conventional Commits v1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/):
`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, with a `!` or a `BREAKING CHANGE:` footer for a break.
The type is what a reader of `CHANGELOG.md` sees, so a message that lies about its type misdescribes the release.

## Cutting a release

By hand, in this order. `main` is the release branch.

1. In one commit on `main`: the new version in `manifest.json` and `package.json`, the same version in
   `package-lock.json` at both `.version` and `packages[""].version`, the new key appended to `versions.json`
   carrying the current `minAppVersion` from `manifest.json`, and the `CHANGELOG.md` entry.
2. `versions.json` is append-only. Add the new key and change nothing above it: an earlier release is still
   installed in somebody's vault and its floor must not move.
3. `git push origin main`.
4. `npm run gate` at that commit. It typechecks, builds `main.js`, lints and runs the tests. Do not tag a
   commit whose gate is red.
5. `git tag <version>` with no `v` prefix, then `git push origin <version>`.
6. `gh release create <version> --title "ICOR for Life - AI Chat <version>" main.js manifest.json styles.css`.

`main.js` is gitignored and exists only as a release asset, so it is built at the tagged commit and nowhere
else. The Obsidian directory rebuilds from the tagged source and compares byte for byte, and an asset built
from any other tree will not match.

Run `npm run gate` before you commit. `main` is the release branch, so a commit
that lands red breaks it for everybody.

For security issues, use the process in SECURITY.md instead of a public
commit or issue.
