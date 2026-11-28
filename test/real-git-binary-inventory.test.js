'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const test = require('node:test');

const vscode = {
  extensions: { getExtension: () => undefined },
  workspace: { workspaceFolders: [], textDocuments: [] },
  window: {},
  l10n: { t: message => message }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
};
let gitApi;
try { gitApi = require('../src/git'); } finally { Module._load = originalLoad; }

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function binary(seed, size = 1024 * 1024 + 257) {
  return Buffer.concat([Buffer.from(seed + '\0'), Buffer.alloc(size, 0xA5), Buffer.from('\0' + seed)]);
}

test('real Git binary inventory covers extensionless, quoted, attributed, renamed and deleted files without classifying text/LFS pointers', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-real-binary-inventory-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'repository with spaces');
  fs.mkdirSync(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Binary Inventory Fixture');
  git(root, 'config', 'user.email', 'binary-inventory@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.quotepath', 'true');

  write(root, 'firmware/rename-source.bin', binary('RENAME_SOURCE'));
  write(root, 'firmware/delete-me.dat', binary('DELETE_ME'));
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'baseline binary artifacts');

  git(root, 'mv', 'firmware/rename-source.bin', 'firmware/renamed "image".bin');
  fs.rmSync(path.join(root, 'firmware/delete-me.dat'));
  write(root, 'firmware/update.bin', binary('UPDATE_BIN'));
  write(root, 'artifacts/no-extension', binary('NO_EXTENSION'));
  write(root, 'artifacts/forced.dat', binary('FORCED_BINARY'));
  write(root, '.gitattributes', 'artifacts/forced.dat -diff\n');
  write(root, 'src/large.c', Buffer.from('int changed_value = 1;\n'.repeat(60000)));
  write(root, 'docs/marker-text.txt', [
    'GIT binary patch',
    'Binary files a/not-a-binary b/not-a-binary differ',
    'SOURCE_MARKER_TEXT_MUST_REMAIN_TEXT'
  ].join('\n') + '\n');
  write(root, 'artifacts/lfs-pointer.bin', [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:' + 'a'.repeat(64),
    'size 1048833',
    ''
  ].join('\n'));

  git(root, 'add', '--all');
  const [stagedPaths, binaryPaths, metadata] = await Promise.all([
    gitApi.getStagedPathList(root),
    gitApi.getBinaryPathSet(root),
    gitApi.getStagedChangeMetadata(root)
  ]);
  const staged = new Set(stagedPaths);
  const binaries = new Set(binaryPaths);

  for (const expected of [
    'firmware/renamed "image".bin',
    'firmware/delete-me.dat',
    'firmware/update.bin',
    'artifacts/no-extension',
    'artifacts/forced.dat'
  ]) assert.ok(binaries.has(expected), 'missing binary path: ' + expected);

  assert.ok(!binaries.has('src/large.c'), 'large text hunk must not be classified as binary');
  assert.ok(!binaries.has('docs/marker-text.txt'), 'text containing binary markers must not be classified as binary');
  assert.ok(!binaries.has('artifacts/lfs-pointer.bin'), 'a textual Git LFS pointer must remain text');
  assert.ok(staged.has('firmware/renamed "image".bin'));
  assert.ok(staged.has('firmware/delete-me.dat'));
  assert.ok(metadata.has('firmware/renamed "image".bin'));
  assert.ok(metadata.has('firmware/delete-me.dat'));
  assert.equal(metadata.get('firmware/renamed "image".bin').status, 'R');
  assert.equal(metadata.get('firmware/renamed "image".bin').oldPath, 'firmware/rename-source.bin');
  assert.ok(binaries.size <= staged.size + 1, 'binary inventory must remain bounded to the staged change set plus rename source');
  assert.ok(binaryPaths.every(value => typeof value === 'string' && value.length > 0));
});
