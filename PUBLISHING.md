# Publishing

Codex Review releases are built by GitHub Actions from the committed npm lockfile.

## Release gate

A release requires:

- committed `package-lock.json`;
- unit/regression tests passing;
- Linux Extension Host integration tests passing under Xvfb;
- Windows Extension Host integration tests passing, including `.cmd` Codex execution;
- official `@vscode/vsce` packaging;
- SHA256 generated from the packaged VSIX.

## Create a GitHub Release

Ensure `package.json` version matches the tag, then:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `Release` workflow verifies both platforms, packages the VSIX, generates `SHA256SUMS.txt`, and creates the GitHub Release automatically.
