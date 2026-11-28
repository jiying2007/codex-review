'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createReviewHarness } = require('./helpers/review-pipeline');
const harness = createReviewHarness();
const { materializeVerifiedFindings } = require('../src/semantic-review');
const { buildEvidenceManifest, validateEvidenceBackedFinding } = require('../src/codex-safe-core/semantic-review');

const options = { maxFindings:10, confidenceThreshold:0.7, reviewRules:{} };

test('deleted protected source retains an exact old-side mechanical finding from real Git', async () => {
  const file = 'protected/removed.c';
  await harness.withGitFixture({ [file]:'deny();\nretain();\n' }, { [file]:null }, async ({ diff, paths }) => {
    const ranges = harness.parseChangedLineRanges(diff);
    const review = harness.consolidateReviewResults([], {
      ...options, reviewRules:{ forbiddenPathPrefixes:['protected/'] }
    }, paths, ranges, { complete:true, coverageGaps:[] });
    assert.equal(review.findings.length, 1);
    assert.equal(review.findings[0].file, file);
    assert.equal(review.findings[0].side, 'old');
    assert.equal(review.findings[0].line, 1);
    assert.equal(review.mechanicalGate, 'fail');
    assert.equal(review.readinessVerdict, 'blocked');
    assert.equal(review.verdict, 'block');
  });
});

test('old-side fallback cannot use another raw slash or whitespace path identity', () => {
  const raw = 'protected/a\\b.c ', slash = 'protected/a/b.c ';
  const ranges = new Map([[slash, [{ start:90, end:90 }]]]);
  ranges.old = new Map([[raw, [{ start:7, end:7 }]], [slash, [{ start:8, end:8 }]]]);
  const result = harness.deterministicReview([raw, slash], ranges, { forbiddenPathPrefixes:['protected/'] });
  assert.deepEqual(result.findings.map(({ file, side, line }) => ({ file, side, line })), [
    { file:raw, side:'old', line:7 }, { file:slash, side:'new', line:90 }
  ]);
});

test('the raw consolidated result blocks mechanical violations without a publishable line', () => {
  const review = harness.consolidateReviewResults([], {
    ...options, reviewRules:{ forbiddenPathPrefixes:['protected/'] }
  }, ['protected/renamed.c'], new Map(), { complete:true, coverageGaps:[] });
  assert.equal(review.findings.length, 0);
  assert.equal(review.qualityVerdict, 'no_findings');
  assert.equal(review.mechanicalGate, 'fail');
  assert.equal(review.readinessVerdict, 'blocked');
  assert.equal(review.verdict, 'block');
});

test('explicit coverage gaps block the raw result despite a contradictory complete flag', () => {
  const review = harness.consolidateReviewResults([], options, [], new Map(), {
    complete:true, coverageGaps:['required-evidence-not-delivered']
  });
  assert.equal(review.coverageVerdict, 'incomplete');
  assert.equal(review.readinessVerdict, 'blocked');
  assert.equal(review.verdict, 'block');
  assert.deepEqual(review.coverageGaps, ['required-evidence-not-delivered']);
});

function weakVerifiedEvidence() {
  const hypothesis = {
    category:'resource', file:'app.c', side:'new', line:1, endLine:1,
    claim:'The callee retains an owned pointer.', claimClass:'ownership',
    requiredSymbols:['callee'], assumptions:['The callee owns the supplied pointer.'],
    rootCauseSymbol:'callee', modelConfidence:0.99, scopeDisposition:'in_scope'
  };
  const manifest = buildEvidenceManifest([{ kind:'staged', source:'index', path:'app.c', content:'callee(value);' }]);
  const verdict = { hypothesisIndex:0, verificationStatus:'verified', evidenceRefs:[manifest.entries[0].id] };
  return { hypothesis, manifest, verdict };
}

