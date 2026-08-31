'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REQUIRED_FRESH_RUNS,
  transitionBetween,
  buildReviewSessionKey,
  computeSubjectStability,
  createReviewLineageStore
} = require('../src/review-lineage');
const { evaluateConvergence } = require('../src/convergence');

function memoryState() {
  const values = new Map();
  return {
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    async update(key, value) { if (value === undefined) values.delete(key); else values.set(key, value); }
  };
}

const previous = [
  { stableFindingId:'A', file:'pt_common.c', category:'correctness', severity:'high', evidenceDigest:'e1', verificationStatus:'verified' },
  { stableFindingId:'B', file:'pt_common.c', category:'concurrency', severity:'high', evidenceDigest:'e2', verificationStatus:'verified' }
];
const current = [
  { stableFindingId:'B', file:'pt_common.c', category:'concurrency', severity:'high', evidenceDigest:'e2', verificationStatus:'verified' },
  { stableFindingId:'C', file:'pt_common.c', category:'correctness', severity:'high', evidenceDigest:'e3', verificationStatus:'verified', invariantCandidate:true, invariantText:'A queued stale event must not override a newer sample.' }
];
const transition = transitionBetween(previous, current, new Set(['A','B']));
assert.deepEqual(transition.fixedIds, ['A']);
assert.deepEqual(transition.unchangedIds, ['B']);
assert.deepEqual(transition.newIds, ['C']);
assert.deepEqual(transition.likelyFixInducedIds, ['C']);
assert.deepEqual(transition.reintroducedIds, []);

const reintroduced = transitionBetween(current, [...current, previous[0]], new Set(['A','B','C']));
assert.deepEqual(reintroduced.reintroducedIds, ['A']);

const session1 = buildReviewSessionKey({ headOid:'h', policyFingerprint:'p', scopeFingerprint:'s', profile:'standard' });
const session2 = buildReviewSessionKey({ profile:'standard', scopeFingerprint:'s', policyFingerprint:'p', headOid:'h' });
assert.equal(session1, session2);
assert.equal(REQUIRED_FRESH_RUNS, 2);

const matchingRuns = [
  { findingSetDigest:'same', findings:[], executionProvenance:{ inference:'fresh', mode:'standard', judgmentContext:'blind', judgmentCacheUsed:false } },
  { findingSetDigest:'same', findings:[], executionProvenance:{ inference:'fresh', mode:'independent', judgmentContext:'blind', judgmentCacheUsed:false } }
];
const pending = computeSubjectStability(matchingRuns.slice(0, 1));
assert.equal(pending.compared, false);
assert.equal(pending.stable, false);
assert.equal(pending.freshInferenceRuns, 1);
const stable = computeSubjectStability(matchingRuns);
assert.equal(stable.compared, true);
assert.equal(stable.stable, true);
assert.equal(stable.freshInferenceRuns, 2);
assert.equal(stable.blindFreshRuns, 2);
assert.equal(stable.independentReviewRuns, 1);
assert.equal(stable.cachedVerdictRuns, 0);
assert.equal(stable.agreement, 1);

const disagreement = computeSubjectStability([
  { findingSetDigest:'x', findings:previous, executionProvenance:{ inference:'fresh', mode:'standard', judgmentContext:'blind', judgmentCacheUsed:false } },
  { findingSetDigest:'y', findings:current, executionProvenance:{ inference:'fresh', mode:'independent', judgmentContext:'blind', judgmentCacheUsed:false } }
]);
assert.equal(disagreement.stable, false);
assert.ok(disagreement.unstableFindingIds.includes('A'));
assert.ok(disagreement.unstableFindingIds.includes('C'));

