# Changelog

## Unreleased

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
