# Publishing

Codex Review Safe releases are built by GitHub Actions from the committed npm lockfile.

## Release gate

A release requires:

- committed `package-lock.json`;
- `npm run verify:lock` passing, including package name/version and dev-dependency parity;
- English/Simplified-Chinese manifest and runtime localization key parity passing via `npm run verify:l10n`;
- every literal runtime `t('...')` source key referenced by `extension.js` to exist in both runtime localization bundles;
- unit/regression tests passing, including the Codex CLI argv contract (`--ask-for-approval never` before the `exec` subcommand);
- latest VS Code Extension Host tests passing on Linux, Windows, and macOS;
- minimum supported VS Code `1.90.0` Extension Host test passing on Ubuntu;
- Simplified-Chinese localization smoke passing inside an Ubuntu Extension Host, validating the shipped zh-CN runtime bundle and critical report/error translations;
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

After the version change has passed CI and is merged to `main`, the `Release` workflow detects the committed version bump automatically. It runs the full gate and, only after every validation and packaging job succeeds, creates the immutable `v<package.version>` tag and GitHub Release in the same run. Ordinary `main` pushes with no version change skip the release jobs.

Pushing a matching tag remains a supported manual fallback:

```bash
git checkout main
git pull --ff-only
# Replace X.Y.Z with the next package.json version.
git tag vX.Y.Z
git push origin vX.Y.Z
```

Do not force-move release tags. A rerun safely reuses a tag only when it resolves to the same commit, and refreshes existing Release artifacts with `--clobber`.

## Package contents

The release gate requires these user-facing files inside the VSIX:

- `package.nls.json`
- `package.nls.zh-cn.json`
- `l10n/bundle.l10n.json`
- `l10n/bundle.l10n.zh-cn.json`
- `README.zh-CN.md`
- `images/icon.png`
- `src/safe-contract.js`

The NLS files localize extension metadata, commands, and configuration. The `l10n` bundles localize runtime progress, notifications, reports, environment checks, and errors.

Development-only content such as tests, scripts, lockfiles, repository metadata, and publishing documentation must not be included in the VSIX.

## Future VS Code Marketplace publication

The stable Marketplace identity is `jiying2007.codex-review-safe`. Do not rename the extension `name` (`codex-review-safe`) or the `safeCodexReview.*` command/settings namespace as part of publishing; doing so would create a different extension or break upgrade continuity.

Marketplace publication is intentionally not automated yet. When enabled, keep the publishing credential outside the repository (for example, a protected Actions secret) and run the same CI/release gate before `vsce publish`.
