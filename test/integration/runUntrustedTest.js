'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');

function exec(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  exec('git', ['init'], root);
  exec('git', ['config', 'user.email', 'test@example.com'], root);
  exec('git', ['config', 'user.name', 'Codex Review Safe Test'], root);
  fs.writeFileSync(path.join(root, 'a.c'), 'int value = 0;\n');
  exec('git', ['add', 'a.c'], root);
  exec('git', ['commit', '-m', 'initial'], root);
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-untrusted-it-'));
  const repo = path.join(base, 'repo');
  const userDataDir = path.join(base, 'user-data-untrusted');
  initRepo(repo);

  const runOptions = {
    extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
    extensionTestsPath: path.resolve(__dirname, 'suite', 'untrusted-index'),
    launchArgs: [
      repo,
      '--disable-extensions',
      '--user-data-dir', userDataDir,
      '--skip-welcome',
      '--skip-release-notes'
    ]
  };
  if (process.env.VSCODE_TEST_VERSION) runOptions.version = process.env.VSCODE_TEST_VERSION;

  try {
    await runTests(runOptions);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
