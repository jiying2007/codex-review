'use strict';

const path = require('node:path');
const { canonicalJson, sha256 } = require('./codex-safe-core/semantic-review');

const REVIEW_LINEAGE_STORAGE_KEY = 'safeCodexReview.lineage.v2';
const LEGACY_REVIEW_LINEAGE_STORAGE_KEY = 'safeCodexReview.lineage.v1';
const MAX_SESSIONS_PER_REPO = 12;
const MAX_RUNS_PER_SESSION = 40;
const REQUIRED_FRESH_RUNS = 2;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalizeFsPath(value) { const resolved=path.resolve(value); return process.platform==='win32'?resolved.toLowerCase():resolved; }
function normalizeGitPath(value) { return String(value||'').replace(/\\/g,'/').replace(/^\.\//,''); }
function buildReviewSessionKey({ headOid, policyFingerprint, scopeFingerprint, profile }) {
  return sha256(canonicalJson({ headOid, policyFingerprint, scopeFingerprint, profile }));
}
function snapshotFinding(finding) {
  return {
    stableFindingId: String(finding.stableFindingId || ''),
    file: normalizeGitPath(finding.file || ''),
    category: String(finding.category || ''),
    severity: String(finding.severity || ''),
    evidenceDigest: String(finding.evidenceDigest || ''),
    verificationStatus: String(finding.verificationStatus || ''),
    claimClass: String(finding.claimClass || ''),
    invariantCandidate: finding.invariantCandidate === true,
    invariantText: String(finding.invariantText || '').slice(0, 500)
  };
}
function findingSignature(finding) {
  return [finding.stableFindingId, finding.severity, finding.evidenceDigest, finding.verificationStatus].join('|');
}
function findingSetDigest(findings = []) {
  return sha256(canonicalJson(findings.map(snapshotFinding).map(findingSignature).sort()));
}
function transitionBetween(previous, current, seenIds = new Set()) {
  if (!previous) return { previousReviewSubjectKey:'', newIds:current.map(item=>item.stableFindingId).filter(Boolean), unchangedIds:[], changedIds:[], fixedIds:[], reintroducedIds:[], likelyFixInducedIds:[], previousCount:0, currentCount:current.length };
  const prev = new Map(previous.map(item => [item.stableFindingId, item]));
  const curr = new Map(current.map(item => [item.stableFindingId, item]));
  const unchangedIds = [], changedIds = [], fixedIds = [], newIds = [], reintroducedIds = [], likelyFixInducedIds = [];
  for (const [id, before] of prev) {
    const after = curr.get(id);
    if (!after) { fixedIds.push(id); continue; }
    if (findingSignature(before) === findingSignature(after)) unchangedIds.push(id); else changedIds.push(id);
  }
  const fixedPaths = new Set(fixedIds.map(id => prev.get(id)?.file).filter(Boolean));
  for (const [id, after] of curr) {
    if (prev.has(id)) continue;
    newIds.push(id);
    if (seenIds.has(id)) reintroducedIds.push(id);
    else if (fixedPaths.has(after.file)) likelyFixInducedIds.push(id);
  }
  return { previousReviewSubjectKey:'', newIds, unchangedIds, changedIds, fixedIds, reintroducedIds, likelyFixInducedIds, previousCount:previous.length, currentCount:current.length };
}
function disagreementFindingIds(left = [], right = []) {
  const a = new Map(left.map(item => [item.stableFindingId, findingSignature(item)]));
  const b = new Map(right.map(item => [item.stableFindingId, findingSignature(item)]));
  const ids = new Set([...a.keys(), ...b.keys()]);
  return [...ids].filter(id => a.get(id) !== b.get(id)).sort();
}
function computeSubjectStability(runs = []) {
  const freshRuns = runs.filter(run => run.executionProvenance?.inference === 'fresh');
  const completeFreshRuns = freshRuns.filter(run => run.coverageVerdict === 'complete');
  const digests = freshRuns.map(run => String(run.findingSetDigest || findingSetDigest(run.findings || [])));
  const counts = new Map();
  for (const digest of digests) counts.set(digest, (counts.get(digest) || 0) + 1);
  const modalCount = Math.max(0, ...counts.values());
  const agreement = freshRuns.length ? modalCount / freshRuns.length : 0;
  const compared = freshRuns.length >= REQUIRED_FRESH_RUNS;
  const latestPair = freshRuns.slice(-REQUIRED_FRESH_RUNS);
  const latestComplete = latestPair.length === REQUIRED_FRESH_RUNS && latestPair.every(run => run.coverageVerdict === 'complete');
  const latestDigestAgreement = latestPair.length === REQUIRED_FRESH_RUNS && latestPair.every(run => String(run.findingSetDigest || findingSetDigest(run.findings || [])) === String(latestPair[0].findingSetDigest || findingSetDigest(latestPair[0].findings || [])));
  const stable = compared && latestComplete && latestDigestAgreement;
  const unstableFindingIds = compared && !latestDigestAgreement ? disagreementFindingIds(latestPair[0].findings || [], latestPair[latestPair.length - 1].findings || []) : [];
  return {
    compared,
    stable,
    requiredFreshRuns: REQUIRED_FRESH_RUNS,
    freshInferenceRuns: freshRuns.length,
    completeFreshRuns: completeFreshRuns.length,
    latestRequiredRunsCoverageComplete: latestComplete,
    independentReviewRuns: freshRuns.filter(run => run.executionProvenance?.mode === 'independent').length,
    blindFreshRuns: freshRuns.filter(run => run.executionProvenance?.judgmentContext === 'blind').length,
    cachedVerdictRuns: freshRuns.filter(run => run.executionProvenance?.judgmentCacheUsed === true).length,
    agreement,
    consecutiveAgreementRuns: stable ? REQUIRED_FRESH_RUNS : freshRuns.length ? 1 : 0,
    unstableFindingIds
  };
}
function createReviewLineageStore(globalState) {
  const byRepo = new Map();
  function restore() {
    byRepo.clear();
    const stored = globalState?.get(REVIEW_LINEAGE_STORAGE_KEY, {}) || {};
    for (const [repo, sessions] of Object.entries(stored)) {
      if (!Array.isArray(sessions)) continue;
      const valid = sessions.filter(session => session && typeof session.sessionKey === 'string' && Array.isArray(session.runs)).map(session => ({ ...session, runs: session.runs.slice(-MAX_RUNS_PER_SESSION) })).slice(0, MAX_SESSIONS_PER_REPO);
      if (valid.length) byRepo.set(repo, valid);
    }
  }
  async function flush() { if (globalState) await globalState.update(REVIEW_LINEAGE_STORAGE_KEY, Object.fromEntries(byRepo)); }
  function sessions(repoRoot) { return byRepo.get(normalizeFsPath(repoRoot)) || []; }
  function getSession(repoRoot, sessionKey) { return sessions(repoRoot).find(session => session.sessionKey === sessionKey) || null; }
  function latest(repoRoot, sessionKey) { const session=getSession(repoRoot,sessionKey); return session?.runs?.[session.runs.length-1]?clone(session.runs[session.runs.length-1]):null; }
  function latestForSubject(repoRoot, sessionKey, reviewSubjectKey) {
    const session = getSession(repoRoot, sessionKey);
    if (!session) return null;
    const runs = session.runs.filter(run => run.reviewSubjectKey === reviewSubjectKey);
    return runs.length ? clone(runs[runs.length - 1]) : null;
  }
  async function record(repoRoot, input) {
    if (!input || typeof input.reviewRunId !== 'string' || input.reviewRunId.length < 8 || typeof input.reviewSubjectKey !== 'string' || input.reviewSubjectKey.length !== 64) {
      throw new Error('Review lineage requires a ReviewRunId and ReviewSubjectKey.');
    }
    const repo = normalizeFsPath(repoRoot), values = sessions(repoRoot).map(clone);
    let session = values.find(item => item.sessionKey === input.sessionKey);
    if (!session) { session={sessionKey:input.sessionKey,createdAt:new Date().toISOString(),phase:String(input.phase||'unspecified'),runs:[]}; values.unshift(session); }
    const existing = session.runs.find(run => run.reviewRunId === input.reviewRunId);
    if (existing) return clone(existing.lineage);

    const currentFindings = (input.findings || []).filter(item => item?.stableFindingId).map(snapshotFinding);
    const previousRun = session.runs[session.runs.length - 1] || null;
    const sameSubjectContinuation = previousRun?.reviewSubjectKey === input.reviewSubjectKey;
    const seenIds = new Set(session.runs.flatMap(run => (run.findings || []).map(item => item.stableFindingId)));
    let transition;
    if (sameSubjectContinuation) transition = clone(previousRun.lineage?.transition || transitionBetween(null, currentFindings, seenIds));
    else {
      transition = transitionBetween(previousRun?.findings || null, currentFindings, seenIds);
      transition.previousReviewSubjectKey = previousRun?.reviewSubjectKey || '';
    }

    const subjectRunsBefore = session.runs.filter(run => run.reviewSubjectKey === input.reviewSubjectKey);
    const runRecord = {
      reviewRunId: input.reviewRunId,
      reviewSubjectKey: input.reviewSubjectKey,
      evidenceKey: String(input.evidenceKey || ''),
      createdAt: new Date().toISOString(),
      coverageVerdict: String(input.coverageVerdict || ''),
      findingSetDigest: findingSetDigest(currentFindings),
      findings: currentFindings,
      executionProvenance: {
        mode: String(input.executionProvenance?.mode || 'standard'),
        inference: String(input.executionProvenance?.inference || 'fresh'),
        evidenceCacheHit: input.executionProvenance?.evidenceCacheHit === true,
        resultReplay: input.executionProvenance?.resultReplay === true,
        judgmentContext: String(input.executionProvenance?.judgmentContext || 'blind'),
        judgmentCacheUsed: input.executionProvenance?.judgmentCacheUsed === true
      }
    };
    const subjectRunsAfter = [...subjectRunsBefore, runRecord];
    const stability = computeSubjectStability(subjectRunsAfter);
    const lineage = {
      sessionKey: input.sessionKey,
      sessionRunNumber: session.runs.length + 1,
      subjectRunNumber: subjectRunsBefore.length + 1,
      reviewRunId: input.reviewRunId,
      reviewSubjectKey: input.reviewSubjectKey,
      previousReviewRunId: previousRun?.reviewRunId || '',
      previousReviewSubjectKey: previousRun?.reviewSubjectKey || '',
      transitionKind: sameSubjectContinuation ? 'repeat_subject' : 'subject_change',
      transition,
      stability,
      phase: String(input.phase || session.phase || 'unspecified')
    };
    runRecord.lineage = lineage;
    session.runs.push(runRecord);
    session.runs = session.runs.slice(-MAX_RUNS_PER_SESSION);
    byRepo.set(repo, values.slice(0, MAX_SESSIONS_PER_REPO));
    await flush();
    return clone(lineage);
  }
  function list(repoRoot) { return clone(sessions(repoRoot)); }
  async function purgeLegacy() {
    if (globalState?.get(LEGACY_REVIEW_LINEAGE_STORAGE_KEY, undefined) !== undefined) await globalState.update(LEGACY_REVIEW_LINEAGE_STORAGE_KEY, undefined);
  }
  async function clear(repoRoot) { if(repoRoot)byRepo.delete(normalizeFsPath(repoRoot));else byRepo.clear();await flush();if(!repoRoot)await purgeLegacy(); }
  return { restore, record, latest, latestForSubject, list, purgeLegacy, clear };
}

module.exports = {
  REVIEW_LINEAGE_STORAGE_KEY,
  LEGACY_REVIEW_LINEAGE_STORAGE_KEY,
  MAX_SESSIONS_PER_REPO,
  MAX_RUNS_PER_SESSION,
  REQUIRED_FRESH_RUNS,
  normalizeGitPath,
  buildReviewSessionKey,
  snapshotFinding,
  findingSignature,
  findingSetDigest,
  disagreementFindingIds,
  computeSubjectStability,
  transitionBetween,
  createReviewLineageStore
};
