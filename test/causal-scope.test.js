'use strict';
const assert = require('node:assert/strict');
const { validateCausalAnchor, normalizeSupportingLocations } = require('../src/causal-anchor');
const { normalizeReviewScope, scopeDispositionAllowsPublish } = require('../src/review-scope');
const semanticSource = require('node:fs').readFileSync('src/semantic-review.js','utf8');

const changed = new Map([['pt_common.c', [{ start:100, end:101 }]]]);
const staged = new Set(['pt_common.c']);
const anchor = validateCausalAnchor('pt_common.c', 100, staged, changed);
assert.deepEqual(anchor, { file:'pt_common.c', line:100 });
assert.throws(() => validateCausalAnchor('pt_common.c', 800, staged, changed), /causal anchor is not an exact changed line/);
assert.throws(() => validateCausalAnchor('unchanged.c', 100, staged, changed), /causal path is not staged/);

const supporting = normalizeSupportingLocations([{ file:'pt_common.c', line:800, endLine:806, kind:'symptom', reason:'Existing LCD branch renders the new stopped state as RUN.' }]);
assert.equal(supporting.length, 1);
assert.equal(supporting[0].line, 800);
assert.equal(supporting[0].kind, 'symptom');

const scope = normalizeReviewScope({
  schemaVersion:1,
  phase:'production-aging-v1',
  goals:['temperature pause/resume'],
  invariants:['Common remains the sole managed-load lifecycle executor.'],
  nonGoals:['shared UART generation framework'],
  complexityBudget:'minimal'
});
assert.equal(scopeDispositionAllowsPublish(scope,'in_scope',''), true);
assert.equal(scopeDispositionAllowsPublish(scope,'non_goal_risk',''), false);
assert.equal(scopeDispositionAllowsPublish(scope,'needs_scope_decision',''), false);
assert.equal(scopeDispositionAllowsPublish(scope,'non_goal_risk','Common remains the sole managed-load lifecycle executor.'), true);
assert.match(semanticSource,/validateCausalAnchor/,'semantic review must use the headless causal-anchor gate');
assert.match(semanticSource,/scopeDispositionAllowsPublish/,'semantic review must use the deterministic scope disposition gate');
assert.match(semanticSource,/supportingLocations/,'semantic review must preserve supporting locations without relaxing the causal line gate');
console.log('Causal anchor and scope contract tests passed.');
