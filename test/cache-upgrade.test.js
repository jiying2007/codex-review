'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createReviewCache } = require('../src/review-cache');

function controllerKeys({ legacy = false } = {}) {
  const file = path.resolve(__dirname, '..', 'extension.js');
  let source = fs.readFileSync(file, 'utf8');
  if (legacy) {
    source = source.replace(/const REVIEW_EVIDENCE_PROTOCOL_VERSION = \d+;/, 'const REVIEW_EVIDENCE_PROTOCOL_VERSION = 3;')
      .replace(/const REVIEW_SUBJECT_PROTOCOL_VERSION = \d+;/, 'const REVIEW_SUBJECT_PROTOCOL_VERSION = 2;');
  }
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return { workspace: { workspaceFolders: [], textDocuments: [] }, window: {}, extensions: { getExtension: () => undefined }, l10n: { t: value => value } };
    return original.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(source + '\nmodule.exports.cacheKeysForFixture = { structuralEvidenceKey, computeReviewSubjectKey };\n', file);
    return loaded.exports.cacheKeysForFixture;
  } finally { Module._load = original; }
}

test('a controller upgrade cannot reuse persisted old path evidence or subject continuity', async () => {
  const previous = controllerKeys({ legacy: true }), current = controllerKeys();
  const values = new Map(), state = { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, update: async (key, value) => values.set(key, value) };
  const root = path.resolve(__dirname, '..');
  const snapshot = { headOid: 'a'.repeat(40), indexFingerprint: 'b'.repeat(64) };
  const diff = 'c'.repeat(64), manifest = 'd'.repeat(64), scope = 'e'.repeat(64), analyzer = 'f'.repeat(64);
  const profile = { impactDepth: 1, maxImpactFiles: 4 };
  const options = { policyFingerprint: '1'.repeat(64), profile: 'balanced', profileConfig: profile, language: 'en', model: 'fixture', maxFindings: 10 };
  const oldKey = previous.structuralEvidenceKey(snapshot, diff, profile);
  const newKey = current.structuralEvidenceKey(snapshot, diff, profile);
  const cache = createReviewCache(state);
  await cache.putEvidence(root, { evidenceKey: oldKey, structuralManifestDigest: manifest, structuralEvidence: { manifest: { manifestDigest: manifest, entries: [{ id: 'old', path: 'x/y.c' }] } } });
  const restored = createReviewCache(state); restored.restore();
  assert.ok(restored.getEvidence(root, oldKey), 'the persisted old entry must really exist');
  assert.notEqual(newKey, oldKey, 'unchanged Git input still needs fresh structural evidence after the protocol change');
  assert.equal(restored.getEvidence(root, newKey), null, 'legacy folded-path evidence must never satisfy the upgraded controller');
  assert.notEqual(current.computeReviewSubjectKey(snapshot, diff, options, analyzer, scope, manifest), previous.computeReviewSubjectKey(snapshot, diff, options, analyzer, scope, manifest), 'old fresh-run continuity must not authorize the new evidence protocol');
  await restored.putEvidence(root, { evidenceKey: newKey, structuralManifestDigest: manifest, structuralEvidence: { manifest: { manifestDigest: manifest, entries: [{ id: 'literal', path: 'x\\y.c' }, { id: 'directory', path: 'x/y.c' }] } } });
  const fresh = createReviewCache(state); fresh.restore();
  assert.deepEqual(fresh.getEvidence(root, newKey).structuralEvidence.manifest.entries.map(entry => entry.path), ['x\\y.c', 'x/y.c']);
});
