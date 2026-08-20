# Publishing

Codex Review releases are built by GitHub Actions from the committed npm lockfile.

## Release gate

A release requires:

- committed `package-lock.json`;
- `npm run verify:lock` passing;
- unit/regression tests passing;
- latest VS Code Extension Host tests passing on Linux, Windows, and macOS;
- minimum supported VS Code `1.90.0` Extension Host test passing on Ubuntu;
- official `@vscode/vsce` packaging;
- VSIX content verification;
- SHA-256 generation.

Validation jobs use read-only repository permissions. Only the final package/publish job receives `contents: write`.

## Versioning

Release tags must use strict semantic versioning:

```text
vMAJOR.MINOR.PATCH
```

The tag version must match `package.json.version`, and the tagged commit must be reachable from `main`.

## Create a release

After the version change has passed CI and is merged to `main`:

```bash
git checkout main
git pull --ff-only
# Replace X.Y.Z with the next package.json version.
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `Release` workflow validates all platforms, packages the official VSIX, checks package contents, generates `SHA256SUMS`, uploads the build artifact, and creates the GitHub Release automatically.

## Package contents

The release gate requires these user-facing files inside the VSIX:

- `package.nls.json`
- `package.nls.zh-cn.json`
- `l10n/bundle.l10n.json`
- `l10n/bundle.l10n.zh-cn.json`
- `README.zh-CN.md`
- `images/icon.png`

The NLS files localize extension metadata, commands, and configuration. The `l10n` bundles localize runtime progress, notifications, reports, environment checks, and errors.

Development-only content such as tests, scripts, lockfiles, repository metadata, and publishing documentation must not be included in the VSIX.

## Future VS Code Marketplace publication

The stable Marketplace identity is `jiying2007.codex-review`. Do not rename the extension `name` (`codex-review`) or the `codexReview.*` command/settings namespace as part of publishing; doing so would create a different extension or break upgrade continuity.

Marketplace publication is intentionally not automated yet. When enabled, keep the publishing credential outside the repository (for example, a protected Actions secret) and run the same CI/release gate before `vsce publish`.
