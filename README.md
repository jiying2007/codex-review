# Codex Review Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Review safe, structured findings from **staged Git changes only** in VS Code using the local Codex CLI.

> **Why “Safe”?** Codex Review Safe is the review-side companion to [Codex Commit Safe](https://github.com/jiying2007/codex-commit). Both extensions deliberately keep a narrow trust boundary: staged-only input, Structured Output, HEAD + raw-index consistency checks, minimal Codex capabilities, fail-closed behavior, and no automatic source edits/commit/push.

## Highlights

- One-click review from VS Code Source Control
- Uses **staged/index changes only** (`git diff --cached`)
- Review findings in **Simplified Chinese or English**
- VS Code commands, settings, progress, warnings, reports, and errors localized for **English and Simplified Chinese**
- UI language and review-result language are independent
- Codex Structured Output with strict local schema/path validation
- Conservative Problems publishing: only safely mappable findings become inline diagnostics
- HEAD + raw Git index snapshot protection against stale results and TOCTOU races
- HEAD-pinned `.codex-review.json` policy, so a staged policy change cannot weaken its own review
- Dirty editors, unstaged changes, deleted/binary/submodule files, symlink escapes, pure rename/copy changes, and unsafe line mappings fall back to report-only
- Windows `.exe` / `.cmd` / `.bat`, Linux, and macOS execution paths covered by CI
- Never automatically modifies source files, commits, pushes, or opens pull requests

## Language support

The VS Code UI automatically follows the editor locale:

- English VS Code → English commands/messages/reports
- Simplified Chinese VS Code → Simplified Chinese commands/messages/reports

The review-result language is controlled separately:

```json
{
  "safeCodexReview.language": "zh-CN"
}
```

or:

```json
{
  "safeCodexReview.language": "en"
}
```

A Chinese UI can request English findings, and an English UI can request Chinese findings.

## Workflow

```text
Stage changes
    ↓
VS Code Source Control
    ↓
Codex Review Safe
    ↓
local Codex CLI
    ↓
Structured review result
    ↓
local validation
    ↓
Problems + review report
```

## Safety model

Codex Review Safe deliberately keeps the execution boundary narrow:

- only the staged diff is sent for inference;
- Codex runs from a temporary directory, not the repository;
- user Codex config and project execution rules are ignored for the review request;
- unnecessary Codex capabilities are explicitly disabled where supported;
- sandbox mode is read-only and approvals are disabled;
- model output must pass strict local schema, path, and range validation;
- repository state is represented by **HEAD OID + SHA-256(raw `git ls-files --stage -z`)**;
- snapshots are checked before/after collection, after Codex returns, and after Problems publication;
- stale reviews are discarded if HEAD/index changes or a newer review supersedes them;
- workspace/folder settings cannot weaken review policy;
- `.codex-review.json` is read from the exact captured HEAD OID;
- operational logs do not contain source code, staged diff contents, review content, secrets, or absolute repository paths.

Organization-managed Codex requirements, MDM settings, managed hooks, and cloud policy may still apply. The extension does not attempt to bypass organization policy.

> The staged diff leaves the local machine for the configured Codex service. Use the extension only where your organization’s source-code and data policy permits it.

See [SECURITY.md](SECURITY.md) for details.

## Requirements

- VS Code `1.90.0` or later
- Git
- OpenAI Codex CLI installed and authenticated

Check Codex CLI first:

```bash
codex --version
```

## Installation

Download the VSIX from a GitHub Release and install it:

```bash
code --install-extension codex-review-safe-1.0.1.vsix
```

Or in VS Code:

```text
Extensions → ... → Install from VSIX...
```

Then run:

```text
Ctrl+Shift+P → Codex Review Safe: Check Codex Environment
```

## Usage

1. Stage the changes you want to review.
2. Open **Source Control**.
3. Run **Codex Review Safe: Review Staged Changes** or use the Source Control toolbar action.
4. Safely locatable findings appear in **Problems**.
5. Open **Codex Review Safe: Show Review Report** for the complete report, including report-only findings and reasons.
6. Fix issues, stage again, rerun the review, and commit manually.

## Project configuration

A repository may include `.codex-review.json`:

```json
{
  "language": "zh-CN",
  "maxDiffBytes": 524288,
  "maxFindings": 40,
  "severityThreshold": "low",
  "timeoutSeconds": 120,
  "extraInstructions": "Focus on correctness, resource leaks, concurrency, bounds checks, error handling, and long-running stability."
}
```

Project rules cannot configure the Codex executable, model, environment variables, working directory, or arbitrary commands. The repository policy is read from the exact HEAD captured for the review, so a staged policy edit takes effect only after commit.

All `safeCodexReview.*` VS Code settings are application-scoped User Settings.

## Extension identity

- Repository: `codex-review`
- Extension name: `codex-review-safe`
- Display name: **Codex Review Safe**
- Publisher/VSIX ID: `jiying2007.codex-review-safe`
- Command/settings namespace: `safeCodexReview.*`
- Repository policy: `.codex-review.json`
- Companion extension: **Codex Commit Safe** (`jiying2007.codex-commit-safe`)
- Marketplace status: **not published yet**; GitHub Releases are the current distribution channel

## Development

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

CI validates latest VS Code on Linux/Windows/macOS, VS Code `1.90.0` minimum compatibility, a Simplified-Chinese localization smoke inside Extension Host, localization source/bundle parity, official VSIX contents, and SHA-256 generation.

See [PUBLISHING.md](PUBLISHING.md) for release details.

## License

See [LICENSE](LICENSE).
