# Contributing to Codex Review Safe

Thank you for helping improve Codex Review Safe. This extension intentionally has a narrow security and review boundary, so changes that look small can affect trust, data exposure, or stale-result handling.

## Before opening a pull request

Run the same local gates used by CI:

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run package
```

`npm run test:integration` covers both a normal trusted workspace and Restricted Mode.

## Safety invariants

A contribution must not weaken these invariants without an explicit security design discussion:

- Review input is limited to staged/index changes.
- Codex executes outside the repository in a temporary directory.
- The Codex sandbox remains read-only and approvals remain disabled.
- Project-controlled input must not enable arbitrary commands, network access, tools, hooks, apps, or additional repository reads.
- User/project Codex configuration and rules must not silently widen the execution boundary.
- Model output remains structured and locally validated before it can become a VS Code Diagnostic.
- Findings for paths or locations that cannot be mapped safely remain report-only.
- HEAD/index snapshot checks and stale-review cancellation must remain fail-closed.
- Restricted Mode must not activate review execution.
- The extension must not automatically edit source code, commit, push, publish, or open pull requests.
- Operational logs must not contain source code, staged diff contents, review content, secrets, or absolute repository paths.

## Review behavior changes

When changing the prompt, output schema, finding validation, line mapping, verdicts, receipts, or Git snapshot logic:

1. Add or update focused unit/regression coverage in `test.js` or `test/quality-cases.json`.
2. Add Extension Host coverage when VS Code behavior is involved.
3. Preserve the distinction between `qualityVerdict` and `readinessVerdict`; no findings in a diff are not proof that requirements, builds, or tests pass.
4. Prefer fail-closed/report-only behavior when evidence cannot be mapped safely.

## Localization

User-visible runtime strings must use VS Code localization and remain synchronized between English and Simplified Chinese bundles. Run:

```bash
npm run verify:l10n
```

If package metadata changes, update both `package.nls.json` and `package.nls.zh-cn.json` as required.

## GitHub Actions and dependencies

- Keep workflow permissions minimal.
- Pin third-party GitHub Actions to full commit SHAs.
- Do not enable credential persistence in checkout unless a specific trusted release step requires it.
- Keep dependencies minimal; runtime dependencies require a clear justification because this extension handles source-code diffs.

## Pull request scope

Prefer small, reviewable pull requests. Separate architecture refactors from review-policy or safety behavior changes when possible. Describe:

- the problem being solved;
- the observable behavior change;
- security/trust-boundary impact;
- tests added or updated;
- any compatibility impact on VS Code, Git, or Codex CLI.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md) instead of being filed publicly.
