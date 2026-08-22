# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Review **staged Git changes only** in VS Code with a local Codex CLI, fail-closed evidence coverage, deterministic repository rules, and a narrow execution boundary.

Codex Review Safe 4.0 uses **Codex Safe Core 4.0.0** pinned to commit `4dc4de836625a8b70084531eb3321734eca675d0`. Repository policy is a single HEAD-pinned `.codex-safe.json` document with `schemaVersion: 3`; Policy v2 is intentionally rejected.

## Long-term architecture

```text
staged Git snapshot
      ↓
Safe Core Git / Policy / Process / Codex
      ↓
coverage-preserving Review Evidence Chunks
      ↓
Review domain
  exact changed-line validation
  confidence gate
  deterministic review rules
  diagnostics/report
      ↓
Review Receipt v4
```

The product repository owns only Review-specific behavior. Process execution, generic Git primitives, repository-policy structure, Safe Contract/Receipt validation, Review Evidence chunking, deterministic rule semantics, and Codex CLI safety belong to `codex-safe-core`.

## Key guarantees

- staged changes only; working-tree-only edits are outside the reviewed snapshot;
- HEAD + raw Git-index fingerprint protects against stale/TOCTOU results;
- `.codex-safe.json.review` is read from the captured HEAD and validated fail-closed as Policy Schema v3;
- Review Evidence Chunking never silently middle-truncates changed hunks: a hunk is reviewed or becomes an explicit coverage gap;
- model findings must point to an exact post-change added/modified line; the old ±3 nearest-line relocation is removed;
- `confidenceThreshold` suppresses low-confidence model findings before they affect Problems or verdicts;
- `.codex-safe.json.review.rules` is evaluated deterministically by Safe Core, including forbidden paths and code-without-tests policy;
- incomplete coverage or invalid model finding locations fail closed and block the review verdict;
- Review Receipt v4 binds a `git-index` subject to HEAD/index/diff/policy fingerprints plus quality/readiness/mechanical/coverage verdicts;
- Restricted Mode is rejected at runtime and covered by Extension Host tests;
- Codex runs in an ephemeral directory with read-only sandboxing, no approvals, ignored user rules/config, and required capability probing;
- no source edits, commits, pushes, or PR creation;
- Marketplace/Release runtime is `dist/` only; source, tests, scripts, lockfiles and submodule metadata are excluded from VSIX.

## Configuration

Repository policy:

```json
{
  "schemaVersion": 3,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "Focus on correctness, concurrency, bounds, error handling and long-running stability.",
    "rules": {
      "requireTestsForCodeChanges": true,
      "codePathPrefixes": ["src/"],
      "testPathPrefixes": ["test/", "tests/"],
      "forbiddenPathPrefixes": []
    }
  }
}
```

`maxDiffBytes` is the **per-review evidence budget used by coverage-preserving chunking**, not a raw-diff rejection threshold. The raw staged diff has a fixed 8 MiB safety ceiling and the complete raw diff remains the basis for deterministic fingerprints.

`safeCodexReview.codexPath` is machine-scoped; other VS Code product settings are application-scoped. Repository policy cannot select an executable/model or arbitrary commands.

## Usage

1. Stage the intended changes.
2. Run **Codex Review Safe: Review Staged Changes** from Source Control or the Command Palette.
3. Exact post-change findings appear in Problems; coverage gaps, deterministic-rule violations, and report-only evidence remain visible in the Review report.
4. Fix, stage, and review again before committing.

`qualityVerdict=no_findings` means no substantive issue was found in the reviewed evidence. It does not prove specification, build, test, or human-review readiness.

## Development and release

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run test:trust
npm run package
```

CI covers latest VS Code on Linux/Windows/macOS, minimum VS Code `1.90.0`, zh-CN localization, Workspace Trust, deterministic dist-only packaging, and SHA-256. Release additionally produces GitHub build-provenance attestation for the VSIX and `SHA256SUMS` before publishing an immutable version tag/release.

See [SECURITY.md](SECURITY.md), [PUBLISHING.md](PUBLISHING.md), and [CONTRIBUTING.md](CONTRIBUTING.md).

## Identity

- Publisher: `jiying2007`
- Extension: `codex-review-safe`
- ID: `jiying2007.codex-review-safe`
- Settings namespace: `safeCodexReview.*`
- Runtime entry: `./dist/extension.js`

## License

See [LICENSE](LICENSE).
