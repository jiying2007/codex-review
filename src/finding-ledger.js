'use strict';

const { normalizeFsPath } = require('./review-support');
const { normalizeResolutionRecord, activeResolution, RESOLUTION_VALUES } = require('./codex-safe-core/semantic-review');

const FINDING_LEDGER_STORAGE_KEY = 'safeCodexReview.findingLedger.v1';
const MAX_RESOLUTIONS_PER_REPO = 500;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function createFindingLedger(globalState) {
  const byRepo = new Map();
  function restore() {
    byRepo.clear();
    const stored = globalState?.get(FINDING_LEDGER_STORAGE_KEY, {}) || {};
    for (const [repo, records] of Object.entries(stored)) {
      if (!Array.isArray(records)) continue;
      const valid = records.map(normalizeResolutionRecord).filter(record => record.stableFindingId && record.evidenceDigest).slice(0, MAX_RESOLUTIONS_PER_REPO);
      if (valid.length) byRepo.set(repo, valid);
    }
  }
  async function flush() { if (globalState) await globalState.update(FINDING_LEDGER_STORAGE_KEY, Object.fromEntries(byRepo)); }
  function list(repoRoot) { return clone(byRepo.get(normalizeFsPath(repoRoot)) || []); }
  function getActive(repoRoot, stableFindingId, evidenceDigest) { return activeResolution(byRepo.get(normalizeFsPath(repoRoot)) || [], stableFindingId, evidenceDigest); }
  async function resolve(repoRoot, input) {
    const record = normalizeResolutionRecord({ ...input, resolvedAt: input?.resolvedAt || new Date().toISOString() });
    if (!record.stableFindingId || !record.evidenceDigest) throw new Error('Finding resolution requires stableFindingId and evidenceDigest.');
    const key = normalizeFsPath(repoRoot);
    const values = [record, ...(byRepo.get(key) || []).filter(item => !(item.stableFindingId === record.stableFindingId && item.evidenceDigest === record.evidenceDigest))].slice(0, MAX_RESOLUTIONS_PER_REPO);
    byRepo.set(key, values); await flush(); return clone(record);
  }
  async function clear(repoRoot) { if (repoRoot) byRepo.delete(normalizeFsPath(repoRoot)); else byRepo.clear(); await flush(); }
  return { restore, list, getActive, resolve, clear };
}

module.exports = { FINDING_LEDGER_STORAGE_KEY, MAX_RESOLUTIONS_PER_REPO, RESOLUTION_VALUES, createFindingLedger };
