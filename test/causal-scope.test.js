'use strict';
const assert = require('node:assert/strict');
const { buildEvidenceManifest, normalizeEvidenceEntry } = require('../src/codex-safe-core/semantic-review');
const { normalizeReviewScope } = require('../src/review-scope');
const { validateHypothesis, materializeVerifiedFindings } = require('../src/semantic-review');

const diff = [
  'diff --git a/pt_common.c b/pt_common.c',
  '--- a/pt_common.c',
  '+++ b/pt_common.c',
  '@@ -99,0 +100,2 @@',
  '+state = PT_THERMAL_SENSOR_FAULT;',
  '+refresh_lcd();'
].join('\n');
const changed = new Map([['pt_common.c', [{ start:100, end:101 }]]]);
const raw = {
  severity:'high', category:'correctness', file:'pt_common.c', line:100, endLine:100,
  claim:'The new sensor-fault state is still rendered as RUN by unchanged display logic.', suggestion:'Render the new non-running state as paused.', modelConfidence:0.98,
  assumptions:[], requiredSymbols:[], rootCauseSymbol:'PT_THERMAL_SENSOR_FAULT', claimClass:'state-presentation',
  supportingLocations:[{ file:'pt_common.c', line:800, endLine:806, kind:'symptom', reason:'Existing LCD branch renders every non-HOT/COLD state as RUN.' }],
  scopeDisposition:'in_scope', scopeReason:'The changed state transition introduces the incorrect presentation.', scopeInvariant:'',
  invariantCandidate:true, invariantText:'Every thermal startup/protection/fault state that keeps managed loads stopped must render a non-running LCD status.'
};
const hypothesis = validateHypothesis(raw, new Set(['pt_common.c']), changed, diff);
assert.equal(hypothesis.line, 100);
assert.equal(hypothesis.supportingLocations[0].line, 800);
assert.throws(() => validateHypothesis({ ...raw, line:800, endLine:800 }, new Set(['pt_common.c']), changed, diff), /causal anchor is not an exact changed line/);

const staged = normalizeEvidenceEntry({ kind:'staged', source:'index', path:'pt_common.c', content:diff, relatedPaths:['pt_common.c'] });
const manifest = buildEvidenceManifest([staged], { headOid:'a'.repeat(40), indexFingerprint:'b'.repeat(64), diffFingerprint:'c'.repeat(64) });
const evidence = { manifest, blocks:[{ entry:staged, content:diff }] };
const verification = [{ hypothesisIndex:0, verificationStatus:'verified', evidenceRefs:[staged.id], verificationReason:'The changed state is causal and the staged target is sufficient.' }];
const options = { confidenceThreshold:0.7 };

const scope = normalizeReviewScope({ schemaVersion:1, phase:'production-aging-v1', goals:['temperature pause/resume'], invariants:['Common remains the sole managed-load lifecycle executor.'], nonGoals:['shared UART generation framework'], complexityBudget:'minimal' });
const inScope = materializeVerifiedFindings([hypothesis], verification, evidence, [], options, scope);
assert.equal(inScope.findings.length, 1);
assert.equal(inScope.findings[0].supportingLocations[0].kind, 'symptom');
assert.equal(inScope.findings[0].invariantCandidate, true);

const nonGoal = { ...hypothesis, scopeDisposition:'non_goal_risk', scopeReason:'Would require the excluded shared UART generation framework.', scopeInvariant:'' };
const suppressed = materializeVerifiedFindings([nonGoal], verification, evidence, [], options, scope);
assert.equal(suppressed.findings.length, 0);
assert.equal(suppressed.suppressedFindings[0].suppressionReason, 'scope:non_goal_risk');

const invariantOverride = { ...nonGoal, scopeInvariant:'Common remains the sole managed-load lifecycle executor.' };
const publishable = materializeVerifiedFindings([invariantOverride], verification, evidence, [], options, scope);
assert.equal(publishable.findings.length, 1);
console.log('Causal anchor and scope contract tests passed.');
