# Publishing

Codex Review Safe releases are immutable GitHub Actions builds from a committed source revision, locked npm graph, and one exact commit-pinned **Codex Safe Core v4** submodule.

## Release source requirements

Before release:

```bash
git submodule update --init --recursive
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:integration
npm run test:trust
npm run package
```

A release is valid only when:

- package and lockfile metadata agree;
- `src/codex-safe-core` is a `160000` gitlink at the coordinated reviewed Core commit;
- `.codex-safe.example.json` schema provenance points to the same Core commit;
- Safe Core v4 / Safe Contract v2 / Policy Schema v3 / Review Receipt v4 / Prompt Contract v1 checks pass;
- security/module-boundary, unit, exact-line, evidence coverage and deterministic-rule tests pass;
- latest VS Code Extension Host tests pass on Linux, Windows and macOS;
- minimum VS Code `1.90.0` and Workspace Trust tests pass;
- official VSIX package-boundary verification passes;
- SHA256, SPDX SBOM and GitHub build provenance are generated.

## Versioning

Use strict semantic versioning: `vMAJOR.MINOR.PATCH`. The tag must equal `v<package.json.version>` and remain immutable. Family v4 is the current hard-cut protocol line; do not restore legacy policy/receipt semantics, nearest-line relocation, copied Core runtime, or compatibility shims.

## Standard release flow

```bash
git checkout main
git pull --ff-only
git submodule update --init --recursive
npm run release:prepare -- X.Y.Z
git diff --check
git diff
npm run release:check
npm run release:push
```

A committed version change on `main` owns publication. Validation jobs remain read-only; only the final release job receives `contents: write`, `id-token: write`, and `attestations: write`. Third-party Actions remain immutable full-SHA pinned.

## Package boundary

The runtime package is under `dist/`; source/test/scripts/git metadata must not enter the VSIX. CI inspects the actual packaged VSIX before publication.

## Artifact integrity

The GitHub Release contains:

- `codex-review-safe-<version>.vsix`;
- `SBOM.spdx.json`;
- `SHA256SUMS`.

Verify downloaded artifacts as described in [`VERIFY_RELEASE.md`](VERIFY_RELEASE.md). Generating an attestation is not sufficient by itself; consumers and downstream distribution workflows must verify it.

## Marketplace publication

GitHub Release is the **single binary source of truth**. Marketplace publication must:

1. checkout the immutable release tag only for metadata/tooling;
2. download the exact GitHub Release VSIX and `SHA256SUMS`;
3. verify SHA256;
4. run `gh attestation verify <vsix> -R jiying2007/codex-review`;
5. inspect the VSIX package boundary;
6. publish that exact VSIX with `vsce publish --packagePath`.

Marketplace workflows must never run `vsce package` or `npm run package`; a second build would create a second artifact identity.

Stable `@vscode/vsce` 3.9.x still uses `VSCE_PAT`. Do not adopt prerelease/next tooling merely to remove the PAT. Hard-switch to trusted OIDC publishing only after a stable `vsce` release officially ships the required OIDC option, then remove the PAT path rather than keeping dual authentication modes.

## Failure policy

- transient runner/network failure: rerun failed jobs;
- source/test/package defect: fix on `main` and publish a new version;
- never delete, recreate, overwrite or force-move an existing release tag/asset to hide a defective release.

## Stable identity

```text
Publisher: jiying2007
Name:      codex-review-safe
ID:        jiying2007.codex-review-safe
Namespace: safeCodexReview.*
```

Do not rename the extension or command/settings namespace during publication.
