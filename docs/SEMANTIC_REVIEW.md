# Semantic Review 4.2

Codex Review Safe 4.2 treats the staged Git index as an immutable review subject and separates candidate reasoning from finding publication.

## Review subject

The only review target is the staged diff. Dependency context is acquired read-only from the same Git index snapshot (`git show :path`); unstaged working-tree content is never semantic evidence. Pre-generated SARIF remains data-only evidence and no analyzer command is executed.

The controller builds an Evidence Manifest containing bounded staged, dependency, symbol declaration/definition and analyzer evidence entries. Every entry has a stable evidence ID and content digest. The manifest digest participates in the ReviewKey.

## Symbol evidence

Changed C/C++ call sites are extracted as semantic requirements. The controller resolves bounded declaration/definition references with `git grep --cached`, then reads matching snippets from the index. Dependency files are context only and can never become finding targets.

## Two-stage review

1. **Hypothesis stage** — Codex may propose a candidate claim only on an exact changed line. Any external semantic premise must be listed as an assumption and required symbol.
2. **Verification stage** — semantic hypotheses are checked only against supplied immutable evidence. Results are `verified`, `insufficient_evidence`, or `contradicted`, with exact evidence IDs.

A high model confidence is not evidence. A semantic hypothesis with unresolved assumptions cannot be published. Final findings carry a stable finding ID, evidence grade, evidence references and evidence digest.

## Repeated review convergence

A ReviewKey binds HEAD, index fingerprint, diff fingerprint, policy fingerprint, execution profile, Evidence Manifest digest, analyzer digest, semantic contract/options and model identity. Re-running the same ReviewKey reuses the validated cached result instead of calling Codex again.

`Force Re-review Staged Changes` bypasses the cache. If the same frozen ReviewKey produces an unstable model finding set, unstable model findings are suppressed and the review is fail-closed with an explicit stability coverage gap.

## Finding resolutions

Users can resolve a verified finding as `fixed`, `false_positive`, `accepted_risk`, `duplicate`, `obsolete`, `not_applicable`, or `policy_exception`. Resolutions are keyed by stable finding ID plus evidence digest. If the dependency implementation/evidence changes, the old resolution automatically stops applying and the finding is verified again.

`Clear Review Results` does not erase the resolution ledger. Resolution history can be cleared explicitly with `Clear Finding Resolutions`.

## Safety boundaries

- no model tools, shell, network, repository-rule execution or additional file reads;
- repository I/O is controller-owned and bounded;
- dependency context is index-pinned and untrusted;
- findings must still anchor to exact staged changed lines;
- safe fix proposals remain preview-first, working-tree-only, and never stage/commit/push/merge automatically.


## Review lineage and Scope Contract

Review 4.2 can read an optional `.codex-review-scope.json` from HEAD and records cross-index Review Lineage inside one HEAD/Policy/Scope/Profile session. See [Review Convergence](REVIEW_CONVERGENCE.md).
