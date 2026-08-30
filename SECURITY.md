# Security

Codex Review Safe follows the **Codex Safe Core v4** implementation line while keeping **Safe Contract v2** unchanged. Security-sensitive shared primitives are owned by the pinned `codex-safe-core` submodule; this repository owns Review-specific finding, diagnostic and report behavior only.

## Trust boundaries

### 1. Workspace

- Restricted Mode is unsupported.
- Virtual workspaces are unsupported.
- Runtime commands enforce Workspace Trust; menu visibility is not the security boundary.
- Multi-repository ambiguity fails closed.

### 2. Git repository

A review is bound to the exact staged snapshot:

- HEAD OID, including unborn HEAD;
- SHA-256 of raw `git ls-files --stage -z` index bytes;
- SHA-256 of the complete staged diff;
- HEAD-pinned repository policy fingerprint.

Snapshots are checked before/after collection, after model execution and after diagnostic publication. Stale diagnostics are retracted.

The complete staged diff remains local for fingerprints and changed-line mapping. Raw diff has a fixed 8 MiB safety ceiling.

### 3. Codex executable

Safe Core performs CLI capability negotiation. Required review capabilities include:

- `--ask-for-approval never`;
- `exec --json`;
- ephemeral execution;
- ignored user/project Codex rules for this request;
- read-only sandbox;
- output schema;
- explicit Safe Core configuration overrides.

Shell, unified exec, web search, apps, multi-agent, remote plugins, hooks, goals, memories and related capabilities are disabled for the request.

If a required capability is missing or a required safety argument is rejected, review fails closed. There is no compatibility fallback that weakens the contract.

Codex executes from a temporary directory rather than the repository.

### 4. Repository policy

The only repository policy is `.codex-safe.json` **Policy Schema v3**. Review consumes the `review` section from the exact captured HEAD. Policy v2 is intentionally rejected.

A staged policy modification cannot change the policy used to review itself; it becomes effective only after commit.

Repository policy cannot configure Codex executable/model, environment variables, working directory, or arbitrary commands.

`safeCodexReview.codexPath` is machine-scoped. Remaining user preferences are application-scoped.

### 5. Review Evidence coverage

`maxDiffBytes` is a bounded Review Evidence budget, not the raw-diff limit.

Safe Core v4 parses unified diff hunks into **coverage-preserving Review Evidence Chunks**:

- changed hunks are never silently middle-truncated;
- every hunk is either included in one chunk or emitted as an explicit coverage gap;
- exceeding a per-hunk or total chunk budget produces `coverageVerdict=incomplete`;
- incomplete coverage blocks the review verdict.

Fingerprints and changed-line mapping still use the complete original diff.

### 6. Model output

AI output is untrusted structured data. Each model finding must pass local validation for:

- closed schema;
- severity/category allow-lists;
- staged relative path membership;
- exact **post-change added/modified changed-line** location;
- bounded title/description/suggestion;
- confidence in `[0, 1]`.

The previous ±3 nearest-changed-line relocation is removed. A finding that cannot prove an exact post-change changed line is rejected; rejected locations make coverage incomplete rather than being silently relocated.

Findings below `confidenceThreshold` are suppressed before they can affect Problems or quality verdicts.

### 7. Deterministic repository rules

`.codex-safe.json.review.rules` is evaluated by the canonical Safe Core rule evaluator. Review Safe does not maintain a separate interpretation of:

- `forbiddenPathPrefixes`;
- `requireTestsForCodeChanges`;
- `codePathPrefixes`;
- `testPathPrefixes`.

Rule violations remain part of the mechanical gate even when a local Problems diagnostic cannot safely map to a current working-tree line.

## Diagnostic safety

Problems is a conservative projection of a staged snapshot onto the current working tree.

A validated finding becomes report-only when inline publication cannot be proven safe, including deleted/binary/submodule changes, dirty editors, unstaged overlays, repository symlink escape, pure rename/copy without content change, or file mutation during publication.

Paths are normalized and realpath containment is checked before file content is read for diagnostic placement.

## Verdict and receipt semantics

Review Safe separates:

- `qualityVerdict`: what the reviewed evidence found;
- `readinessVerdict`: whether delivery evidence is sufficient;
- `mechanicalGate`: deterministic repository-rule state;
- `coverageVerdict`: whether all required changed hunks were reviewed.

`qualityVerdict=no_findings` is never treated as proof of requirement, build or test success.

**Review Receipt v4** uses a `git-index` subject and binds HEAD/index/diff/policy fingerprints with quality/readiness/mechanical/coverage verdicts. It contains provenance metadata, not source diff or finding text. Receipt history is stored in VS Code extension global state and exposed only through a read-only companion API.

Range evidence recomputes committed first-parent diffs before associating historical receipts with real commits.

Receipts are AI workflow evidence, not human approval.

## Process handling

Process execution is delegated to Safe Core. Native processes run without an unrestricted shell. Windows script shims use explicit quoting. Timeout, cancellation, process-tree termination and stdout/stderr limits are enforced.

## Logging

Operational logs must not persist source code, staged diff content, finding/report text beyond the user-facing in-session report, secrets, or absolute repository paths.

## Data flow

Review evidence leaves the local machine for the configured Codex service. Use the extension only when allowed by the organization's source-code/data policy.

Organization-managed Codex policy, managed hooks, MDM or cloud controls may still apply; the extension does not attempt to bypass them.

## Release supply chain

Marketplace/Release runtime is `dist/extension.js`; the canonical Policy v3 schema is `dist/codex-safe.schema.json`. CI rejects source, tests, scripts and submodule metadata in the VSIX.

Validation jobs use read-only repository permissions. Only the final release job receives `contents: write`, `id-token: write`, and `attestations: write`.

Release validation covers lock integrity, module/security boundaries, unit/regression tests, Workspace Trust, Simplified-Chinese localization, latest Linux/Windows/macOS Extension Host, minimum VS Code `1.90.0`, VSIX boundary audit and SHA-256 generation.

GitHub Actions are pinned to immutable full commit SHAs. Release artifacts (`.vsix` and `SHA256SUMS`) receive GitHub build-provenance attestations.

## Reporting a vulnerability

Do not disclose security-sensitive issues publicly before remediation. Use the repository's GitHub security reporting mechanism when available, or contact the maintainer privately through the repository owner profile.
