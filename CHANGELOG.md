# Changelog

## Unreleased

- Added review-input fingerprints, staged input size, and Codex execution metadata to reports.
- Added explicit reporting for staged files with newer unstaged overlays.
- Strengthened the review prompt with an internal category-coverage and false-positive challenge pass.
- Added cached Codex CLI capability probing to environment checks and actual reviews.
- Split quality findings from delivery readiness and record explicit cannot-verify/mechanical-gate state.
- Persist versioned, snapshot-bound review receipts and expose a read-only companion-extension API.
- Added offline quality fixtures and the shared Codex Safe argv/compatibility contract.

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
