'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {
  REVIEW_RECEIPT_SCHEMA_VERSION,
  validateReviewReceipt
} = require('./src/safe-contract');
const { t } = require('./src/i18n');
const {
  PROJECT_RULES_FILE,
  normalizeFsPath,
  normalizeGitPathForComparison,
  clampNumber,
  validateExtraInstructions,
  getUserOnlySetting
} = require('./src/core');
const {
  prepareCommand,
  runProcess
} = require('./src/process');
const {
  git,
  getGitApi,
  getRepositories,
  chooseRepository,
  getStagedDiff,
  getIndexFingerprint,
  getHeadOid,
  getRepositorySnapshot,
  snapshotsEqual,
  getDirtyOpenPathSet,
  parseNameStatusZ,
  getStagedChangeMetadata,
  getBinaryPathSet,
  getSubmodulePathSet,
  getUnmergedPaths,
  getUnstagedPathSet
} = require('./src/git');
const {
  readProjectRulesAtHead,
  getEffectiveOptions
} = require('./src/policy');
const {
  computeVerdict,
  parseChangedLineRanges,
  lineInChangedRanges,
  nearestChangedLine,
  outputSchema,
  buildPrompt,
  parseCodexJsonl,
  normalizeFinding,
  validateReviewResult,
  buildReviewInputMeta,
  createReviewReceipt,
  shortFingerprint,
  severityPasses
} = require('./src/review');
const {
  resolveCodexExecutable,
  probeCodexCapabilities,
  buildCodexArgs,
  runCodexReview,
  isCliCompatibilityError
} = require('./src/codex');

let outputChannel;
let diagnosticCollection;
const diagnosticUrisByRepo = new Map();
const reviewSnapshotsByRepo = new Map();
const reportsByRepo = new Map();
const gitInvalidationTimers = new Map();
let fileWatcher;
let fileWatcherSubscriptions = [];
const activeReviews = new Map();
const reviewReceiptsByRepo = new Map();
let extensionContext;
let nextReviewId = 1;
const RECEIPT_STORAGE_KEY = 'safeCodexReview.receipts.v1';
const MAX_RECEIPTS_PER_REPO = 50;

