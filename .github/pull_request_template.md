## Problem

<!-- What concrete problem or risk does this PR address? -->

## Changes

<!-- Summarize the implementation. -->

## Safety / trust-boundary checklist

- [ ] Review input remains staged/index-only, or any scope change is explicitly justified.
- [ ] No new source-edit, commit, push, publish, or PR-creation behavior is introduced unintentionally.
- [ ] Codex remains read-only with approvals disabled; no unnecessary network/tool/hook/app capability is enabled.
- [ ] Project-controlled configuration cannot introduce arbitrary commands or silently widen the execution boundary.
- [ ] Structured output, path validation, snapshot validation, stale-result handling, and report-only fallbacks remain fail-closed.
- [ ] Restricted Mode behavior remains safe.
- [ ] Operational logs do not expose source/diff/review contents, secrets, or absolute repository paths.

## Verification

- [ ] `npm run verify:lock`
- [ ] `npm ci --ignore-scripts --no-audit --no-fund`
- [ ] `npm run check`
- [ ] `npm run test:integration`
- [ ] `npm run package`
- [ ] English / Simplified Chinese localization updated when user-visible text changed.

## Compatibility

<!-- Note any VS Code, Git, Codex CLI, platform, configuration, receipt/API, or migration impact. -->
