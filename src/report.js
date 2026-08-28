'use strict';

const { t } = require('./i18n');
const { severityPasses, shortFingerprint } = require('./review');

function buildReviewReport(review, options, publishMeta, reviewInputMeta = {}) {
  const visibleFindings = review.findings.filter(finding => severityPasses(finding.severity, options.severityThreshold));
  const hiddenCount = review.findings.length - visibleFindings.length;
  const lines = [];
  lines.push(t('Finding verdict: {0}', review.verdict));
  lines.push(t('Quality verdict: {0}', review.qualityVerdict || 'unknown'));
  lines.push(t('Readiness verdict: {0}', review.readinessVerdict || 'needs_evidence'));
  lines.push(t('Mechanical gate: {0}', review.mechanicalGate || 'not_run'));
  lines.push(`Coverage verdict: ${review.coverageVerdict || reviewInputMeta.coverageVerdict || 'incomplete'}`);
  lines.push(t('Summary: {0}', review.summary || t('None')));
  lines.push(t('Review policy: {0}', options.policySource));
  lines.push(t('Review input: HEAD {0}, index {1}, diff {2}, {3} staged files, {4} bytes', shortFingerprint(reviewInputMeta.headOid), shortFingerprint(reviewInputMeta.indexFingerprint), shortFingerprint(reviewInputMeta.diffFingerprint), reviewInputMeta.stagedFileCount ?? 0, reviewInputMeta.diffBytes ?? 0));
  lines.push(t('Review execution: model {0}, Codex CLI {1}', reviewInputMeta.model || 'cli-default', reviewInputMeta.codexVersion || 'unknown'));
  if (reviewInputMeta.reviewKey) lines.push(`ReviewKey: ${reviewInputMeta.reviewKey}${reviewInputMeta.cacheHit ? ' [cache-hit]' : ' [model-run]'}`);
  if (reviewInputMeta.evidenceManifestDigest) lines.push(`Evidence Manifest: sha256:${reviewInputMeta.evidenceManifestDigest}`);
  if (review.semanticVerification) {
    const counts=review.semanticVerification.statusCounts||{};
    lines.push(`Semantic verification: hypotheses=${review.semanticVerification.hypotheses||0}, verified=${counts.verified||0}, insufficient=${counts.insufficient_evidence||0}, contradicted=${counts.contradicted||0}, resolution-suppressed=${counts.suppressed_by_resolution||0}, verifier=${review.semanticVerification.verifierCalled?'model':'not-needed'}`);
  }
  if (review.stability?.compared) lines.push(`Repeated-review stability: ${review.stability.stable?'stable':`unstable (${review.stability.unstableFindingIds?.length||0} suppressed)`}`);
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
    }
    const meta = publishMeta?.get(finding);
    if (meta && !meta.published) {
      const reasonText = {
        deleted_file: t('The file is deleted in the staged version and cannot be mapped to the current working tree.'), submodule_change: t('This is a submodule pointer change; it is report-only.'), binary_file: t('This is a binary file change with no reliable source line; it is report-only.'), dirty_editor: t('The file has unsaved editor changes; no inline Diagnostic is published to avoid line drift.'), unstaged_changes: t('The file also has unstaged changes; no inline Diagnostic is published to avoid line drift.'), rename_without_content_change: t('This is a pure rename with no changed post-image source line.'), copy_without_content_change: t('This is a pure copy with no changed post-image source line.'), no_added_or_modified_line: t('This diff has no locatable new-file line; the finding is report-only.'), line_not_mappable: t('The model line cannot be mapped to a changed line; the finding is report-only.'), symlink_outside_repo: t('The real file path escapes the repository through a symlink; the finding is report-only.'), file_changed_during_publish: t('The file changed while the Diagnostic was being built; the finding is report-only.'), unstaged_changes_after_publish: t('Final validation found new unstaged changes; the inline Diagnostic was retracted.'), dirty_editor_after_publish: t('Final validation found new unsaved edits; the inline Diagnostic was retracted.'), file_read_failed: t('The working-tree file could not be read; the finding is report-only.')
      }[meta.reason] || t('Inline Diagnostic was not published.');
      lines.push(`   ${t('Problems: {0} — {1}', t('not published'), reasonText)}`);
    } else if (meta?.published) lines.push(`   ${t('Problems: published at {0}:{1}', finding.file, meta.mappedLine)}`);
    lines.push(`   Model confidence: ${Number(finding.modelConfidence ?? finding.confidence ?? 0).toFixed(2)}`);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { buildReviewReport };
