# Changelog

## 1.1.1

- Align Codex CLI executable health checks with Codex Commit Safe: `--version` must succeed and return non-empty version information.
- Use an English control prompt for both output languages while keeping review findings independently selectable as Simplified Chinese or English.
- Complete runtime report localization for headers, Problems status, confidence, and stale markers.
- Add English/Simplified-Chinese localization key-parity verification to CI.
- Strengthen lockfile verification with package-version parity.
- Remove the unused pre-`name-status` staged-path helper and version-specific unit-test output.
- Document the stable extension identity, Codex Commit Safe companion relationship, Marketplace status, and generic release-tag procedure.

## 1.1.0

- Add English and Simplified Chinese Marketplace/manifest localization with `package.nls.json` and `package.nls.zh-cn.json`.
- Add English and Simplified Chinese runtime UI localization through `vscode.l10n`.
- Add English `README.md` and Simplified Chinese `README.zh-CN.md`.
- Keep review-result language independently selectable with `codexReview.language` (`zh-CN` / `en`).
- Add Marketplace metadata, SCM category, free pricing metadata, and extension icon.
- Harden CI with immutable GitHub Action SHAs and least-privilege permissions.
- Add Linux, Windows, and macOS latest Extension Host coverage plus VS Code `1.90.0` minimum-version coverage.
- Update `@vscode/test-electron` to `3.1.0` for current macOS VS Code executable resolution.
- Add lockfile integrity verification and official VSIX content verification.
- Add Dependabot for npm and GitHub Actions maintenance.
- Harden release tags: strict SemVer, package-version match, and release commit reachability from `main`.
- Expand security and publishing documentation with logging and release-supply-chain requirements.

## 1.0.0

- Initial release.
- Staged-only Codex code review from VS Code Source Control.
- Structured findings, local verdict calculation, Problems integration, report-only safety fallbacks, and multi-repository support.
- HEAD + raw INDEX consistency checks, HEAD-pinned review policy, conflict detection, and working-tree/dirty-editor protection.
