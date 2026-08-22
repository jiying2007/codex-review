# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Review **staged Git changes only** in VS Code with a local Codex CLI, conservative diagnostics, deterministic provenance, and a narrow execution boundary.

Codex Review Safe 2.1 uses **Codex Safe Core 2.1** as the only shared Core. Repository policy is a single HEAD-pinned `.codex-safe.json` document with `schemaVersion: 2`; the `review` section is validated by Safe Core before product logic consumes it.

## Long-term architecture

```text
staged Git snapshot
      ↓
Safe Core Git / Policy / Process / Codex / Context
      ↓
Review domain
  finding validation
  confidence gate
  diagnostics/report
      ↓
Review Receipt v2
```

The product repository owns only Review-specific behavior. Process execution, generic Git primitives, repository-policy structure, Safe contracts/receipts, Semantic Context budgeting, and Codex CLI safety belong to `codex-safe-core`.

## Key guarantees

- staged changes only; working-tree-only edits are outside the reviewed snapshot;
- HEAD + raw Git-index fingerprint protects against stale/TOCTOU results;
- `.codex-safe.json.review` is read from the captured HEAD and validated fail-closed;
- `confidenceThreshold` suppresses low-confidence findings before they can affect Problems or verdicts;
- source changes consume the Semantic Context budget; generated/lock/binary content is represented conservatively;
- Review Receipt v2 is bound to HEAD/index/diff/policy fingerprints and is AI evidence, not human approval or test evidence;
- Restricted Mode is rejected at runtime and covered by Extension Host tests;
- Codex runs in an ephemeral directory with read-only sandboxing, no approvals, ignored user rules/config, and required capability probing;
- no source edits, commits, pushes, or PR creation;
- Marketplace/Release runtime is `dist/` only; source, tests, scripts, lockfiles and submodule metadata are excluded from VSIX.

## Configuration

Repository policy:

```json
{
  "schemaVersion": 2,
  "review": {
    "language": "zh-CN",
    "maxDiffBytes": 524288,
    "maxFindings": 40,
    "severityThreshold": "low",
    "confidenceThreshold": 0.7,
    "timeoutSeconds": 120,
    "extraInstructions": "Focus on correctness, concurrency, bounds, error handling and long-running stability."
  }
}
```

`maxDiffBytes` is the **model Semantic Context budget**, not a user-controlled raw-diff rejection threshold. The raw staged diff has a fixed 8 MiB safety ceiling and the complete raw diff remains the basis for deterministic fingerprints.

`safeCodexReview.codexPath` is machine-scoped; other VS Code product settings are application-scoped. Repository policy cannot select an executable/model or arbitrary commands.

## Usage

1. Stage the intended changes.
2. Run **Codex Review Safe: Review Staged Changes** from Source Control or the Command Palette.
3. Safely mappable findings appear in Problems; all validated findings and report-only reasons are available in the Review report.
4. Fix, stage, and review again before committing.

`qualityVerdict=no_findings` means no substantive issue was found in the supplied diff. It does not prove specification, build, test, or human-review readiness.

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
