'use strict';

const crypto = require('crypto');
const { normalizeFsPath } = require('./review-support');
const { git } = require('./git');
const {
  REVIEW_RECEIPT_SCHEMA_VERSION,
  validateReviewReceipt
} = require('./codex-safe-core/safe-contract');

const RECEIPT_STORAGE_KEY = 'safeCodexReview.receipts.v4';
const MAX_RECEIPTS_PER_REPO = 50;

function localSubject(receipt) {
  return receipt?.subject?.type === 'git-index' ? receipt.subject : null;
}

function createReviewReceiptStore(globalState) {
  const receiptsByRepo = new Map();

  function restore() {
    receiptsByRepo.clear();
    const stored = globalState?.get(RECEIPT_STORAGE_KEY, {}) || {};
    for (const [repoKey, receipts] of Object.entries(stored)) {
      if (!Array.isArray(receipts)) continue;
      const valid = receipts.map(validateReviewReceipt).filter(receipt => localSubject(receipt)).slice(0, MAX_RECEIPTS_PER_REPO);
      if (valid.length) receiptsByRepo.set(repoKey, valid);
    }
  }

  async function persist(repoRoot, receipt) {
    const validated = validateReviewReceipt(receipt);
    const subject = localSubject(validated);
    if (!validated || !subject) throw new Error('Local Review Receipt v4 is invalid and was not stored.');
    const key = normalizeFsPath(repoRoot);
    const receipts = [validated, ...(receiptsByRepo.get(key) || [])]
      .filter((item, index, all) => {
        const itemSubject = localSubject(item);
        return itemSubject && all.findIndex(other => {
          const otherSubject = localSubject(other);
          return otherSubject &&
            otherSubject.headOid === itemSubject.headOid &&
            otherSubject.indexFingerprint === itemSubject.indexFingerprint &&
            other.diffFingerprint === item.diffFingerprint;
        }) === index;
      })
      .slice(0, MAX_RECEIPTS_PER_REPO);
    receiptsByRepo.set(key, receipts);
    if (globalState) await globalState.update(RECEIPT_STORAGE_KEY, Object.fromEntries(receiptsByRepo));
    return validated;
  }

  function getReceipts(repoRoot) { return (receiptsByRepo.get(normalizeFsPath(repoRoot)) || []).map(item => ({ ...item, subject: { ...item.subject } })); }
  function getLatest(repoRoot) { return getReceipts(repoRoot)[0] || null; }

  function getStatus(repoRoot, snapshot) {
    const receipt = getLatest(repoRoot);
    const subject = localSubject(receipt);
    if (!receipt || !subject) return { status: 'unavailable', receipt: null };
    const current = Boolean(snapshot && subject.headOid === snapshot.headOid && subject.indexFingerprint === snapshot.indexFingerprint);
    return { status: current ? 'current' : 'stale', receipt };
  }

  async function getEvidenceForRange(repoRoot, baseRef, headRef = 'HEAD', token) {
    for (const [name, value] of [['baseRef', baseRef], ['headRef', headRef]]) {
      if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${name}.`);
    }
    const receipts = getReceipts(repoRoot);
    const { stdout } = await git(['rev-list', '--first-parent', '--reverse', `${baseRef}..${headRef}`, '--'], repoRoot, token);
    const commits = stdout.split(/\r?\n/).filter(Boolean);
    const matched = [];

    for (const commitOid of commits) {
      let parentOid;
      try { parentOid = (await git(['rev-parse', `${commitOid}^`], repoRoot, token)).stdout.trim(); }
      catch (error) { if (error?.code === 'ECANCELLED') throw error; continue; }
      const candidates = receipts.filter(receipt => localSubject(receipt)?.headOid === parentOid);
      if (!candidates.length) continue;
      const { stdout: diff } = await git([
        '-c', 'core.quotePath=false', 'diff', '-M', '-C', '--src-prefix=a/', '--dst-prefix=b/',
        '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', parentOid, commitOid, '--'
      ], repoRoot, token);
      const fingerprint = crypto.createHash('sha256').update(diff, 'utf8').digest('hex');
      const receipt = candidates.find(item => item.diffFingerprint === fingerprint);
      if (receipt) matched.push({ commitOid, receipt });
    }

    return {
      schemaVersion: REVIEW_RECEIPT_SCHEMA_VERSION,
      kind: 'codex-review-range-evidence',
      totalCommits: commits.length,
      reviewedCommits: matched.length,
      blockedCommits: matched.filter(item => item.receipt.qualityVerdict === 'blocked').length,
      incompleteCommits: matched.filter(item => item.receipt.coverageVerdict !== 'complete').length,
      needsEvidenceCommits: matched.filter(item => item.receipt.readinessVerdict !== 'ready').length,
      matches: matched.map(item => ({ commitOid: item.commitOid, receipt: { ...item.receipt, subject: { ...item.receipt.subject } } }))
    };
  }

  async function clear() {
    receiptsByRepo.clear();
    if (globalState) await globalState.update(RECEIPT_STORAGE_KEY, undefined);
  }
  function resetMemory() { receiptsByRepo.clear(); }

  return { restore, persist, getReceipts, getLatest, getStatus, getEvidenceForRange, clear, resetMemory };
}

module.exports = { RECEIPT_STORAGE_KEY, MAX_RECEIPTS_PER_REPO, createReviewReceiptStore };
