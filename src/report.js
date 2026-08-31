'use strict';

const { t } = require('./i18n');
const { severityPasses, shortFingerprint } = require('./review');

function pct(value) { return `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(0)}%`; }
function pad2(value) { return String(value).padStart(2, '0'); }
function formatReviewTime(value, language = 'en') {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
  const local = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return language === 'zh-CN' ? `审查时间: ${local} ${offset} (UTC: ${date.toISOString()})` : `Review time: ${local} ${offset} (UTC: ${date.toISOString()})`;
}
function defectVerdict(review) {
  if (review.qualityVerdict === 'blocked') return 'blocked';
  if (review.qualityVerdict === 'findings_open') return 'findings_open';
  return 'no_findings';
}
function buildReviewReport(review, options, publishMeta, reviewInputMeta = {}) {
  const visibleFindings = review.findings.filter(finding => severityPasses(finding.severity, options.severityThreshold));
  const hiddenCount = review.findings.length - visibleFindings.length;
  const lines = [];
  lines.push(`Defect verdict: ${defectVerdict(review)}`);
  lines.push(`Evidence readiness: ${review.coverageVerdict || reviewInputMeta.coverageVerdict || 'incomplete'}`);
  lines.push(`Overall readiness: ${review.readinessVerdict || 'needs_evidence'}`);
  lines.push(t('Mechanical gate: {0}', review.mechanicalGate || 'not_run'));
  lines.push(t('Summary: {0}', review.summary || t('None')));
  lines.push(t('Review policy: {0}', options.policySource));
  lines.push(t('Review input: HEAD {0}, index {1}, diff {2}, {3} staged files, {4} bytes', shortFingerprint(reviewInputMeta.headOid), shortFingerprint(reviewInputMeta.indexFingerprint), shortFingerprint(reviewInputMeta.diffFingerprint), reviewInputMeta.stagedFileCount ?? 0, reviewInputMeta.diffBytes ?? 0));
  lines.push(t('Review execution: model {0}, Codex CLI {1}', reviewInputMeta.model || 'cli-default', reviewInputMeta.codexVersion || 'unknown'));
  const reviewTime = formatReviewTime(reviewInputMeta.reviewCreatedAt, options.language);
  if (reviewTime) lines.push(reviewTime);

  const meta = review.executionMeta || {};
  const reviewSubjectKey = meta.reviewSubjectKey || reviewInputMeta.reviewSubjectKey;
  const reviewRunId = meta.reviewRunId || reviewInputMeta.reviewRunId;
  if (reviewSubjectKey) lines.push(`ReviewSubjectKey: ${shortFingerprint(reviewSubjectKey)}`);
  if (reviewRunId) lines.push(`ReviewRunId: ${String(reviewRunId).slice(0, 18)}${meta.resultReplay || reviewInputMeta.resultReplay ? ' [result-replay]' : ' [fresh-run]'}`);
  const evidenceState = meta.evidenceState || reviewInputMeta.evidenceState || (meta.evidenceCacheHit || reviewInputMeta.evidenceCacheHit ? 'cache-hit' : 'fresh');
  lines.push(`Execution provenance: mode=${meta.executionMode || reviewInputMeta.executionMode || 'standard'}, inference=${meta.inference || reviewInputMeta.inference || 'unknown'}, evidence=${evidenceState}, judgment=${meta.resultReplay || reviewInputMeta.resultReplay ? 'replay-only' : 'fresh'}, context=${meta.judgmentContext || reviewInputMeta.judgmentContext || 'unknown'}`);
  if (meta.originReviewRunId || reviewInputMeta.originReviewRunId) lines.push(`Replay origin: ${String(meta.originReviewRunId || reviewInputMeta.originReviewRunId).slice(0, 18)}`);
  if (meta.evidenceManifestDigest || reviewInputMeta.evidenceManifestDigest) lines.push(`Evidence Manifest: ${shortFingerprint(meta.evidenceManifestDigest || reviewInputMeta.evidenceManifestDigest)}`);
  if (review.scope) {
    lines.push(`Scope: phase=${review.scope.phase || 'unspecified'}, complexity=${review.scope.complexityBudget || 'balanced'}, source=${review.scope.source || 'default'}`);
    if (review.scope.present && review.scope.nonGoals?.length) lines.push(`Scope non-goals: ${review.scope.nonGoals.join(' | ')}`);
  }
  if (review.lineage) {
    const tr = review.lineage.transition || {};
    lines.push(`Review lineage: session=${shortFingerprint(review.lineage.sessionKey)}, session-run=${review.lineage.sessionRunNumber}, subject-run=${review.lineage.subjectRunNumber}, transition=${review.lineage.transitionKind || 'unknown'}, new=${tr.newIds?.length || 0}, fixed=${tr.fixedIds?.length || 0}, unchanged=${tr.unchangedIds?.length || 0}, changed=${tr.changedIds?.length || 0}, reintroduced=${tr.reintroducedIds?.length || 0}, likely-fix-induced=${tr.likelyFixInducedIds?.length || 0}`);
    const s = review.lineage.stability;
    if (s) {
      const status = s.stable ? 'stable' : s.compared ? `unstable (${s.unstableFindingIds?.length || 0} disagreement IDs)` : 'pending';
      lines.push(`Independent-review stability: ${status}; fresh=${s.freshInferenceRuns || 0}/${s.requiredFreshRuns || 2}, complete=${s.completeFreshRuns || 0}, blind=${s.blindFreshRuns || 0}, independent=${s.independentReviewRuns || 0}, cached-verdict=${s.cachedVerdictRuns || 0}, agreement=${pct(s.agreement)}`);
    }
  } else if (meta.resultReplay || reviewInputMeta.resultReplay) {
    lines.push('Review lineage: unchanged [result-replay does not create a fresh lineage run]');
  }
  if (review.convergence) {
    const c = review.convergence;
    lines.push(`Convergence: ${c.state}; reviews-to-convergence=${c.reviewsToConvergence ?? 'pending'}, stability=${c.stabilityReason || 'unknown'}, fresh=${c.freshInferenceRuns || 0}/${c.requiredFreshRuns || 2}, complete=${c.completeFreshRuns || 0}, blind=${c.blindFreshRuns || 0}, agreement=${pct(c.agreement)}, closure=${pct(c.closureRate)}, new=${c.added || 0}, reintroduced=${c.reintroduced || 0}, likely-fix-induced=${c.likelyFixInduced || 0}, deterministic-preventable=${c.deterministicPreventableCount || 0}, fix-induced-rate=${pct(c.fixInducedRate)}, reintroduced-rate=${pct(c.reintroducedRate)}`);
    if (c.invariantCandidates?.length) {
      lines.push('Suggested deterministic invariants:');
      for (const item of c.invariantCandidates.slice(0, 10)) lines.push(`- ${item}`);
    }
  }
  if (review.semanticVerification) {
    const counts=review.semanticVerification.statusCounts||{};
    lines.push(`Semantic verification: hypotheses=${review.semanticVerification.hypotheses||0}, verified=${counts.verified||0}, insufficient=${counts.insufficient_evidence||0}, contradicted=${counts.contradicted||0}, resolution-suppressed=${counts.suppressed_by_resolution||0}, verifier=${review.semanticVerification.verifierCalled?'model':'not-needed'}`);
  }
  if (reviewInputMeta.unstagedOverlayPaths?.length) lines.push(t('Working tree notice: {0} staged files also have unstaged changes; those latest edits were not reviewed: {1}', reviewInputMeta.unstagedOverlayPaths.length, reviewInputMeta.unstagedOverlayPaths.slice(0, 10).join(', ')));
  if (review.policyNotice) lines.push(t('Policy notice: {0}', review.policyNotice));
  if (review.coverageGaps?.length) { lines.push('Coverage gaps:'); for (const gap of review.coverageGaps.slice(0, 20)) lines.push(`- ${gap}`); }
  if (review.mechanicalViolations?.length) {
    lines.push('Deterministic review-rule violations:');
    for (const violation of review.mechanicalViolations.slice(0, 20)) {
      if (violation.rule === 'forbiddenPathPrefix') lines.push(`- forbiddenPathPrefix: ${violation.path} under ${violation.prefix}`);
      else if (violation.rule === 'requireTestsForCodeChanges') lines.push(`- requireTestsForCodeChanges: ${violation.codePaths?.join(', ') || violation.path}`);
      else lines.push(`- ${violation.rule}: ${violation.path || ''}`);
    }
  }
  if (review.cannotVerify?.length) {
    lines.push(t('Cannot verify from diff:'));
    const labels = { requirements: t('Requirement/spec compliance cannot be established from the staged diff alone.'), tests: t('Build and test execution were not performed by Codex Review Safe.') };
    for (const item of review.cannotVerify) lines.push(`- ${labels[item] || item}`);
  }
  lines.push(t('Findings: {0} accepted / {1} model, {2} visible, {3} hidden, {4} rejected', review.findings.length, review.modelFindingCount ?? review.findings.length, visibleFindings.length, hiddenCount, review.rejectedFindings?.length || 0));
  lines.push(`Suppressed hypotheses/findings: ${review.suppressedFindings?.length || 0}`);
  if (review.truncatedFindingCount) lines.push(`Validated findings omitted by maxFindings: ${review.truncatedFindingCount}`);
  lines.push('');

  if (!visibleFindings.length) {
    lines.push(t('No findings meet the current severity threshold.'));
    if (hiddenCount > 0) lines.push(t('{0} lower-severity findings are hidden by the current threshold.', hiddenCount));
  }
  if (review.rejectedFindings?.length) {
    lines.push(t('Invalid findings returned by the model were rejected individually:'));
    for (const rejected of review.rejectedFindings.slice(0, 10)) lines.push(`- finding[${rejected.index}]: ${rejected.reason}`);
    lines.push('');
  }
  if (review.suppressedFindings?.length) {
    lines.push('Suppressed findings/hypotheses:');
    for (const finding of review.suppressedFindings.slice(0, 20)) lines.push(`- ${finding.file || '?'}:${finding.line || '?'} [${finding.category || 'other'}] ${finding.suppressionReason || finding.verificationStatus || 'suppressed'} — ${finding.title || finding.description || ''}`);
    lines.push('');
  }

  visibleFindings.forEach((finding, index) => {
    lines.push(`${index + 1}. [${finding.severity.toUpperCase()}] [${finding.category}] ${finding.file}:${finding.line}`);
    lines.push(`   ${finding.title}`);
    lines.push(`   ${finding.description}`);
    if (finding.suggestion) lines.push(`   ${t('Suggestion:')} ${finding.suggestion}`);
    if (finding.deterministic) lines.push('   Source: deterministic repository review rule');
    else {
      lines.push(`   Evidence: status=${finding.verificationStatus || 'legacy'}, grade=${finding.evidenceGrade || '?'}, stableId=${String(finding.stableFindingId || '').slice(0,16) || 'n/a'}`);
      if (finding.evidenceRefs?.length) lines.push(`   Evidence refs: ${finding.evidenceRefs.join(', ')}`);
      if (finding.verificationReason) lines.push(`   Verification: ${finding.verificationReason}`);
      if (finding.scopeDisposition && finding.scopeDisposition !== 'in_scope') lines.push(`   Scope: ${finding.scopeDisposition}${finding.scopeReason ? ` — ${finding.scopeReason}` : ''}`);
      if (finding.scopeInvariant) lines.push(`   Scope invariant: ${finding.scopeInvariant}`);
      if (finding.supportingLocations?.length) {
        lines.push('   Supporting locations:');
        for (const location of finding.supportingLocations.slice(0, 8)) lines.push(`   - ${location.kind} ${location.file}:${location.line}-${location.endLine} — ${location.reason}`);
      }
      if (finding.invariantCandidate && finding.invariantText) lines.push(`   Deterministic invariant candidate: ${finding.invariantText}`);
    }
    const publish = publishMeta?.get(finding);
    if (publish && !publish.published) {
      const reasonText = {
        deleted_file: t('The file is deleted in the staged version and cannot be mapped to the current working tree.'), submodule_change: t('This is a submodule pointer change; it is report-only.'), binary_file: t('This is a binary file change with no reliable source line; it is report-only.'), dirty_editor: t('The file has unsaved editor changes; no inline Diagnostic is published to avoid line drift.'), unstaged_changes: t('The file also has unstaged changes; no inline Diagnostic is published to avoid line drift.'), rename_without_content_change: t('This is a pure rename with no changed post-image source line.'), copy_without_content_change: t('This is a pure copy with no changed post-image source line.'), no_added_or_modified_line: t('This diff has no locatable new-file line; the finding is report-only.'), line_not_mappable: t('The model line cannot be mapped to a changed line; the finding is report-only.'), symlink_outside_repo: t('The real file path escapes the repository through a symlink; the finding is report-only.'), file_changed_during_publish: t('The file changed while the Diagnostic was being built; the finding is report-only.'), unstaged_changes_after_publish: t('Final validation found new unstaged changes; the inline Diagnostic was retracted.'), dirty_editor_after_publish: t('Final validation found new unsaved edits; the inline Diagnostic was retracted.'), file_read_failed: t('The working-tree file could not be read; the finding is report-only.')
      }[publish.reason] || t('Inline Diagnostic was not published.');
      lines.push(`   ${t('Problems: {0} — {1}', t('not published'), reasonText)}`);
    } else if (publish?.published) lines.push(`   ${t('Problems: published at {0}:{1}', finding.file, publish.mappedLine)}`);
    lines.push(`   Model confidence: ${Number(finding.modelConfidence ?? finding.confidence ?? 0).toFixed(2)} (self-assessment, not evidence)`);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { buildReviewReport, formatReviewTime, defectVerdict };
