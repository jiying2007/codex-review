'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extension = fs.readFileSync('extension.js', 'utf8');
const processModule = fs.readFileSync('src/process.js', 'utf8');
const policyModule = fs.readFileSync('src/policy.js', 'utf8');
const reviewModule = fs.readFileSync('src/review.js', 'utf8');
const codexModule = fs.readFileSync('src/codex.js', 'utf8');

for (const modulePath of [
  './src/i18n', './src/core', './src/process', './src/git', './src/policy',
  './src/review', './src/report', './src/receipts', './src/codex'
]) {
  assert.match(extension, new RegExp(`require\\(['\"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]\\)`), `extension.js must import ${modulePath}`);
}

assert.strictEqual(fs.existsSync('src/safe-contract.js'), false, 'legacy src/safe-contract.js shim must not return');
assert.doesNotMatch(extension, /\b__test\b/, 'extension.js must not expose a transitional private test surface');
assert.doesNotMatch(extension, /require\(['\"]child_process['\"]\)/, 'extension.js must not own subprocess execution');
assert.doesNotMatch(extension, /require\(['\"]os['\"]\)/, 'extension.js must not own temporary-directory execution');
assert.match(processModule, /require\(['\"]child_process['\"]\)/, 'src/process.js must own subprocess execution');
for (const [name, source] of [['src/policy.js', policyModule], ['src/review.js', reviewModule], ['src/codex.js', codexModule]]) {
  assert.match(source, /require\(['\"]\.\/codex-safe-core\/safe-contract['\"]\)/, `${name} must import the canonical Safe Core contract directly`);
  assert.doesNotMatch(source, /require\(['\"]\.\/safe-contract['\"]\)/, `${name} must not reintroduce the legacy contract shim`);
}

for (const functionName of [
  'runProcess', 'runProcessBuffer', 'getStagedDiff', 'readProjectRulesAtHead',
  'getEffectiveOptions', 'outputSchema', 'buildPrompt', 'parseCodexJsonl',
  'validateReviewResult', 'buildReviewReport', 'createReviewReceiptStore',
  'resolveCodexExecutable', 'probeCodexCapabilities', 'runCodexReview'
]) {
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
  assert.doesNotMatch(source, /\b__test\b/, `${file} must not depend on the removed private test surface`);
  assert.doesNotMatch(source, /src[\\/]safe-contract\.js|require\(['\"]\.\/src\/safe-contract['\"]\)/, `${file} must not depend on the removed contract shim`);
}

console.log('Runtime module boundaries verified without transition shims.');
