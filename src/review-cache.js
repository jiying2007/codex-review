'use strict';

const { normalizeFsPath } = require('./review-support');

const REVIEW_CACHE_STORAGE_KEY = 'safeCodexReview.semanticRuns.v1';
const MAX_CACHED_RUNS_PER_REPO = 20;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function createReviewCache(globalState) {
  const byRepo = new Map();
  function restore() {
    byRepo.clear();
    const stored = globalState?.get(REVIEW_CACHE_STORAGE_KEY, {}) || {};
    for (const [repo, runs] of Object.entries(stored)) {
      if (!Array.isArray(runs)) continue;
      const valid = runs.filter(run => run && typeof run.reviewKey === 'string' && run.reviewKey.length === 64 && run.review && typeof run.review === 'object').slice(0, MAX_CACHED_RUNS_PER_REPO);
      if (valid.length) byRepo.set(repo, valid);
    }
  }
  async function flush() { if (globalState) await globalState.update(REVIEW_CACHE_STORAGE_KEY, Object.fromEntries(byRepo)); }
  function get(repoRoot, reviewKey) {
    const key = normalizeFsPath(repoRoot);
    const hit = (byRepo.get(key) || []).find(run => run.reviewKey === reviewKey);
    return hit ? clone(hit) : null;
  }
  async function put(repoRoot, run) {
    if (!run || typeof run.reviewKey !== 'string' || run.reviewKey.length !== 64) throw new Error('Review cache entry requires a stable ReviewKey.');
    const key = normalizeFsPath(repoRoot);
    const compact = {
      reviewKey: run.reviewKey,
      createdAt: String(run.createdAt || new Date().toISOString()),
      findingSetDigest: String(run.findingSetDigest || ''),
      evidenceManifestDigest: String(run.evidenceManifestDigest || ''),
      review: clone(run.review)
    };
    const values = [compact, ...(byRepo.get(key) || []).filter(item => item.reviewKey !== compact.reviewKey)].slice(0, MAX_CACHED_RUNS_PER_REPO);
    byRepo.set(key, values); await flush(); return clone(compact);
  }
  function list(repoRoot) { return clone(byRepo.get(normalizeFsPath(repoRoot)) || []); }
  async function clear(repoRoot) {
    if (repoRoot) byRepo.delete(normalizeFsPath(repoRoot)); else byRepo.clear();
    await flush();
  }
  return { restore, get, put, list, clear };
}
module.exports = { REVIEW_CACHE_STORAGE_KEY, MAX_CACHED_RUNS_PER_REPO, createReviewCache };
