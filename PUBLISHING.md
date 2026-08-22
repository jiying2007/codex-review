# Publishing

Codex Review Safe releases are immutable, reproducible GitHub Actions builds from a committed source revision, locked npm graph and commit-pinned Codex Safe Core v2 submodule.

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
- the Core path is the canonical commit-pinned Git submodule;
- Safe Core v2 contract/policy/receipt checks pass;
- security/module-boundary, unit and regression tests pass;
- confidence suppression and Receipt v2 tests pass;
- latest VS Code Extension Host tests pass on Linux, Windows and macOS;
- minimum VS Code `1.90.0` passes;
- Simplified-Chinese localization smoke passes;
- trusted and Restricted Mode Extension Host tests pass;
- official VSIX package-boundary verification passes;
- SHA-256 is generated.

## Versioning

Use strict semantic versioning:

```text
vMAJOR.MINOR.PATCH
```

The tag must equal `v<package.json.version>`, lockfile version metadata must match, and the release commit must be reachable from `main`.

Codex Safe v2 is a breaking protocol line. Do not restore v1 repository-policy or receipt compatibility in a 2.x release.

## Standard release flow

From clean synchronized `main` with non-empty `CHANGELOG.md` Unreleased notes:

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

`release:prepare` updates only `package.json`, `package-lock.json`, and `CHANGELOG.md`. `release:check` requires exactly those edits, synchronized `main`, an unused remote tag and the complete lock/test/package gate. `release:push` reruns the gate, commits/pushes the release files and verifies the exact Release workflow result, immutable tag, VSIX and checksum.

Never force-move a release tag. `CODEX_RELEASE_GITHUB_TOKEN`, if used for release polling, stays local.

## GitHub Actions release gate

A committed version change on `main` triggers the Release workflow. An unchanged version skips publication. A matching `vMAJOR.MINOR.PATCH` tag remains the manual fallback.

Validation jobs are read-only. Only the final release job receives:

```text
contents: write
id-token: write
attestations: write
```

Third-party actions are pinned to immutable full commit SHAs.

## Package boundary

Marketplace/Release entry:

```text
dist/extension.js
dist/codex-safe.schema.json
dist/src/*
```

`dist/src/` contains only deterministic production runtime modules staged by `npm run build`; the Core runtime subset is staged under `dist/src/codex-safe-core/` without Git/submodule metadata.

The VSIX also contains required localization, README and icon assets.

The package must not contain development/source material such as:

```text
extension.js
src/
test/
scripts/
.gitmodules
package-lock.json
repository metadata
```

CI fails if those paths appear outside the production `dist/` boundary.

## Artifact integrity

The final job creates:

- `codex-review-safe-<version>.vsix`;
- `SHA256SUMS`.

Both are workflow/GitHub Release artifacts and receive GitHub build-provenance attestations using a full-SHA-pinned `actions/attest-build-provenance` action.

Marketplace publication, when enabled, must reuse the validated VSIX rather than rebuild another binary.

## Failure policy

- Transient runner/network failure: rerun failed jobs.
- Source/test/package defect: fix on `main` and publish a new version.
- Never delete or force-move an existing release tag to conceal a bad release.

## Stable identity

```text
Publisher: jiying2007
Name:      codex-review-safe
ID:        jiying2007.codex-review-safe
Namespace: safeCodexReview.*
```

Do not rename the extension or command/settings namespace during publication.
