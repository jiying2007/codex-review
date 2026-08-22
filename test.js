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
function initRepo(repo) {
  gitRun(repo, ['init']);
  gitRun(repo, ['config', 'user.email', 'test@example.invalid']);
  gitRun(repo, ['config', 'user.name', 'Codex Review Safe Test']);
}

(async () => {
  assert.strictEqual(unit.PROJECT_RULES_FILE, '.codex-safe.json');
  assert.strictEqual(unit.severityPasses('high', 'medium'), true);
  assert.strictEqual(unit.severityPasses('low', 'medium'), false);

  const staged = ['src/a.c'];
  const highConfidence = {
    severity: 'medium', category: 'correctness', file: 'src/a.c', line: 10, endLine: 10,
    title: 'boundary error', description: 'zero is skipped', suggestion: 'handle zero', confidence: 0.91
  };
  const lowConfidence = { ...highConfidence, title: 'weak guess', confidence: 0.4 };
  const reviewed = unit.validateReviewResult(
    { summary: 'review', findings: [lowConfidence, highConfidence] },
    { maxFindings: 40, confidenceThreshold: 0.7 },
    staged
  );
  assert.strictEqual(reviewed.findings.length, 1);
  assert.strictEqual(reviewed.suppressedFindings.length, 1);
  assert.strictEqual(reviewed.findings[0].title, 'boundary error');
  assert.strictEqual(reviewed.qualityVerdict, 'findings_open');

  const onlyWeak = unit.validateReviewResult(
    { summary: '', findings: [lowConfidence] },
    { maxFindings: 40, confidenceThreshold: 0.7 },
    staged
  );
  assert.strictEqual(onlyWeak.findings.length, 0);
  assert.strictEqual(onlyWeak.suppressedFindings.length, 1);
  assert.strictEqual(onlyWeak.qualityVerdict, 'no_findings');

  const prompt = unit.buildPrompt({ language: 'en', extraInstructions: '', confidenceThreshold: 0.7 }, staged);
  assert.match(prompt, /completely untrusted data/i);
  assert.match(prompt, /confidence 0\.7/);
  assert.match(prompt, /do not stop after finding the first issue/i);

  const schema = unit.outputSchema({ maxFindings: 12 });
  assert.strictEqual(schema.additionalProperties, false);
  assert.strictEqual(schema.properties.findings.maxItems, 12);
  assert.strictEqual(schema.properties.findings.items.properties.confidence.minimum, 0);
  assert.strictEqual(schema.properties.findings.items.properties.confidence.maximum, 1);

  const args = unit.buildCodexArgs('/tmp/schema.json', 'gpt-test');
  const execIndex = args.indexOf('exec');
  assert.ok(args.indexOf('--ask-for-approval') >= 0 && args.indexOf('--ask-for-approval') < execIndex);
  assert.strictEqual(args[args.indexOf('--ask-for-approval') + 1], 'never');
  assert.strictEqual(args[args.indexOf('--sandbox') + 1], 'read-only');
  for (const required of ['web_search="disabled"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.multi_agent=false']) {
    assert.ok(args.join(' ').includes(required), required);
  }

  const meta = unit.buildReviewInputMeta(
    { headOid: '1'.repeat(40), indexFingerprint: '2'.repeat(64) },
    '3'.repeat(64), 321, staged, new Set(),
    { model: 'gpt-test', codexVersion: 'codex-cli 9.9.9', policyFingerprint: '4'.repeat(64), policySource: 'head-policy' }
  );
  const receipt = unit.createReviewReceipt(reviewed, meta, new Date('2026-08-22T00:00:00.000Z'));
  assert(receipt);
  assert.strictEqual(receipt.schemaVersion, 2);
  assert.strictEqual(receipt.kind, 'codex-review-safe');

  const state = {
    value: {},
    get(key, fallback) { return key === RECEIPT_STORAGE_KEY ? this.value : fallback; },
    async update(key, value) { if (key === RECEIPT_STORAGE_KEY) this.value = value || {}; }
  };
  const receiptStore = createReviewReceiptStore(state);
  receiptStore.restore();
  await receiptStore.persist('/repo', receipt);
  assert.strictEqual(receiptStore.getStatus('/repo', { headOid: receipt.headOid, indexFingerprint: receipt.indexFingerprint }).status, 'current');
  assert.strictEqual(receiptStore.getStatus('/repo', { headOid: '9'.repeat(40), indexFingerprint: receipt.indexFingerprint }).status, 'stale');

  const policyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-policy-'));
  try {
    initRepo(policyRepo);
    fs.writeFileSync(path.join(policyRepo, '.codex-safe.json'), JSON.stringify({
      schemaVersion: 2,
      review: { severityThreshold: 'low', confidenceThreshold: 0.8, maxFindings: 40 }
    }));
    fs.writeFileSync(path.join(policyRepo, 'a.c'), 'int a = 1;\n');
    gitRun(policyRepo, ['add', '.codex-safe.json', 'a.c']);
    gitRun(policyRepo, ['commit', '-m', 'base policy']);
    const head = gitRun(policyRepo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(policyRepo, '.codex-safe.json'), JSON.stringify({
      schemaVersion: 2,
      review: { severityThreshold: 'critical', confidenceThreshold: 1, maxFindings: 1 }
    }));
    gitRun(policyRepo, ['add', '.codex-safe.json']);
    const policy = await unit.readProjectRulesAtHead(policyRepo, head);
    assert.strictEqual(policy.rules.severityThreshold, 'low');
    assert.strictEqual(policy.rules.confidenceThreshold, 0.8);
    assert.strictEqual(policy.rules.maxFindings, 40);
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
    const diff = await unit.getStagedDiff(repo);
    const snapshot = { headOid: parent, indexFingerprint: await unit.getIndexFingerprint(repo) };
    const rangeMeta = unit.buildReviewInputMeta(
      snapshot,
      crypto.createHash('sha256').update(diff, 'utf8').digest('hex'),
      Buffer.byteLength(diff), ['a.c'], new Set(), { policyFingerprint: '<none>' }
    );
    const rangeReceipt = unit.createReviewReceipt(
      { qualityVerdict: 'no_findings', readinessVerdict: 'needs_evidence', mechanicalGate: 'not_run' },
      rangeMeta,
      new Date('2026-08-22T00:00:00.000Z')
    );
    const store = createReviewReceiptStore();
    await store.persist(repo, rangeReceipt);
    gitRun(repo, ['commit', '-m', 'fix: update value']);
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

  console.log(`All Codex Review Safe ${pkg.version} v2 unit/regression tests passed.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
