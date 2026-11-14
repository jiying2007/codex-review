# Packaging dependency qualification

The release toolchain locks `@vscode/vsce` to 4.1.1. The lockfile uses the supported Azure Identity dependency graph and its native MSAL dependency; no cross-major MSAL override is applied.

VSCE's transitive `minimatch` is scoped to 11.0.1 in `package.json` to include the fix for GHSA-g3hv-75wg-m249. The override applies only below VSCE. Remove it when a supported VSCE release selects a fixed version itself, after running the same qualification. The build uses Node 22 or 24, both supported by this dependency set.

`test/packaging-dependencies.test.js` exercises real CJS/ESM SDK imports, fixture-based token and cache behavior, managed identity initialization, structured arguments for developer credential commands, the VSCE authentication bridge, and the MSAL authority regression. Network access and actual credential processes are blocked in these tests. No production authentication is claimed.

`npm run package` validates the actual VSIX packaging path. CI also runs the unit suite and `npm audit --audit-level=high` over production and development dependencies. Marketplace publication installs the same locked tooling before exposing the existing publication credential, then publishes the exact verified immutable-release VSIX. Its result is successful only if the publication step succeeds.
