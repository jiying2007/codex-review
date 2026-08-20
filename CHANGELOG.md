# Changelog

## 1.0.1

- Fixed current Codex CLI compatibility by placing the global approval policy before the `exec` subcommand.
- Added a shared Codex argv builder plus regression and fake-CLI argument-order checks.
- Improved Codex CLI compatibility errors so they no longer incorrectly require an upgrade for every rejected argument.
- Added runtime localization source-to-bundle coverage and a Simplified-Chinese Extension Host smoke test.
- Removed remaining pre-release rebrand residue from publishing documentation and made integration test version output dynamic.

## 1.0.0

- Initial public baseline as **Codex Review Safe**.
- Staged-only code review with Structured Output and local validation.
- Conservative Problems publishing with report-only safety fallbacks.
- HEAD + raw INDEX consistency checks and HEAD-pinned `.codex-review.json` policy.
- Complete English/Simplified-Chinese manifest and runtime localization.
- Linux/Windows/macOS Extension Host coverage plus VS Code `1.90.0` minimum compatibility.
- Reproducible lockfile, official VSIX content verification, immutable GitHub Actions, Dependabot, and SHA-256 release artifacts.
