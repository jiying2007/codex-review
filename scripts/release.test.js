'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compareVersions, parseGitHubRemote, parseVersion, platformCommand, sameFiles, updateChangelog } = require('./release');

assert.deepStrictEqual(parseVersion('1.2.3'), [1, 2, 3]);
assert.throws(() => parseVersion('v1.2.3'), /严格 SemVer/);
assert.throws(() => parseVersion('1.2.3-beta.1'), /严格 SemVer/);
assert.throws(() => parseVersion('01.2.3'), /严格 SemVer/);
assert.strictEqual(compareVersions('1.2.3', '1.2.2'), 1);
assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
assert.strictEqual(compareVersions('1.2.3', '2.0.0'), -1);
assert.deepStrictEqual(parseGitHubRemote('git@github.com:owner/repo.git'), { owner: 'owner', repo: 'repo' });
assert.deepStrictEqual(parseGitHubRemote('https://github.com/owner/repo.git'), { owner: 'owner', repo: 'repo' });
assert.throws(() => parseGitHubRemote('https://example.com/owner/repo.git'), /GitHub URL/);
assert.strictEqual(platformCommand('npm', 'win32'), 'npm.cmd');
assert.strictEqual(platformCommand('npm', 'linux'), 'npm');
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md', 'package-lock.json', 'product-contract.json']), true);
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md', 'package-lock.json']), false);
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md', 'package-lock.json', 'product-contract.json', 'extension.js']), false);
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md']), false);
const source = '# Changelog\n\n## Unreleased\n\n- New behavior.\n\n## 1.0.0\n\n- Initial.\n';
assert.strictEqual(updateChangelog(source, '1.0.1'), '# Changelog\n\n## Unreleased\n\n## 1.0.1\n\n- New behavior.\n\n## 1.0.0\n\n- Initial.\n');
assert.throws(() => updateChangelog('# Changelog\n\n## Unreleased\n\n## 1.0.0\n', '1.0.1'), /Unreleased 区域为空/);

