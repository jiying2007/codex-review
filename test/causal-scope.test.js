'use strict';
const assert = require('node:assert/strict');
const { validateCausalAnchor, normalizeSupportingLocations, anchorContextDigestForSide } = require('../src/causal-anchor');
const { normalizeReviewScope, scopeDispositionAllowsPublish } = require('../src/review-scope');
const { validateHypothesis, hypothesisSchema } = require('../src/semantic-review');
const { evaluateConvergence } = require('../src/convergence');
const semanticSource = require('node:fs').readFileSync('src/semantic-review.js','utf8');

const changed = new Map([['pt_common.c', [{ start:100, end:101 }]]]);
const staged = new Set(['pt_common.c']);
const anchor = validateCausalAnchor('pt_common.c', 100, staged, changed, 101);
assert.deepEqual(anchor, { file:'pt_common.c', line:100, side:'new' });
assert.throws(() => validateCausalAnchor('pt_common.c', 800, staged, changed), /exact new-side changed lines/);
assert.throws(() => validateCausalAnchor('pt_common.c', 101, staged, changed, 102), /exact new-side changed lines/);
assert.throws(() => validateCausalAnchor('unchanged.c', 100, staged, changed), /causal path is not staged/);

const removedGuardDiff = [
  'diff --git a/auth.c b/auth.c',
  '--- a/auth.c',
  '+++ b/auth.c',
  '@@ -10,3 +10,1 @@',
  '-if (!authorized(user))',
  '-  return -EPERM;',
  ' do_sensitive_work();'
].join('\n');
const removedStaged = new Set(['auth.c']);
const oldAnchor = validateCausalAnchor('auth.c', 10, removedStaged, new Map(), 10, { side:'old', diff:removedGuardDiff });
assert.deepEqual(oldAnchor, { file:'auth.c', line:10, side:'old' }, 'removed authorization checks must remain valid causal anchors');
assert.ok(anchorContextDigestForSide(removedGuardDiff,'auth.c',10,'old'), 'old-side anchors must have a stable content digest');
assert.throws(() => validateCausalAnchor('auth.c', 10, removedStaged, new Map(), 10, { side:'new', diff:removedGuardDiff }), /exact new-side changed lines/);

const schema = hypothesisSchema({ maxFindings:10 });
assert.deepEqual(schema.properties.hypotheses.items.properties.side.enum, ['new','old']);
assert.ok(schema.properties.hypotheses.items.required.includes('side'), 'semantic hypothesis contract must require causal side');
const oldHypothesis = validateHypothesis({
  severity:'high', category:'security', file:'auth.c', side:'old', line:10, endLine:10,
  claim:'Removing this authorization check permits unauthorized callers to reach the sensitive operation.', suggestion:'Restore an authorization gate before the sensitive operation.', modelConfidence:0.99,
  assumptions:[], requiredSymbols:[], rootCauseSymbol:'authorized', claimClass:'missing-check', supportingLocations:[],
  scopeDisposition:'in_scope', scopeReason:'Authorization remains required.', scopeInvariant:'', invariantCandidate:true, invariantText:'Sensitive operations require authorization.'
}, removedStaged, new Map(), removedGuardDiff);
assert.equal(oldHypothesis.side,'old');
assert.equal(oldHypothesis.line,10);
assert.ok(oldHypothesis.anchorContextDigest,'old-side hypothesis must retain a stable causal digest');

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

const convergedReview = { findings:[], coverageVerdict:'complete', coverageGaps:[], qualityVerdict:'no_findings', readinessVerdict:'needs_evidence', verdict:'pass' };
const convergedLineage = { transition:{}, stability:{ requiredFreshRuns:2, freshInferenceRuns:2, completeFreshRuns:2, blindFreshRuns:2, cachedVerdictRuns:0, latestRequiredRunsCoverageComplete:true, stable:true, agreement:1 } };
const convergence = evaluateConvergence(convergedReview, convergedLineage, scope);
assert.equal(convergence.state,'converged');
assert.equal(convergence.readinessVerdict,'ready');
assert.equal(convergedReview.readinessVerdict,'ready');
assert.equal(convergedReview.verdict,'ready');

assert.match(semanticSource,/validateCausalAnchor\(normalized\.file,normalized\.line,stagedPathSet,changedLineRanges,normalized\.endLine,\{side,diff\}\)/,'semantic review must validate the full side-aware causal anchor span');
assert.match(semanticSource,/Removed-only regressions are first-class review targets/,'semantic review must not omit removed-line defects');
assert.match(semanticSource,/scopeDispositionAllowsPublish/,'semantic review must use the deterministic scope disposition gate');
assert.match(semanticSource,/supportingLocations/,'semantic review must preserve supporting locations without relaxing the causal line gate');
console.log('Causal anchor, old-side recall, scope, and readiness contract tests passed.');
