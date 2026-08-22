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

const meta = {
  diffFingerprint: 'a'.repeat(64),
  policyFingerprint: 'b'.repeat(64),
  stagedFileCount: 1,
  stagedPaths: ['src/a.js'],
  changedRanges: new Map([['src/a.js', [{ start: 1, end: 20 }]]),
  dirtyOpenPaths: new Set(),
  binaryPaths: new Set(),
  submodulePaths: new Set(),
  unstagedPaths: new Set()
};
const highConfidence = { severity: 'medium', file: 'src/a.js', line: 10, title: 'Issue', message: 'Problem', confidence: 0.9 };
const lowConfidence = { severity: 'high', file: 'src/a.js', line: 11, title: 'Unclear', message: 'Weak', confidence: 0.2 };

(async () => {
  assert.strictEqual(unit.computeVerdict([]), 'pass');
  assert.strictEqual(unit.computeVerdict([highConfidence]), 'needs_attention');
  const validated = unit.validateReviewResult({ summary: 'review', findings: [highConfidence, lowConfidence] }, meta, { maxFindings: 40, confidenceThreshold: 0.7 });
  assert.strictEqual(validated.findings.length, 1);
  assert.strictEqual(validated.suppressedFindings.length, 1);
  assert.strictEqual(validated.findings[0].confidence, 0.9);

  const receipt = unit.createReviewReceipt(
    { qualityVerdict: 'no_findings', readinessVerdict: 'needs_evidence', mechanicalGate: 'not_run' },
    { headOid: '1'.repeat(40), indexFingerprint: '2'.repeat(64) },
    { ...meta, diffFingerprint: '3'.repeat(64), policyFingerprint: '4'.repeat(64) }
  );
  assert.strictEqual(receipt.schemaVersion, 2);
  assert.strictEqual(receipt.kind, 'codex-review-safe');

  const memory = new Map();
  const globalState = { get: (k, fallback) => memory.has(k) ? memory.get(k) : fallback, update: async (k, v) => memory.set(k, v) };
  const store = createReviewReceiptStore(globalState);
  store.restore();
  assert.strictEqual(RECEIPT_STORAGE_KEY, 'safeCodexReview.receipts.v2');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-range-'));
  try {
    gitRun(repo, ['init']);
    gitRun(repo, ['config', 'user.email', 'test@example.invalid']);
    gitRun(repo, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    gitRun(repo, ['add', 'a.txt']);
    gitRun(repo, ['commit', '-m', 'initial']);
    const parent = gitRun(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n');
    gitRun(repo, ['add', 'a.txt']);
    const snapshot = await unit.getRepositorySnapshot(repo);
    const diff = await unit.getStagedDiff(repo);
    const currentReceipt = unit.createReviewReceipt(
      { qualityVerdict: 'no_findings', readinessVerdict: 'needs_evidence', mechanicalGate: 'not_run' },
      snapshot,
      { ...meta, diffFingerprint: crypto.createHash('sha256').update(diff, 'utf8').digest('hex'), policyFingerprint: '<none>' }
    );
    await store.set(repo, currentReceipt);
    gitRun(repo, ['commit', '-m', 'reviewed']);
    const evidence = await store.getEvidenceForRange(repo, parent, 'HEAD');
    assert.strictEqual(evidence.schemaVersion, 2);
    assert.strictEqual(evidence.totalCommits, 1);
    assert.strictEqual(evidence.reviewedCommits, 1);
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
  assert.strictEqual(pkg.extensionKind[0], 'workspace');

  const report = unit.buildReviewReport(
    { summary: 'review', verdict: 'needs_attention', findings: [highConfidence], suppressedFindings: [lowConfidence], rejectedFindings: [], modelFindingCount: 2 },
    { severityThreshold: 'low', confidenceThreshold: 0.7, policySource: 'head-policy' },
    new Map([[highConfidence, { published: true, mappedLine: 10, reason: 'exact' }]]),
    meta
  );
  assert.match(report, /Review policy: head-policy/);
  assert.match(report, /\[MEDIUM\]/);

  const source = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
  assert.doesNotMatch(source, /contractVersion:\s*1/);
  assert.match(source, /contractVersion:\s*2/);

  console.log(`All Codex Review Safe ${pkg.version} unit/regression tests passed.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
