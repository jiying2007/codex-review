# Codex Review

[简体中文](README.zh-CN.md) | English

Codex Review brings a conservative, staged-only code review workflow to VS Code Source Control. It sends the Git index diff to the local Codex CLI, validates Structured Output locally, publishes only safely mappable findings to **Problems**, and keeps the full report in the **Codex Review** OutputChannel.

> **Why conservative?** Like its companion [Codex Commit Safe](https://github.com/jiying2007/codex-commit), the extension deliberately keeps a narrow trust boundary: staged-only input, Structured Output, HEAD + raw-index consistency checks, minimal Codex capabilities, no automatic edits/commit/push, and fail-safe output projection.

## Highlights

- Review **staged/index changes only** from the Source Control title bar or Command Palette.
- Local `codex exec` integration with Structured Output and local schema/path validation.
- Deterministic local verdict: `critical/high -> block`, other findings -> `needs_attention`, no findings -> `pass`.
- Fail-safe inline diagnostics: a finding is published to Problems only when it can be mapped safely to the current working-tree file.
- Detects dirty editors, unstaged changes, deleted files, binary files, submodules, symlink escapes, pure rename/copy changes, and stale Git state.
- Multi-stage `HEAD + raw INDEX` snapshot checks discard stale results when Git state changes during review.
- Rejects unresolved merge conflicts before Codex is called.
- Repository policy is pinned to the captured HEAD, so a staged `.codex-review.json` change cannot weaken the review of itself.
- All VS Code policy settings are application-scoped; workspace/folder settings cannot weaken review policy.
- Multi-repository workspaces keep diagnostics and reports isolated per repository.
- Trusted local workspaces only; virtual workspaces are unsupported.

## Chinese / English support

The extension manifest is localized with VS Code NLS files:

- English: `package.nls.json`
- Simplified Chinese: `package.nls.zh-cn.json`

Command titles, configuration descriptions, capability descriptions, Marketplace metadata, progress notifications, reports, environment checks, and runtime errors follow the VS Code UI locale through VS Code NLS and `vscode.l10n`. Review summary/findings are controlled separately by `codexReview.language`:

- `zh-CN` — Simplified Chinese review output
- `en` — English review output

This lets an English VS Code user request Chinese review findings, or a Chinese VS Code user request English findings.

## Requirements

- VS Code `1.90.0+`
- Git
- A working local Codex CLI

Verify Codex:

```bash
codex --version
```

## Install

Download the VSIX from GitHub Releases, then:

```bash
code --install-extension codex-review-*.vsix
```

## Usage

1. Stage the changes you intend to commit.
2. Click **Codex Review** in the Source Control title bar, or run **Codex Review: Review Staged Changes**.
3. Safely locatable findings appear in **Problems**.
4. The complete report, including report-only findings and reasons, is available in the **Codex Review** OutputChannel.
5. Editing files or changing HEAD/index invalidates stale inline diagnostics.

## Settings

All settings below are application-scoped User Settings.

| Setting | Default | Purpose |
|---|---:|---|
| `codexReview.codexPath` | `codex` | Codex CLI executable path |
| `codexReview.model` | empty | Optional model override |
| `codexReview.language` | `zh-CN` | Review output language: `zh-CN` / `en` |
| `codexReview.maxDiffBytes` | `524288` | Maximum staged diff bytes sent to Codex |
| `codexReview.maxFindings` | `40` | Maximum accepted findings |
| `codexReview.severityThreshold` | `low` | Minimum severity shown in Problems/report |
| `codexReview.timeoutSeconds` | `120` | Codex timeout |
| `codexReview.extraInstructions` | empty | Additional user-level review instructions |

## Repository review policy

A repository may commit `.codex-review.json` as team policy. The extension reads the policy from the **exact HEAD OID captured for the review snapshot**, not from the working tree/index.

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "Focus on resource leaks, concurrency, bounds checks, error handling, and long-running embedded stability."
}
```

If `.codex-review.json` is staged in the same review, the previous HEAD policy remains in effect; the new policy takes effect after commit.

## Security model

Codex Review runs Codex from a temporary directory and uses a controlled non-interactive request, including:

- `--json`
- `--output-schema`
- `--ephemeral`
- `--ignore-user-config`
- `--ignore-rules`
- `--sandbox read-only`
- `--ask-for-approval never`

Unneeded shell/app/hook/goal/memory/plugin-related features are disabled where supported. Finding paths and line mappings are validated locally before diagnostics are published.

> The staged diff leaves the local machine for Codex inference. Follow your organization's source-code and data-handling policies.

See [SECURITY.md](SECURITY.md) for the complete trust and release-supply-chain model.

## Development

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

## CI and releases

CI validates:

- lockfile integrity;
- unit/regression tests;
- latest VS Code Extension Host on Linux, Windows, and macOS;
- minimum supported VS Code `1.90.0` on Ubuntu;
- official `@vscode/vsce` packaging;
- VSIX contents and SHA-256.

Release tags must use `vMAJOR.MINOR.PATCH`, match `package.json.version`, and point to a commit reachable from `main`. Only the final release job receives repository write permission.

See [PUBLISHING.md](PUBLISHING.md).


## Extension identity

- Repository: `codex-review`
- Extension name: `codex-review`
- Display name: **Codex Review**
- Publisher/VSIX ID: `jiying2007.codex-review`
- Command/settings namespace: `codexReview.*`
- Companion extension: **Codex Commit Safe** (`jiying2007.codex-commit-safe`)
- Marketplace status: **not published yet**; GitHub Releases are the current distribution channel

The technical extension ID and namespace are intentionally stable so future Marketplace publication preserves the GitHub/VSIX upgrade path.

## License

MIT
