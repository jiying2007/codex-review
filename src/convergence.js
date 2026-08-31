'use strict';

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function invariantCandidates(findings = []) {
  const values = [];
  const seen = new Set();
  for (const finding of findings) {
    if (finding?.invariantCandidate !== true) continue;
    const text = String(finding.invariantText || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text); values.push(text);
  }
  return values.slice(0, 20);
}
function stabilityReason(stability) {
  const required = Math.max(2, Number(stability?.requiredFreshRuns || 2));
  if (Number(stability?.cachedVerdictRuns || 0) > 0) return 'judgment_cache_used';
  if (Number(stability?.freshInferenceRuns || 0) < required) return 'fresh_runs_missing';
  if (Number(stability?.blindFreshRuns || 0) < required) return 'blind_context_missing';
  if (stability?.stable !== true) return 'finding_disagreement';
  return 'stable';
}
function evaluateConvergence(review, lineage = null, scope = null) {
  const transition = lineage?.transition || {};
  const findings = review?.findings || [];
  const coverageComplete = review?.coverageVerdict === 'complete' && !(review?.coverageGaps || []).length;
  const stability = lineage?.stability || review?.stability || {};
  const requiredFreshRuns = Math.max(2, Number(stability.requiredFreshRuns || 2));
  const freshInferenceRuns = Number(stability.freshInferenceRuns || 0);
  const blindFreshRuns = Number(stability.blindFreshRuns || 0);
  const cachedVerdictRuns = Number(stability.cachedVerdictRuns || 0);
  const provenanceComplete = freshInferenceRuns >= requiredFreshRuns && blindFreshRuns >= requiredFreshRuns && cachedVerdictRuns === 0;
  const stabilityOk = provenanceComplete && stability.stable === true;
  const fixed = (transition.fixedIds || []).length;
  const added = (transition.newIds || []).length;
  const reintroduced = (transition.reintroducedIds || []).length;
  const likelyFixInduced = (transition.likelyFixInducedIds || []).length;
  const previousCount = Number(transition.previousCount || 0);
  const closureRate = previousCount > 0 ? clamp01(fixed / previousCount) : 0;
  const fixInducedRate = added > 0 ? clamp01(likelyFixInduced / added) : 0;
  const reintroducedRate = added > 0 ? clamp01(reintroduced / added) : 0;
  const sessionRunNumber = Number(lineage?.sessionRunNumber || 1);
  const subjectRunNumber = Number(lineage?.subjectRunNumber || 1);
  let state = 'active';
  if (!coverageComplete || !stabilityOk) state = 'incomplete';
  else if (!findings.length) state = 'converged';
  else if (reintroduced > 0 || likelyFixInduced > 0 || added > fixed) state = 'regressing';
  else if (fixed > added) state = 'improving';
  const invariants = invariantCandidates(findings);
  return Object.freeze({
    state,
    coverageComplete,
    stabilityOk,
    provenanceComplete,
    stabilityReason: stabilityReason(stability),
    requiredFreshRuns,
    freshInferenceRuns,
    blindFreshRuns,
    independentReviewRuns: Number(stability.independentReviewRuns || 0),
    cachedVerdictRuns,
    agreement: clamp01(stability.agreement),
    sessionRunNumber,
    subjectRunNumber,
    reviewsToConvergence: state === 'converged' ? sessionRunNumber : null,
    fixed,
    added,
    unchanged: (transition.unchangedIds || []).length,
    changed: (transition.changedIds || []).length,
    reintroduced,
    likelyFixInduced,
    closureRate,
    fixInducedRate,
    reintroducedRate,
    deterministicPreventableCount: invariants.length,
    invariantCandidates: invariants,
    scopePhase: String(scope?.phase || 'unspecified'),
    complexityBudget: String(scope?.complexityBudget || 'balanced')
  });
}
function convergenceCoverageGap(convergence) {
  if (!convergence || convergence.state !== 'incomplete') return null;
  if (!convergence.coverageComplete) return 'convergence_coverage_incomplete';
  return `convergence_stability:${convergence.stabilityReason || 'incomplete'}`;
}

module.exports = { evaluateConvergence, convergenceCoverageGap, invariantCandidates, stabilityReason };
