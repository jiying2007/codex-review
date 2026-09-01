'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const runtimeModules = [
  'i18n.js', 'review-support.js', 'process.js', 'git.js', 'policy.js',
  'review.js', 'report.js', 'receipts.js', 'codex.js', 'quality.js',
  'semantic-evidence.js', 'semantic-review.js', 'review-cache.js', 'replay-window.js',
  'finding-ledger.js', 'review-scope.js', 'review-lineage.js', 'convergence.js',
  'causal-anchor.js', 'code-intelligence.js'
];
const coreModules = [
  'index.js', 'safe-contract.js', 'judgment-lifecycle.js', 'codex-runtime.js', 'codex-cli.js', 'process-runner.js',
  'git-repository.js', 'context-builder.js', 'efficiency-planner.js', 'quality-platform.js', 'semantic-review.js', 'policy.js', 'review-rules.js'
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
  if (!fs.existsSync(path.join(dist, 'src', 'codex-safe-core', 'judgment-lifecycle.js'))) throw new Error('Judgment Lifecycle runtime module missing from dist.');
}

main();
