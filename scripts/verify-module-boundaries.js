'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extension = fs.readFileSync('extension.js', 'utf8');
const processModule = fs.readFileSync('src/process.js', 'utf8');
const gitModule = fs.readFileSync('src/git.js', 'utf8');
const policyModule = fs.readFileSync('src/policy.js', 'utf8');
const reviewModule = fs.readFileSync('src/review.js', 'utf8');
const codexModule = fs.readFileSync('src/codex.js', 'utf8');

for (const modulePath of ['./src/i18n', './src/review-support', './src/process', './src/git', './src/policy', './src/review', './src/report', './src/receipts', './src/codex', './src/quality', './src/semantic-evidence', './src/semantic-review', './src/review-cache', './src/finding-ledger', './src/review-scope', './src/review-lineage', './src/convergence']) {
  assert.match(extension, new RegExp(`require\\(['\"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]\\)`), `extension.js must import ${modulePath}`);
}

assert.strictEqual(fs.existsSync('src/core.js'), false, 'ambiguous Review src/core.js must not return');
assert.strictEqual(fs.existsSync('src/safe-contract.js'), false, 'legacy src/safe-contract.js shim must not return');
assert.strictEqual(fs.existsSync('safe-core.lock.json'), false, 'legacy Safe Core lock must not return');
assert.strictEqual(fs.existsSync('scripts/safe-core.js'), false, 'legacy Safe Core sync script must not return');
for (const name of ['index.js','safe-contract.js','codex-cli.js','process-runner.js','git-repository.js','context-builder.js','efficiency-planner.js','quality-platform.js','semantic-review.js','policy.js','review-rules.js','core-contract.json']) {
  assert.strictEqual(fs.existsSync(path.join('src','codex-safe-core',name)), true, `Safe Core v4.5 runtime missing ${name}`);
}
assert.doesNotMatch(extension, /\b__test\b/, 'extension.js must not expose a transitional private test surface');
assert.doesNotMatch(extension, /require\(['\"]child_process['\"]\)/, 'extension.js must not own subprocess execution');
assert.doesNotMatch(extension, /nearestChangedLine|nearest_changed_line|mapped to the nearest changed line/i, 'extension.js must enforce exact changed-line publication only');
assert.doesNotMatch(processModule, /require\(['\"]child_process['\"]\)/, 'Review must not own subprocess execution');
assert.match(processModule, /\.\/codex-safe-core\/process-runner/, 'Review process adapter must delegate to Core');
assert.match(gitModule, /\.\/codex-safe-core\/git-repository/, 'Review Git primitives must delegate to Core');
assert.match(policyModule, /\.\/codex-safe-core\/policy/, 'Review policy must delegate to Core');
assert.match(reviewModule, /\.\/codex-safe-core\/review-rules/, 'Review deterministic rules must delegate to Core');
assert.match(codexModule, /buildReviewEvidenceChunks/, 'Review evidence chunking must delegate to Core');
assert.match(codexModule, /efficiency-planner/, 'Review token/risk budgeting must delegate to Core');
assert.match(codexModule, /quality-platform/, 'Review profile/patch validation must delegate to Core');
assert.match(codexModule, /semantic-review/, 'Review semantic verification contracts must delegate to Core');
assert.doesNotMatch(fs.readFileSync('src/semantic-evidence.js','utf8'), /fs\.readFileSync/, 'semantic dependency evidence must never read the working tree');
assert.match(fs.readFileSync('src/semantic-evidence.js','utf8'), /require\(['\"]\.\/code-intelligence['\"]\)/, 'semantic-evidence must own the code-intelligence provider seam');
assert.doesNotMatch(extension, /require\(['\"]\.\/src\/code-intelligence['\"]\)/, 'extension must not bypass semantic-evidence to import code-intelligence directly');
assert.match(fs.readFileSync('src/semantic-review.js','utf8'), /require\(['\"]\.\/causal-anchor['\"]\)/, 'semantic-review must delegate causal anchoring to the headless causal-anchor module');
for (const symbol of ['estimateRequestTokens','scoreEvidenceRisk','selectChunksWithinByteBudget','maxEstimatedTokens','requestEstimate','usage']) assert.match(codexModule,new RegExp(`\\b${symbol}\\b`),`Review efficiency adapter must retain ${symbol}`);
assert.doesNotMatch(reviewModule, /nearestChangedLine|maxDistance\s*=\s*3/, 'nearest-line compatibility residue must not return');
for (const catalog of ['l10n/bundle.l10n.json','l10n/bundle.l10n.zh-cn.json']) {
  if (!fs.existsSync(catalog)) continue;
  assert.doesNotMatch(fs.readFileSync(catalog, 'utf8'), /mapped to the nearest changed line/i, `${catalog} must not retain nearest-line compatibility copy`);
}

for (const [name, source] of [['src/policy.js', policyModule], ['src/review.js', reviewModule], ['src/codex.js', codexModule]]) {
  assert.match(source, /require\(['\"]\.\/codex-safe-core\/safe-contract['\"]\)/, `${name} must import the canonical Safe Core contract directly`);
  assert.doesNotMatch(source, /require\(['\"]\.\/safe-contract['\"]\)/, `${name} must not reintroduce a contract shim`);
}

for (const functionName of ['runProcess', 'runProcessBuffer', 'getStagedDiff', 'readProjectRulesAtHead', 'getEffectiveOptions', 'outputSchema', 'buildPrompt', 'parseCodexJsonl', 'validateReviewResult', 'buildReviewReport', 'createReviewReceiptStore', 'resolveCodexExecutable', 'probeCodexCapabilities', 'runCodexReview']) {
  assert.doesNotMatch(extension, new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`), `${functionName} must stay outside extension.js`);
}

function collectJsFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

for (const file of ['test.js', ...collectJsFiles('test')]) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /\b__test\b/, `${file} must not depend on removed private test surfaces`);
  assert.doesNotMatch(source, /src[\\/]safe-contract\.js|require\(['\"]\.\/src\/safe-contract['\"]\)/, `${file} must not depend on a removed contract shim`);
}

console.log('Review runtime boundaries verified against Codex Safe Core v4.5 with index-pinned semantic evidence, exact-line-only publication and evidence-backed verification.');
