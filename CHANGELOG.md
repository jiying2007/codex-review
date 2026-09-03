## 4.7.4

- Repin to Codex Safe Core 4.14.4 as a new immutable product release; no compatibility shim or stale artifact reuse is permitted.
- Refresh generated/current-state Family identity and release evidence for the exact Core pin.

## Unreleased

## 4.7.3

- Bound repository-size Git enumeration to the staged Review scope: submodule classification and unstaged-overlay safety checks now query only literal, batched staged pathspecs instead of enumerating the entire index or working tree.
- Add explicit bounded Git-enumeration ceilings plus phase/command-class `EOUTPUTLIMIT` diagnostics, while preserving index-pinned staged-only model authority and fail-closed publication semantics.
- Extend large-repository regressions for >4 MiB semantic grep output, bounded pathspec batching, literal pathspec handling, unstaged isolation, and staged gitlink classification.

## 4.7.2 - 2026-09-03

- Bound index-pinned semantic symbol discovery at the source: enumerate matching files with NUL-safe `git grep -l`, recursively split over-broad symbol batches, cap broad-symbol candidates, and inspect only size-preflighted index blobs.
- Add a real regression fixture whose legacy `git grep -n` output exceeds 4 MiB, proving Review completes bounded semantic discovery instead of failing with `Child process stdout exceeded the limit (4194304 bytes)`.
- Preserve Core 4.13.1 structured Codex transcript limits, Review judgment/evidence publication contracts, staged-only authority, and fail-closed evidence validation.

## 4.7.1 - 2026-09-03

- Repin to immutable Codex Safe Core 4.13.1 (`479e4b33356457a90617aea7bbba5ee25b65b2c8`) so long structured `codex exec --json` Review transcripts use bounded retained stdout with an independent fail-closed total transcript ceiling.
- Prevent false `Child process stdout exceeded the limit (4194304 bytes)` failures during long hypothesis/verification runs while preserving generic process output limits, Safe Contract v2, Review Receipt v5, Runtime Contract v3 and Provider Contract v3.
- No Review judgment, finding validation, replay, convergence, scope or evidence semantics change.

## 4.5.0

- Adopt immutable Safe Core 4.11.0 and Review Receipt v5 / Judgment Lifecycle v1.
- Bind persisted receipts to the exact ReviewSubject and Evidence Manifest identity; historical receipts restored after restart are never current-session freshness.
- Keep bounded in-session Judgment Replay receipt-free and retain only deterministic structural Evidence Cache across sessions.
- Expose delivery-qualified range evidence from coverage, mechanical and quality gates without overloading Review readiness.

## 4.4.3

- Replace persistent judgment caching with a bounded in-session Replay Window: `fresh → replay → replay → fresh`, max 2 consecutive replays and max 10-minute replay age.
- Retire the user-facing Independent Review command; every forced fresh cycle is automatically blind to prior judgments.
- Keep deterministic structural Evidence Cache persistent, split analyzer/SARIF composition from structural scanning, and hard-cut legacy `reviewArtifacts.v2`/`semanticRuns.v1` replay state.
- Preserve Review Receipt v4, Safe Contract v2, Policy Schema v4, lineage/convergence provenance gates, and exact Safe Core 4.10.2 pin.

# Changelog

## 4.6.1 - 2026-09-02

- Release-only patch carrying the exact Codex Safe Core 4.12.4 family pin and validated Review Receipt/Provider contracts; no Review Safe judgment semantics change.

## 4.4.2

- Align the primary VS Code SCM toolbar with the Family UI Contract: Review is the single `navigation@5` primary action; Independent Review remains a secondary trusted action.
- Repin to immutable Safe Core 4.10.2.

## 4.4.1 - 2026-08-31

- Publish the already-validated Review Safe main line on immutable Safe Core v4.10.1 (`76418b80533c644e3ab01045290cd3cdd355622c`) and Policy Schema v4.
- No Review runtime authority, Safe Contract v2, Review Receipt v4, prompt contract, or model behavior change.

- Restore the original release boundary: the Release workflow ends at the validated immutable GitHub Release, while VS Code Marketplace publication is an independent `workflow_dispatch` that consumes the exact Release VSIX. External Marketplace credential/service failures no longer invalidate an already-successful GitHub source release.

## 4.4.0

- Hard-cut whole-review verdict caching into deterministic Evidence Cache plus explicit Judgment Replay history; legacy `semanticRuns.v1` state is purged rather than migrated.
- Split `ReviewSubjectKey` from `ReviewRunId`; the same immutable subject can now have multiple genuine fresh review runs.
- Replace Force Re-review with blind **Independent Review**: deterministic evidence may be reused, but previous findings, suppressed hypotheses, coverage conclusions, and model explanations are never reviewer input.
- Treat a normal review of an identical subject as explicit result replay; replay does not advance lineage/convergence and does not create a new Review Receipt.
- Require fresh, blind, coverage-complete provenance for convergence stability and preserve reviewer disagreement instead of suppressing findings to force agreement.
- Make deterministic Evidence Cache judgment-agnostic and host-independent; evidence identity no longer varies with model/language/policy judgment options, while Judgment Replay can only resolve after the current ReviewSubjectKey is recomputed.
- Split the human report into defect verdict, evidence readiness, and overall readiness, with explicit inference/evidence/replay provenance.
- Add regression gates for cache-domain separation, same-subject multi-run lineage, independent-review trust boundaries, fresh coverage stability, layered readiness reporting, and removal of the retired Force Review command.

