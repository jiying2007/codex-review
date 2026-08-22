# Security

Codex Review Safe follows the **Codex Safe Core v2** contract. Security-sensitive shared primitives are owned by the pinned `codex-safe-core` submodule; this repository owns Review-specific finding, diagnostic and receipt logic only.

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

The complete staged diff remains local for fingerprints and line mapping. Raw diff has a fixed 8 MiB safety ceiling.

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

The only repository policy is `.codex-safe.json` schema v2. Review consumes only its `review` section from the exact captured HEAD.

A staged policy modification cannot change the policy used to review itself; it becomes effective only after commit.

Repository policy cannot configure:

- Codex executable;
- model;
- environment variables;
- working directory;
- arbitrary commands.

`safeCodexReview.codexPath` is machine-scoped. Remaining user preferences are application-scoped.

### 5. Model output

AI output is untrusted structured data. Each finding must pass local validation for:

- closed schema;
- severity/category allow-lists;
- staged relative path membership;
- post-change line/range validity;
- bounded title/description/suggestion;
- confidence in `[0, 1]`.

Findings below `confidenceThreshold` are suppressed before they can affect Problems, quality verdicts or Review Receipt state.

## Semantic Context Budget

`maxDiffBytes` is the model-context budget, not the raw-diff limit.

Safe Core parses the unified diff by file:

- source files receive a fair per-file allocation;
- generated/lock files are metadata-only;
- binary files are metadata-only;
- oversized source files retain bounded head/tail context.

Fingerprints, changed-line mapping and receipts still use the complete original diff.

## Diagnostic safety

Problems is a conservative projection of a staged snapshot onto the current working tree.

A valid finding becomes report-only when inline publication cannot be proven safe, including:

- deleted files;
- binary files;
- submodules;
- dirty editors;
- unstaged overlays;
- repository symlink escape;
- pure rename/copy without content change;
- unmappable line locations;
- file mutation during publication.

Paths are normalized and realpath containment is checked before file content is read for diagnostic placement.

## Verdict and receipt semantics

Review Safe separates:

- `qualityVerdict`: what the supplied diff review found;
- `readinessVerdict`: whether independent delivery evidence exists;
- `mechanicalGate`: separately tracked mechanical verification state.

`qualityVerdict=no_findings` is never treated as proof of requirement, build or test success.

Review Receipt v2 contains fingerprints/verdict metadata, not source diff or generated finding text. Receipt history is stored in VS Code extension global state and exposed only through a read-only companion API.

Range evidence recomputes committed first-parent diffs before associating historical receipts with real commits.

Receipts are AI workflow evidence, not human approval.

## Process handling

Process execution is delegated to Safe Core. Native processes run without an unrestricted shell. Windows script shims use explicit quoting. Timeout, cancellation, process-tree termination and stdout/stderr limits are enforced.

## Logging

Operational logs must not persist:

- source code;
- staged diff content;
- finding/report text beyond the user-facing in-session report;
- secrets;
- absolute repository paths.

## Data flow

Semantic review context leaves the local machine for the configured Codex service. Use the extension only when allowed by the organization's source-code/data policy.

Organization-managed Codex policy, managed hooks, MDM or cloud controls may still apply; the extension does not attempt to bypass them.

## Release supply chain

Marketplace/Release runtime is `dist/extension.js`; the canonical policy schema is `dist/codex-safe.schema.json`. CI rejects source, tests, scripts and submodule metadata in the VSIX.

Validation jobs use read-only repository permissions. Only the final release job receives:

- `contents: write`;
- `id-token: write`;
- `attestations: write`.

Release validation covers lock integrity, module/security boundaries, unit/regression tests, Workspace Trust, Simplified-Chinese localization, latest Linux/Windows/macOS Extension Host, minimum VS Code `1.90.0`, VSIX boundary audit and SHA-256 generation.

GitHub Actions are pinned to immutable full commit SHAs. Release artifacts (`.vsix` and `SHA256SUMS`) receive GitHub build-provenance attestations.

## Reporting a vulnerability

Do not disclose security-sensitive issues publicly before remediation. Use the repository's GitHub security reporting mechanism when available, or contact the maintainer privately through the repository owner profile.
