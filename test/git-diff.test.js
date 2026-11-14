'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseGitDiff } = require('../src/git-diff');

test('unterminated quoted headers finish within a bounded child process', () => {
  const program = [
    'const assert=require("node:assert/strict");',
    'const fs=require("node:fs");',
    'const {parseGitDiff}=require(process.argv[1]);',
    'for(const input of JSON.parse(fs.readFileSync(0,"utf8")))',
    'assert.deepEqual(parseGitDiff(input),[]);'
  ].join('\n');
  const suffix = '\\!'.repeat(200000);
  const result = spawnSync(process.execPath, ['-e', program, path.resolve(__dirname, '../src/git-diff.js')], {
    input: JSON.stringify(['diff --git "' + suffix, 'diff --git "" "' + suffix]),
    encoding: 'utf8', timeout: 5000, windowsHide: true
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('quoted paths preserve escaped quotes, backslashes and tabs', () => {
  const oldPath = JSON.stringify('a/quo"ted\\path\tname.c');
  const newPath = JSON.stringify('b/quo"ted\\path\tname.c');
  const diff = ['diff --git ' + oldPath + ' ' + newPath, '--- ' + oldPath, '+++ ' + newPath,
    '@@ -1 +1 @@', '-old', '+new'].join('\n');
  const [section] = parseGitDiff(diff);
  assert.equal(section.oldPath, 'quo"ted/path\tname.c');
  assert.equal(section.newPath, 'quo"ted/path\tname.c');
  assert.equal(section.oldLines.get(1), 'old');
  assert.equal(section.newLines.get(1), 'new');
});

test('real Git preserves a and b directories, quoted rename paths and hunk source prefixes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-git-diff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  git('config', 'user.name', 'Review Git Diff Test');
  git('config', 'user.email', 'review-diff@example.invalid');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.quotepath', 'true');
  for (const file of ['a/file.c', 'b/file.c', 'file.c']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'before ' + file + '\n');
  }
  const oldPath = 'a/路径 name.c', newPath = 'b/路径 name.c';
  const before = ['rename fixture', '--counter;', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10', ''].join('\n');
  fs.writeFileSync(path.join(root, oldPath), before);
  git('add', '.');
  git('commit', '-m', 'baseline');
  for (const file of ['a/file.c', 'b/file.c', 'file.c']) fs.writeFileSync(path.join(root, file), 'after ' + file + '\n');
  git('mv', oldPath, newPath);
  fs.writeFileSync(path.join(root, newPath), before.replace('--counter;', '++counter;'));
  git('add', '-A');
  const diff = git('diff', '--cached', '--find-renames=50%', '--no-ext-diff', '--no-textconv');
  assert.match(diff, /^diff --git "/m);
  assert.match(diff, /^rename from /m);
  let sections;
  assert.doesNotThrow(() => { sections = parseGitDiff(diff); }, diff);
  assert.deepEqual(sections.map(section => section.path).sort(), ['a/file.c', 'b/file.c', 'file.c', newPath].sort());
  const renamed = sections.find(section => section.newPath === newPath);
  assert.equal(renamed.oldPath, oldPath);
  assert.equal(renamed.oldLines.get(2), '--counter;');
  assert.equal(renamed.newLines.get(2), '++counter;');
});
