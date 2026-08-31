# Publishing

Codex Review Safe releases are immutable GitHub Actions builds from a committed source revision, locked npm graph, and one exact commit-pinned **Codex Safe Core v4** submodule.

## Release source requirements

A release is valid only when:

- `package.json`, `package-lock.json`, and `product-contract.json.productVersion` agree;
- `src/codex-safe-core` is a `160000` gitlink at the coordinated reviewed Core commit;
- `.codex-safe.example.json` schema provenance points to the same Core commit;
- Safe Core v4 / Safe Contract v2 / Policy Schema v3 / Review Receipt v4 / Prompt Contract v1 checks pass;
- security/module-boundary, unit, exact-line, evidence coverage and deterministic-rule tests pass;
- latest VS Code Extension Host tests pass on Linux, Windows and macOS;
- minimum VS Code `1.90.0`, real Simplified-Chinese locale, and Workspace Trust tests pass;
- official VSIX package-boundary verification passes;
- SHA256, SPDX SBOM and GitHub build provenance are generated.

## Versioning

Use strict semantic versioning: `vMAJOR.MINOR.PATCH`. The tag must equal `v<package.json.version>` and remain immutable. Family v4 is the current hard-cut protocol line; do not restore legacy policy/receipt semantics, nearest-line relocation, copied Core runtime, or compatibility shims.

## Workflow-closed release flow

The repository release path is intentionally server-side and auditable:

1. create `release/vX.Y.Z` from current `main`, or run **Prepare Release** with `X.Y.Z`;
2. `.github/workflows/prepare-release.yml` deterministically updates only `package.json`, `package-lock.json`, `product-contract.json`, and `CHANGELOG.md`, then commits those release metadata files to that release branch;
3. open the release branch as a PR to `main` and require the normal CI, dependency, family-governance and family-release gates;
4. merge the release PR only after all gates pass;
5. the `main` push runs `.github/workflows/release.yml`, which re-runs release Extension Host gates, packages the VSIX, generates SBOM/checksums, creates provenance attestations, creates the immutable tag and GitHub Release, and then calls the Marketplace workflow directly;
6. `.github/workflows/marketplace.yml` downloads the exact immutable GitHub Release VSIX, verifies checksum, attestation and package boundary, then publishes that exact binary to VS Code Marketplace;
7. `.github/workflows/release-integrity.yml` verifies the completed release and every published asset after the complete Release workflow succeeds;
8. `.github/workflows/cleanup-merged-branches.yml` removes same-repository merged PR branches only when the branch still points to the exact merged head SHA; missing branches are skipped and branches that advanced after merge are preserved.

The manual `workflow_dispatch` entry on Marketplace is a recovery path for re-publishing the same validated immutable Release VSIX with `--skip-duplicate`; it is not the normal release path.

Local `release:*` scripts remain useful for diagnostics and emergency operator workflows, but routine publication must use the repository workflows above.

## Package boundary

The runtime package is under `dist/`; source/test/scripts/git metadata must not enter the VSIX. CI and Release both inspect the actual packaged VSIX before publication.

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

- transient runner/network failure: rerun the failed job or workflow attempt;
- source/test/package defect: fix through a new PR and publish a new version;
- Marketplace failure after an immutable GitHub Release exists: fix only the distribution credential/runtime issue, then use the Marketplace recovery dispatch for the same tag; never rebuild the VSIX;
- never delete, recreate, overwrite or force-move an existing release tag/asset to hide a defective release.

## Stable identity

```text
Publisher: jiying2007
Name:      codex-review-safe
ID:        jiying2007.codex-review-safe
Namespace: safeCodexReview.*
```

Do not rename the extension or command/settings namespace during publication.