function log(message) {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function assertTrustedWorkspace() {
  if (!vscode.workspace.isTrusted) {
    throw new Error(t('The current workspace is in Restricted Mode. Trust the workspace before using Codex Review Safe.'));
  }
}

function hasReviewDiagnosticForUri(uri) {
  if (!uri) return false;
  const uriString = uri.toString();
  for (const uris of diagnosticUrisByRepo.values()) {
    if (uris.has(uriString)) return true;
  }
  return false;
}

function clearDiagnosticForUri(uri) {
  if (!diagnosticCollection || !uri) return;
  const uriString = uri.toString();
  diagnosticCollection.delete(uri);

  for (const [repoKey, uris] of diagnosticUrisByRepo.entries()) {
    if (uris.delete(uriString) && uris.size === 0) diagnosticUrisByRepo.delete(repoKey);
  }
  disposeFileWatcherIfUnused();
}

function clearDiagnosticsForRepo(repoRoot, { markReportStale = false } = {}) {
  const key = normalizeFsPath(repoRoot);
  const uris = diagnosticUrisByRepo.get(key);

  if (uris) {
    for (const uriString of uris) {
      diagnosticCollection.delete(vscode.Uri.parse(uriString));
    }
    diagnosticUrisByRepo.delete(key);
  }

  disposeFileWatcherIfUnused();
  reviewSnapshotsByRepo.delete(key);

  if (markReportStale) {
    const report = reportsByRepo.get(key);
    if (report) {
      report.stale = true;
      reportsByRepo.set(key, report);
      refreshOutputChannel();
    }
  }
}

function refreshOutputChannel() {
  outputChannel.clear();

  if (!reportsByRepo.size) {
    outputChannel.appendLine(t('Codex Review Safe: no review report is available.'));
    return;
  }

  for (const report of reportsByRepo.values()) {
    outputChannel.appendLine(
      `===== ${report.repoLabel}${report.stale ? ` [${t('STALE')}]` : ''} =====`
    );
    outputChannel.appendLine(report.text);
    outputChannel.appendLine('');
  }
}

function scheduleRepositorySnapshotValidation(repoRoot) {
  const key = normalizeFsPath(repoRoot);
  const previous = gitInvalidationTimers.get(key);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(async () => {
    gitInvalidationTimers.delete(key);
    const expected = reviewSnapshotsByRepo.get(key);
    if (!expected) return;

    try {
      const current = await getRepositorySnapshot(repoRoot);
      if (!snapshotsEqual(current, expected)) {
        clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
      }
    } catch {
      clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
    }
  }, 250);

  gitInvalidationTimers.set(key, timer);
}

function subscribeRepositoryInvalidation(repo, context) {
  if (!repo?.rootUri?.fsPath || !repo.state?.onDidChange) return;
  context.subscriptions.push(
    repo.state.onDidChange(() => {
      scheduleRepositorySnapshotValidation(repo.rootUri.fsPath);
    })
  );
}

function disposeFileWatcherIfUnused() {
  if ([...diagnosticUrisByRepo.values()].some(uris => uris.size > 0)) return;
  for (const disposable of fileWatcherSubscriptions) { try { disposable.dispose(); } catch {} }
  fileWatcherSubscriptions = [];
  if (fileWatcher) { try { fileWatcher.dispose(); } catch {}; fileWatcher = undefined; }
}

function ensureFileWatcher() {
  if (fileWatcher) return;
  fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fileWatcherSubscriptions = [
    fileWatcher.onDidChange(uri => {
      if (hasReviewDiagnosticForUri(uri)) clearDiagnosticForUri(uri);
    }),
    fileWatcher.onDidDelete(uri => {
      if (hasReviewDiagnosticForUri(uri)) clearDiagnosticForUri(uri);
    })
  ];
}

async function setupInvalidationWatchers(context) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document?.uri?.scheme === 'file') {
        clearDiagnosticForUri(event.document.uri);
      }
    })
  );

  try {
    const api = await getGitApi();
    if (!api) return;

    for (const repo of api.repositories) {
      subscribeRepositoryInvalidation(repo, context);
    }

    context.subscriptions.push(
      api.onDidOpenRepository(repo => subscribeRepositoryInvalidation(repo, context)),
      api.onDidCloseRepository(repo => {
        clearDiagnosticsForRepo(repo.rootUri.fsPath, { markReportStale: true });
      })
    );
  } catch (error) {
    log(`Git invalidation watcher unavailable: ${error?.message || error}`);
  }
}

async function persistReviewReceipt(repoRoot, receipt) {
  const validated = validateReviewReceipt(receipt);
  if (!validated) throw new Error(t('Review receipt is invalid and was not stored.'));
  const key = normalizeFsPath(repoRoot);
  const receipts = [validated, ...(reviewReceiptsByRepo.get(key) || [])]
    .filter((item, index, all) => all.findIndex(other =>
      other.headOid === item.headOid &&
      other.indexFingerprint === item.indexFingerprint &&
      other.diffFingerprint === item.diffFingerprint
    ) === index)
    .slice(0, MAX_RECEIPTS_PER_REPO);
  reviewReceiptsByRepo.set(key, receipts);
  if (extensionContext?.globalState) {
    const stored = Object.fromEntries(reviewReceiptsByRepo);
    await extensionContext.globalState.update(RECEIPT_STORAGE_KEY, stored);
  }
  return validated;
}

function getReviewReceipts(repoRoot) {
  return (reviewReceiptsByRepo.get(normalizeFsPath(repoRoot)) || []).map(item => ({ ...item }));
}

function getLatestReviewReceipt(repoRoot) {
  return getReviewReceipts(repoRoot)[0] || null;
}

