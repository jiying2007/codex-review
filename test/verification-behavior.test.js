'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { createReviewHarness } = require('./helpers/review-pipeline');
const { parseGitDiff } = require('../src/git-diff');
const { changedLinesBySide, validateCausalAnchor } = require('../src/causal-anchor');
const harness = createReviewHarness();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const before = { 'auth.c':'allowed = user.is_admin;\n' };
const after = { 'auth.c':'allowed = true;\n' };
function candidate(file = 'auth.c') {
  return { severity:'high', category:'security', file, side:'new', line:1, endLine:1, claim:'This change allows unauthorized access.', suggestion:'Restore authorization.', modelConfidence:0.99, assumptions:[], requiredSymbols:[], rootCauseSymbol:'', claimClass:'missing-check', supportingLocations:[], scopeDisposition:'in_scope', scopeReason:'Authorization is required.', scopeInvariant:'', invariantCandidate:false, invariantText:'' };
}

for (const scenario of ['insufficient', 'missing-result', 'missing-staged-ref', 'unseen-ref', 'contradicted-without-evidence', 'required-symbol-missing']) {
  test(`unresolved verification blocks delivery: ${scenario}`, async () => {
    await harness.withGitFixture(before, after, async ({ repo, snapshot, diff, paths }) => {
      const options = harness.options();
      const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
      assert.deepEqual(evidence.manifest.entries.map(entry => entry.kind), ['staged']);
      harness.respond(async request => {
        if (request.phase.startsWith('hypothesis')) return { hypotheses:[{ ...candidate(), ...(scenario === 'required-symbol-missing' ? { requiredSymbols:['missing_authorization_contract'] } : {}) }] };
        assert.ok(request.input.includes('-allowed = user.is_admin;'));
        assert.ok(request.input.includes('+allowed = true;'));
        if (scenario === 'missing-result') return { results:[] };
        const supplied = harness.evidenceIds(request.input);
        const status = scenario === 'insufficient' ? 'insufficient_evidence' : scenario === 'contradicted-without-evidence' ? 'contradicted' : 'verified';
        return { results:[{ hypothesisIndex:0, verificationStatus:status, evidenceRefs:scenario === 'unseen-ref' ? [...supplied, 'evidence-never-sent'] : scenario === 'insufficient' ? supplied : [], verificationReason:'Controlled unresolved verification.' }] };
      });
      const lineageStore = harness.createReviewLineageStore();
      let review;
      for (let number = 0; number < 2; number++) {
        review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
        const lineage = await lineageStore.record(repo, { sessionKey:digest(scenario), reviewRunId:`${scenario}-${number}`, reviewSubjectKey:digest(diff), evidenceKey:digest(diff), coverageVerdict:review.coverageVerdict, findings:review.findings, executionProvenance:{ inference:'fresh', judgmentContext:'blind', judgmentCacheUsed:false } });
        harness.evaluateConvergence(review, lineage);
      }
      assert.equal(review.coverageVerdict, 'incomplete'); assert.equal(review.readinessVerdict, 'blocked'); assert.ok(review.coverageGaps.length);
      const receipt = harness.createReviewReceipt(review, { ...snapshot, stagedFileCount:1, diffFingerprint:digest(diff), policyFingerprint:digest(scenario), reviewSubjectKey:digest(diff), evidenceManifestDigest:evidence.manifest.manifestDigest });
      assert.equal(harness.reviewReceiptQualifiesForDelivery(receipt), false);
    });
  });
}

test('all profile-specific checks reach both hypothesis and verification requests', async () => {
  await harness.withGitFixture(before, after, async ({ repo, snapshot, diff, paths }) => {
    const requests = new Map();
    for (const pack of ['cpp','embedded-linux','driver']) {
      const options = harness.options(pack);
      const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
      harness.respond(async request => request.phase.startsWith('hypothesis') ? { hypotheses:[candidate()] } : { results:[{ hypothesisIndex:0, verificationStatus:'verified', evidenceRefs:harness.evidenceIds(request.input), verificationReason:'Controlled positive.' }] });
      await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
      assert.equal(harness.calls.length, 2);
      for (const request of harness.calls) for (const check of options.profileConfig.checks) assert.ok(request.input.includes(check), `${pack} omitted ${check}`);
      requests.set(pack, harness.calls[0].input);
    }
    assert.notEqual(requests.get('cpp'), requests.get('embedded-linux'));
    assert.notEqual(requests.get('cpp'), requests.get('driver'));
  });
});

