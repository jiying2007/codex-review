'use strict';

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return { l10n: { t: (message, ...args) => String(message).replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)] ?? `{${index}}`) } };
  return originalLoad.apply(this, arguments);
};

const assert = require('node:assert/strict');
const {
  REVIEW_CACHE_STORAGE_KEY,
  LEGACY_REVIEW_CACHE_STORAGE_KEY,
  createReviewCache
} = require('../src/review-cache');

function memoryState(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    async update(key, value) { if (value === undefined) values.delete(key); else values.set(key, value); },
    snapshot() { return Object.fromEntries(values); }
  };
}

const repo = process.cwd();
const evidenceKey = 'a'.repeat(64);
const reviewSubjectKey = 'b'.repeat(64);
const manifestDigest = 'c'.repeat(64);
const reviewRunId = '11111111-2222-4333-8444-555555555555';
const semanticEvidence = {
  impact: { nodes: [{ path: 'a.c', content: 'x' }], edges: [], bytes: 1 },
  callSymbolsByPath: new Map([['a.c', ['Foo']]]),
  blocks: [{ entry: { id: 'E1', kind: 'staged', path: 'a.c' }, content: '+Foo();' }],
  manifest: { manifestDigest, entries: [{ id: 'E1', kind: 'staged', path: 'a.c' }] },
  analyzerDigest: 'd'.repeat(64)
};

(async () => {
  const state = memoryState({ [LEGACY_REVIEW_CACHE_STORAGE_KEY]: { legacy: true } });
  const cache = createReviewCache(state);
  cache.restore();
  assert.equal(cache.getEvidence(repo, evidenceKey), null);
  assert.equal(cache.getReplay(repo, reviewSubjectKey), null);

  await cache.putEvidence(repo, { evidenceKey, reviewSubjectKey, evidenceManifestDigest: manifestDigest, semanticEvidence });
  const evidence = cache.getEvidence(repo, evidenceKey);
  assert.ok(evidence, 'deterministic evidence must be cacheable');
  assert.equal(evidence.reviewSubjectKey, reviewSubjectKey);
  assert.equal(evidence.semanticEvidence.manifest.manifestDigest, manifestDigest);
  assert.ok(evidence.semanticEvidence.callSymbolsByPath instanceof Map, 'Map-backed symbol evidence must rehydrate');
  assert.deepEqual(evidence.semanticEvidence.callSymbolsByPath.get('a.c'), ['Foo']);
  assert.equal(Object.prototype.hasOwnProperty.call(evidence, 'review'), false, 'evidence cache must never expose a model judgment');

  const review = { findings: [], suppressedFindings: [{ file: 'a.c', line: 1 }], coverageVerdict: 'complete', findingSetDigest: 'e'.repeat(64) };
  await cache.putReplay(repo, { evidenceKey, reviewSubjectKey, reviewRunId, evidenceManifestDigest: manifestDigest, findingSetDigest: review.findingSetDigest, review });
  const replay = cache.getReplay(repo, reviewSubjectKey);
  assert.ok(replay, 'validated judgment may be stored only as explicit replay history');
  assert.equal(replay.reviewRunId, reviewRunId);
  assert.deepEqual(replay.review.suppressedFindings, review.suppressedFindings);
  assert.equal(cache.getEvidence(repo, evidenceKey).reviewSubjectKey, reviewSubjectKey, 'judgment replay must not replace evidence artifacts');

  const persisted = state.snapshot()[REVIEW_CACHE_STORAGE_KEY];
  assert.equal(persisted.version, 2);
  assert.ok(persisted.evidence, 'v2 storage must separate evidence');
  assert.ok(persisted.replays, 'v2 storage must separate judgment replay');
  assert.ok(state.snapshot()[LEGACY_REVIEW_CACHE_STORAGE_KEY], 'legacy state is not read or silently migrated');
  await cache.purgeLegacy();
  assert.equal(state.snapshot()[LEGACY_REVIEW_CACHE_STORAGE_KEY], undefined, 'legacy whole-review cache must be purged on activation');

  const restored = createReviewCache(state);
  restored.restore();
  const restoredEvidence = restored.getEvidence(repo, evidenceKey);
  assert.ok(restoredEvidence.semanticEvidence.callSymbolsByPath instanceof Map);
  assert.deepEqual(restoredEvidence.semanticEvidence.callSymbolsByPath.get('a.c'), ['Foo']);
  assert.equal(restored.getReplay(repo, reviewSubjectKey).reviewRunId, reviewRunId);

  console.log('Review evidence cache and judgment replay separation tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