function getReviewReceiptStatus(repoRoot, snapshot) {
  const receipt = getLatestReviewReceipt(repoRoot);
  if (!receipt) return { status: 'unavailable', receipt: null };
  const current = Boolean(
    snapshot &&
    receipt.headOid === snapshot.headOid &&
    receipt.indexFingerprint === snapshot.indexFingerprint
  );
  return { status: current ? 'current' : 'stale', receipt };
}

async function getReviewEvidenceForRange(repoRoot, baseRef, headRef = 'HEAD', token) {
  for (const [name, value] of [['baseRef', baseRef], ['headRef', headRef]]) {
    if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid ${name}.`);
    }
  }
  const receipts = getReviewReceipts(repoRoot);
  const { stdout } = await git(['rev-list', '--first-parent', '--reverse', `${baseRef}..${headRef}`, '--'], repoRoot, token);
  const commits = stdout.split(/\r?\n/).filter(Boolean);
  const matched = [];

  for (const commitOid of commits) {
    let parentOid;
    try {
      parentOid = (await git(['rev-parse', `${commitOid}^`], repoRoot, token)).stdout.trim();
    } catch (error) {
      if (error?.code === 'ECANCELLED') throw error;
      continue;
    }
    const candidates = receipts.filter(receipt => receipt.headOid === parentOid);
    if (!candidates.length) continue;
    const { stdout: diff } = await git([
      '-c', 'core.quotePath=false',
      'diff',
      '-M',
      '-C',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=3',
      parentOid,
      commitOid,
      '--'
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
    needsEvidenceCommits: matched.filter(item => item.receipt.readinessVerdict !== 'ready').length,
    matches: matched.map(item => ({ commitOid: item.commitOid, receipt: { ...item.receipt } }))
  };
}

function severityToDiagnostic(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return vscode.DiagnosticSeverity.Error;
    case 'medium':
      return vscode.DiagnosticSeverity.Warning;
    case 'low':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

function safeFileUri(repoRoot, relativeFile) {
  const absolute = path.resolve(repoRoot, relativeFile);
  const normalizedRoot = normalizeFsPath(repoRoot);
  const normalizedAbsolute = normalizeFsPath(absolute);

  if (
    normalizedAbsolute !== normalizedRoot &&
    !normalizedAbsolute.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error(t('Review result path escapes the repository: {0}', relativeFile));
  }
  return vscode.Uri.file(absolute);
}

function realPathContainedInRepo(repoRoot, filePath) {
  try {
    const realRepo = normalizeFsPath(fs.realpathSync.native(repoRoot));
    const realFile = normalizeFsPath(fs.realpathSync.native(filePath));
    return realFile === realRepo || realFile.startsWith(realRepo + path.sep);
  } catch {
    return false;
  }
}

function fileStateToken(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch { return '<missing>'; }
}

async function pruneDiagnosticsAfterPublish(repoRoot, publishMeta, review, diagnosticUris) {
  const currentUnstaged = await getUnstagedPathSet(repoRoot);
  const currentDirty = getDirtyOpenPathSet(repoRoot);
  for (const finding of review.findings) {
    const meta = publishMeta.get(finding);
    if (!meta?.published) continue;
    const file = normalizeGitPathForComparison(finding.file);
    if (currentUnstaged.has(file) || currentDirty.has(file)) {
      const uri = safeFileUri(repoRoot, file);
      diagnosticCollection.delete(uri);
      diagnosticUris.delete(uri.toString());
      meta.published = false;
      meta.reason = currentUnstaged.has(file)
        ? 'unstaged_changes_after_publish'
        : 'dirty_editor_after_publish';
    }
  }
}

async function publishDiagnostics(
  repoRoot,
  review,
  options,
  changedLineRanges,
  unstagedPathSet,
  dirtyOpenPathSet,
  stagedChangeMetadata,
  binaryPathSet,
  submodulePathSet
) {
  clearDiagnosticsForRepo(repoRoot);

  const perFile = new Map();
  const publishMeta = new Map();

  for (const finding of review.findings) {
    if (!severityPasses(finding.severity, options.severityThreshold)) continue;

    const normalizedFile = normalizeGitPathForComparison(finding.file);
    const uri = safeFileUri(repoRoot, normalizedFile);
    const changeMeta = stagedChangeMetadata.get(normalizedFile);
    const isDeleted = changeMeta?.status === 'D' || !fs.existsSync(uri.fsPath);
    const hasUnstagedChanges = unstagedPathSet.has(normalizedFile);
    const hasDirtyEditor = dirtyOpenPathSet.has(normalizedFile);
    const isBinary = binaryPathSet.has(normalizedFile);
    const isSubmodule = submodulePathSet.has(normalizedFile);
    const ranges = changedLineRanges.get(normalizedFile) || [];
    const exactChangedLine = lineInChangedRanges(finding.line, ranges);
    const nearestLine = nearestChangedLine(finding.line, ranges);

    const meta = {
      published: false,
      reason: '',
      mappedLine: finding.line
    };

    if (isDeleted) {
      meta.reason = 'deleted_file';
      publishMeta.set(finding, meta);
      continue;
    }
    if (isSubmodule) {
      meta.reason = 'submodule_change';
      publishMeta.set(finding, meta);
      continue;
    }
    if (isBinary) {
      meta.reason = 'binary_file';
      publishMeta.set(finding, meta);
      continue;
    }
    if (hasDirtyEditor) {
      meta.reason = 'dirty_editor';
      publishMeta.set(finding, meta);
      continue;
    }
    if (hasUnstagedChanges) {
      meta.reason = 'unstaged_changes';
      publishMeta.set(finding, meta);
      continue;
    }
    if (!ranges.length) {
      if (changeMeta?.status === 'R') meta.reason = 'rename_without_content_change';
      else if (changeMeta?.status === 'C') meta.reason = 'copy_without_content_change';
      else meta.reason = 'no_added_or_modified_line';
      publishMeta.set(finding, meta);
      continue;
    }
    if (!exactChangedLine && nearestLine === undefined) {
      meta.reason = 'line_not_mappable';
      publishMeta.set(finding, meta);
      continue;
    }
    if (!realPathContainedInRepo(repoRoot, uri.fsPath)) {
      meta.reason = 'symlink_outside_repo';
      publishMeta.set(finding, meta);
      continue;
    }

    const stateBeforeRead = fileStateToken(uri.fsPath);
    let lines;
    try {
      lines = fs.readFileSync(uri.fsPath, 'utf8').split(/\r?\n/);
    } catch {
      meta.reason = 'file_read_failed';
      publishMeta.set(finding, meta);
      continue;
    }

    const lineNumber = exactChangedLine ? finding.line : nearestLine;
    const startIndex = Math.min(Math.max(1, lineNumber), Math.max(1, lines.length)) - 1;
    const endRequested = Math.max(finding.endLine, lineNumber);
    const endIndex = Math.min(
      Math.max(lineNumber, endRequested),
      Math.max(1, lines.length)
    ) - 1;
    const endCharacter = (lines[endIndex] || '').length;

    const range = new vscode.Range(
      new vscode.Position(startIndex, 0),
      new vscode.Position(endIndex, endCharacter)
    );

    const locationNote = exactChangedLine
      ? ''
      : `\n\n${t('Location note: the model line was outside the changed lines and was mapped to the nearest changed line {0}.', lineNumber)}`;

    const message = finding.suggestion
      ? `${finding.title}\n\n${finding.description}\n\n${t('Suggestion:')} ${finding.suggestion}${locationNote}`
      : `${finding.title}\n\n${finding.description}${locationNote}`;

    const diagnostic = new vscode.Diagnostic(
      range,
      message,
      severityToDiagnostic(finding.severity)
    );
    diagnostic.source = 'Codex Review Safe';
    diagnostic.code = `${finding.category}/${finding.severity}`;

    if (stateBeforeRead !== fileStateToken(uri.fsPath)) {
      meta.reason = 'file_changed_during_publish';
      publishMeta.set(finding, meta);
      continue;
    }

    const key = uri.toString();
    if (!perFile.has(key)) perFile.set(key, { uri, diagnostics: [] });
    perFile.get(key).diagnostics.push(diagnostic);

    meta.published = true;
    meta.mappedLine = lineNumber;
    meta.reason = exactChangedLine ? 'exact' : 'nearest_changed_line';
    publishMeta.set(finding, meta);
  }

  const repoKey = normalizeFsPath(repoRoot);
  const uriSet = new Set();

  for (const { uri, diagnostics } of perFile.values()) {
    diagnosticCollection.set(uri, diagnostics);
    uriSet.add(uri.toString());
  }

  diagnosticUrisByRepo.set(repoKey, uriSet);

  if (uriSet.size > 0) ensureFileWatcher();
  else disposeFileWatcherIfUnused();

  await pruneDiagnosticsAfterPublish(repoRoot, publishMeta, review, uriSet);

  if (uriSet.size === 0) disposeFileWatcherIfUnused();
  return publishMeta;
}

function buildReviewReport(review, options, publishMeta, reviewInputMeta = {}) {
  const visibleFindings = review.findings.filter(
    f => severityPasses(f.severity, options.severityThreshold)
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

  visibleFindings.forEach((f, index) => {
    lines.push(`${index + 1}. [${f.severity.toUpperCase()}] [${f.category}] ${f.file}:${f.line}`);
    lines.push(`   ${f.title}`);
    lines.push(`   ${f.description}`);
    if (f.suggestion) lines.push(`   ${t('Suggestion:')} ${f.suggestion}`);

    const meta = publishMeta?.get(f);
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
      lines.push(`   ${t('Problems: published at {0}:{1}', f.file, meta.mappedLine)}`);
    }

    lines.push(`   ${t('Confidence: {0}', f.confidence.toFixed(2))}`);
    lines.push('');
  });

  return lines.join('\n');
}

function renderOutput(repoRoot, review, options, publishMeta, reviewInputMeta) {
  const repoKey = normalizeFsPath(repoRoot);
  reportsByRepo.set(repoKey, {
    repoLabel: path.basename(repoRoot),
    text: buildReviewReport(review, options, publishMeta, reviewInputMeta),
    stale: false
  });
  refreshOutputChannel();
}

function getStoredReportText(repoRoot) {
  return reportsByRepo.get(normalizeFsPath(repoRoot))?.text || '';
}

function beginReview(repoRoot) {
  const key = normalizeFsPath(repoRoot);
  const previous = activeReviews.get(key);
  if (previous) {
    previous.cancelSource.cancel();
    previous.cancelSource.dispose();
  }

  const state = {
    id: nextReviewId++,
    cancelSource: new vscode.CancellationTokenSource()
  };
  activeReviews.set(key, state);
  return { key, state };
}

function isCurrentReview(key, id) {
  return activeReviews.get(key)?.id === id;
}

function finishReview(key, id) {
  const current = activeReviews.get(key);
  if (current?.id === id) {
    current.cancelSource.dispose();
    activeReviews.delete(key);
  }
}

function linkCancellation(externalToken, internalSource) {
  if (externalToken.isCancellationRequested) {
    internalSource.cancel();
    return { dispose() {} };
  }
  return externalToken.onCancellationRequested(() => internalSource.cancel());
}

async function reviewStaged(commandArgs = []) {
  assertTrustedWorkspace();

  const repositoryInfo = await chooseRepository(commandArgs);
  if (!repositoryInfo) return;

  const repoRoot = repositoryInfo.root;
  const { key, state } = beginReview(repoRoot);
  log('review started');

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.SourceControl,
        title: t('Codex is reviewing Staged Changes…'),
        cancellable: true
      },
      async (_progress, uiToken) => {
        const linked = linkCancellation(uiToken, state.cancelSource);
        const token = state.cancelSource.token;

        try {
          const unmergedPaths = await getUnmergedPaths(repoRoot, token);
          if (unmergedPaths.length) {
            const preview = unmergedPaths.slice(0, 10).join(', ');
            const suffix = unmergedPaths.length > 10
              ? t(' and {0} files total', unmergedPaths.length)
              : '';
            const error = new Error(
              t('Unresolved Git conflicts were detected: {0}{1}. Resolve and stage the conflicts before reviewing.', preview, suffix)
            );
            error.code = 'EUNMERGED';
            throw error;
          }

          const snapshotBefore = await getRepositorySnapshot(repoRoot, token);
          const options = await getEffectiveOptions(repoRoot, snapshotBefore.headOid, token);

          const [diff, stagedChangeMetadata, binaryPathSet, submodulePathSet] = await Promise.all([
            getStagedDiff(repoRoot, token),
            getStagedChangeMetadata(repoRoot, token),
            getBinaryPathSet(repoRoot, token),
            getSubmodulePathSet(repoRoot, token)
          ]);
          const stagedPaths = [...stagedChangeMetadata.keys()];
          const stagedPolicyChange = stagedChangeMetadata.has(PROJECT_RULES_FILE);

          const snapshotAfter = await getRepositorySnapshot(repoRoot, token);
          if (!snapshotsEqual(snapshotBefore, snapshotAfter)) {
            const error = new Error(
              t('Git HEAD or staged changes changed while input was being collected. Review again.')
            );
            error.code = 'EREPOSITORYCHANGED';
            throw error;
          }

          if (!diff.trim()) {
            vscode.window.showInformationMessage(t('There are no staged changes. Stage the changes you want to review first.'));
            return undefined;
          }

          if (stagedPaths.length > 5000) {
            throw new Error(t('There are too many staged files ({0}). Split the review into smaller changes.', stagedPaths.length));
          }

          const diffBytes = Buffer.byteLength(diff, 'utf8');
          if (diffBytes > options.maxDiffBytes) {
            throw new Error(
              t('The staged diff is about {0} KiB and exceeds the {1} KiB limit. Split the commit before reviewing.', Math.ceil(diffBytes / 1024), Math.ceil(options.maxDiffBytes / 1024))
            );
          }

          const changedLineRanges = parseChangedLineRanges(diff);
          const diffFingerprint = crypto.createHash('sha256').update(diff, 'utf8').digest('hex');

          log(`input prepared: files=${stagedPaths.length}, diffBytes=${diffBytes}`);
          const review = await runCodexReview(diff, stagedPaths, options, token);
          return {
            review,
            snapshot: snapshotAfter,
            changedLineRanges,
            stagedChangeMetadata,
            binaryPathSet,
            submodulePathSet,
            stagedPolicyChange,
            diffFingerprint,
            diffBytes,
            options
          };
        } finally {
          linked.dispose();
        }
      }
    );

    if (!result) return;

    if (!isCurrentReview(key, state.id)) {
      log('stale review discarded');
      return;
    }

    const currentSnapshot = await getRepositorySnapshot(repoRoot);
    if (!snapshotsEqual(currentSnapshot, result.snapshot)) {
      log('review discarded: HEAD or staged index changed');
      vscode.window.showWarningMessage(
        t('Git HEAD or staged changes changed during review. The stale result was discarded; review again.')
      );
      return;
    }

    if (!isCurrentReview(key, state.id)) return;

    const currentUnstagedPathSet = await getUnstagedPathSet(repoRoot);
    const dirtyOpenPathSet = getDirtyOpenPathSet(repoRoot);

    const publishMeta = await publishDiagnostics(
      repoRoot,
      result.review,
      result.options,
      result.changedLineRanges,
      currentUnstagedPathSet,
      dirtyOpenPathSet,
      result.stagedChangeMetadata,
      result.binaryPathSet,
      result.submodulePathSet
    );

    const snapshotAfterPublish = await getRepositorySnapshot(repoRoot);
    if (!snapshotsEqual(snapshotAfterPublish, result.snapshot)) {
      clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
      log('review discarded after publish: HEAD or staged index changed');
      vscode.window.showWarningMessage(
        t('Git HEAD or staged changes changed while publishing results. Stale Problems were retracted; review again.')
      );
      return;
    }

    if (result.stagedPolicyChange) {
      result.review.policyNotice = t('{0} is modified in the staged changes. This review still uses the policy from HEAD; the new policy takes effect after commit.', PROJECT_RULES_FILE);
    }
    const reviewInputMeta = buildReviewInputMeta(
      result.snapshot,
      result.diffFingerprint,
      result.diffBytes,
      [...result.stagedChangeMetadata.keys()],
      currentUnstagedPathSet,
      {
        ...result.review.executionMeta,
        policySource: result.options.policySource,
        policyFingerprint: result.options.policyFingerprint
      }
    );
    reviewSnapshotsByRepo.set(normalizeFsPath(repoRoot), result.snapshot);
    const receipt = createReviewReceipt(result.review, reviewInputMeta);
    try {
      await persistReviewReceipt(repoRoot, receipt);
    } catch (error) {
      log(`review receipt persistence unavailable: code=${error?.code || error?.name || 'ERROR'}`);
    }
    renderOutput(repoRoot, result.review, result.options, publishMeta, reviewInputMeta);

    const visibleFindings = result.review.findings.filter(
      f => severityPasses(f.severity, result.options.severityThreshold)
    ).length;
    const hiddenFindings = result.review.findings.length - visibleFindings;

    if (result.review.verdict === 'pass') {
      vscode.window.showInformationMessage(t('Codex Review Safe: no substantive diff issues found; delivery readiness still needs independent evidence.'));
    } else {
      const rejectedCount = result.review.rejectedFindings?.length || 0;
      const allRejected = result.review.findings.length === 0 && rejectedCount > 0;
      const thresholdNote = hiddenFindings > 0
        ? t(', with {0} additional findings below the current threshold', hiddenFindings)
        : '';

      const message = allRejected
        ? t('Codex Review Safe: the model returned {0} findings, but all were rejected by format/path validation. See the report.', rejectedCount)
        : t('Codex Review Safe: {0}; showing {1} findings{2}.', result.review.verdict, visibleFindings, thresholdNote);

      const viewReportAction = t('View Report');
      const openProblemsAction = t('Open Problems');
      void vscode.window.showWarningMessage(
        message,
        viewReportAction,
        openProblemsAction
      ).then(action => {
        if (action === viewReportAction) outputChannel.show(true);
        if (action === openProblemsAction) {
          void vscode.commands.executeCommand('workbench.actions.view.problems');
        }
      }, error => {
        log(`warning notification failed: ${error?.message || error}`);
      });
    }

    log('review completed');
  } finally {
    finishReview(key, state.id);
  }
}

async function clearReview() {
  diagnosticCollection.clear();
  diagnosticUrisByRepo.clear();
  reviewSnapshotsByRepo.clear();
  reportsByRepo.clear();
  reviewReceiptsByRepo.clear();
  if (extensionContext?.globalState) {
    try {
      await extensionContext.globalState.update(RECEIPT_STORAGE_KEY, undefined);
    } catch (error) {
      log(`review receipt cleanup unavailable: code=${error?.code || error?.name || 'ERROR'}`);
    }
  }
  for (const timer of gitInvalidationTimers.values()) clearTimeout(timer);
  gitInvalidationTimers.clear();
  for (const disposable of fileWatcherSubscriptions) { try { disposable.dispose(); } catch {} }
  fileWatcherSubscriptions = [];
  if (fileWatcher) { try { fileWatcher.dispose(); } catch {}; fileWatcher = undefined; }
  outputChannel.clear();
  vscode.window.setStatusBarMessage(`$(check) ${t('Codex Review Safe: review results cleared')}`, 3000);
}

async function checkEnvironment() {
  assertTrustedWorkspace();

  const repositories = await getRepositories();
  const repoRoot = repositories[0]?.root ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    process.cwd();

  const headOid = await getHeadOid(repoRoot);
  const options = await getEffectiveOptions(repoRoot, headOid);
  const resolved = await resolveCodexExecutable(options.codexPath);
  await probeCodexCapabilities(resolved, options.model);
  const { stdout: gitVersion } = await runProcess(
    'git',
    ['--version'],
    { timeoutMs: 10000, prepared: false }
  );

  vscode.window.showInformationMessage(
    t('Codex Review Safe environment is ready: {0}; {1}; required CLI capabilities OK', resolved.version || resolved.executable, gitVersion.trim())
  );
}

function friendlyError(error) {
  const detail = error?.stderr || error?.message || String(error);
  if (error?.code === 'ETIMEDOUT') {
    return t('{0}. Increase safeCodexReview.timeoutSeconds, or check Codex network/login status.', detail);
  }
  return detail;
}

function activate(context) {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Codex Review Safe');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('codex-review-safe');

  context.subscriptions.push(outputChannel, diagnosticCollection);
  const storedReceipts = context.globalState?.get(RECEIPT_STORAGE_KEY, {}) || {};
  for (const [repoKey, receipts] of Object.entries(storedReceipts)) {
    if (!Array.isArray(receipts)) continue;
    const valid = receipts.map(validateReviewReceipt).filter(Boolean).slice(0, MAX_RECEIPTS_PER_REPO);
    if (valid.length) reviewReceiptsByRepo.set(repoKey, valid);
  }
  setupInvalidationWatchers(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('safeCodexReview.reviewStaged', async (...args) => {
      try {
        await reviewStaged(args);
      } catch (error) {
        log(`review failed: code=${error?.code || 'unknown'}`);
        if (error?.code !== 'ECANCELLED') {
          vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error)));
        }
      }
    }),
    vscode.commands.registerCommand('safeCodexReview.clearReview', clearReview),
    vscode.commands.registerCommand('safeCodexReview.showOutput', () => outputChannel.show(true)),
    vscode.commands.registerCommand('safeCodexReview.checkEnvironment', async () => {
      try {
        await checkEnvironment();
      } catch (error) {
        vscode.window.showErrorMessage(t('Codex Review Safe environment check failed: {0}', friendlyError(error)));
      }
    })
  );

  return {
    contractVersion: 1,
    getLatestReviewReceipt,
    getReviewReceipts,
    getReviewReceiptStatus,
    getReviewEvidenceForRange
  };
}

function deactivate() {
  for (const state of activeReviews.values()) {
    state.cancelSource.cancel();
    state.cancelSource.dispose();
  }
  activeReviews.clear();
  diagnosticUrisByRepo.clear();
  reviewSnapshotsByRepo.clear();
  reportsByRepo.clear();
  reviewReceiptsByRepo.clear();
  extensionContext = undefined;
  for (const timer of gitInvalidationTimers.values()) clearTimeout(timer);
  gitInvalidationTimers.clear();
  for (const disposable of fileWatcherSubscriptions) { try { disposable.dispose(); } catch {} }
  fileWatcherSubscriptions = [];
  if (fileWatcher) { try { fileWatcher.dispose(); } catch {}; fileWatcher = undefined; }
}

module.exports = {
  activate,
  deactivate,
  __test: {
    clampNumber,
    validateExtraInstructions,
    getUserOnlySetting,
    prepareCommand,
    parseCodexJsonl,
    buildPrompt,
    buildCodexArgs,
    isCliCompatibilityError,
    probeCodexCapabilities,
    resolveCodexExecutable,
    outputSchema,
    normalizeFinding,
    validateReviewResult,
    severityPasses,
    computeVerdict,
    buildReviewReport,
    buildReviewInputMeta,
    createReviewReceipt,
    persistReviewReceipt,
    getLatestReviewReceipt,
    getReviewReceipts,
    getReviewReceiptStatus,
    getReviewEvidenceForRange,
    shortFingerprint,
    getStoredReportText,
    parseChangedLineRanges,
    parseNameStatusZ,
    lineInChangedRanges,
    nearestChangedLine,
    normalizeGitPathForComparison,
    getUnmergedPaths,
    getStagedDiff,
    readProjectRulesAtHead,
    getEffectiveOptions,
    snapshotsEqual,
    getIndexFingerprint,
    getHeadOid
  }
};
