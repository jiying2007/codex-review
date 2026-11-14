'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const vscode = {
  extensions:{ getExtension:() => undefined },
  workspace:{ workspaceFolders:[], textDocuments:[] }, window:{},
  l10n:{ t:message => message }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
};
let api;
try { api = require('../src/git'); } finally { Module._load = originalLoad; }

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'review-root-')); }
function init(root, file) {
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd:root });
  fs.writeFileSync(path.join(root, file), 'fixture\n');
  execFileSync('git', ['add', '--', file], { cwd:root });
}

test('fallback repository discovery keeps a selected root with spaces and nested folders', async () => {
  const base = fixture();
  try {
    const root = path.join(base, 'selected repository');
    init(root, 'selected.txt');
    const nested = path.join(root, 'nested'); fs.mkdirSync(nested);
    vscode.workspace.workspaceFolders = [{ uri:{ fsPath:nested } }, { uri:{ fsPath:root } }];
    const repositories = await api.getRepositories();
    assert.equal(repositories.length, 1);
    assert.equal(fs.realpathSync.native(repositories[0].root), fs.realpathSync.native(root));
    assert.deepEqual(await api.getStagedPathList(repositories[0].root), ['selected.txt']);
  } finally { vscode.workspace.workspaceFolders = []; fs.rmSync(base, { recursive:true, force:true }); }
});

test('fallback cannot redirect a whitespace-suffixed repository into its real neighbor', { skip:process.platform === 'win32' }, async () => {
  const base = fixture();
  try {
    init(path.join(base, 'repo'), 'neighbor.txt');
    const roots = ['repo ', 'repo\t', 'repo\r', 'repo\n', 'repo\\name', 'repo\uFEFF'].map(name => path.join(base, name));
    for (const root of roots) {
      init(root, 'selected.txt');
      vscode.workspace.workspaceFolders = [{ uri:{ fsPath:root } }];
      const repositories = await api.getRepositories();
      assert.equal(repositories.length, 1);
      assert.equal(repositories[0].root, fs.realpathSync.native(root));
      assert.deepEqual(await api.getStagedPathList(repositories[0].root), ['selected.txt']);
    }
  } finally { vscode.workspace.workspaceFolders = []; fs.rmSync(base, { recursive:true, force:true }); }
});

test('repository root parser rejects malformed bytes and framing without trimming valid identity', () => {
  const root = path.resolve('root with space ');
  assert.equal(api.decodeRepositoryRoot(Buffer.from(root + '\n')), root);
  for (const bytes of [Buffer.from(root), Buffer.from('\n'), Buffer.from('relative\n'), Buffer.from(root + '\0\n'), Buffer.concat([Buffer.from(root), Buffer.from([0xff, 0x0a])])]) {
    assert.throws(() => api.decodeRepositoryRoot(bytes), error => error.code === 'EGITROOT');
  }
  assert.throws(() => api.decodeRepositoryRoot(root + '\n'), error => error.code === 'EGITROOT');
});

test('root discovery rejects a reported repository outside the selected workspace', async () => {
  const base = fixture(), previous = process.env.GIT_WORK_TREE;
  try {
    const selected = path.join(base, 'selected'), neighbor = path.join(base, 'neighbor');
    init(selected, 'selected.txt'); init(neighbor, 'neighbor.txt');
    vscode.workspace.workspaceFolders = [{ uri:{ fsPath:selected } }];
    process.env.GIT_WORK_TREE = neighbor;
    assert.deepEqual(await api.getRepositories(), []);
  } finally {
    if (previous === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = previous;
    vscode.workspace.workspaceFolders = []; fs.rmSync(base, { recursive:true, force:true });
  }
});

test('review cannot collapse an invalid Git filename onto a valid replacement-character filename', { skip:process.platform !== 'linux' }, async () => {
  const base = fixture();
  try {
    const root = path.join(base, 'repository'); init(root, 'regular.txt');
    const invalid = Buffer.concat([Buffer.from(root + '/bad-'), Buffer.from([0xff]), Buffer.from('.txt')]);
    fs.writeFileSync(invalid, 'bad byte\n');
    fs.writeFileSync(path.join(root, 'bad-\uFFFD.txt'), 'valid Unicode\n');
    execFileSync('git', ['add', '--all'], { cwd:root });
    for (const method of ['getStagedPathList', 'getStagedChangeMetadata', 'getBinaryPathSet', 'getSubmodulePathSet', 'getUnstagedPathSet']) {
      await assert.rejects(api[method](root), error => error.code === 'EGITINVENTORY', method);
    }
  } finally { fs.rmSync(base, { recursive:true, force:true }); }
});

test('path inventory decoding preserves BOM and exact names, and rejects incomplete byte records', () => {
  const names = '\uFEFFfirst\0a\\b \0a/b\0line\nname\0';
  assert.equal(api.decodeGitPathEnumeration(Buffer.from(names)), names);
  assert.equal(api.decodeGitPathEnumeration(Buffer.alloc(0)), '');
  for (const raw of [Buffer.from('partial'), Buffer.from([0xff, 0]), 'name\0']) {
    assert.throws(() => api.decodeGitPathEnumeration(raw), error => error.code === 'EGITINVENTORY');
  }
});
