# Getting Started with Codex Review Safe

## 1. Install prerequisites

Install VS Code 1.90+, Git and OpenAI Codex CLI in the environment that hosts the workspace extension. Authenticate Codex there:

```bash
codex --version
codex login
```

Remote SSH, Dev Containers, Codespaces and WSL require Codex inside the remote environment.

## 2. Install the extension

Install `jiying2007.codex-review-safe` from the VS Code Marketplace or install the immutable VSIX from a GitHub Release.

## 3. Check the environment

Open a trusted Git workspace and run:

**Codex Review Safe: Check Codex Environment**

Fix Git/Codex/capability errors before reviewing.

## 4. Run the first review

```bash
git status --short
git add <files>
git diff --cached --stat
```

Then run **Review Staged Changes**. Only the staged snapshot is reviewed; unstaged edits are intentionally ignored.

## 5. Optional repository policy

Commit `.codex-safe.json` to the repository target branch to set language, evidence budget, thresholds and deterministic rules. Policy changes take effect only after they are committed.

## Common problems

### No staged changes

Stage the intended files with `git add`. Review Safe does not review working-tree-only edits.

### Codex executable not found

Run `codex --version` in the same local/remote environment as the VS Code workspace. Set `safeCodexReview.codexPath` if needed.

### Restricted Mode

Trust the workspace first. Review execution is intentionally disabled in Restricted Mode.

### Coverage incomplete

The review fails closed when a changed hunk cannot be covered within the configured evidence limits. Reduce the change or adjust the reviewed repository policy after evaluating the risk.

## Upgrade

Upgrade from Marketplace or replace the VSIX with a newer immutable release, reload VS Code, then run **Check Codex Environment** before the first review.
