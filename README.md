# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

A VS Code extension that reviews **staged Git changes only** with your local Codex CLI, deterministic repository rules, exact changed-line validation, and fail-closed evidence coverage.

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
4. Read exact-line findings in Problems and the complete Review report.
5. Fix issues, stage again, re-run Review, then commit manually.

Working-tree-only edits are intentionally excluded from the reviewed snapshot.

See [Getting Started](docs/GETTING_STARTED.md) for installation, configuration and troubleshooting.

## What it guarantees

- staged snapshot only, bound to HEAD + raw Git index fingerprint;
- Policy Schema v3 from committed HEAD `.codex-safe.json`;
- coverage-preserving Review Evidence Chunking with explicit gaps instead of silent hunk truncation;
- model findings must resolve to exact post-change changed lines;
- deterministic repository rules run outside the model;
- low-confidence findings are filtered before Problems/verdicts;
- incomplete coverage or invalid findings fail closed;
- Review Receipt v4 records immutable evidence/provenance;
- Restricted Mode is rejected;
- Codex runs with Safe Contract v2: ephemeral execution, read-only sandbox, no approvals, no shell/web/apps/multi-agent/plugins/hooks/goals/memories/dependency installation;
- no source edits, commit, push or PR side effects.

Shared safety/runtime behavior comes only from the exact commit-pinned `codex-safe-core` v4 submodule.

## Repository policy

The only repository policy file is committed `.codex-safe.json` with `schemaVersion: 3`:

```json
{
  "$schema": "https://raw.githubusercontent.com/jiying2007/codex-safe-core/6c0417a376179c295433c18b1b077854d290243d/codex-safe.schema.json",
  "schemaVersion": 3,
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
  }
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
Codex PR Safe → PR narrative + provenance
```

Each product remains independently useful; provenance becomes richer when they are used together.

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
