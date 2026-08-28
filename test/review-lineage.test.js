'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { transitionBetween, buildReviewSessionKey } = require('../src/review-lineage');
const { evaluateConvergence } = require('../src/convergence');

const previous = [
  { stableFindingId:'A', file:'pt_common.c', category:'correctness', severity:'high', evidenceDigest:'e1' },
  { stableFindingId:'B', file:'pt_common.c', category:'concurrency', severity:'high', evidenceDigest:'e2' }
];
const current = [
  { stableFindingId:'B', file:'pt_common.c', category:'concurrency', severity:'high', evidenceDigest:'e2' },
  { stableFindingId:'C', file:'pt_common.c', category:'correctness', severity:'high', evidenceDigest:'e3', invariantCandidate:true, invariantText:'A queued stale event must not override a newer sample.' }
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

const convergence = evaluateConvergence(
  { findings: current, coverageVerdict:'complete', coverageGaps:[], stability:{stable:true} },
  { runNumber:2, transition },
  { phase:'production-aging-v1', complexityBudget:'minimal' }
);
assert.equal(convergence.state, 'regressing');
assert.equal(convergence.fixed, 1);
assert.equal(convergence.added, 1);
assert.equal(convergence.likelyFixInduced, 1);
assert.equal(convergence.deterministicPreventableCount, 1);
assert.equal(convergence.scopePhase, 'production-aging-v1');
assert.equal(convergence.reviewsToConvergence, null);

const converged = evaluateConvergence({ findings:[], coverageVerdict:'complete', coverageGaps:[] }, { runNumber:3, transition:{ fixedIds:['B','C'], newIds:[], unchangedIds:[], changedIds:[], reintroducedIds:[], likelyFixInducedIds:[], previousCount:2 } }, { phase:'production-aging-v1', complexityBudget:'minimal' });
assert.equal(converged.state, 'converged');
assert.equal(converged.closureRate, 1);
assert.equal(converged.reviewsToConvergence, 3);

const controllerSource = fs.readFileSync('extension.js','utf8');
const finalSnapshotGate = controllerSource.indexOf('const snapshotAfterPublish = await getRepositorySnapshot(repoRoot);');
const lineagePersist = controllerSource.indexOf('const lineage = await reviewLineage.record(repoRoot');
assert.ok(finalSnapshotGate >= 0 && lineagePersist > finalSnapshotGate, 'lineage must persist only after the final publish snapshot gate');
assert.ok(controllerSource.indexOf('findings: result.rawReview.findings') > lineagePersist, 'lineage must preserve verified raw findings rather than resolution-filtered visible findings');

console.log('Review lineage and convergence tests passed.');
