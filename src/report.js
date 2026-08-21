'use strict';

const { t } = require('./i18n');
const { severityPasses, shortFingerprint } = require('./review');

function buildReviewReport(review, options, publishMeta, reviewInputMeta = {}) {
  const visibleFindings = review.findings.filter(
    finding => severityPasses(finding.severity, options.severityThreshold)
  );
  const hiddenCount = review.findings.length - visibleFindings.length;

  const lines = [];
  lines.push(t('Finding verdict: {0}', review.verdict));
  lines.push(t('Quality verdict: {0}', review.qualityVerdict || 'unknown'));
  lines.push(t('Readiness verdict: {0}', review.readinessVerdict || 'needs_evidence'));
  lines.push(t('Mechanical gate: {0}', review.mechanicalGate || 'not_run'));
  lines.push(t('Summary: {0}', review.summary || t('None')));
  lines.push(t('Review policy: {0}', options.policySource));
  lines.push(
    t(
      'Review input: HEAD {0}, index {1}, diff {2}, {3} staged files, {4} bytes',
      shortFingerprint(reviewInputMeta.headOid),
      shortFingerprint(reviewInputMeta.indexFingerprint),
      shortFingerprint(reviewInputMeta.diffFingerprint),
      reviewInputMeta.stagedFileCount ?? 0,
      reviewInputMeta.diffBytes ?? 0
    )
  );
  lines.push(
    t(
      'Review execution: model {0}, Codex CLI {1}',
      reviewInputMeta.model || 'cli-default',
      reviewInputMeta.codexVersion || 'unknown'
    )
  );
  if (reviewInputMeta.unstagedOverlayPaths?.length) {
    lines.push(
      t(
        'Working tree notice: {0} staged files also have unstaged changes; those latest edits were not reviewed: {1}',
        reviewInputMeta.unstagedOverlayPaths.length,
        reviewInputMeta.unstagedOverlayPaths.slice(0, 10).join(', ')
      )
    );
  }
  if (review.policyNotice) lines.push(t('Policy notice: {0}', review.policyNotice));
  if (review.cannotVerify?.length) {
    lines.push(t('Cannot verify from diff:'));
    const labels = {
      requirements: t('Requirement/spec compliance cannot be established from the staged diff alone.'),
      tests: t('Build and test execution were not performed by Codex Review Safe.')
    };
    for (const item of review.cannotVerify) lines.push(`- ${labels[item] || item}`);
  }
  lines.push(
    t(
      'Findings: {0} accepted / {1} model, {2} visible, {3} hidden, {4} rejected',
      review.findings.length,
      review.modelFindingCount ?? review.findings.length,
      visibleFindings.length,
      hiddenCount,
      review.rejectedFindings?.length || 0
    )
  );
  lines.push('');

  if (!visibleFindings.length) {
    lines.push(t('No findings meet the current severity threshold.'));
    if (hiddenCount > 0) {
      lines.push(t('{0} lower-severity findings are hidden by the current threshold.', hiddenCount));
    }
  }

  if (review.rejectedFindings?.length) {
    lines.push(t('Invalid findings returned by the model were rejected individually:'));
    for (const rejected of review.rejectedFindings.slice(0, 10)) {
      lines.push(`- finding[${rejected.index}]: ${rejected.reason}`);
    }
    lines.push('');
  }

  visibleFindings.forEach((finding, index) => {
    lines.push(`${index + 1}. [${finding.severity.toUpperCase()}] [${finding.category}] ${finding.file}:${finding.line}`);
    lines.push(`   ${finding.title}`);
    lines.push(`   ${finding.description}`);
    if (finding.suggestion) lines.push(`   ${t('Suggestion:')} ${finding.suggestion}`);

    const meta = publishMeta?.get(finding);
    if (meta && !meta.published) {
      const reasonText = {
        deleted_file: t('The file is deleted in the staged version and cannot be mapped to the current working tree.'),
        submodule_change: t('This is a submodule pointer change; it is report-only.'),
        binary_file: t('This is a binary file change with no reliable source line; it is report-only.'),
        dirty_editor: t('The file has unsaved editor changes; no inline Diagnostic is published to avoid line drift.'),
        unstaged_changes: t('The file also has unstaged changes; no inline Diagnostic is published to avoid line drift.'),
        rename_without_content_change: t('This is a pure rename with no changed post-image source line.'),
        copy_without_content_change: t('This is a pure copy with no changed post-image source line.'),
        no_added_or_modified_line: t('This diff has no locatable new-file line; the finding is report-only.'),
        line_not_mappable: t('The model line cannot be mapped to a changed line; the finding is report-only.'),
        symlink_outside_repo: t('The real file path escapes the repository through a symlink; the finding is report-only.'),
        file_changed_during_publish: t('The file changed while the Diagnostic was being built; the finding is report-only.'),
        unstaged_changes_after_publish: t('Final validation found new unstaged changes; the inline Diagnostic was retracted.'),
        dirty_editor_after_publish: t('Final validation found new unsaved edits; the inline Diagnostic was retracted.'),
        file_read_failed: t('The working-tree file could not be read; the finding is report-only.')
      }[meta.reason] || t('Inline Diagnostic was not published.');
      lines.push(`   ${t('Problems: {0} — {1}', t('not published'), reasonText)}`);
    } else if (meta?.published) {
      lines.push(`   ${t('Problems: published at {0}:{1}', finding.file, meta.mappedLine)}`);
    }

    lines.push(`   ${t('Confidence: {0}', finding.confidence.toFixed(2))}`);
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = { buildReviewReport };
