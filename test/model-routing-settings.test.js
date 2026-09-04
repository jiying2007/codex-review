'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const props = pkg.contributes?.configuration?.properties || {};

assert.deepEqual(props['safeCodexReview.mode']?.enum, ['fast', 'balanced', 'deep']);
assert.equal(props['safeCodexReview.mode']?.default, 'balanced');
assert.ok(Array.isArray(props['safeCodexReview.profilePack']?.enum));
assert.ok(props['safeCodexReview.profilePack'].enum.includes('embedded-linux'));
assert.equal(props['safeCodexReview.profile'], undefined, 'legacy mixed execution/domain profile must be removed');
assert.equal(props['safeCodexReview.fastModel']?.scope, 'application');
assert.equal(props['safeCodexReview.maxTokenBudget']?.type, 'number');
assert.equal(props['safeCodexReview.totalContextBudgetBytes']?.type, 'number');

const policy = fs.readFileSync('src/policy.js', 'utf8');
assert.match(policy, /resolveReviewModeProfile\(mode, profilePack\)/);
assert.match(policy, /fastModel/);

const extension = fs.readFileSync('extension.js', 'utf8');
assert.match(extension, /safeCodexReview\.reviewFresh/);
assert.match(extension, /forceFresh: true/);

console.log('Review Model Routing v1 settings and Fresh Blind Review contract verified.');
