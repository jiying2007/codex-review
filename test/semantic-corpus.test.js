'use strict';
const assert = require('node:assert/strict');
const corpus = require('../quality/semantic-review-corpus.json');
assert.equal(corpus.schemaVersion, 1);
assert.ok(Array.isArray(corpus.cases));
const ids = new Set();
let positives = 0, negatives = 0;
for (const item of corpus.cases) {
  assert.ok(item.id && !ids.has(item.id), `duplicate corpus id: ${item.id}`); ids.add(item.id);
  assert.ok(['hard_positive','hard_negative'].includes(item.kind));
  assert.ok(item.category); assert.ok(item.claimClass); assert.ok(item.expected); assert.ok(item.description);
  if (item.kind === 'hard_positive') positives++; else negatives++;
}
assert.ok(positives >= 14, `expected at least 14 hard positives, got ${positives}`);
assert.ok(negatives >= 1, `expected at least one hard negative, got ${negatives}`);
for (const required of [
  'vsapi-trim-ownership-hard-negative','thermal-recover-reason-loss','thermal-partial-start-rollback','thermal-stale-event-generation',
  'thermal-lazy-mutex-init','thermal-trip-single-slot-overwrite','thermal-invalid-temperature-precedence','thermal-startup-health-suppression',
  'thermal-opposite-boundary-recovery','thermal-config-gate-bypass','thermal-lcd-unchanged-symptom-causal-anchor'
]) assert.ok(ids.has(required), `missing required semantic regression case: ${required}`);
console.log(`Semantic repeated-review corpus locked: ${positives} hard positives, ${negatives} hard negatives.`);
