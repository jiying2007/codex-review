'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const corpus = require('../quality/semantic-review-corpus.json');
const { createReviewHarness } = require('./helpers/review-pipeline');

assert.equal(corpus.schemaVersion, 2);
assert.equal(corpus.evaluationMode, 'controlled-model-controller-regression');
const ids = new Set(corpus.cases.map(item => item.id));
assert.equal(ids.size, corpus.cases.length);
assert.ok(corpus.cases.filter(item => item.kind === 'hard_positive').length >= 15);
assert.ok(corpus.cases.some(item => item.kind === 'hard_negative'));
const harness = createReviewHarness();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

for (const item of corpus.cases) {
  test(`controlled review fixture: ${item.id}`, async () => {
    const fixture = item.fixture;
    assert.ok(fixture && fixture.beforeFiles && fixture.afterFiles, 'a corpus entry must contain executable source fixtures');
    const source = (fixture.side === 'old' ? fixture.beforeFiles : fixture.afterFiles)[fixture.file];
    const line = source.split('\n').findIndex(text => text.includes(fixture.anchorText)) + 1;
    assert.ok(line > 0, 'fixture anchor must identify an actual source line');
    const candidate = {
      severity:'high', category:item.category, file:fixture.file, side:fixture.side, line, endLine:line,
      claim:item.description, suggestion:'Restore the invariant represented by this fixture.', modelConfidence:0.99,
      assumptions:[], requiredSymbols:fixture.requiredSymbols || [], rootCauseSymbol:'', claimClass:item.claimClass,
      supportingLocations:[{ file:fixture.file, line, endLine:line, kind:'state', reason:'The exact staged before/after change must support this candidate.' }],
      scopeDisposition:'in_scope', scopeReason:'The changed causal line is within the fixture scope.', scopeInvariant:'', invariantCandidate:false, invariantText:''
    };
    await harness.withGitFixture(fixture.beforeFiles, fixture.afterFiles, async ({ repo, snapshot, diff, paths }) => {
      const options = harness.options('embedded-linux');
      const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
      const staged = evidence.manifest.entries.find(entry => entry.kind === 'staged' && entry.path === fixture.file);
      assert.ok(staged, 'real index collection must retain the staged target');
      harness.respond(async request => {
        if (request.phase.startsWith('hypothesis')) return { hypotheses:[candidate] };
        assert.equal(request.phase, 'verification');
        assert.ok(request.input.includes(fixture.anchorText), 'verification must receive actual causal source, not only the candidate claim');
        assert.ok(harness.evidenceIds(request.input).includes(staged.id), 'staged evidence must be delivered with its exact ID');
        if (fixture.requiredEvidenceText) assert.ok(request.input.includes(fixture.requiredEvidenceText), 'ownership evidence must reach the verifier');
        return { results:harness.verificationSubjects(request.input).map(subject => ({
          hypothesisIndex:subject.hypothesisIndex, verificationStatus:fixture.verifierStatus,
          evidenceRefs:harness.evidenceIds(request.input), verificationReason:'Controlled fixture verdict for controller regression coverage, not a live model quality measurement.'
        })) };
      });
      const lineageStore = harness.createReviewLineageStore();
      let review;
      for (let run = 0; run < 2; run++) {
        review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
        const lineage = await lineageStore.record(repo, {
          sessionKey:digest(item.id), reviewRunId:`fixture-${item.id}-${run}`, reviewSubjectKey:digest(diff), evidenceKey:digest(diff),
          coverageVerdict:review.coverageVerdict, findings:review.findings,
          executionProvenance:{ inference:'fresh', judgmentContext:'blind', judgmentCacheUsed:false }
        });
        harness.evaluateConvergence(review, lineage);
      }
      assert.equal(review.coverageVerdict, 'complete');
      assert.deepEqual(review.coverageGaps, []);
      if (item.kind === 'hard_positive') {
        assert.equal(review.findings.length, 1);
        assert.equal(review.findings[0].file, fixture.file);
        assert.equal(review.findings[0].side, fixture.side);
        assert.equal(review.findings[0].line, line);
        assert.equal(review.readinessVerdict, 'blocked');
      } else {
        assert.equal(review.findings.length, 0);
        assert.equal(review.suppressedFindings[0]?.verificationStatus, 'contradicted');
        assert.equal(review.readinessVerdict, 'ready');
      }
      const receipt = harness.createReviewReceipt(review, {
        ...snapshot, stagedFileCount:paths.length, diffFingerprint:digest(diff), policyFingerprint:digest(item.id),
        reviewSubjectKey:digest(diff), evidenceManifestDigest:evidence.manifest.manifestDigest
      });
      assert.ok(receipt);
      assert.equal(harness.reviewReceiptQualifiesForDelivery(receipt), item.kind === 'hard_negative');
      assert.equal(harness.calls.filter(request => request.phase === 'verification').length, 2);
    });
  });
}
