# Security

## Data flow

Codex Review Safe sends only the staged Git diff and review instructions to the configured Codex service. The repository itself is not used as the Codex working directory.

The staged diff still leaves the local machine for model inference. Use the extension only where your organization’s source-code and data policy permits it.

## Execution boundary

For review generation, the extension:

- runs Codex from a temporary directory;
- requests a read-only sandbox and no approvals;
- ignores user Codex config and project execution rules for the request;
- disables unnecessary shell, execution, web, app, agent, hook, goal, memory, and plugin-related features where supported;
- validates Structured Output locally before publishing diagnostics;
- never automatically edits source files, commits, pushes, or opens pull requests.

Organization-managed Codex requirements, managed hooks, MDM settings, or cloud policy have higher precedence and may still apply. The extension does not attempt to bypass organization policy.

## Review policy boundary

All VS Code Review settings are application-scoped User Settings. Workspace and folder settings cannot weaken review policy.

Repository `.codex-review.json` is treated as repository-controlled policy and is read from the exact HEAD OID captured for the stable review snapshot. A staged policy change therefore cannot weaken the review of itself; it takes effect only after commit.

Project policy cannot configure the Codex executable, model, environment variables, working directory, or arbitrary commands.

## Repository consistency

A review must describe the exact staged state that was analyzed. The extension snapshots both:

- the current `HEAD` object ID, including an explicit unborn-HEAD state; and
- a SHA-256 fingerprint of the raw `git ls-files --stage -z` index bytes.

The snapshot is checked before and after input collection, after Codex returns, and again after inline diagnostics are published. Any mismatch fails safe and stale Problems are removed.

Unresolved merge conflicts stop review before Codex is called. A newer request also supersedes any older in-flight review for the same repository.

## Diagnostic safety

Inline diagnostics are a conservative projection of the staged snapshot onto the current working tree.

A finding is report-only when safe inline mapping cannot be established, including dirty editors, unstaged changes, deleted files, binary files, submodules, symlink escapes, pure rename/copy changes, unmappable lines, or file changes during publication.

Finding paths must belong to staged changes and must remain inside the repository after realpath resolution.

## Process handling

Native executables are started without a shell. On Windows, `.cmd` and `.bat` shims are invoked through `cmd.exe` with explicit quoting and `windowsVerbatimArguments`.

Timeouts, cancellation, process-tree termination, stdout/stderr size limits, and Codex `--version` checks are enforced.

An explicitly configured Codex executable is considered usable only when `<path> --version` exits successfully and returns non-empty version information.

Codex CLI arguments are assembled through a single argv builder. The approval policy is passed as a global CLI option before the `exec` subcommand, while `exec`-specific flags remain after the subcommand. Unit and fake-CLI integration tests lock this contract to prevent silent CLI-order regressions.

## Logging

Operational logs must not contain source code, staged diff contents, model review content, secrets, or absolute repository paths. Reports are shown only in the dedicated VS Code OutputChannel and Problems collection for the active user session.

## Release supply chain

GitHub Actions validation jobs run with read-only repository permissions. Only the final release job receives `contents: write`.

Release tags must:

- use `vMAJOR.MINOR.PATCH`;
- match `package.json.version`;
- point to a commit reachable from `main`.

The release gate runs:

- lockfile integrity verification;
- manifest/runtime localization parity plus runtime source-key coverage;
- unit/regression tests, including the Codex CLI argv contract;
- latest VS Code Extension Host tests on Linux, Windows, and macOS;
- minimum supported VS Code `1.90.0` compatibility tests;
- a deterministic Simplified-Chinese localization smoke inside Extension Host, verifying the shipped zh-CN runtime bundle and critical translated report/error keys;
- official `@vscode/vsce` packaging;
- VSIX content checks;
- SHA-256 generation.

Third-party GitHub Actions are pinned to immutable commit SHAs and maintained through Dependabot.
