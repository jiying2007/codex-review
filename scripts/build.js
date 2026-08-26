'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const runtimeModules = [
  'i18n.js', 'review-support.js', 'process.js', 'git.js', 'policy.js',
  'review.js', 'report.js', 'receipts.js', 'codex.js'
];
const coreModules = [
  'index.js', 'safe-contract.js', 'codex-cli.js', 'process-runner.js',
  'git-repository.js', 'context-builder.js', 'policy.js', 'review-rules.js'
];
const coreRuntimeData = ['core-contract.json'];

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function main() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'src', 'codex-safe-core'), { recursive: true });
  copy(path.join(root, 'extension.js'), path.join(dist, 'extension.js'));
  for (const name of runtimeModules) copy(path.join(root, 'src', name), path.join(dist, 'src', name));
  for (const name of coreModules) copy(path.join(root, 'src', 'codex-safe-core', name), path.join(dist, 'src', 'codex-safe-core', name));
  for (const name of coreRuntimeData) copy(path.join(root, 'src', 'codex-safe-core', name), path.join(dist, 'src', 'codex-safe-core', name));
  copy(path.join(root, 'src', 'codex-safe-core', 'codex-safe.schema.json'), path.join(dist, 'codex-safe.schema.json'));
}

main();