test('a verified label with inadequate checked evidence cannot become complete no-findings', () => {
  const { hypothesis, manifest, verdict } = weakVerifiedEvidence();
  const materialized = materializeVerifiedFindings([hypothesis], [verdict], { manifest }, [], options);
  assert.equal(materialized.findings.length, 0);
  assert.equal(materialized.suppressedFindings.length, 1);
  assert.equal(materialized.suppressedFindings[0].evidenceGrade, 'C');
  assert.equal(materialized.suppressedFindings[0].verificationStatus, 'verified');
  assert.match(materialized.coverageGaps[0], /^verification_incomplete:/);
  const review = harness.consolidateReviewResults([{ ...materialized, modelFindingCount:1 }], options, [], new Map(), {
    complete:true, coverageGaps:materialized.coverageGaps
  });
  assert.equal(review.coverageVerdict, 'incomplete');
  assert.equal(review.readinessVerdict, 'blocked');
  const convergence = harness.evaluateConvergence(review, {
    stability:{ requiredFreshRuns:2, freshInferenceRuns:2, completeFreshRuns:2, blindFreshRuns:2,
      cachedVerdictRuns:0, latestRequiredRunsCoverageComplete:true, stable:true }
  });
  assert.equal(convergence.readinessVerdict, 'blocked');
});

test('contradicted or exactly resolved evidence stays resolved while stale resolution cannot hide a gap', () => {
  const { hypothesis, manifest, verdict } = weakVerifiedEvidence();
  const checked = validateEvidenceBackedFinding({ ...hypothesis, ...verdict }, manifest);
  const resolution = { stableFindingId:checked.stableFindingId, evidenceDigest:checked.evidenceDigest, resolution:'false_positive' };
  const resolved = materializeVerifiedFindings([hypothesis], [verdict], { manifest }, [resolution], options);
  assert.equal(resolved.findings.length, 0);
  assert.equal(resolved.suppressedFindings[0].verificationStatus, 'suppressed_by_resolution');
  assert.deepEqual(resolved.coverageGaps, []);
  const contradicted = materializeVerifiedFindings([hypothesis], [{ ...verdict, verificationStatus:'contradicted' }], { manifest }, [], options);
  assert.deepEqual(contradicted.coverageGaps, []);
  const stale = materializeVerifiedFindings([hypothesis], [verdict], { manifest }, [{ ...resolution, evidenceDigest:'0'.repeat(64) }], options);
  assert.match(stale.coverageGaps[0], /^verification_incomplete:/);
});

test('a low-confidence but evidence-backed high-risk candidate cannot yield complete no-findings', () => {
  const manifest=buildEvidenceManifest([{kind:'staged',source:'index',path:'app.c',content:'int enabled = 1;'}]);
  const verdict={hypothesisIndex:0,verificationStatus:'verified',evidenceRefs:[manifest.entries[0].id]};
  const candidate={category:'correctness',file:'app.c',side:'new',line:1,endLine:1,claim:'The changed constant enables an unsafe path.',claimClass:'unsafe-constant',requiredSymbols:[],assumptions:[],modelConfidence:0.69,scopeDisposition:'in_scope'};
  for(const severity of ['critical','high']){
    const hypothesis={...candidate,severity};
    const checked=validateEvidenceBackedFinding({...hypothesis,...verdict},manifest);
    assert.equal(checked.publishable,true);
    const result=materializeVerifiedFindings([hypothesis],[verdict],{manifest},[],options);
    assert.equal(result.findings.length,0);
    assert.equal(result.suppressedFindings[0].suppressionReason,'confidence_threshold');
    assert.match(result.coverageGaps[0],/^high_risk_confidence_unresolved:/);
    const review=harness.consolidateReviewResults([{...result,modelFindingCount:1}],options,[],new Map(),{complete:true,coverageGaps:result.coverageGaps});
    assert.equal(review.qualityVerdict,'no_findings');
    assert.equal(review.coverageVerdict,'incomplete');
    assert.equal(review.readinessVerdict,'blocked');
    const resolved=materializeVerifiedFindings([hypothesis],[verdict],{manifest},[{stableFindingId:checked.stableFindingId,evidenceDigest:checked.evidenceDigest,resolution:'false_positive'}],options);
    assert.deepEqual(resolved.coverageGaps,[]);
    const contradicted=materializeVerifiedFindings([hypothesis],[{...verdict,verificationStatus:'contradicted'}],{manifest},[],options);
    assert.deepEqual(contradicted.coverageGaps,[]);
    const above=materializeVerifiedFindings([{...hypothesis,modelConfidence:0.7}],[verdict],{manifest},[],options);
    assert.equal(above.findings.length,1);
    assert.deepEqual(above.coverageGaps,[]);
  }
  const medium=materializeVerifiedFindings([{...candidate,severity:'medium'}],[verdict],{manifest},[],options);
  assert.equal(medium.findings.length,0);
  assert.deepEqual(medium.coverageGaps,[]);
});