test('mandatory staged evidence omitted by the verification budget is explicit and cannot qualify', async () => {
  await harness.withGitFixture(before, { 'auth.c':after['auth.c'] + `/* ${'x'.repeat(170 * 1024)} */\n` }, async ({ repo, snapshot, diff, paths }) => {
    const options = harness.options('general', 'deep');
    const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
    const staged = evidence.manifest.entries.find(entry => entry.kind === 'staged');
    assert.ok(staged.bytes > 160 * 1024);
    harness.respond(async request => {
      if (request.phase.startsWith('hypothesis')) return { hypotheses:[candidate()] };
      assert.ok(!harness.evidenceIds(request.input).includes(staged.id), 'oversized evidence must not bypass the request budget');
      return { results:[{ hypothesisIndex:0, verificationStatus:'verified', evidenceRefs:[staged.id], verificationReason:'Controlled invalid claim without supplied evidence.' }] };
    });
    const review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
    assert.equal(review.coverageVerdict, 'incomplete');
    assert.ok(review.coverageGaps.includes(`verification_evidence_budget:${staged.id}`));
    const receipt = harness.createReviewReceipt(review, { ...snapshot, stagedFileCount:1, diffFingerprint:digest(diff), policyFingerprint:digest('budget'), reviewSubjectKey:digest(diff), evidenceManifestDigest:evidence.manifest.manifestDigest });
    assert.equal(harness.reviewReceiptQualifiesForDelivery(receipt), false);
  });
});

test('a verified claim must cite the required symbol evidence that was actually sent', async () => {
  const fixture = require('../quality/semantic-review-corpus.json').cases.find(item => item.kind === 'hard_negative').fixture;
  await harness.withGitFixture(fixture.beforeFiles, fixture.afterFiles, async ({ repo, snapshot, diff, paths }) => {
    const options = harness.options();
    const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
    const line = fixture.afterFiles[fixture.file].split('\n').findIndex(text => text.includes(fixture.anchorText)) + 1;
    harness.respond(async request => {
      if (request.phase.startsWith('hypothesis')) return { hypotheses:[{ ...candidate(fixture.file), line, endLine:line, requiredSymbols:fixture.requiredSymbols }] };
      assert.ok(request.input.includes(fixture.requiredEvidenceText));
      return { results:harness.verificationSubjects(request.input).map(subject => ({ hypothesisIndex:subject.hypothesisIndex, verificationStatus:'verified', evidenceRefs:[subject.stagedEvidenceRef], verificationReason:'Controlled claim that omits the required symbol citation.' })) };
    });
    const review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
    assert.equal(review.coverageVerdict, 'incomplete'); assert.equal(review.readinessVerdict, 'blocked'); assert.equal(review.findings.length, 0);
    assert.ok(review.coverageGaps.some(gap => gap.startsWith('verification_incomplete:')));
  });
});

test('real a and b directories remain distinct through actual Git evidence and verification', async () => {
  const initial = { 'a/auth.c':'allowed = false;\n', 'b/auth.c':'allowed = false;\n', 'auth.c':'allowed = false;\n' };
  const changed = Object.fromEntries(Object.keys(initial).map(file => [file, 'allowed = true;\n']));
  await harness.withGitFixture(initial, changed, async ({ repo, snapshot, diff, paths }) => {
    assert.deepEqual([...changedLinesBySide(diff).keys()].sort(), Object.keys(initial).sort());
    const options = harness.options();
    const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
    assert.deepEqual(evidence.manifest.entries.filter(entry => entry.kind === 'staged').map(entry => entry.path).sort(), Object.keys(initial).sort());
    harness.respond(async request => request.phase.startsWith('hypothesis') ? { hypotheses:paths.map(file => candidate(file)) } : { results:harness.verificationSubjects(request.input).map(subject => ({ hypothesisIndex:subject.hypothesisIndex, verificationStatus:'verified', evidenceRefs:[subject.stagedEvidenceRef], verificationReason:'Controlled path-specific positive.' })) });
    const review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
    assert.equal(review.coverageVerdict, 'complete');
    assert.deepEqual(review.findings.map(finding => finding.file).sort(), paths.sort());
    assert.equal(new Set(review.findings.map(finding => finding.stableFindingId)).size, 3);
  });
});

