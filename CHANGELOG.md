# Changelog

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
