# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

A VS Code extension that reviews **staged Git changes only** with your local Codex CLI, deterministic repository rules, exact changed-line validation, fail-closed evidence coverage, and provenance-backed independent re-review.

## Start here

Use this product when you want a quality gate **before commit** without giving AI authority to edit source, commit, push, or create a PR.

Requirements:

- VS Code 1.90.0+
- Git
- OpenAI Codex CLI installed and authenticated in the same environment where the VS Code Extension Host runs
- a trusted, local-filesystem Git workspace

For Remote SSH, Dev Containers, Codespaces or WSL, install/authenticate Codex in that remote environment and set `safeCodexReview.codexPath` there.

### First successful review

1. Stage the files you want reviewed.
2. Run **Codex Review Safe: Check Codex Environment** once.
3. Run **Codex Review Safe: Review Staged Changes** from Source Control or the Command Palette.
4. Read exact-line findings and the complete Review report.
5. Fix issues, stage again, re-run Review, then commit manually.

Working-tree-only edits are intentionally excluded from the reviewed snapshot.

See [Getting Started](docs/GETTING_STARTED.md) for installation, configuration and troubleshooting.

## Fresh and independent review

Codex Review Safe distinguishes the immutable subject from each real model execution:

- `ReviewSubjectKey` answers **what is being reviewed**;
- `ReviewRunId` identifies **one actual fresh model run**;
- deterministic semantic evidence may be reused through the Evidence Cache;
- a prior model judgment is never fed into a fresh reviewer;
- a replay of an identical subject is explicitly marked `[result-replay]` and does not create a new lineage run, convergence run, or Review Receipt;
- **Independent Review Staged Changes** forces fresh, blind model inference while still allowing deterministic evidence reuse.

For convergence, the default protocol requires at least two fresh blind runs for the same subject. If independent reviewers disagree, the disagreement remains visible and convergence stays incomplete; findings are not suppressed merely to manufacture stability.

See [Review Convergence](docs/REVIEW_CONVERGENCE.md) for the full ReviewSubject/ReviewRun, cache, lineage, and provenance contract.

## What it guarantees

- staged snapshot only, bound to HEAD + raw Git index fingerprint;
- Policy Schema v4 from committed HEAD `.codex-safe.json`;
- coverage-preserving Review Evidence Chunking with explicit gaps instead of silent hunk truncation;
- deterministic Evidence Cache is separated from model Judgment Replay;
- independent re-review performs fresh blind inference and never consumes previous findings/suppressed hypotheses as reviewer input;
- convergence requires fresh provenance rather than cached-output equality;
- model findings must resolve to exact post-change changed lines;
- deterministic repository rules run outside the model;
- low-confidence findings are filtered before Problems/verdicts;
- incomplete coverage or invalid findings fail closed;
- Review Receipt v4 records immutable evidence/provenance for fresh review executions;
- Restricted Mode is rejected;
- Codex runs with Safe Contract v2: ephemeral execution, read-only sandbox, no approvals, no shell/web/apps/multi-agent/plugins/hooks/goals/memories/dependency installation;
- no source edits, commit, push or PR side effects.

Shared safety/runtime and repository-policy validation come only from the exact commit-pinned **Codex Safe Core 4.10.0** submodule at `57440a00030941020d5c3e9e01ced3c06062f42e`.

## Reading readiness correctly

The report separates:

- `Defect verdict` — confirmed evidence-backed code findings;
- `Evidence readiness` — semantic review/coverage completeness;
- `Overall readiness` — whether current evidence is enough to claim delivery readiness.

Therefore `no_findings` can correctly coexist with incomplete build/HIL/requirements evidence without implying that a code defect was found.

## Repository policy

The only repository policy file is committed `.codex-safe.json` with `schemaVersion: 4`. Safe Core owns the closed `commit`, `review`, `change`, and `reviewService` sections; Review Safe consumes only its relevant Review policy while leaving Change delivery interpretation to Codex Change Safe.

```json
{
  "$schema": "https://raw.githubusercontent.com/jiying2007/codex-safe-core/57440a00030941020d5c3e9e01ced3c06062f42e/codex-safe.schema.json",
  "schemaVersion": 4,
  "review": {
    "language": "en",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "rules": {
      "requireTestsForCodeChanges": true,
      "codePathPrefixes": ["src/"],
      "testPathPrefixes": ["test/", "tests/"],
      "forbiddenPathPrefixes": []
    }
  },
  "change": {}
}
```

`maxDiffBytes` is the model/evidence budget, not the raw staged-diff rejection threshold. The raw staged diff has a fixed safety ceiling and remains the deterministic fingerprint source.

## Family workflow

```text
staged changes
    ↓
Codex Review Safe → Review Receipt v4
    ↓
Codex Commit Safe → Commit Receipt v4
    ↓
manual git commit / push
    ↓
Codex Change Safe → Change Receipt v1
    ↓
GitHub PR / GitLab MR
```

Each product remains independently useful. **Codex PR Safe** is retired as the former model-generated PR-description product; **Codex Change Safe** is the deterministic successor delivery stage and does not restore that narrative generator.

## Install, upgrade and verify

Install from the VS Code Marketplace or an immutable GitHub Release VSIX. After upgrading, run **Check Codex Environment** before the first review.

Release artifacts are built once, checksummed and attested. See [VERIFY_RELEASE.md](VERIFY_RELEASE.md) and [PUBLISHING.md](PUBLISHING.md).

## Development

```bash
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

## Support and security

- Usage/troubleshooting: [SUPPORT.md](SUPPORT.md)
- Security boundary/reporting: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Identity

- Publisher: `jiying2007`
- Extension ID: `jiying2007.codex-review-safe`
- Settings: `safeCodexReview.*`

## License

MIT

## Codex provider runtime

Codex Review Safe intentionally ignores `~/.codex/config.toml` to preserve the Safe Contract. For an OpenAI-compatible relay, set `safeCodexReview.providerMode` to `openai-compatible`, configure `safeCodexReview.providerBaseUrl`, and set `safeCodexReview.providerApiKeyEnv` to the name of an environment variable visible to the VS Code process. Compatible providers use Responses HTTP/SSE rather than WebSocket. `Check Environment` performs a live structured provider probe.
