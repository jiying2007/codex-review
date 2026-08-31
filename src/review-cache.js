'use strict';

const { normalizeFsPath } = require('./review-support');

const REVIEW_CACHE_STORAGE_KEY = 'safeCodexReview.reviewArtifacts.v2';
const LEGACY_REVIEW_CACHE_STORAGE_KEY = 'safeCodexReview.semanticRuns.v1';
const MAX_EVIDENCE_ENTRIES_PER_REPO = 6;
const MAX_REPLAY_ENTRIES_PER_REPO = 12;
const MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO = 4 * 1024 * 1024;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function repoKey(repoRoot) { return normalizeFsPath(repoRoot); }
function serializeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  return {
    impact: clone(evidence.impact || {}),
    callSymbolsByPath: evidence.callSymbolsByPath instanceof Map
      ? [...evidence.callSymbolsByPath.entries()].map(([key, value]) => [String(key), clone(value)])
      : Object.entries(evidence.callSymbolsByPath || {}).map(([key, value]) => [String(key), clone(value)]),
    blocks: clone(evidence.blocks || []),
    manifest: clone(evidence.manifest || {}),
    analyzerDigest: String(evidence.analyzerDigest || '')
  };
}
function hydrateEvidence(serialized) {
  if (!serialized || typeof serialized !== 'object') return null;
  return {
    impact: clone(serialized.impact || {}),
    callSymbolsByPath: new Map(Array.isArray(serialized.callSymbolsByPath) ? clone(serialized.callSymbolsByPath) : []),
    blocks: clone(serialized.blocks || []),
    manifest: clone(serialized.manifest || {}),
    analyzerDigest: String(serialized.analyzerDigest || '')
  };
}
function validHex64(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function evidenceEntryBytes(entry) { return Buffer.byteLength(JSON.stringify(entry?.semanticEvidence || {}), 'utf8'); }

function createReviewCache(globalState) {
  const evidenceByRepo = new Map();
  const replayByRepo = new Map();

  function restore() {
    evidenceByRepo.clear();
    replayByRepo.clear();
    const stored = globalState?.get(REVIEW_CACHE_STORAGE_KEY, {}) || {};
    const evidenceRoot = stored.evidence && typeof stored.evidence === 'object' ? stored.evidence : {};
    const replayRoot = stored.replays && typeof stored.replays === 'object' ? stored.replays : {};

    for (const [repo, entries] of Object.entries(evidenceRoot)) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter(entry =>
        entry && validHex64(entry.evidenceKey) && validHex64(entry.reviewSubjectKey) &&
        validHex64(entry.evidenceManifestDigest) && entry.semanticEvidence && typeof entry.semanticEvidence === 'object'
      ).slice(0, MAX_EVIDENCE_ENTRIES_PER_REPO);
      if (valid.length) evidenceByRepo.set(repo, valid);
    }
    for (const [repo, entries] of Object.entries(replayRoot)) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter(entry =>
        entry && validHex64(entry.evidenceKey) && validHex64(entry.reviewSubjectKey) &&
        typeof entry.reviewRunId === 'string' && entry.reviewRunId.length >= 8 &&
        entry.review && typeof entry.review === 'object'
      ).slice(0, MAX_REPLAY_ENTRIES_PER_REPO);
      if (valid.length) replayByRepo.set(repo, valid);
    }
  }

  async function flush() {
    if (!globalState) return;
    const evidence = {};
    for (const [repo, entries] of evidenceByRepo.entries()) {
      let bytes = 0;
      const kept = [];
      for (const entry of entries.slice(0, MAX_EVIDENCE_ENTRIES_PER_REPO)) {
        const size = evidenceEntryBytes(entry);
        if (size <= 0 || bytes + size > MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO) continue;
        bytes += size;
        kept.push(entry);
      }
      if (kept.length) evidence[repo] = kept;
    }
    const replays = Object.fromEntries([...replayByRepo.entries()].map(([repo, entries]) => [repo, entries.slice(0, MAX_REPLAY_ENTRIES_PER_REPO)]));
    await globalState.update(REVIEW_CACHE_STORAGE_KEY, { version: 2, evidence, replays });
  }

  function getEvidence(repoRoot, evidenceKey) {
    const hit = (evidenceByRepo.get(repoKey(repoRoot)) || []).find(entry => entry.evidenceKey === evidenceKey);
    if (!hit) return null;
    return {
      evidenceKey: hit.evidenceKey,
      reviewSubjectKey: hit.reviewSubjectKey,
      evidenceManifestDigest: hit.evidenceManifestDigest,
      createdAt: hit.createdAt,
      semanticEvidence: hydrateEvidence(hit.semanticEvidence)
    };
  }

  async function putEvidence(repoRoot, input) {
    if (!input || !validHex64(input.evidenceKey) || !validHex64(input.reviewSubjectKey) || !validHex64(input.evidenceManifestDigest)) {
      throw new Error('Evidence cache entry requires evidenceKey, ReviewSubjectKey, and Evidence Manifest digest values.');
    }
    const semanticEvidence = serializeEvidence(input.semanticEvidence);
    if (!semanticEvidence?.manifest) throw new Error('Evidence cache entry requires immutable semantic evidence.');
    const key = repoKey(repoRoot);
    const compact = {
      evidenceKey: input.evidenceKey,
      reviewSubjectKey: input.reviewSubjectKey,
      evidenceManifestDigest: input.evidenceManifestDigest,
      createdAt: String(input.createdAt || new Date().toISOString()),
      semanticEvidence
    };
    const values = [compact, ...(evidenceByRepo.get(key) || []).filter(item => item.evidenceKey !== compact.evidenceKey)].slice(0, MAX_EVIDENCE_ENTRIES_PER_REPO);
    evidenceByRepo.set(key, values);
    await flush();
    return getEvidence(repoRoot, input.evidenceKey);
  }

  function getReplay(repoRoot, reviewSubjectKey) {
    const hit = (replayByRepo.get(repoKey(repoRoot)) || []).find(entry => entry.reviewSubjectKey === reviewSubjectKey);
    return hit ? clone(hit) : null;
  }

  function getReplayByEvidenceKey(repoRoot, evidenceKey) {
    const hit = (replayByRepo.get(repoKey(repoRoot)) || []).find(entry => entry.evidenceKey === evidenceKey);
    return hit ? clone(hit) : null;
  }

  async function putReplay(repoRoot, input) {
    if (!input || !validHex64(input.evidenceKey) || !validHex64(input.reviewSubjectKey) || typeof input.reviewRunId !== 'string' || input.reviewRunId.length < 8 || !input.review || typeof input.review !== 'object') {
      throw new Error('Review replay entry requires evidenceKey, ReviewSubjectKey, ReviewRunId, and a validated review.');
    }
    const key = repoKey(repoRoot);
    const compact = {
      evidenceKey: input.evidenceKey,
      reviewSubjectKey: input.reviewSubjectKey,
      reviewRunId: input.reviewRunId,
      createdAt: String(input.createdAt || new Date().toISOString()),
      evidenceManifestDigest: String(input.evidenceManifestDigest || ''),
      findingSetDigest: String(input.findingSetDigest || ''),
      review: clone(input.review)
    };
    const values = [compact, ...(replayByRepo.get(key) || []).filter(item => item.reviewSubjectKey !== compact.reviewSubjectKey)].slice(0, MAX_REPLAY_ENTRIES_PER_REPO);
    replayByRepo.set(key, values);
    await flush();
    return clone(compact);
  }

  function listEvidence(repoRoot) {
    return (evidenceByRepo.get(repoKey(repoRoot)) || []).map(entry => ({
      evidenceKey: entry.evidenceKey,
      reviewSubjectKey: entry.reviewSubjectKey,
      evidenceManifestDigest: entry.evidenceManifestDigest,
      createdAt: entry.createdAt
    }));
  }
  function listReplays(repoRoot) { return clone(replayByRepo.get(repoKey(repoRoot)) || []); }

  async function purgeLegacy() {
    if (globalState?.get(LEGACY_REVIEW_CACHE_STORAGE_KEY, undefined) !== undefined) {
      await globalState.update(LEGACY_REVIEW_CACHE_STORAGE_KEY, undefined);
    }
  }

  async function clear(repoRoot) {
    if (repoRoot) {
      const key = repoKey(repoRoot);
      evidenceByRepo.delete(key);
      replayByRepo.delete(key);
    } else {
      evidenceByRepo.clear();
      replayByRepo.clear();
    }
    await flush();
    if (!repoRoot) await purgeLegacy();
  }

  return { restore, getEvidence, putEvidence, getReplay, getReplayByEvidenceKey, putReplay, listEvidence, listReplays, purgeLegacy, clear };
}

module.exports = {
  REVIEW_CACHE_STORAGE_KEY,
  LEGACY_REVIEW_CACHE_STORAGE_KEY,
  MAX_EVIDENCE_ENTRIES_PER_REPO,
  MAX_REPLAY_ENTRIES_PER_REPO,
  MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO,
  serializeEvidence,
  hydrateEvidence,
  createReviewCache
};
