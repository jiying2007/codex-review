'use strict';

const path = require('node:path');
const { canonicalJson, sha256 } = require('./codex-safe-core/semantic-review');

const REVIEW_LINEAGE_STORAGE_KEY = 'safeCodexReview.lineage.v1';
const MAX_SESSIONS_PER_REPO = 12;
const MAX_RUNS_PER_SESSION = 30;

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
    claimClass: String(finding.claimClass || ''),
    invariantCandidate: finding.invariantCandidate === true,
    invariantText: String(finding.invariantText || '').slice(0, 500)
  };
}
function transitionBetween(previous, current, seenIds = new Set()) {
  if (!previous) return { previousReviewKey:'', newIds:current.map(item=>item.stableFindingId).filter(Boolean), unchangedIds:[], changedIds:[], fixedIds:[], reintroducedIds:[], likelyFixInducedIds:[], previousCount:0, currentCount:current.length };
  const prev = new Map(previous.map(item => [item.stableFindingId, item]));
  const curr = new Map(current.map(item => [item.stableFindingId, item]));
  const unchangedIds = [], changedIds = [], fixedIds = [], newIds = [], reintroducedIds = [], likelyFixInducedIds = [];
  for (const [id, before] of prev) {
    const after = curr.get(id);
    if (!after) { fixedIds.push(id); continue; }
    if (before.severity === after.severity && before.evidenceDigest === after.evidenceDigest) unchangedIds.push(id); else changedIds.push(id);
  }
  const fixedPaths = new Set(fixedIds.map(id => prev.get(id)?.file).filter(Boolean));
  for (const [id, after] of curr) {
    if (prev.has(id)) continue;
    newIds.push(id);
    if (seenIds.has(id)) reintroducedIds.push(id);
    else if (fixedPaths.has(after.file)) likelyFixInducedIds.push(id);
  }
  return { previousReviewKey:'', newIds, unchangedIds, changedIds, fixedIds, reintroducedIds, likelyFixInducedIds, previousCount:previous.length, currentCount:current.length };
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
  async function record(repoRoot, input) {
    const repoKey = normalizeFsPath(repoRoot), values = sessions(repoRoot).map(clone);
    let session = values.find(item => item.sessionKey === input.sessionKey);
    if (!session) { session={sessionKey:input.sessionKey,createdAt:new Date().toISOString(),phase:String(input.phase||'unspecified'),runs:[]}; values.unshift(session); }
    const existing = session.runs.find(run => run.reviewKey === input.reviewKey);
    if (existing) return clone(existing.lineage);
    const currentFindings = (input.findings || []).filter(item => item?.stableFindingId).map(snapshotFinding);
    const previousRun = session.runs[session.runs.length - 1] || null;
    const seenIds = new Set(session.runs.flatMap(run => (run.findings || []).map(item => item.stableFindingId)));
    const transition = transitionBetween(previousRun?.findings || null, currentFindings, seenIds);
    transition.previousReviewKey = previousRun?.reviewKey || '';
    const lineage={sessionKey:input.sessionKey,runNumber:session.runs.length+1,previousReviewKey:transition.previousReviewKey,transition,phase:String(input.phase||session.phase||'unspecified')};
    session.runs.push({reviewKey:input.reviewKey,subjectKey:String(input.subjectKey||''),createdAt:new Date().toISOString(),coverageVerdict:String(input.coverageVerdict||''),findings:currentFindings,lineage});
    session.runs=session.runs.slice(-MAX_RUNS_PER_SESSION); byRepo.set(repoKey,values.slice(0,MAX_SESSIONS_PER_REPO)); await flush(); return clone(lineage);
  }
  function list(repoRoot) { return clone(sessions(repoRoot)); }
  async function clear(repoRoot) { if(repoRoot)byRepo.delete(normalizeFsPath(repoRoot));else byRepo.clear();await flush(); }
  return { restore, record, latest, list, clear };
}

module.exports = { REVIEW_LINEAGE_STORAGE_KEY, MAX_SESSIONS_PER_REPO, MAX_RUNS_PER_SESSION, normalizeGitPath, buildReviewSessionKey, transitionBetween, createReviewLineageStore };
