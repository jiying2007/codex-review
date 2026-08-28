# Review Convergence 4.2

Codex Review Safe 4.2 treats iterative staged edits as a review session instead of unrelated one-shot model calls.

## Scope Contract

An optional `.codex-review-scope.json` is read from **HEAD**, not from the working tree or staged version. This prevents the change under review from weakening its own scope boundary. The contract is product-owned and does not change Safe Policy Schema v3.

Supported fields are `phase`, `goals`, `invariants`, `nonGoals`, `managedPaths`, `complexityBudget`, and `notes`. Unknown fields or invalid values fail closed when the file exists. When the file is absent, Review does not invent non-goals and does not suppress findings on scope grounds.

Scope constrains remediation breadth, not factual correctness. A concern classified as `non_goal_risk` or `needs_scope_decision` is report-only when an explicit Scope Contract exists, unless the changed line violates an invariant copied verbatim from that contract.

## Review Lineage

A review session is keyed by HEAD, Policy fingerprint, Scope fingerprint, and Review Profile. Changes to the staged index create new ReviewKeys inside the same session while HEAD remains unchanged.

For each new ReviewKey the lineage records stable finding identities and classifies transitions as:

- `fixed`
- `unchanged`
- `changed`
- `new`
- `reintroduced`
- `likely-fix-induced`

`likely-fix-induced` is intentionally heuristic: it means a new stable finding appeared in a file where the immediately previous run closed a finding. It is a debugging/convergence signal, not proof of causation.

## Convergence

The report derives a convergence state:

- `converged`: complete coverage, stable review, no publishable findings;
- `improving`: more previous findings were fixed than new findings appeared;
- `regressing`: reintroduced or likely-fix-induced findings exist, or new findings exceed fixes;
- `active`: review still has findings without a clear improvement/regression signal;
- `incomplete`: evidence/coverage or Force Re-review stability is incomplete.

Metrics include closure rate, fix-induced rate, reintroduced rate, run number, and deterministic-invariant candidates.

## Changed causal anchor

Findings still require an exact staged changed line as their causal anchor. The model may additionally provide `supportingLocations` for unchanged symptoms, dependency code, tests, configuration, or state displays.

This addresses cases where a changed state transition exposes a bug in unchanged presentation code without restoring nearest-line mapping. The unchanged symptom is supporting evidence only; Problems diagnostics remain anchored to the exact changed causal line.

## Deterministic invariants

Verified findings may mark themselves as `invariantCandidate` and provide an `invariantText`. These are surfaced in the report so recurring state-machine and concurrency defects can be converted into deterministic tests instead of being rediscovered by the model on every iteration.

The 4.2 regression corpus includes both ownership-semantic hard negatives and repeated-review hard positives from a production-aging thermal state-machine case.
