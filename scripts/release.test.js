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
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md', 'package-lock.json']), true);
assert.strictEqual(sameFiles(['package.json', 'CHANGELOG.md']), false);
const source = '# Changelog\n\n## Unreleased\n\n- New behavior.\n\n## 1.0.0\n\n- Initial.\n';
assert.strictEqual(updateChangelog(source, '1.0.1'), '# Changelog\n\n## Unreleased\n\n## 1.0.1\n\n- New behavior.\n\n## 1.0.0\n\n- Initial.\n');
assert.throws(() => updateChangelog('# Changelog\n\n## Unreleased\n\n## 1.0.0\n', '1.0.1'), /Unreleased 区域为空/);

const root=path.resolve(__dirname,'..');
const expectedCore='a4a8acab6565bdb7e5f7927d2a4db14d31a6e895';
const gitlink=execFileSync('git',['ls-files','--stage','src/codex-safe-core'],{cwd:root,encoding:'utf8'}).trim();
assert.match(gitlink,new RegExp(`^160000 ${expectedCore} 0\\tsrc/codex-safe-core$`));
const policyExample=JSON.parse(fs.readFileSync(path.join(root,'.codex-safe.example.json'),'utf8'));
assert.match(String(policyExample.$schema||''),new RegExp(expectedCore));
const marketplace=fs.readFileSync(path.join(root,'.github','workflows','marketplace.yml'),'utf8');
assert.match(marketplace,/gh release download/);
assert.match(marketplace,/sha256sum -c SHA256SUMS/);
assert.match(marketplace,/gh attestation verify .* -R "\$GITHUB_REPOSITORY"/);
assert.match(marketplace,/vsce publish --packagePath/);
assert.doesNotMatch(marketplace,/npm run package|vsce package/,'Marketplace must publish the exact GitHub Release VSIX, never rebuild it');
const renovate=JSON.parse(fs.readFileSync(path.join(root,'renovate.json'),'utf8'));
assert.ok(renovate.extends.includes(':automergeDisabled'));
assert.equal(renovate.minimumReleaseAge,'3 days');
const verification=fs.readFileSync(path.join(root,'VERIFY_RELEASE.md'),'utf8');
assert.match(verification,/gh attestation verify codex-review-safe-<version>\.vsix -R jiying2007\/codex-review/);

console.log('Release helper, exact Core/schema provenance, Marketplace artifact reuse, attestation and dependency governance tests passed.');
