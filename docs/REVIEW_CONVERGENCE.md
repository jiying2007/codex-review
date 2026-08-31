# Review Convergence and Independent Review Protocol

Codex Review Safe separates **what is being reviewed** from **each execution that reviews it**. Repeated review is no longer allowed to turn a cached model judgment into fake convergence.

## ReviewSubject and ReviewRun

A `ReviewSubjectKey` identifies the immutable semantic review subject: HEAD/index/diff, policy, scope/profile, analyzer evidence, prompt contract, model identity/options, and the immutable Evidence Manifest.

A `ReviewRunId` identifies one actual fresh model execution. Multiple fresh runs may therefore exist for the same `ReviewSubjectKey`.

This distinction is mandatory:

- same `ReviewSubjectKey` means the code/evidence subject is unchanged;
- same subject does **not** mean a previous model judgment is a new review;
- `ReviewRunId` is the idempotency key for lineage persistence;
- a result replay never creates a new lineage run or review receipt.

## Evidence Cache vs Judgment Replay

The cache is split into two stores.

### Evidence cache

Deterministic, immutable evidence may be reused when its fingerprint is unchanged: staged diff evidence, index-pinned dependency/symbol evidence, impact graph data, analyzer evidence, and the Evidence Manifest.

An evidence cache hit is reported as `evidence=cache-hit`. It is allowed during an independent review because it does not contain a prior model verdict.

### Judgment replay

A validated model result may be retained only as explicit history/replay. It is never an input to a fresh reviewer and never counts as fresh stability evidence.

A replay is reported as `inference=replay`, `judgment=replay-only`, and `[result-replay]`. It does not increment lineage, convergence, or receipt history.

Legacy whole-review cache state (`semanticRuns.v1`) is purged and is not migrated into the new protocol.

## Independent Review

`Independent Review Staged Changes` always executes fresh model inference for the current `ReviewSubjectKey`.

It may reuse deterministic Evidence Cache entries, but it must remain blind to:

- previous accepted findings;
- previous suppressed hypotheses/findings;
- previous coverage verdicts;
- previous model summaries or explanations;
- previous false-positive decisions.

The previous judgments are reconciled only **after** the fresh model execution, in deterministic lineage/stability logic.

Fresh disagreement is preserved. Codex Review Safe does not suppress a new finding merely because an earlier reviewer did not produce it.

## Review Lineage

A Review Session is keyed by HEAD, Policy fingerprint, Scope fingerprint, and Review Profile. Inside a session, lineage now has two dimensions:

1. **Subject transition** — when the staged subject changes, stable finding IDs classify `fixed`, `unchanged`, `changed`, `new`, `reintroduced`, and `likely-fix-induced` findings.
2. **Repeated subject runs** — when the subject is unchanged, multiple fresh runs measure reviewer agreement and stability without pretending that the code changed.

`likely-fix-induced` remains a heuristic signal only; it does not claim proven causality.

## Fresh provenance gate

Convergence requires provenance, not merely identical serialized output.

By default a subject needs at least two fresh, blind model runs. Stability records:

- required fresh runs;
- fresh inference runs;
- complete fresh runs;
- blind fresh runs;
- independent-review runs;
- cached-verdict runs;
- finding-set agreement;
- disagreement finding IDs.

The latest required fresh runs must all have complete coverage. A cached/replayed verdict cannot satisfy the stability gate.

## Convergence

The convergence state is:

- `converged`: coverage is complete, fresh provenance is complete, the latest required fresh runs agree, and there are no publishable findings;
- `improving`: a changed subject closed more findings than it added;
- `regressing`: a changed subject reintroduced/likely induced findings or added more than it fixed;
- `active`: findings remain without a stronger improvement/regression signal;
- `incomplete`: evidence coverage is incomplete, the required fresh blind runs are missing/incomplete, or fresh reviewers disagree.

The report exposes the reason (`fresh_runs_missing`, `blind_context_missing`, `fresh_coverage_incomplete`, `finding_disagreement`, or `judgment_cache_used`) rather than collapsing every case into an opaque `blocked` result.

## Layered readiness

The report separates three questions:

- `Defect verdict`: whether evidence-verified code findings are open;
- `Evidence readiness`: whether review evidence/coverage is complete;
- `Overall readiness`: whether the current evidence is sufficient for delivery readiness.

This prevents `no_findings` plus missing HIL/build/requirements evidence from looking like a contradictory code defect verdict.

## Changed causal anchor

A Finding must still anchor to an exact staged added/modified causal span. `supportingLocations` may point to unchanged symptom/dependency/test/configuration evidence, but never bypass the changed-line gate.

## Deterministic invariants

Verified findings may still nominate deterministic regression invariants. Repeated model review should be used to discover durable invariants; once expressed as deterministic tests/rules, those checks should no longer depend on the model rediscovering the same problem.