## 4.3.4 - 2026-08-30

- Bind the human Review report to the exact Review Receipt v4 timestamp.
- Show host-local review time with an explicit numeric UTC offset and retain the canonical UTC `...Z` value in the same line.
- Keep machine receipts canonical UTC and unchanged; this is a human observability improvement only.


## 4.3.3

- Repin to immutable Codex Safe Core v4.9.0 (10393a0035ce5168b3d0e88822af0d74fe85ec6c) and adopt Product Contract v1.
- Derive current documentation/Core identity checks from machine contracts instead of preserving historical SHA/version literals.
- No Review runtime authority, Safe Contract, Policy Schema, Receipt, or review semantics change.

## 4.3.0 - 2026-08-28

- Add the shared Core v4.6 Codex Runtime/Provider Contract with explicit OpenAI-compatible relay configuration while preserving `--ignore-user-config`.
- Split per-request and whole-review timeouts, force relay traffic to Responses HTTP/SSE, add live Environment Check, and surface provider/DNS/TLS/auth/rate-limit/model/timeout diagnostics without exposing secrets.

## 4.2.0 - 2026-08-28

### Evidence-centric semantic review

- Bind dependency context to the Git Index, never the unstaged working tree, and resolve ordinary C/C++ call symbols to bounded declaration/definition evidence.
- Split model work into hypothesis and evidence-verification stages; high model confidence cannot publish an external-semantics finding without supporting evidence.
- Add immutable Evidence Manifests, stable ReviewKeys/Finding IDs, same-subject result caching, evidence-scoped human resolutions, Force Re-review stability suppression, and chunk-scoped evidence.
- Add HEAD-pinned Scope Contracts, cross-index Review Lineage, changed causal anchors with unchanged supporting locations, convergence metrics, deterministic invariant candidates, and repeated-review hard-positive regression cases.
- Add a hard-negative gate for ownership-replacing APIs such as `VSAPISTRING_Trim`, plus an index-safe discovery adapter boundary for future Tree-sitter/SCIP/LSP providers.

## 4.3.2 - 2026-08-30

- Repin to immutable Codex Safe Core v4.8.1 (`d06383ecf58b8153ddbd9d0b26a4f83b6e0515c2`) after the Family workspace/test-stability maintenance line; preserve Review runtime behavior, Safe Contract v2, Policy Schema v3, Review Receipt v4 and Review Prompt Contract v1.

## 4.3.1 - 2026-08-28

- Publish the complete bilingual OpenAI-compatible relay setup and troubleshooting guide; runtime, Safe Contract, Core pin and provider behavior are unchanged.

## 4.1.1 - 2026-08-27

- Repin the exact Safe Core 4.4.1 immutable-release publication patch; Review runtime, Quality Platform and protocol semantics are unchanged.
- Publish new VSIX/SBOM/checksum assets under repository-level immutable Releases and verify the published assets in CI.

## 4.1.0 - 2026-08-27

- Adopt Safe Core 4.4 Quality Platform with user review profiles, bounded local Impact Evidence, pre-generated SARIF evidence, deterministic controller summaries and explicit preview-before-apply fix proposals.
- Keep Safe Contract v2, Policy Schema v3, Review Receipt v4, exact changed-line publication and Workspace Trust unchanged.

## 4.0.1

### Fixed

- Localize the `confidenceThreshold` setting description so Simplified-Chinese VS Code settings no longer expose an English-only string.

### Changed

- Repin to the coordinated Safe Core 4.0.1 security-maintenance commit.
- Pin GitHub Actions Node setup to the upstream verified post-v7.0.0 commit that fixes GHSA-3jxr-9vmj-r5cp.

## 4.0.0

### Changed

- Hard-switch to Safe Core 4.0.0 and Review Receipt v4 with complete Core/Contract/Policy/Prompt/model/Codex provenance.
- Add immutable VSIX releases with SPDX SBOM, SHA256 checksums, provenance attestations, Scorecard, and no asset overwrite.
- Keep Review findings exact-line, coverage-preserving and fail-closed; Receipt v3 is intentionally unsupported.

## 3.0.0

### Changed

- Hard-switched to Codex Safe Core 3.0.1, Policy Schema v3 and Review Receipt v3.
- Replaced narrative diff truncation with coverage-preserving Review Evidence Chunks.
- Removed ±3 finding relocation; local findings require exact post-change changed lines.
- Added canonical deterministic repository review rules and explicit coverage/mechanical evidence.

## 2.1.0

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
- Unify CI/release gates, retain real Workspace Trust and zh-CN Extension Host coverage, SHA-256 plus full-SHA-pinned GitHub build-provenance attestations.
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