(async () => {
  const store = createReviewLineageStore(memoryState());
  store.restore();
  const subject = '1'.repeat(64);
  const session = '2'.repeat(64);
  const evidenceKey = '3'.repeat(64);
  const run1 = await store.record('/tmp/review-lineage-test', {
    sessionKey:session, phase:'production-aging-v1', reviewRunId:'00000000-0000-4000-8000-000000000001', reviewSubjectKey:subject, evidenceKey,
    coverageVerdict:'complete', findings:[], executionProvenance:{ mode:'standard', inference:'fresh', evidenceCacheHit:false, judgmentContext:'blind', judgmentCacheUsed:false }
  });
  assert.equal(run1.sessionRunNumber, 1);
  assert.equal(run1.subjectRunNumber, 1);
  assert.equal(run1.transitionKind, 'subject_change');
  assert.equal(run1.stability.stable, false);

  const firstConvergence = evaluateConvergence(
    { findings:[], coverageVerdict:'complete', coverageGaps:[] },
    run1,
    { phase:'production-aging-v1', complexityBudget:'minimal' }
  );
  assert.equal(firstConvergence.state, 'incomplete');
  assert.equal(firstConvergence.stabilityReason, 'fresh_runs_missing');

  const run2 = await store.record('/tmp/review-lineage-test', {
    sessionKey:session, phase:'production-aging-v1', reviewRunId:'00000000-0000-4000-8000-000000000002', reviewSubjectKey:subject, evidenceKey,
    coverageVerdict:'complete', findings:[], executionProvenance:{ mode:'independent', inference:'fresh', evidenceCacheHit:true, judgmentContext:'blind', judgmentCacheUsed:false }
  });
  assert.equal(run2.sessionRunNumber, 2);
  assert.equal(run2.subjectRunNumber, 2);
  assert.equal(run2.transitionKind, 'repeat_subject');
  assert.equal(run2.stability.stable, true);
  assert.equal(run2.stability.freshInferenceRuns, 2);
  assert.equal(run2.stability.independentReviewRuns, 1);

  const converged = evaluateConvergence(
    { findings:[], coverageVerdict:'complete', coverageGaps:[] },
    run2,
    { phase:'production-aging-v1', complexityBudget:'minimal' }
  );
  assert.equal(converged.state, 'converged');
  assert.equal(converged.reviewsToConvergence, 2);
  assert.equal(converged.provenanceComplete, true);

  const duplicate = await store.record('/tmp/review-lineage-test', {
    sessionKey:session, phase:'production-aging-v1', reviewRunId:'00000000-0000-4000-8000-000000000002', reviewSubjectKey:subject, evidenceKey,
    coverageVerdict:'complete', findings:current, executionProvenance:{ mode:'independent', inference:'fresh', judgmentContext:'blind', judgmentCacheUsed:false }
  });
  assert.equal(duplicate.sessionRunNumber, 2, 'ReviewRunId is the idempotency key; duplicate persistence must not create another run');
  assert.equal(store.list('/tmp/review-lineage-test')[0].runs.length, 2);

  const controllerSource = fs.readFileSync('extension.js','utf8');
  const finalSnapshotGate = controllerSource.indexOf('const snapshotAfterPublish = await getRepositorySnapshot(repoRoot);');
  const lineagePersist = controllerSource.indexOf('lineage = await reviewLineage.record(repoRoot');
  assert.ok(finalSnapshotGate >= 0 && lineagePersist > finalSnapshotGate, 'fresh lineage must persist only after the final publish snapshot gate');
  assert.ok(controllerSource.indexOf('findings: result.rawReview.findings') > lineagePersist, 'lineage must preserve verified raw findings rather than resolution-filtered visible findings');
  assert.match(controllerSource, /mode === 'independent'/, 'independent review must be a first-class execution mode');
  assert.match(controllerSource, /reviewRunId = crypto\.randomUUID\(\)/, 'every fresh inference must receive a unique ReviewRunId');
  assert.match(controllerSource, /judgmentContext: resultReplay \? 'replay' : 'blind'/, 'fresh reviewer context must be blind to prior judgments');
  assert.doesNotMatch(controllerSource, /suppressUnstableFindings/, 'fresh disagreements must not be suppressed using a previous model judgment');

  console.log('ReviewSubject/ReviewRun lineage and fresh convergence tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
