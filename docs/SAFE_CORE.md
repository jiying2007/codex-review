# Safe Core

Codex Review Safe vendors **Safe Core v1** from the canonical product-family source `jiying2007/codex-commit:main/src/codex-safe-core`.

The shared runtime owns the Codex safety argv contract, CLI executable resolution, capability probing, JSONL parsing, temporary schema execution, and Structured Output process orchestration. Review-specific Git collection, policy, prompts, review schema, finding validation, diagnostics, and receipts remain local to this repository.

The vendored bytes are pinned by `safe-core.lock.json` and `src/codex-safe-core/manifest.json`.

```bash
node scripts/safe-core.js verify
node scripts/safe-core.js upstream
node scripts/safe-core.js sync
```

- `verify` is fully offline and validates vendored file hashes against the lock and manifest.
- `upstream` checks that the locked manifest still matches the canonical `codex-commit/main` source; CI runs this fail-closed drift gate.
- `sync` deliberately downloads the canonical manifest/files from `codex-commit/main`, verifies their hashes, updates the vendored copy and lock, and leaves the resulting diff for human review.

There is no Git submodule, dedicated Safe Core branch, or runtime network dependency on the canonical repository.
