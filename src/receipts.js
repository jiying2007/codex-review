'use strict';

const crypto = require('crypto');
const { normalizeFsPath } = require('./review-support');
const { git } = require('./git');
const { REVIEW_RECEIPT_SCHEMA_VERSION, validateReviewReceipt } = require('./codex-safe-core/safe-contract');
const { reviewReceiptQualifiesForDelivery } = require('./codex-safe-core/judgment-lifecycle');

const RECEIPT_STORAGE_KEY = 'safeCodexReview.receipts.v5';
const MAX_RECEIPTS_PER_REPO = 50;
function localSubject(receipt) { return receipt?.subject?.type === 'git-index' ? receipt.subject : null; }
function receiptIdentity(receipt) { return receipt ? `${receipt.reviewSubjectFingerprint}:${receipt.evidenceManifestDigest}` : ''; }
function durableReceiptIdentity(receipt) {
  const subject=localSubject(receipt);
  return subject ? [subject.headOid,subject.indexFingerprint,receipt.diffFingerprint,receipt.reviewSubjectFingerprint,receipt.evidenceManifestDigest,receipt.createdAt].join(':') : '';
}
function monotonicReceipt(receipt, latest) {
  const validated=validateReviewReceipt(receipt);
  const latestMs=Date.parse(String(latest?.createdAt||''));
  const currentMs=Date.parse(String(validated.createdAt||''));
  if(!Number.isFinite(latestMs)||!Number.isFinite(currentMs)||currentMs>latestMs)return validated;
  return validateReviewReceipt({...validated,createdAt:new Date(latestMs+1).toISOString()});
}

function createReviewReceiptStore(globalState) {
  const receiptsByRepo = new Map();
  const currentIdentityByRepo = new Map();

  function restore() {
    receiptsByRepo.clear();
    currentIdentityByRepo.clear();
    const stored = globalState?.get(RECEIPT_STORAGE_KEY, {}) || {};
    for (const [repoKey, receipts] of Object.entries(stored)) {
      if (!Array.isArray(receipts)) continue;
      const valid = receipts.map(validateReviewReceipt).filter(receipt => localSubject(receipt)).slice(0, MAX_RECEIPTS_PER_REPO);
      if (valid.length) receiptsByRepo.set(repoKey, valid);
    }
  }

  async function persist(repoRoot, receipt) {
    const key = normalizeFsPath(repoRoot);
    const existing=receiptsByRepo.get(key)||[];
    const validated = monotonicReceipt(receipt,existing[0]), subject = localSubject(validated);
    if (!validated || !subject) throw new Error('Local Review Receipt v5 is invalid and was not stored.');
    const receipts = [validated, ...existing]
      .filter((item, index, all) => all.findIndex(other => durableReceiptIdentity(other) === durableReceiptIdentity(item)) === index)
      .slice(0, MAX_RECEIPTS_PER_REPO);
    receiptsByRepo.set(key, receipts);
    currentIdentityByRepo.set(key, receiptIdentity(validated));
    if (globalState) await globalState.update(RECEIPT_STORAGE_KEY, Object.fromEntries(receiptsByRepo));
    return validated;
  }

  function getReceipts(repoRoot) { return (receiptsByRepo.get(normalizeFsPath(repoRoot)) || []).map(item => ({ ...item, subject: { ...item.subject } })); }
  function getLatest(repoRoot) { return getReceipts(repoRoot)[0] || null; }
  function getStatus(repoRoot, snapshot) {
    const key = normalizeFsPath(repoRoot), receipt = getLatest(repoRoot), subject = localSubject(receipt);
    if (!receipt || !subject) return { status: 'unavailable', receipt: null };
    const snapshotMatches = Boolean(snapshot && subject.headOid === snapshot.headOid && subject.indexFingerprint === snapshot.indexFingerprint);
    const sessionIdentityMatches = currentIdentityByRepo.get(key) === receiptIdentity(receipt);
    return { status: snapshotMatches && sessionIdentityMatches ? 'current' : 'stale', receipt };
  }

  async function getEvidenceForRange(repoRoot, baseRef, headRef = 'HEAD', token) {
    for (const [name, value] of [['baseRef', baseRef], ['headRef', headRef]]) if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${name}.`);
    const receipts = getReceipts(repoRoot), { stdout } = await git(['rev-list', '--first-parent', '--reverse', `${baseRef}..${headRef}`, '--'], repoRoot, token), commits = stdout.split(/\r?\n/).filter(Boolean), matched = [];
    for (const commitOid of commits) {
      let parentOid; try { parentOid = (await git(['rev-parse', `${commitOid}^`], repoRoot, token)).stdout.trim(); } catch (error) { if (error?.code === 'ECANCELLED') throw error; continue; }
      const candidates = receipts.filter(receipt => localSubject(receipt)?.headOid === parentOid); if (!candidates.length) continue;
      const { stdout: diff } = await git(['-c','core.quotePath=false','diff','-M','-C','--src-prefix=a/','--dst-prefix=b/','--no-color','--no-ext-diff','--no-textconv','--unified=3',parentOid,commitOid,'--'], repoRoot, token);
      const diffFingerprint = crypto.createHash('sha256').update(diff, 'utf8').digest('hex');
      const receipt = candidates.find(item => item.diffFingerprint === diffFingerprint); if (receipt) matched.push({ commitOid, receipt });
    }
    const qualifiedCommits = matched.filter(item => reviewReceiptQualifiesForDelivery(item.receipt)).length;
    return {
      schemaVersion: REVIEW_RECEIPT_SCHEMA_VERSION, kind: 'codex-review-range-evidence', totalCommits: commits.length, reviewedCommits: matched.length,
      qualifiedCommits, blockedCommits: matched.filter(item => item.receipt.qualityVerdict === 'blocked').length,
      incompleteCommits: matched.filter(item => item.receipt.coverageVerdict !== 'complete').length,
      needsEvidenceCommits: Math.max(0, commits.length - qualifiedCommits),
      matches: matched.map(item => ({ commitOid: item.commitOid, receipt: { ...item.receipt, subject: { ...item.receipt.subject } } }))
    };
  }

  async function clear() { receiptsByRepo.clear(); currentIdentityByRepo.clear(); if (globalState) { await globalState.update(RECEIPT_STORAGE_KEY, undefined); await globalState.update('safeCodexReview.receipts.v4', undefined); } }
  function resetMemory() { receiptsByRepo.clear(); currentIdentityByRepo.clear(); }
  return { restore, persist, getReceipts, getLatest, getStatus, getEvidenceForRange, clear, resetMemory };
}
module.exports = { RECEIPT_STORAGE_KEY, MAX_RECEIPTS_PER_REPO, durableReceiptIdentity, monotonicReceipt, createReviewReceiptStore };