function verifyReleaseMetadataWorkspace() {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-release-metadata-'));
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const sourceContract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'product-contract.json'), 'utf8'));
  const currentVersion = sourcePackage.version;
  const parts = currentVersion.split('.');
  const nextVersion = [parts[0], parts[1], Number(parts[2]) + 1].join('.');
  const releaseFiles = ['CHANGELOG.md', 'package-lock.json', 'package.json', 'product-contract.json'];
  const execute = (directory, command, args) => {
    const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    return { status: result.status, text: (result.stdout || '') + (result.stderr || '') };
  };
  const git = (directory, ...args) => {
    const result = execute(directory, 'git', args);
    assert.strictEqual(result.status, 0, result.text);
    return result.text.trim();
  };
  const release = (directory, ...args) => execute(directory, process.execPath, ['scripts/release.js', ...args]);
  const writeJson = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  const readJson = (directory, name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const expectFailure = (result, message) => {
    assert.strictEqual(result.status, 1, result.text);
    assert.match(result.text, message);
  };
  const fixture = (name, mutate = () => {}) => {
    const directory = path.join(temporary, name);
    fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'release.js'), path.join(directory, 'scripts/release.js'));
    const pkg = { name: sourcePackage.name, version: currentVersion };
    const lock = { name: pkg.name, version: currentVersion, lockfileVersion: 3, packages: { '': { name: pkg.name, version: currentVersion } } };
    const contract = { ...sourceContract };
    mutate({ pkg, lock, contract });
    writeJson(directory, 'package.json', pkg);
    writeJson(directory, 'package-lock.json', lock);
    writeJson(directory, 'product-contract.json', contract);
    fs.writeFileSync(path.join(directory, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Prepared metadata.\n\n## ' + currentVersion + '\n\n- Existing release history.\n');
    git(directory, 'init', '--quiet', '--initial-branch=main');
    git(directory, 'config', 'user.name', 'Local release fixture');
    git(directory, 'config', 'user.email', 'release-fixture@example.invalid');
    git(directory, 'config', 'core.autocrlf', 'false');
    git(directory, 'add', '.');
    git(directory, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture baseline');
    const origin = path.join(temporary, name + '-origin.git');
    git(temporary, 'clone', '--quiet', '--bare', directory, origin);
    git(directory, 'remote', 'add', 'origin', origin);
    return directory;
  };
  try {
    const directory = fixture('consistent');
    const beforePackage = readJson(directory, 'package.json');
    const beforeLock = readJson(directory, 'package-lock.json');
    const beforeContract = readJson(directory, 'product-contract.json');
    let result = release(directory, 'prepare', nextVersion, '--dry-run');
    assert.strictEqual(result.status, 0, result.text);
    assert.strictEqual(git(directory, 'status', '--porcelain'), '', 'prepare --dry-run must preserve the clean workspace');

    result = release(directory, 'prepare', nextVersion);
    assert.strictEqual(result.status, 0, result.text);
    assert.deepStrictEqual(git(directory, 'diff', '--name-only').split(/\r?\n/).sort(), releaseFiles);
    const preparedPackage = readJson(directory, 'package.json');
    const preparedLock = readJson(directory, 'package-lock.json');
    const preparedContract = readJson(directory, 'product-contract.json');
    assert.strictEqual(preparedPackage.version, nextVersion);
    assert.strictEqual(preparedLock.version, nextVersion);
    assert.strictEqual(preparedLock.packages[''].version, nextVersion);
    assert.strictEqual(preparedContract.productVersion, nextVersion);
    assert.deepStrictEqual({ ...preparedPackage, version: currentVersion }, beforePackage);
    assert.deepStrictEqual({ ...preparedLock, version: currentVersion, packages: { ...preparedLock.packages, '': { ...preparedLock.packages[''], version: currentVersion } } }, beforeLock);
    assert.deepStrictEqual({ ...preparedContract, productVersion: currentVersion }, beforeContract, 'prepare must preserve every non-version product contract field');
    assert.ok(fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8').endsWith('## ' + currentVersion + '\n\n- Existing release history.\n'));
    result = release(directory, 'check', '--dry-run');
    assert.strictEqual(result.status, 0, result.text);

    fs.writeFileSync(path.join(directory, 'UNRELATED.txt'), 'outside release metadata\n');
    expectFailure(release(directory, 'check', '--dry-run'), /UNRELATED\.txt/);
    fs.unlinkSync(path.join(directory, 'UNRELATED.txt'));

    writeJson(directory, 'product-contract.json', { ...preparedContract, productVersion: '0.0.0' });
    expectFailure(release(directory, 'check', '--dry-run'), /product-contract\.json 与 package\.json 版本不一致/);
    writeJson(directory, 'product-contract.json', { ...preparedContract, safeCoreCommit: 'f'.repeat(40) });
    expectFailure(release(directory, 'check', '--dry-run'), /其他契约字段不得变更/);
    writeJson(directory, 'product-contract.json', { ...preparedContract, productId: 'another-product' });
    expectFailure(release(directory, 'check', '--dry-run'), /产品身份不一致/);
    writeJson(directory, 'product-contract.json', preparedContract);

    writeJson(directory, 'package-lock.json', { ...preparedLock, version: '0.0.0' });
    expectFailure(release(directory, 'check', '--dry-run'), /package-lock\.json 版本不一致/);
    writeJson(directory, 'package-lock.json', preparedLock);
    result = release(directory, 'check', '--dry-run');
    assert.strictEqual(result.status, 0, result.text);

    for (const [name, mutate, message] of [
      ['contract-drift', ({ contract }) => { contract.productVersion = '0.0.0'; }, /product-contract\.json 与 package\.json 版本不一致/],
      ['identity-drift', ({ contract }) => { contract.productId = 'another-product'; }, /产品身份不一致/],
      ['lock-root-drift', ({ lock }) => { lock.version = '0.0.0'; }, /package-lock\.json 版本不一致/],
      ['lock-package-drift', ({ lock }) => { lock.packages[''].version = '0.0.0'; }, /package-lock\.json 版本不一致/]
    ]) {
      const invalid = fixture(name, mutate);
      expectFailure(release(invalid, 'prepare', nextVersion), message);
      assert.strictEqual(git(invalid, 'status', '--porcelain'), '', 'invalid existing metadata must not be silently repaired or partially written');
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('Real Git release workspace: synchronized four-file preparation, unchanged contract identity, dry-run, unrelated-file rejection and metadata-drift rejection passed.');
}
verifyReleaseMetadataWorkspace();

const root=path.resolve(__dirname,'..');
const productContract=require('../product-contract.json');
const expectedCore=productContract.safeCoreCommit;
assert.match(expectedCore,/^[0-9a-f]{40}$/);
assert.strictEqual(expectedCore,'190651770a444b0693d82228afc66879dd57b0c0');
assert.strictEqual(productContract.productContractVersion,2);
assert.strictEqual(productContract.safeCoreRuntimeDigest,'0b9c507ddb74bf40a0b950c3d8548ae747f547f76d3d2d37cebbd761cf28f5a0');
const gitlink=execFileSync('git',['ls-files','--stage','src/codex-safe-core'],{cwd:root,encoding:'utf8'}).trim();
assert.match(gitlink,new RegExp(`^160000 ${expectedCore} 0\\tsrc/codex-safe-core$`));
const policyExample=JSON.parse(fs.readFileSync(path.join(root,'.codex-safe.example.json'),'utf8'));
assert.match(String(policyExample.$schema||''),new RegExp(expectedCore));
assert.ok(!Object.prototype.hasOwnProperty.call(policyExample,'pr'),'retired PR policy surface must not return');

const release=fs.readFileSync(path.join(root,'.github','workflows','release.yml'),'utf8');
assert.match(release,/generate-consumer-ci-receipt\.js --output CONSUMER_CI_RECEIPT\.json/);
assert.match(release,/CI_WORKFLOW_NAME: Release/);
assert.match(release,/CI_SUITES: static-unit-contract,integration-linux-windows-macos,vscode-1\.90,zh-cn,workspace-trust,package/);
assert.match(release,/sha256sum "\$vsix" SBOM\.spdx\.json CONSUMER_CI_RECEIPT\.json > SHA256SUMS/);
assert.match(release,/CONSUMER_CI_RECEIPT\.json\n\s+SHA256SUMS/);
assert.match(release,/gh release create "\$RELEASE_TAG" "\$vsix" SBOM\.spdx\.json CONSUMER_CI_RECEIPT\.json SHA256SUMS/);

const marketplace=fs.readFileSync(path.join(root,'.github','workflows','marketplace.yml'),'utf8');
assert.match(marketplace,/\n  workflow_dispatch:\n/);
assert.doesNotMatch(marketplace,/\n  workflow_run:\n/,'Marketplace must not auto-publish from Release in the current stage');
assert.match(marketplace,/gh release download/);
assert.match(marketplace,/--pattern CONSUMER_CI_RECEIPT\.json/);
assert.match(marketplace,/sha256sum -c SHA256SUMS/);
assert.match(marketplace,/gh attestation verify .* -R "\$GITHUB_REPOSITORY"/);
assert.match(marketplace,/@vscode\/vsce@3\.9\.2 publish --packagePath/);
assert.match(marketplace,/distribution-receipt\.yml@190651770a444b0693d82228afc66879dd57b0c0/);
assert.match(marketplace,/channel: vscode-marketplace/);
assert.doesNotMatch(marketplace,/npm run package|vsce package/,'Marketplace must publish the exact GitHub Release VSIX, never rebuild it');
const renovate=JSON.parse(fs.readFileSync(path.join(root,'renovate.json'),'utf8'));
assert.ok(renovate.extends.includes(':automergeDisabled'));
assert.equal(renovate.minimumReleaseAge,'3 days');
const verification=fs.readFileSync(path.join(root,'VERIFY_RELEASE.md'),'utf8');
assert.match(verification,/gh attestation verify codex-review-safe-<version>\.vsix -R jiying2007\/codex-review/);

console.log(`Release helper, Core ${productContract.safeCoreVersion} Product Contract, Consumer CI Receipt, manual-only exact-SHA Marketplace promotion, pinned vsce, Distribution Receipt, attestation and dependency governance tests passed.`);
