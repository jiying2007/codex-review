'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const stampFile = path.join(dist, '.build-input.sha256');
const runtimeModules = [
  'i18n.js', 'review-support.js', 'process.js', 'git.js', 'policy.js',
  'review.js', 'report.js', 'receipts.js', 'codex.js', 'quality.js',
  'semantic-evidence.js', 'semantic-review.js', 'review-cache.js', 'replay-window.js',
  'finding-ledger.js', 'review-scope.js', 'review-lineage.js', 'convergence.js',
  'causal-anchor.js', 'code-intelligence.js'
];
const coreModules = [
  'index.js', 'safe-contract.js', 'judgment-lifecycle.js', 'codex-runtime.js', 'codex-runtime-resolver.js',
  'model-registry-resolver.js', 'model-routing.js', 'model-capabilities.js', 'model-lineage.js', 'model-economics.js',
  'codex-jsonl-stream.js', 'codex-cli.js', 'process-runner.js', 'git-repository.js', 'context-builder.js',
  'efficiency-planner.js', 'token-calibration-store.js', 'quality-platform.js', 'review-profile-pack.js',
  'semantic-review.js', 'policy.js', 'review-rules.js'
];
const optionalCoreModules = ['secure-local-file.js'];
const coreRuntimeData = ['core-contract.json', 'quality/profile-packs.json'];

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function sourceFiles() {
  const files = [path.join(root, 'extension.js')];
  for (const name of runtimeModules) files.push(path.join(root, 'src', name));
  for (const name of coreModules) files.push(path.join(root, 'src', 'codex-safe-core', name));
  for (const name of optionalCoreModules) {
    const file = path.join(root, 'src', 'codex-safe-core', name);
    if (fs.existsSync(file)) files.push(file);
  }
  for (const name of coreRuntimeData) files.push(path.join(root, 'src', 'codex-safe-core', name));
  files.push(path.join(root, 'src', 'codex-safe-core', 'codex-safe.schema.json'));
  return files;
}
function buildInputDigest() {
  const hash = crypto.createHash('sha256');
  hash.update('codex-review-build-v2\0');
  for (const file of sourceFiles()) {
    if (!fs.existsSync(file)) throw new Error(`Build input is missing: ${path.relative(root, file)}`);
    hash.update(path.relative(root, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
function distIsReusable(digest) {
  try {
    if (fs.readFileSync(stampFile, 'utf8').trim() !== digest) return false;
    for (const file of ['extension.js', 'src/review.js', 'src/codex-safe-core/codex-cli.js', 'codex-safe.schema.json']) {
      if (!fs.existsSync(path.join(dist, file))) return false;
    }
    return true;
  } catch { return false; }
}

function main() {
  const digest = buildInputDigest();
  if (distIsReusable(digest)) {
    process.stdout.write(`Codex Review Safe build cache hit ${digest.slice(0, 12)}\n`);
    return;
  }
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'src', 'codex-safe-core'), { recursive: true });
  copy(path.join(root, 'extension.js'), path.join(dist, 'extension.js'));
  for (const name of runtimeModules) copy(path.join(root, 'src', name), path.join(dist, 'src', name));
  for (const name of coreModules) copy(path.join(root, 'src', 'codex-safe-core', name), path.join(dist, 'src', 'codex-safe-core', name));
  for (const name of optionalCoreModules) {
    const source = path.join(root, 'src', 'codex-safe-core', name);
    if (fs.existsSync(source)) copy(source, path.join(dist, 'src', 'codex-safe-core', name));
  }
  for (const name of coreRuntimeData) copy(path.join(root, 'src', 'codex-safe-core', name), path.join(dist, 'src', 'codex-safe-core', name));
  copy(path.join(root, 'src', 'codex-safe-core', 'codex-safe.schema.json'), path.join(dist, 'codex-safe.schema.json'));
  for (const name of ['judgment-lifecycle.js', 'codex-runtime-resolver.js', 'model-routing.js', 'review-profile-pack.js', 'codex-jsonl-stream.js']) {
    if (!fs.existsSync(path.join(dist, 'src', 'codex-safe-core', name))) throw new Error(`Required Core runtime module missing from dist: ${name}`);
  }
  if (fs.existsSync(path.join(root, 'src', 'codex-safe-core', 'secure-local-file.js')) && !fs.existsSync(path.join(dist, 'src', 'codex-safe-core', 'secure-local-file.js'))) {
    throw new Error('Required Core secure-local-file runtime module missing from dist.');
  }
  fs.writeFileSync(stampFile, `${digest}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Codex Review Safe built ${digest.slice(0, 12)}\n`);
}

main();