test('hunk source prefixes and rename old-side anchors are parsed as source, not headers', () => {
  const diff = 'diff --git a/a/count.c b/b/count.c\nsimilarity index 90%\nrename from a/count.c\nrename to b/count.c\n--- a/a/count.c\n+++ b/b/count.c\n@@ -1 +1 @@\n---counter;\n+++counter;\n';
  assert.equal(parseGitDiff(diff)[0].path, 'b/count.c');
  assert.equal(changedLinesBySide(diff, 'new').get('b/count.c').get(1), '++counter;');
  assert.equal(changedLinesBySide(diff, 'old').get('b/count.c').get(1), '--counter;');
  const ranges = harness.parseChangedLineRanges(diff);
  assert.deepEqual(validateCausalAnchor('b/count.c', 1, new Set(['b/count.c']), ranges, 1, { side:'old', diff }), { file:'b/count.c', line:1, side:'old' });
});

test('mechanical failures remain blocked even when there is no publishable line or model finding', () => {
  const review = harness.consolidateReviewResults([], { maxFindings:10, reviewRules:{ forbiddenPathPrefixes:['protected/'] } }, ['protected/renamed.c'], new Map(), { complete:true, coverageGaps:[] });
  assert.equal(review.mechanicalGate, 'fail');
  const stable = { transition:{}, stability:{ requiredFreshRuns:2, freshInferenceRuns:2, completeFreshRuns:2, blindFreshRuns:2, cachedVerdictRuns:0, latestRequiredRunsCoverageComplete:true, stable:true, agreement:1 } };
  const convergence = harness.evaluateConvergence(review, stable);
  assert.equal(review.readinessVerdict, 'blocked'); assert.equal(review.verdict, 'block');
  assert.equal(review.qualityVerdict, 'no_findings');
  assert.equal(harness.convergenceCoverageGap(convergence), 'convergence_mechanical_gate_failed');
});

test('maxFindings truncation cannot certify review coverage or delivery', async () => {
  const prior = { 'a.c':'allowed = false;\n', 'b.c':'allowed = false;\n' };
  const changed = { 'a.c':'allowed = true;\n', 'b.c':'allowed = true;\n' };
  await harness.withGitFixture(prior, changed, async ({ repo, snapshot, diff, paths }) => {
    const options = { ...harness.options(), maxFindings:1 };
    const evidence = await harness.collectStructuralEvidence(repo, diff, paths, snapshot, options.profileConfig);
    harness.respond(async request => {
      if (request.phase.startsWith('hypothesis')) return { hypotheses:paths.map(file => ({ ...candidate(file), claim:`Unauthorized access in ${file}.` })) };
      return { results:harness.verificationSubjects(request.input).map(subject => ({
        hypothesisIndex:subject.hypothesisIndex, verificationStatus:'contradicted',
        evidenceRefs:[subject.stagedEvidenceRef], verificationReason:'Controlled negative verdict.'
      })) };
    });
    const review = await harness.runCodexReview(diff, paths, options, undefined, { semanticEvidence:evidence });
    assert.equal(review.coverageVerdict, 'incomplete');
    assert.equal(review.readinessVerdict, 'blocked');
    assert.ok(review.coverageGaps.some(gap => gap.startsWith('unverified_hypotheses_limit:')), JSON.stringify(review.coverageGaps));
    const receipt = harness.createReviewReceipt(review, { ...snapshot, stagedFileCount:2, diffFingerprint:digest(diff), policyFingerprint:digest('maxFindings'), reviewSubjectKey:digest(diff), evidenceManifestDigest:evidence.manifest.manifestDigest });
    assert.equal(harness.reviewReceiptQualifiesForDelivery(receipt), false);
  });
});
