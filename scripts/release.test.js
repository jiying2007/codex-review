'use strict';

const assert = require('assert');
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
console.log('Release helper tests passed.');
