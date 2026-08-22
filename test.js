'use strict';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {}, window: {}, extensions: {}, languages: {}, scm: {},
      Uri: { file: x => ({ fsPath: x, toString: () => x }) },
      Range: class {}, Position: class {}, Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }
    };
  }
  return originalLoad.apply(this, arguments);
};

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('./src/codex-safe-core');
const { createReviewReceiptStore, RECEIPT_STORAGE_KEY } = require('./src/receipts');
const unit = {
  ...require('./src/review-support'),
  ...require('./src/process'),
  ...require('./src/git'),
  ...require('./src/policy'),
  ...require('./src/review'),
  ...require('./src/report'),
  ...require('./src/codex')
};
const pkg = require('./package.json');

function gitRun(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
function initRepo(repo) {
  gitRun(repo, ['init']);
  gitRun(repo, ['config', 'user.email', 'test@example.invalid']);
  gitRun(repo, ['config', 'user.name', 'Codex Review Safe Test']);
}

(async () => {
  assert.strictEqual(core.SAFE_CORE_VERSION, 3);
  assert.strictEqual(core.SAFE_CONTRACT_VERSION, 2);
  assert.strictEqual(core.POLICY_SCHEMA_VERSION, 3);
  assert.strictEqual(core.REVIEW_RECEIPT_SCHEMA_VERSION, 3);
  assert.strictEqual(unit.PROJECT_RULES_FILE, '.codex-safe.json');
  assert.strictEqual(unit.severityPasses('high', 'medium'), true);
  assert.strictEqual(unit.severityPasses('low', 'medium'), false);

  const staged = ['src/a.c'];
  const diff = ['diff --git a/src/a.c b/src/a.c','--- a/src/a.c','+++ b/src/a.c','@@ -9,2 +9,2 @@',' old','-bad','+good'].join('\n');
  const changed = unit.parseChangedLineRanges(diff);
  assert.strictEqual(unit.lineInChangedRanges(10, changed.get('src/a.c')), true);

  const highConfidence = {
    severity: 'medium', category: 'correctness', file: 'src/a.c', line: 10, endLine: 10,
    title: 'boundary error', description: 'zero is skipped', suggestion: 'handle zero', confidence: 0.91
  };
  const lowConfidence = { ...highConfidence, title: 'weak guess', confidence: 0.4 };
  const reviewedChunk = unit.validateReviewResult(
    { summary: 'review', findings: [lowConfidence, highConfidence] },
    { maxFindings: 40, confidenceThreshold: 0.7 },
    staged,
    changed
  );
  assert.strictEqual(reviewedChunk.findings.length, 1);
  assert.strictEqual(reviewedChunk.suppressedFindings.length, 1);
  assert.strictEqual(reviewedChunk.findings[0].title, 'boundary error');

  const wrongLine = unit.validateReviewResult(
    { summary: '', findings: [{ ...highConfidence, line: 11, endLine: 11 }] },
    { maxFindings: 40, confidenceThreshold: 0.7 }, staged, changed
  );
  assert.strictEqual(wrongLine.findings.length, 0);
  assert.strictEqual(wrongLine.rejectedFindings.length, 1);

  const prompt = unit.buildPrompt({ language: 'en', extraInstructions: '', confidenceThreshold: 0.7 }, staged);
  assert.match(prompt, /untrusted data/i);
  assert.match(prompt, /confidence 0\.7/);
  assert.match(prompt, /exact added\/modified changed line/i);
  assert.doesNotMatch(prompt, /nearest changed line/i);

  const schema = unit.outputSchema({ maxFindings: 12 });
  assert.strictEqual(schema.additionalProperties, false);
  assert.strictEqual(schema.properties.findings.maxItems, 12);

  const args = unit.buildCodexArgs('/tmp/schema.json', 'gpt-test');
  const execIndex = args.indexOf('exec');
  assert.ok(args.indexOf('--ask-for-approval') >= 0 && args.indexOf('--ask-for-approval') < execIndex);
  assert.strictEqual(args[args.indexOf('--ask-for-approval') + 1], 'never');
  assert.strictEqual(args[args.indexOf('--sandbox') + 1], 'read-only');

  const mechanical = unit.deterministicReview(['src/a.c'], changed, {
    requireTestsForCodeChanges: true,
    codePathPrefixes: ['src/'],
    testPathPrefixes: ['test/']
  });
  assert.strictEqual(mechanical.violations.length, 1);
  assert.strictEqual(mechanical.violations[0].rule, 'requireTestsForCodeChanges');
  assert.strictEqual(mechanical.findings[0].category, 'test');

  const consolidated = unit.consolidateReviewResults(
    [reviewedChunk],
    { maxFindings: 40, reviewRules: {}, confidenceThreshold: 0.7 },
    staged,
    changed,
    { complete: true, coverageGaps: [] }
  );
  assert.strictEqual(consolidated.qualityVerdict, 'findings_open');
  assert.strictEqual(consolidated.coverageVerdict, 'complete');
  assert.strictEqual(consolidated.mechanicalGate, 'pass');
  const incomplete = unit.consolidateReviewResults([], { maxFindings: 40, reviewRules: {} }, staged, changed, { complete: false, coverageGaps: ['src/a.c:hunk_exceeds_budget'] });
  assert.strictEqual(incomplete.verdict, 'block');
  assert.strictEqual(incomplete.coverageVerdict, 'incomplete');
  assert.strictEqual(incomplete.readinessVerdict, 'blocked');

  const evidence = core.buildReviewEvidenceChunks({ diff, maxBytes: 4096, maxChunks: 8 });
  assert.strictEqual(evidence.complete, true);
  assert.strictEqual(evidence.chunks.length, 1);

  const meta = unit.buildReviewInputMeta(
    { headOid: '1'.repeat(40), indexFingerprint: '2'.repeat(64) },
    '3'.repeat(64), 321, staged, new Set(),
    { model: 'gpt-test', codexVersion: 'codex-cli 9.9.9', policyFingerprint: '4'.repeat(64), policySource: 'head-policy', coverageVerdict: 'complete' }
  );
  const receipt = unit.createReviewReceipt(consolidated, meta, new Date('2026-08-22T00:00:00.000Z'));
  assert(receipt);
  assert.strictEqual(receipt.schemaVersion, 3);
  assert.strictEqual(receipt.kind, 'codex-review');
  assert.strictEqual(receipt.subject.type, 'git-index');
  assert.strictEqual(receipt.subject.headOid, meta.headOid);
  assert.strictEqual(receipt.coverageVerdict, 'complete');

  const state = {
    value: {},
    get(key, fallback) { return key === RECEIPT_STORAGE_KEY ? this.value : fallback; },
    async update(key, value) { if (key === RECEIPT_STORAGE_KEY) this.value = value || {}; }
  };
  const receiptStore = createReviewReceiptStore(state);
  receiptStore.restore();
  await receiptStore.persist('/repo', receipt);
  assert.strictEqual(receiptStore.getStatus('/repo', { headOid: receipt.subject.headOid, indexFingerprint: receipt.subject.indexFingerprint }).status, 'current');
  assert.strictEqual(receiptStore.getStatus('/repo', { headOid: '9'.repeat(40), indexFingerprint: receipt.subject.indexFingerprint }).status, 'stale');

  const policyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-policy-'));
  try {
    initRepo(policyRepo);
    fs.writeFileSync(path.join(policyRepo, '.codex-safe.json'), JSON.stringify({
      schemaVersion: 3,
      review: { severityThreshold: 'low', confidenceThreshold: 0.8, maxFindings: 40, rules: { requireTestsForCodeChanges: true } }
    }));
    fs.writeFileSync(path.join(policyRepo, 'a.c'), 'int a = 1;\n');
    gitRun(policyRepo, ['add', '.codex-safe.json', 'a.c']);
    gitRun(policyRepo, ['commit', '-m', 'base policy']);
    const head = gitRun(policyRepo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(policyRepo, '.codex-safe.json'), JSON.stringify({ schemaVersion: 3, review: { severityThreshold: 'critical' } }));
    gitRun(policyRepo, ['add', '.codex-safe.json']);
    const policy = await unit.readProjectRulesAtHead(policyRepo, head);
    assert.strictEqual(policy.rules.severityThreshold, 'low');
    assert.strictEqual(policy.rules.confidenceThreshold, 0.8);
    assert.strictEqual(policy.rules.rules.requireTestsForCodeChanges, true);
    await assert.rejects(async () => {
      const badRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-v2-'));
      try {
        initRepo(badRepo);
        fs.writeFileSync(path.join(badRepo, '.codex-safe.json'), JSON.stringify({ schemaVersion: 2, review: {} }));
        fs.writeFileSync(path.join(badRepo, 'a.c'), 'x\n');
        gitRun(badRepo, ['add', '.']);
        gitRun(badRepo, ['commit', '-m', 'old policy']);
        await unit.readProjectRulesAtHead(badRepo, gitRun(badRepo, ['rev-parse', 'HEAD']));
      } finally { fs.rmSync(badRepo, { recursive: true, force: true }); }
    }, /schemaVersion must be 3/);
  } finally {
    fs.rmSync(policyRepo, { recursive: true, force: true });
  }

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-range-'));
  try {
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'a.c'), 'int a = 1;\n');
    gitRun(repo, ['add', 'a.c']);
    gitRun(repo, ['commit', '-m', 'initial']);
    const parent = gitRun(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo, 'a.c'), 'int a = 2;\n');
    gitRun(repo, ['add', 'a.c']);
    const rangeDiff = await unit.getStagedDiff(repo);
    const snapshot = { headOid: parent, indexFingerprint: await unit.getIndexFingerprint(repo) };
    const rangeMeta = unit.buildReviewInputMeta(snapshot, crypto.createHash('sha256').update(rangeDiff, 'utf8').digest('hex'), Buffer.byteLength(rangeDiff), ['a.c'], new Set(), { policyFingerprint: '<none>', coverageVerdict: 'complete' });
    const rangeReceipt = unit.createReviewReceipt({ qualityVerdict: 'no_findings', readinessVerdict: 'needs_evidence', mechanicalGate: 'pass', coverageVerdict: 'complete' }, rangeMeta, new Date('2026-08-22T00:00:00.000Z'));
    const store = createReviewReceiptStore();
    await store.persist(repo, rangeReceipt);
    gitRun(repo, ['commit', '-m', 'fix: update value']);
    const rangeEvidence = await store.getEvidenceForRange(repo, parent, 'HEAD');
    assert.strictEqual(rangeEvidence.schemaVersion, 3);
    assert.strictEqual(rangeEvidence.totalCommits, 1);
    assert.strictEqual(rangeEvidence.reviewedCommits, 1);
    assert.strictEqual(rangeEvidence.incompleteCommits, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }

  const properties = pkg.contributes?.configuration?.properties || {};
  assert.strictEqual(properties['safeCodexReview.codexPath'].scope, 'machine');
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'safeCodexReview.codexPath') continue;
    assert.strictEqual(value.scope, 'application', `${key} must remain application scoped`);
  }
  assert.deepStrictEqual(pkg.contributes.jsonValidation, [{ fileMatch: '.codex-safe.json', url: './dist/codex-safe.schema.json' }]);

  const report = unit.buildReviewReport(
    { ...consolidated, summary: 'review' },
    { severityThreshold: 'low', confidenceThreshold: 0.7, policySource: 'head-policy' },
    new Map([[consolidated.findings[0], { published: true, mappedLine: 10, reason: 'exact' }]]),
    meta
  );
  assert.match(report, /Coverage verdict: complete/);
  assert.match(report, /Review policy: head-policy/);
  assert.match(report, /\[MEDIUM\]/);

  console.log(`All Codex Review Safe ${pkg.version} Family v3 unit/regression tests passed.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
