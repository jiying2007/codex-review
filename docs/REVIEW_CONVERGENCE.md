# Review Convergence and Adaptive Replay Protocol

Codex Review Safe separates **deterministic evidence**, **fresh model judgment**, **short-lived replay**, and **durable audit history**.

## Review and Fresh Blind Review

For an unchanged `ReviewSubjectKey`, the normal Review action automatically follows:

`fresh → replay → replay → fresh → replay → replay → fresh ...`

**Fresh Blind Review** explicitly bypasses this replay window and starts a fresh model run for the current subject. It preserves all evidence, coverage, and convergence gates.

A changed HEAD/index/diff, policy, scope/profile, model/options, prompt contract, analyzer/SARIF input, or Evidence Manifest produces a different subject and therefore requires fresh inference.

## Persistent Evidence Cache

Only deterministic structural evidence is persisted: staged/index-pinned evidence, symbol/dependency evidence, impact graph data, and its structural Evidence Manifest. It is content-addressed and invalidated by fingerprints, not by wall-clock TTL. Analyzer/SARIF evidence is composed into the final Evidence Manifest on every invocation, so analyzer changes do not force an expensive structural rescan.

`evidence=structural-cache-hit` means evidence was reused. It does **not** mean model inference was skipped.

## Session Replay Window

Model judgments are not persisted as cache. A recent fresh result may be replayed only inside the current extension session, only for the exact same `ReviewSubjectKey`, with both limits:

- at most 2 consecutive replays;
- at most 10 minutes since the origin fresh run.

After either limit, the next Review must execute fresh blind model inference. Restarting VS Code also clears the Replay Window, so the next Review is fresh while deterministic Evidence Cache may still be reused.

A replay never creates a new `ReviewRunId`, lineage run, Review Receipt, or fresh-convergence evidence.

## Fresh blind review

Every fresh run receives the current diff/evidence but never previous findings, suppressed hypotheses, coverage verdicts, summaries, explanations, or human resolution decisions as model context. Previous judgments are reconciled only after inference by deterministic lineage/stability logic.

## Review lineage and convergence

`ReviewSubjectKey` identifies the immutable review subject. `ReviewRunId` identifies one actual fresh model execution. Convergence still requires at least two fresh blind runs with complete coverage and matching finding sets. Replay cannot satisfy this requirement.

An unresolved verifier result or missing mandatory staged/dependency evidence makes coverage incomplete. A failed mechanical gate blocks readiness even if there are no publishable findings. Repeating either result cannot make it ready.

The report must distinguish `fresh`, `result-replay`, and `structural-cache-hit`. Durable judgment history lives only in Review Receipt + Review Lineage; it is audit evidence, not future model input.
