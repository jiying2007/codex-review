# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Review **staged Git changes only** in VS Code and turn validated findings into a versioned quality receipt without giving the model control of the repository.

Codex Review Safe is the quality-gate stage of the **Codex Safe Git Workflow** family:

```text
Codex Review Safe
      ↓ Review Receipt v2
Codex Commit Safe
      ↓ Commit Receipt v2
Codex PR Safe
      ↓ verified PR provenance
```

Shared safety/runtime infrastructure comes exclusively from the pinned [`codex-safe-core`](https://github.com/jiying2007/codex-safe-core) Git submodule.

## What it does

- Reviews staged/index changes only.
- Produces structured findings in Simplified Chinese or English.
- Uses Safe Core Semantic Context Budget instead of raw first-N-byte truncation.
- Validates every finding locally: schema, severity, category, file, line range and confidence.
- Suppresses findings below `confidenceThreshold` before they can affect Problems, verdicts or receipts.
- Publishes inline Problems only when the location can be mapped safely to the current file.
- Keeps unsafe/unmappable findings in the report instead of forcing a diagnostic.
- Protects against stale results with HEAD + raw-index snapshots.
- Separates **quality verdict** from **delivery readiness**.
- Persists Review Receipt v2 tied to HEAD, index, full diff and policy fingerprints.
- Exposes read-only range evidence to Commit/PR companions.

## What it never does

- It never edits source code.
- It never commits or pushes.
- It never opens/submits a pull request.
- It never gives Codex shell access.
- It never gives Codex network/web-search access.
- It never treats “no findings” as proof that requirements, builds or tests passed.

## Safety boundary

Safe Core v2 requires the Codex CLI capabilities needed for:

- `--ask-for-approval never`
- `exec --json`
- ephemeral execution
- ignored user/project Codex rules for this request
- read-only sandbox
- Structured Output schema
- explicit disabling of shell, unified exec, web search, apps, hooks, memories, multi-agent and related capabilities

Missing required capabilities cause a fail-closed upgrade error. There is no legacy CLI fallback.

The complete staged diff is retained locally for fingerprints, line mapping and Review Receipt evidence. Model input is independently reduced by Safe Core Semantic Context Budget:

- source files receive a fair per-file budget;
- generated/lock files are metadata-only;
- binary files are metadata-only;
- oversized source files keep bounded head/tail context;
- raw staged diff has a fixed 8 MiB safety ceiling.

## Finding precision

A finding has a `confidence` value from `0` to `1`. The default `confidenceThreshold` is `0.70`.

```text
model finding
    ↓ schema/path validation
confidence >= threshold?
    ├─ yes → finding → diagnostic/verdict/receipt
    └─ no  → suppressed finding
```

Suppressed findings do not affect `qualityVerdict` or Review Receipt state. This is intentional: the quality gate optimizes for evidence-backed precision rather than finding count.

## Repository policy

The only repository policy file is `.codex-safe.json` with `schemaVersion: 2`.

```json
{
  "$schema": "https://raw.githubusercontent.com/jiying2007/codex-safe-core/d49dc356824b984166e81e42bb5f9d7abfb90099/codex-safe.schema.json",
  "schemaVersion": 2,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "Focus on correctness, resource lifetime, concurrency, bounds and error handling."
  }
}
```

Only the policy committed in **HEAD** is effective. A staged policy change cannot weaken the review that evaluates that same change.

Repository policy cannot select the Codex executable, model, environment, working directory or arbitrary commands. `safeCodexReview.codexPath` is machine-scoped; other user preferences are application-scoped.

`maxDiffBytes` is the **model semantic-context budget**, not the raw-diff rejection threshold.

## Verdicts and receipts

Review Safe separates two dimensions:

- `qualityVerdict`: `no_findings`, `findings_open`, or `blocked`;
- `readinessVerdict`: remains evidence-driven and does not claim requirements/build/test completion.

A Review Receipt v2 contains the exact HEAD, index, diff and policy fingerprints together with quality/readiness/mechanical-gate state and execution metadata.

Commit Safe only consumes a receipt when it matches the exact staged snapshot. PR Safe can later verify receipts against committed first-parent diffs.

## Diagnostic safety

A validated finding may still be report-only. Problems publishing is withheld for cases such as:

- deleted files;
- binary files;
- submodule changes;
- dirty editors;
- unstaged overlays;
- symlink escape outside the repository;
- rename/copy with no changed line;
- line locations that cannot be mapped safely.

This keeps the diagnostic UI conservative while preserving complete review evidence in the report.

## Usage

1. Stage the intended changes.
2. Open **Source Control**.
3. Run **Codex Review Safe: Review Staged Changes**.
4. Inspect safe inline findings in **Problems**.
5. Open **Codex Review Safe: Show Review Report** for the complete result.
6. Fix/stage changes and rerun until satisfied.
7. Commit manually or continue with Codex Commit Safe.

**Clear Review Results** also clears locally persisted Review Receipt history.

## Requirements

- VS Code `1.90.0` or newer
- Git
- OpenAI Codex CLI installed and authenticated where the workspace extension host runs

## Build and test

```bash
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run test:trust
npm run package
```

Marketplace/Release runtime is `dist/extension.js`. The VSIX contains only the deterministic staged runtime under `dist/`, the canonical `dist/codex-safe.schema.json`, localization, icon and release documentation. Source, tests, scripts and submodule metadata are rejected by CI package-boundary checks.

CI gates include:

- static/contract/module-boundary tests;
- unit/regression tests;
- Linux/Windows/macOS Extension Host tests;
- minimum VS Code `1.90.0`;
- Simplified-Chinese localization smoke;
- real Workspace Trust / Restricted Mode tests;
- official VSIX boundary audit and SHA-256 generation.

## Release integrity

A version change on `main` runs the complete release gate. The immutable tag and GitHub Release are created only after validation and integration tests pass.

Release artifacts include:

- `codex-review-safe-<version>.vsix`
- `SHA256SUMS`
- GitHub build-provenance attestations for both artifacts

Only the final release job receives `contents: write`, `id-token: write`, and `attestations: write`; validation jobs remain read-only. Actions are pinned to immutable full commit SHAs.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [PUBLISHING.md](PUBLISHING.md).

## Product-family boundary

| Product | Responsibility | Does not do |
| --- | --- | --- |
| **Codex Review Safe** | Staged-change quality gate + Review Receipt | write code / commit |
| Codex Commit Safe | Commit message + verified Commit Receipt | commit / push |
| Codex PR Safe | PR narrative + provenance | push / submit PR automatically |

The design principle is: **AI-assisted Git workflow without surrendering control of Git to the AI.**

## License

MIT
