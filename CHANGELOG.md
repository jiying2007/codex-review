# Changelog

## Unreleased

- Pin the final Codex Safe Core 2.1 baseline with canonical repository-policy validation, closed receipt contracts, hardened process execution, Git token validation, deep-frozen policy values, and Semantic Context budgeting.
- Remove the ambiguous Review product `src/core.js` boundary in favor of `src/review-support.js`; `codex-safe-core` is now the only Core.
- Keep Review-specific adapters only where they add localization or domain semantics while delegating shared safety/runtime behavior to Safe Core.
- Preserve confidence-gated findings, Review Receipt v2, HEAD-pinned `.codex-safe.json`, dist-only packaging, Trust/localization gates, SHA-256, and provenance attestation as the long-term baseline.

## 2.0.0

- Breaking: hard-switch to Codex Safe Core v2 through a commit-pinned Git submodule; remove copied vendoring, sync locks, compatibility shims, and legacy Core ownership from the Review repository.
- Replace `.codex-review.json` with the unified `.codex-safe.json` schema v2 `review` section; v1 policy and Receipt v1 are intentionally unsupported.
- Add confidence-aware quality gating with configurable `confidenceThreshold` (default `0.70`); low-confidence findings are suppressed before diagnostics, verdicts, and receipts.
- Route model input through Safe Core Semantic Context Budget while preserving the complete staged diff for fingerprints/line mapping/receipt evidence; enforce a fixed 8 MiB raw staged-diff safety ceiling.
- Upgrade the public companion API and persisted Review Receipt store to contract/schema v2, including verified first-parent range evidence.
- Standardize the Marketplace runtime on deterministic `dist/` staging plus `dist/codex-safe.schema.json`, with CI rejecting source/tests/scripts/submodule metadata in VSIX artifacts.
- Unify CI/release gates, retain real Workspace Trust and zh-CN Extension Host coverage, and add SHA-256 plus full-SHA-pinned GitHub build-provenance attestations.
- Rewrite English/Chinese user, security, and publishing documentation around the v2 product-family contract.

## 1.0.2

- Automatically create the immutable version tag and GitHub Release after a committed version bump reaches `main`, while retaining the manual tag-push fallback.
- Make release reruns idempotent and reject existing lightweight or annotated tags that resolve to a different commit.

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
- HEAD + raw INDEX consistency checks and HEAD-pinned repository policy.
- Complete English/Simplified-Chinese manifest and runtime localization.
- Linux/Windows/macOS Extension Host coverage plus VS Code `1.90.0` minimum compatibility.
- Reproducible lockfile, official VSIX content verification, immutable GitHub Actions, Dependabot, and SHA-256 release artifacts.
