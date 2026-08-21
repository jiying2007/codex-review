'use strict';

const assert = require('assert');
const fs = require('fs');

const extension = fs.readFileSync('extension.js', 'utf8');
const processModule = fs.readFileSync('src/process.js', 'utf8');

for (const modulePath of [
  './src/i18n',
  './src/core',
  './src/process',
  './src/git',
  './src/policy',
  './src/review',
  './src/codex'
]) {
  assert.match(extension, new RegExp(`require\\(['\"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]\\)`), `extension.js must import ${modulePath}`);
}

assert.doesNotMatch(extension, /require\(['\"]child_process['\"]\)/, 'extension.js must not own subprocess execution');
assert.doesNotMatch(extension, /require\(['\"]os['\"]\)/, 'extension.js must not own temporary-directory execution');
assert.match(processModule, /require\(['\"]child_process['\"]\)/, 'src/process.js must own subprocess execution');

for (const functionName of [
  'runProcess',
  'runProcessBuffer',
  'getStagedDiff',
  'readProjectRulesAtHead',
  'getEffectiveOptions',
  'outputSchema',
  'buildPrompt',
  'parseCodexJsonl',
  'validateReviewResult',
  'resolveCodexExecutable',
  'probeCodexCapabilities',
  'runCodexReview'
]) {
  assert.doesNotMatch(
    extension,
    new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`),
    `${functionName} must stay outside extension.js`
  );
}

console.log('Runtime module boundaries verified.');
