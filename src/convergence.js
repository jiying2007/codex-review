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
function evaluateConvergence(review, lineage = null, scope = null) {
  const transition = lineage?.transition || {};
  const findings = review?.findings || [];
  const coverageComplete = review?.coverageVerdict === 'complete' && !(review?.coverageGaps || []).length;
  const stabilityOk = review?.stability?.stable !== false;
  const fixed = (transition.fixedIds || []).length;
  const added = (transition.newIds || []).length;
  const reintroduced = (transition.reintroducedIds || []).length;
  const likelyFixInduced = (transition.likelyFixInducedIds || []).length;
  const previousCount = Number(transition.previousCount || 0);
  const closureRate = previousCount > 0 ? clamp01(fixed / previousCount) : 0;
  const fixInducedRate = added > 0 ? clamp01(likelyFixInduced / added) : 0;
  const reintroducedRate = added > 0 ? clamp01(reintroduced / added) : 0;
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
    runNumber: Number(lineage?.runNumber || 1),
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
  if (!convergence) return null;
  if (convergence.state === 'incomplete') return 'convergence_incomplete';
  return null;
}

module.exports = { evaluateConvergence, convergenceCoverageGap, invariantCandidates };