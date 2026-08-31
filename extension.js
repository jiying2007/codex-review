'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { t } = require('./src/i18n');
const {
  PROJECT_RULES_FILE,
  normalizeFsPath,
  normalizeGitPathForComparison
} = require('./src/review-support');
const { runProcess } = require('./src/process');
const {
  getGitApi,
  getRepositories,
  chooseRepository,
  getStagedDiff,
  getHeadOid,
  getRepositorySnapshot,
  snapshotsEqual,
  getDirtyOpenPathSet,
  getStagedChangeMetadata,
  getBinaryPathSet,
  getSubmodulePathSet,
  getUnmergedPaths,
  getUnstagedPathSet
} = require('./src/git');
const { getEffectiveOptions } = require('./src/policy');
const {
  parseChangedLineRanges,
  lineInChangedRanges,
  buildReviewInputMeta,
  createReviewReceipt,
  severityPasses
} = require('./src/review');
const { buildReviewReport } = require('./src/report');
const { createReviewReceiptStore } = require('./src/receipts');
const {
  resolveCodexExecutable,
  probeCodexCapabilities,
  probeCodexRuntime,
  runCodexReview,
  runCodexPatchProposal,
  isCliCompatibilityError
} = require('./src/codex');
const { loadSarifFiles, importSarifFile, applyValidatedPatch } = require('./src/quality');
const { collectSemanticEvidence } = require('./src/semantic-evidence');
const { createReviewCache } = require('./src/review-cache');
const { createFindingLedger, RESOLUTION_VALUES } = require('./src/finding-ledger');
const { loadReviewScope } = require('./src/review-scope');
const { createReviewLineageStore, buildReviewSessionKey } = require('./src/review-lineage');
const { evaluateConvergence } = require('./src/convergence');
const { applyResolutionLedger } = require('./src/semantic-review');
const { computeReviewKey, canonicalJson, sha256, SEMANTIC_REVIEW_VERSION, digestAnalyzerEvidence } = require('./src/codex-safe-core/semantic-review');
const { REVIEW_PROMPT_CONTRACT_VERSION } = require('./src/codex-safe-core/safe-contract');

const REVIEW_EVIDENCE_PROTOCOL_VERSION = 2;

let outputChannel;
let diagnosticCollection;
const diagnosticUrisByRepo = new Map();
const reviewSnapshotsByRepo = new Map();
const reportsByRepo = new Map();
const gitInvalidationTimers = new Map();
const importedSarifByRepo = new Map();
const lastReviewsByRepo = new Map();
let fileWatcher;
let fileWatcherSubscriptions = [];
const activeReviews = new Map();
let reviewReceiptStore;
let reviewCache;
let findingLedger;
let reviewLineage;
let nextReviewId = 1;

function log(message) {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function uiText(english, chinese) {
  return String(vscode.env?.language || '').toLowerCase().startsWith('zh') ? chinese : english;
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
    for (const uriString of uris) diagnosticCollection.delete(vscode.Uri.parse(uriString));
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
    outputChannel.appendLine(`===== ${report.repoLabel}${report.stale ? ` [${t('STALE')}]` : ''} =====`);
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
      if (!snapshotsEqual(current, expected)) clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
    } catch {
      clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
    }
  }, 250);
  gitInvalidationTimers.set(key, timer);
}

function subscribeRepositoryInvalidation(repo, context) {
  if (!repo?.rootUri?.fsPath || !repo.state?.onDidChange) return;
  context.subscriptions.push(repo.state.onDidChange(() => scheduleRepositorySnapshotValidation(repo.rootUri.fsPath)));
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
    fileWatcher.onDidChange(uri => { if (hasReviewDiagnosticForUri(uri)) clearDiagnosticForUri(uri); }),
    fileWatcher.onDidDelete(uri => { if (hasReviewDiagnosticForUri(uri)) clearDiagnosticForUri(uri); })
  ];
}

async function setupInvalidationWatchers(context) {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document?.uri?.scheme === 'file') clearDiagnosticForUri(event.document.uri);
  }));
  try {
    const api = await getGitApi();
    if (!api) return;
    for (const repo of api.repositories) subscribeRepositoryInvalidation(repo, context);
    context.subscriptions.push(
      api.onDidOpenRepository(repo => subscribeRepositoryInvalidation(repo, context)),
      api.onDidCloseRepository(repo => clearDiagnosticsForRepo(repo.rootUri.fsPath, { markReportStale: true }))
    );
  } catch (error) {
    log(`Git invalidation watcher unavailable: ${error?.message || error}`);
  }
}

function severityToDiagnostic(severity) {
  switch (severity) {
    case 'critical':
    case 'high': return vscode.DiagnosticSeverity.Error;
    case 'medium': return vscode.DiagnosticSeverity.Warning;
    case 'low': return vscode.DiagnosticSeverity.Information;
    default: return vscode.DiagnosticSeverity.Hint;
  }
}

function safeFileUri(repoRoot, relativeFile) {
  const absolute = path.resolve(repoRoot, relativeFile);
  const normalizedRoot = normalizeFsPath(repoRoot);
  const normalizedAbsolute = normalizeFsPath(absolute);
  if (normalizedAbsolute !== normalizedRoot && !normalizedAbsolute.startsWith(normalizedRoot + path.sep)) {
    throw new Error(t('Review result path escapes the repository: {0}', relativeFile));
  }
  return vscode.Uri.file(absolute);
}

function realPathContainedInRepo(repoRoot, filePath) {
  try {
    const realRepo = normalizeFsPath(fs.realpathSync.native(repoRoot));
    const realFile = normalizeFsPath(fs.realpathSync.native(filePath));
    return realFile === realRepo || realFile.startsWith(realRepo + path.sep);
  } catch { return false; }
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
      meta.reason = currentUnstaged.has(file) ? 'unstaged_changes_after_publish' : 'dirty_editor_after_publish';
    }
  }
}

async function publishDiagnostics(repoRoot, review, options, changedLineRanges, unstagedPathSet, dirtyOpenPathSet, stagedChangeMetadata, binaryPathSet, submodulePathSet) {
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
    const meta = { published: false, reason: '', mappedLine: finding.line };
    if (isDeleted) meta.reason = 'deleted_file';
    else if (isSubmodule) meta.reason = 'submodule_change';
    else if (isBinary) meta.reason = 'binary_file';
    else if (hasDirtyEditor) meta.reason = 'dirty_editor';
    else if (hasUnstagedChanges) meta.reason = 'unstaged_changes';
    else if (!ranges.length) meta.reason = changeMeta?.status === 'R' ? 'rename_without_content_change' : changeMeta?.status === 'C' ? 'copy_without_content_change' : 'no_added_or_modified_line';
    else if (!exactChangedLine) meta.reason = 'line_not_mappable';
    else if (!realPathContainedInRepo(repoRoot, uri.fsPath)) meta.reason = 'symlink_outside_repo';
    if (meta.reason) { publishMeta.set(finding, meta); continue; }

    const stateBeforeRead = fileStateToken(uri.fsPath);
    let lines;
    try { lines = fs.readFileSync(uri.fsPath, 'utf8').split(/\r?\n/); }
    catch { meta.reason = 'file_read_failed'; publishMeta.set(finding, meta); continue; }
    const lineNumber = finding.line;
    const startIndex = Math.min(Math.max(1, lineNumber), Math.max(1, lines.length)) - 1;
    const endRequested = Math.max(finding.endLine, lineNumber);
    const endIndex = Math.min(Math.max(lineNumber, endRequested), Math.max(1, lines.length)) - 1;
    const range = new vscode.Range(new vscode.Position(startIndex, 0), new vscode.Position(endIndex, (lines[endIndex] || '').length));
    const message = finding.suggestion
      ? `${finding.title}\n\n${finding.description}\n\n${t('Suggestion:')} ${finding.suggestion}`
      : `${finding.title}\n\n${finding.description}`;
    const diagnostic = new vscode.Diagnostic(range, message, severityToDiagnostic(finding.severity));
    diagnostic.source = 'Codex Review Safe';
    diagnostic.code = `${finding.category}/${finding.severity}`;
    if (stateBeforeRead !== fileStateToken(uri.fsPath)) { meta.reason = 'file_changed_during_publish'; publishMeta.set(finding, meta); continue; }
    const key = uri.toString();
    if (!perFile.has(key)) perFile.set(key, { uri, diagnostics: [] });
    perFile.get(key).diagnostics.push(diagnostic);
    meta.published = true;
    meta.mappedLine = lineNumber;
    meta.reason = 'exact';
    publishMeta.set(finding, meta);
  }
  const repoKey = normalizeFsPath(repoRoot);
  const uriSet = new Set();
  for (const { uri, diagnostics } of perFile.values()) {
    diagnosticCollection.set(uri, diagnostics);
    uriSet.add(uri.toString());
  }
  diagnosticUrisByRepo.set(repoKey, uriSet);
  if (uriSet.size > 0) ensureFileWatcher(); else disposeFileWatcherIfUnused();
  await pruneDiagnosticsAfterPublish(repoRoot, publishMeta, review, uriSet);
  if (uriSet.size === 0) disposeFileWatcherIfUnused();
  return publishMeta;
}

function renderOutput(repoRoot, review, options, publishMeta, reviewInputMeta) {
  const repoKey = normalizeFsPath(repoRoot);
  reportsByRepo.set(repoKey, { repoLabel: path.basename(repoRoot), text: buildReviewReport(review, options, publishMeta, reviewInputMeta), stale: false });
  refreshOutputChannel();
}

function beginReview(repoRoot) {
  const key = normalizeFsPath(repoRoot);
  const previous = activeReviews.get(key);
  if (previous) { previous.cancelSource.cancel(); previous.cancelSource.dispose(); }
  const state = { id: nextReviewId++, cancelSource: new vscode.CancellationTokenSource() };
  activeReviews.set(key, state);
  return { key, state };
}
function isCurrentReview(key, id) { return activeReviews.get(key)?.id === id; }
function finishReview(key, id) {
  const current = activeReviews.get(key);
  if (current?.id === id) { current.cancelSource.dispose(); activeReviews.delete(key); }
}
function linkCancellation(externalToken, internalSource) {
  if (externalToken.isCancellationRequested) { internalSource.cancel(); return { dispose() {} }; }
  return externalToken.onCancellationRequested(() => internalSource.cancel());
}

function reviewOptionsFingerprint(options) {
  const profile = options.profileConfig || {};
  return sha256(canonicalJson({
    semanticReviewVersion: SEMANTIC_REVIEW_VERSION,
    language: options.language,
    profile: options.profile,
    profileConfig: { evidenceFactor: profile.evidenceFactor, tokenFactor: profile.tokenFactor, impactDepth: profile.impactDepth, maxImpactFiles: profile.maxImpactFiles, analyzerMode: profile.analyzerMode, focusCategories: profile.focusCategories },
    model: options.model || '', fastModel: options.fastModel || '',
    maxDiffBytes: options.maxDiffBytes, contextBudgetBytes: options.contextBudgetBytes, totalContextBudgetBytes: options.totalContextBudgetBytes,
    maxTokenBudget: options.maxTokenBudget, maxFindings: options.maxFindings, confidenceThreshold: options.confidenceThreshold,
    extraInstructions: options.extraInstructions || ''
  }));
}
function semanticEvidenceKey(snapshot, diffFingerprint, profileConfig, analyzerDigest) {
  const profile = profileConfig || {};
  return sha256(canonicalJson({
    semanticReviewVersion: SEMANTIC_REVIEW_VERSION,
    reviewEvidenceProtocolVersion: REVIEW_EVIDENCE_PROTOCOL_VERSION,
    headOid: snapshot.headOid,
    indexFingerprint: snapshot.indexFingerprint,
    diffFingerprint,
    analyzerDigest,
    impactDepth: Number(profile.impactDepth || 0),
    maxImpactFiles: Number(profile.maxImpactFiles || 0)
  }));
}
function computeReviewSubjectKey(snapshot, diffFingerprint, options, analyzerDigest, scopeFingerprint, evidenceManifestDigest) {
  const coreReviewKey = computeReviewKey({
    subject: snapshot, diffFingerprint, policyFingerprint: options.policyFingerprint, profile: options.profile,
    evidenceManifestDigest, analyzerDigest, promptContractVersion: REVIEW_PROMPT_CONTRACT_VERSION,
    modelIdentity: `${options.model || 'cli-default'}|${options.fastModel || ''}`, optionsFingerprint: reviewOptionsFingerprint(options)
  });
  return sha256(canonicalJson({ reviewSubjectProtocolVersion: 1, coreReviewKey, scopeFingerprint }));
}

async function reviewStaged(commandArgs = [], { mode = 'standard' } = {}) {
  assertTrustedWorkspace();
  const independent = mode === 'independent';
  const repositoryInfo = await chooseRepository(commandArgs);
  if (!repositoryInfo) return;
  const repoRoot = repositoryInfo.root;
  const { key, state } = beginReview(repoRoot);
  log(independent ? 'independent review started' : 'review started');
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: t('Codex is reviewing Staged Changes…'), cancellable: true }, async (_progress, uiToken) => {
      const linked = linkCancellation(uiToken, state.cancelSource);
      const token = state.cancelSource.token;
      try {
        const unmergedPaths = await getUnmergedPaths(repoRoot, token);
        if (unmergedPaths.length) {
          const preview = unmergedPaths.slice(0, 10).join(', ');
          const suffix = unmergedPaths.length > 10 ? t(' and {0} files total', unmergedPaths.length) : '';
          const error = new Error(t('Unresolved Git conflicts were detected: {0}{1}. Resolve and stage the conflicts before reviewing.', preview, suffix));
          error.code = 'EUNMERGED'; throw error;
        }
        const snapshotBefore = await getRepositorySnapshot(repoRoot, token);
        const options = await getEffectiveOptions(repoRoot, snapshotBefore.headOid, token);
        const scope = await loadReviewScope(repoRoot, snapshotBefore.headOid, token);
        const [diff, stagedChangeMetadata, binaryPathSet, submodulePathSet] = await Promise.all([
          getStagedDiff(repoRoot, token), getStagedChangeMetadata(repoRoot, token), getBinaryPathSet(repoRoot, token), getSubmodulePathSet(repoRoot, token)
        ]);
        const stagedPaths = [...stagedChangeMetadata.keys()];
        const stagedPolicyChange = stagedChangeMetadata.has(PROJECT_RULES_FILE);
        const snapshotAfter = await getRepositorySnapshot(repoRoot, token);
        if (!snapshotsEqual(snapshotBefore, snapshotAfter)) {
          const error = new Error(t('Git HEAD or staged changes changed while input was being collected. Review again.'));
          error.code = 'EREPOSITORYCHANGED'; throw error;
        }
        if (!diff.trim()) { vscode.window.showInformationMessage(t('There are no staged changes. Stage the changes you want to review first.')); return undefined; }
        if (stagedPaths.length > 5000) throw new Error(t('There are too many staged files ({0}). Split the review into smaller changes.', stagedPaths.length));
        const diffBytes = Buffer.byteLength(diff, 'utf8');
        if (diffBytes > 8 * 1024 * 1024) {
          const error = new Error(t('The staged diff exceeds the 8 MiB raw safety ceiling. Split the change before reviewing.'));
          error.code = 'ERAWDIFFTOOLARGE'; throw error;
        }
        const changedLineRanges = parseChangedLineRanges(diff);
        const diffFingerprint = crypto.createHash('sha256').update(diff, 'utf8').digest('hex');
        let configuredSarif = [];
        try { configuredSarif = loadSarifFiles(repoRoot, options.sarifFiles); }
        catch (error) { log(t('Configured SARIF evidence could not be loaded: {0}', error?.message || error)); }
        const analyzerFindings = [...configuredSarif, ...(importedSarifByRepo.get(key) || [])];
        const analyzerDigest = digestAnalyzerEvidence(analyzerFindings);
        const evidenceKey = semanticEvidenceKey(snapshotAfter, diffFingerprint, options.profileConfig, analyzerDigest);
        const sessionKey = buildReviewSessionKey({ headOid: snapshotAfter.headOid, policyFingerprint: options.policyFingerprint, scopeFingerprint: scope.fingerprint, profile: options.profile });
        let rawReview;
        let reviewSubjectKey = '';
        let reviewRunId = '';
        let evidenceManifestDigest = '';
        let semanticEvidence = null;
        let evidenceCacheHit = false;
        let evidenceState = 'fresh';
        let resultReplay = false;
        let originReviewRunId = '';

        const cachedEvidence = reviewCache.getEvidence(repoRoot, evidenceKey);
        if (cachedEvidence) {
          semanticEvidence = cachedEvidence.semanticEvidence;
          evidenceManifestDigest = cachedEvidence.evidenceManifestDigest;
          evidenceCacheHit = true;
          evidenceState = 'cache-hit';
          log('evidence cache hit: deterministic semantic evidence reused');
        } else {
          log(`input prepared: files=${stagedPaths.length}, rawDiffBytes=${diffBytes}, modelBudgetBytes=${options.maxDiffBytes}`);
          semanticEvidence = await collectSemanticEvidence(repoRoot, diff, stagedPaths, snapshotAfter, options.profileConfig, analyzerFindings, token, diffFingerprint);
          evidenceManifestDigest = semanticEvidence.manifest.manifestDigest;
          await reviewCache.putEvidence(repoRoot, { evidenceKey, evidenceManifestDigest, semanticEvidence });
        }

        reviewSubjectKey = computeReviewSubjectKey(snapshotAfter, diffFingerprint, options, analyzerDigest, scope.fingerprint, evidenceManifestDigest);

        if (!independent) {
          const exactReplay = reviewCache.getReplay(repoRoot, reviewSubjectKey);
          if (exactReplay) {
            rawReview = exactReplay.review;
            reviewRunId = exactReplay.reviewRunId;
            originReviewRunId = exactReplay.reviewRunId;
            resultReplay = true;
            log('result replay: validated judgment replayed for the current ReviewSubject');
          }
        }

        if (!resultReplay) {
          reviewRunId = crypto.randomUUID();
          const modelReview = await runCodexReview(diff, stagedPaths, options, token, { semanticEvidence, analyzerFindings, resolutions: [], scope });
          rawReview = modelReview;
          log(independent ? 'fresh independent model inference completed' : 'fresh model inference completed');
        }

        const executionMeta = {
          ...(rawReview.executionMeta || {}),
          reviewSubjectKey,
          reviewRunId,
          executionMode: resultReplay ? 'replay' : independent ? 'independent' : 'standard',
          inference: resultReplay ? 'replay' : 'fresh',
          evidenceCacheHit,
          evidenceState,
          resultReplay,
          originReviewRunId,
          judgmentContext: resultReplay ? 'replay' : 'blind',
          judgmentCacheUsed: resultReplay,
          evidenceManifestDigest,
          scopeFingerprint: scope.fingerprint,
          scopePhase: scope.phase
        };
        rawReview.executionMeta = executionMeta;
        return { rawReview, scope, sessionKey, evidenceKey, reviewSubjectKey, reviewRunId, evidenceManifestDigest, evidenceCacheHit, evidenceState, resultReplay, originReviewRunId, snapshot: snapshotAfter, changedLineRanges, stagedChangeMetadata, binaryPathSet, submodulePathSet, stagedPolicyChange, diffFingerprint, diffBytes, diff, options };
      } finally { linked.dispose(); }
    });
    if (!result) return;
    if (!isCurrentReview(key, state.id)) { log('stale review discarded'); return; }
    const currentSnapshot = await getRepositorySnapshot(repoRoot);
    if (!snapshotsEqual(currentSnapshot, result.snapshot)) {
      log('review discarded: HEAD or staged index changed');
      vscode.window.showWarningMessage(t('Git HEAD or staged changes changed during review. The stale result was discarded; review again.'));
      return;
    }
    if (!isCurrentReview(key, state.id)) return;
    result.review = applyResolutionLedger(result.rawReview, findingLedger.list(repoRoot), result.options.language);
    result.review.scope = { present: result.scope.present, source: result.scope.source, phase: result.scope.phase, complexityBudget: result.scope.complexityBudget, goals: result.scope.goals, invariants: result.scope.invariants, nonGoals: result.scope.nonGoals, managedPaths: result.scope.managedPaths, fingerprint: result.scope.fingerprint };
    result.review.executionMeta = { ...(result.review.executionMeta || {}), ...result.rawReview.executionMeta };
    const currentUnstagedPathSet = await getUnstagedPathSet(repoRoot);
    const dirtyOpenPathSet = getDirtyOpenPathSet(repoRoot);
    const publishMeta = await publishDiagnostics(repoRoot, result.review, result.options, result.changedLineRanges, currentUnstagedPathSet, dirtyOpenPathSet, result.stagedChangeMetadata, result.binaryPathSet, result.submodulePathSet);
    const snapshotAfterPublish = await getRepositorySnapshot(repoRoot);
    if (!snapshotsEqual(snapshotAfterPublish, result.snapshot)) {
      clearDiagnosticsForRepo(repoRoot, { markReportStale: true });
      log('review discarded after publish: HEAD or staged index changed');
      vscode.window.showWarningMessage(t('Git HEAD or staged changes changed while publishing results. Stale Problems were retracted; review again.'));
      return;
    }

    let lineage;
    if (result.resultReplay) {
      lineage = result.rawReview.lineage || reviewLineage.latestForSubject(repoRoot, result.sessionKey, result.reviewSubjectKey)?.lineage || null;
    } else {
      lineage = await reviewLineage.record(repoRoot, {
        sessionKey: result.sessionKey,
        phase: result.scope.phase,
        reviewRunId: result.reviewRunId,
        reviewSubjectKey: result.reviewSubjectKey,
        evidenceKey: result.evidenceKey,
        coverageVerdict: result.rawReview.coverageVerdict,
        findings: result.rawReview.findings,
        executionProvenance: {
          mode: result.rawReview.executionMeta.executionMode,
          inference: 'fresh',
          evidenceCacheHit: result.evidenceCacheHit,
          resultReplay: false,
          judgmentContext: 'blind',
          judgmentCacheUsed: false
        }
      });
    }
    if (lineage) {
      result.review.lineage = lineage;
      result.review.stability = lineage.stability;
    }
    result.review.convergence = evaluateConvergence(result.review, lineage, result.scope);
    if (result.stagedPolicyChange) result.review.policyNotice = t('{0} is modified in the staged changes. This review still uses the policy from HEAD; the new policy takes effect after commit.', PROJECT_RULES_FILE);

    if (!result.resultReplay) {
      result.rawReview.lineage = lineage;
      result.rawReview.stability = lineage?.stability;
      result.rawReview.convergence = evaluateConvergence(result.rawReview, lineage, result.scope);
      try {
        await reviewCache.putReplay(repoRoot, {
          evidenceKey: result.evidenceKey,
          reviewSubjectKey: result.reviewSubjectKey,
          reviewRunId: result.reviewRunId,
          evidenceManifestDigest: result.evidenceManifestDigest,
          findingSetDigest: result.rawReview.findingSetDigest,
          review: result.rawReview
        });
      } catch (error) {
        log(`review replay persistence unavailable: code=${error?.code || error?.name || 'ERROR'}`);
      }
    }

    const reviewInputMeta = {
      ...buildReviewInputMeta(result.snapshot, result.diffFingerprint, result.diffBytes, [...result.stagedChangeMetadata.keys()], currentUnstagedPathSet, {
        ...result.review.executionMeta, policySource: result.options.policySource, policyFingerprint: result.options.policyFingerprint
      }),
      reviewSubjectKey: result.reviewSubjectKey,
      reviewRunId: result.reviewRunId,
      executionMode: result.review.executionMeta.executionMode,
      inference: result.review.executionMeta.inference,
      evidenceCacheHit: result.evidenceCacheHit,
      evidenceState: result.evidenceState,
      resultReplay: result.resultReplay,
      originReviewRunId: result.originReviewRunId,
      judgmentContext: result.review.executionMeta.judgmentContext,
      evidenceManifestDigest: result.evidenceManifestDigest
    };
    reviewSnapshotsByRepo.set(normalizeFsPath(repoRoot), result.snapshot);
    lastReviewsByRepo.set(normalizeFsPath(repoRoot), { repoRoot, rawReview: result.rawReview, review: result.review, options: result.options, snapshot: result.snapshot, stagedPaths: [...result.stagedChangeMetadata.keys()], diff: result.diff, evidenceKey: result.evidenceKey, reviewSubjectKey: result.reviewSubjectKey, reviewRunId: result.reviewRunId });
    if (!result.resultReplay) {
      const receipt = createReviewReceipt(result.review, reviewInputMeta);
      reviewInputMeta.reviewCreatedAt = receipt.createdAt;
      try { await reviewReceiptStore.persist(repoRoot, receipt); }
      catch (error) { log(`review receipt persistence unavailable: code=${error?.code || error?.name || 'ERROR'}`); }
    } else {
      reviewInputMeta.reviewCreatedAt = new Date().toISOString();
    }
    renderOutput(repoRoot, result.review, result.options, publishMeta, reviewInputMeta);

    if (result.resultReplay) {
      const independentAction = uiText('Independent Review', '独立复审');
      const viewReportAction = t('View Report');
      const message = uiText(
        'Codex Review Safe: identical ReviewSubject replayed; no new model inference was executed.',
        'Codex Review Safe：当前 ReviewSubject 与上一轮完全相同，本次仅重放已有结果，没有执行新的模型审查。'
      );
      void vscode.window.showInformationMessage(message, independentAction, viewReportAction).then(action => {
        if (action === independentAction) void vscode.commands.executeCommand('safeCodexReview.independentReviewStaged');
        if (action === viewReportAction) outputChannel.show(true);
      }, error => log(`replay notification failed: ${error?.message || error}`));
    } else if (result.review.lineage?.stability?.compared && result.review.lineage.stability.stable !== true) {
      const viewReportAction = t('View Report');
      const message = uiText(
        'Codex Review Safe: fresh independent judgments disagree or fresh coverage is not consistently complete; convergence remains incomplete and no finding was suppressed only to force agreement.',
        'Codex Review Safe：fresh 独立审查之间存在结论分歧，或 fresh coverage 尚未连续完整；convergence 保持 incomplete，系统不会为了强行一致而压掉 Finding。'
      );
      void vscode.window.showWarningMessage(message, viewReportAction).then(action => {
        if (action === viewReportAction) outputChannel.show(true);
      }, error => log(`stability notification failed: ${error?.message || error}`));
    } else {
      const visibleFindings = result.review.findings.filter(f => severityPasses(f.severity, result.options.severityThreshold)).length;
      const hiddenFindings = result.review.findings.length - visibleFindings;
      if (result.review.verdict === 'pass') {
        vscode.window.showInformationMessage(t('Codex Review Safe: no substantive diff issues found; delivery readiness still needs independent evidence.'));
      } else {
        const rejectedCount = result.review.rejectedFindings?.length || 0;
        const allRejected = result.review.findings.length === 0 && rejectedCount > 0;
        const thresholdNote = hiddenFindings > 0 ? t(', with {0} additional findings below the current threshold', hiddenFindings) : '';
        const message = allRejected
          ? t('Codex Review Safe: the model returned {0} findings, but all were rejected by format/path validation. See the report.', rejectedCount)
          : t('Codex Review Safe: {0}; showing {1} findings{2}.', result.review.verdict, visibleFindings, thresholdNote);
        const viewReportAction = t('View Report'), openProblemsAction = t('Open Problems');
        void vscode.window.showWarningMessage(message, viewReportAction, openProblemsAction).then(action => {
          if (action === viewReportAction) outputChannel.show(true);
          if (action === openProblemsAction) void vscode.commands.executeCommand('workbench.actions.view.problems');
        }, error => log(`warning notification failed: ${error?.message || error}`));
      }
    }
    log(independent ? 'independent review completed' : result.resultReplay ? 'review replay completed' : 'review completed');
  } finally { finishReview(key, state.id); }
}

async function independentReviewStaged(commandArgs = []) { return reviewStaged(commandArgs, { mode: 'independent' }); }

async function importSarifEvidence(commandArgs = []) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs); if (!repositoryInfo) return;
  const repoRoot = repositoryInfo.root, key = normalizeFsPath(repoRoot);
  const picked = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(repoRoot), filters: { SARIF: ['sarif','json'] }, openLabel: t('Select a SARIF file generated by your analyzer or CI') });
  if (!picked?.[0]) return;
  const findings = importSarifFile(repoRoot, picked[0].fsPath);
  importedSarifByRepo.set(key, findings);
  vscode.window.showInformationMessage(t('SARIF evidence imported: {0} findings.', findings.length));
}

async function generateFixProposal(commandArgs = []) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs); if (!repositoryInfo) return;
  const repoRoot = repositoryInfo.root, key = normalizeFsPath(repoRoot), last = lastReviewsByRepo.get(key);
  if (!last?.review?.findings?.length) { vscode.window.showInformationMessage(t('No completed review with actionable findings is available.')); return; }
  const current = await getRepositorySnapshot(repoRoot);
  if (!snapshotsEqual(current, last.snapshot)) { vscode.window.showWarningMessage(t('The reviewed staged snapshot changed. Generate the fix again from a current review.')); return; }
  const items = last.review.findings.map(finding => ({ label: `[${finding.severity.toUpperCase()}] ${finding.title}`, description: `${finding.file}:${finding.line}`, finding }));
  const selected = await vscode.window.showQuickPick(items, { placeHolder: t('Select a finding to generate a fix proposal') }); if (!selected) return;
  const proposal = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Codex is generating a bounded fix proposal…'), cancellable: true }, async (_progress, token) => runCodexPatchProposal(last.diff,last.stagedPaths,last.options,selected.finding,token));
  const document = await vscode.workspace.openTextDocument({ language: 'diff', content: proposal.patch });
  await vscode.window.showTextDocument(document, { preview: true });
  const applyAction=t('Apply Fix');
  const choice=await vscode.window.showWarningMessage(t('Previewed patch proposal touches {0}. Apply it to the working tree?', proposal.touchedPaths.join(', ')), { modal: true }, applyAction);
  if (choice !== applyAction) return;
  const beforeApply=await getRepositorySnapshot(repoRoot);
  if (!snapshotsEqual(beforeApply,last.snapshot)) { vscode.window.showWarningMessage(t('The reviewed staged snapshot changed. Generate the fix again from a current review.')); return; }
  await applyValidatedPatch(repoRoot,proposal,last.stagedPaths);
  const reReview=t('Re-review');
  const next=await vscode.window.showInformationMessage(t('Patch applied to the working tree. Inspect it, stage the intended changes, then re-review.'),reReview);
  if(next===reReview) await vscode.commands.executeCommand('safeCodexReview.reviewStaged');
}

async function resolveFinding(commandArgs = []) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs); if (!repositoryInfo) return;
  const repoRoot = repositoryInfo.root, key = normalizeFsPath(repoRoot), last = lastReviewsByRepo.get(key);
  const candidates = (last?.rawReview?.findings || []).filter(finding => finding.stableFindingId && finding.evidenceDigest && !finding.deterministic);
  if (!candidates.length) { vscode.window.showInformationMessage(t('No completed review with a resolvable finding is available.')); return; }
  const selected = await vscode.window.showQuickPick(candidates.map(finding => ({ label:`[${finding.severity.toUpperCase()}] ${finding.title}`, description:`${finding.file}:${finding.line}`, finding })), { placeHolder:t('Select a verified finding to resolve') });
  if (!selected) return;
  const picked = await vscode.window.showQuickPick(RESOLUTION_VALUES.map(value => ({ label:value, value })), { placeHolder:t('Select a resolution') });
  if (!picked) return;
  const note = await vscode.window.showInputBox({ prompt:t('Optional resolution note'), ignoreFocusOut:true, validateInput:value => value.length > 1000 ? 'Resolution note must not exceed 1000 characters.' : undefined });
  if (note === undefined) return;
  await findingLedger.resolve(repoRoot, { stableFindingId:selected.finding.stableFindingId, evidenceDigest:selected.finding.evidenceDigest, resolution:picked.value, actor:'local-user', note });
  vscode.window.showInformationMessage(uiText(
    'Finding resolution saved. The current ReviewSubject will be replayed with the updated human resolution ledger.',
    'Finding Resolution 已保存；当前 ReviewSubject 会复用原始审查结果，并重新应用更新后的人工 Resolution Ledger。'
  ));
  await reviewStaged(commandArgs, { mode:'standard' });
}
async function clearFindingResolutions(commandArgs = []) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs); if (!repositoryInfo) return;
  await findingLedger.clear(repositoryInfo.root);
  vscode.window.showInformationMessage(t('Finding resolutions cleared.'));
  if (lastReviewsByRepo.has(normalizeFsPath(repositoryInfo.root))) await reviewStaged(commandArgs, { mode:'standard' });
}

async function clearReview() {
  diagnosticCollection.clear();
  diagnosticUrisByRepo.clear();
  reviewSnapshotsByRepo.clear();
  reportsByRepo.clear();
  importedSarifByRepo.clear();
  lastReviewsByRepo.clear();
  try { await reviewReceiptStore?.clear(); await reviewCache?.clear(); }
  catch (error) { log(`review state cleanup unavailable: code=${error?.code || error?.name || 'ERROR'}`); }
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
  const repoRoot = repositories[0]?.root || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const headOid = await getHeadOid(repoRoot);
  const options = await getEffectiveOptions(repoRoot, headOid);
  const runtime = await probeCodexRuntime({ codexPath: options.codexPath, model: options.model, runtime: options.codexRuntime });
  const { stdout: gitVersion } = await runProcess('git', ['--version'], { timeoutMs: 10000, prepared: false });
  const endpoint = runtime.provider.endpointHost || 'Codex default';
  vscode.window.showInformationMessage(t('Codex Review Safe environment is ready: {0}; {1}; provider {2} ({3}); live structured probe {4} ms', runtime.codexVersion || options.codexPath, gitVersion.trim(), runtime.provider.mode, endpoint, runtime.durationMs));
}

function friendlyError(error) {
  const detail = error?.message || error?.stderr || String(error);
  const provider = error?.provider;
  const meta = provider ? ` Provider: ${provider.mode}${provider.endpointHost ? ` @ ${provider.endpointHost}` : ''}.` : '';
  const timing = Number.isFinite(error?.elapsedMs) ? ` Elapsed: ${Math.round(error.elapsedMs / 100) / 10}s${Number.isFinite(error?.lastActivityMs) ? `; last activity ${Math.round(error.lastActivityMs / 100) / 10}s ago` : ''}.` : '';
  const diagnostic = error?.diagnosticTail ? ` Diagnostic: ${String(error.diagnosticTail).slice(-1200)}` : '';
  if (String(error?.code || '').startsWith('ECODEX_')) return `${detail}${meta}${timing}${diagnostic}`;
  return detail;
}

function activate(context) {
  reviewReceiptStore = createReviewReceiptStore(context.globalState);
  reviewReceiptStore.restore();
  reviewCache = createReviewCache(context.globalState);
  reviewCache.restore();
  findingLedger = createFindingLedger(context.globalState);
  findingLedger.restore();
  reviewLineage = createReviewLineageStore(context.globalState);
  reviewLineage.restore();
  outputChannel = vscode.window.createOutputChannel('Codex Review Safe');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('codex-review-safe');
  context.subscriptions.push(outputChannel, diagnosticCollection);
  void Promise.all([reviewCache.purgeLegacy(), reviewLineage.purgeLegacy()]).catch(error => log(`legacy review state cleanup unavailable: code=${error?.code || error?.name || 'ERROR'}`));
  setupInvalidationWatchers(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('safeCodexReview.reviewStaged', async (...args) => {
      try { await reviewStaged(args); }
      catch (error) {
        log(`review failed: code=${error?.code || 'unknown'}`);
        if (error?.code !== 'ECANCELLED') vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error)));
      }
    }),
    vscode.commands.registerCommand('safeCodexReview.independentReviewStaged', async (...args) => { try { await independentReviewStaged(args); } catch (error) { if (error?.code !== 'ECANCELLED') vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),
    vscode.commands.registerCommand('safeCodexReview.resolveFinding', async (...args) => { try { await resolveFinding(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),
    vscode.commands.registerCommand('safeCodexReview.clearFindingResolutions', async (...args) => { try { await clearFindingResolutions(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),
    vscode.commands.registerCommand('safeCodexReview.clearReview', clearReview),
    vscode.commands.registerCommand('safeCodexReview.showOutput', () => outputChannel.show(true)),
    vscode.commands.registerCommand('safeCodexReview.importSarif', async (...args) => { try { await importSarifEvidence(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),
    vscode.commands.registerCommand('safeCodexReview.generateFix', async (...args) => { try { await generateFixProposal(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),
    vscode.commands.registerCommand('safeCodexReview.checkEnvironment', async () => {
      try { await checkEnvironment(); }
      catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe environment check failed: {0}', friendlyError(error))); }
    })
  );
  return {
    contractVersion: 2,
    getLatestReviewReceipt: repoRoot => reviewReceiptStore.getLatest(repoRoot),
    getReviewReceipts: repoRoot => reviewReceiptStore.getReceipts(repoRoot),
    getReviewReceiptStatus: (repoRoot, snapshot) => reviewReceiptStore.getStatus(repoRoot, snapshot),
    getReviewEvidenceForRange: (repoRoot, baseRef, headRef = 'HEAD', token) => reviewReceiptStore.getEvidenceForRange(repoRoot, baseRef, headRef, token),
    getFindingResolutions: repoRoot => findingLedger.list(repoRoot),
    getReviewLineage: repoRoot => reviewLineage.list(repoRoot)
  };
}

function deactivate() {
  for (const state of activeReviews.values()) { state.cancelSource.cancel(); state.cancelSource.dispose(); }
  activeReviews.clear();
  diagnosticUrisByRepo.clear();
  reviewSnapshotsByRepo.clear();
  reportsByRepo.clear();
  reviewReceiptStore?.resetMemory();
  reviewReceiptStore = undefined;
  reviewCache = undefined;
  findingLedger = undefined;
  reviewLineage = undefined;
  for (const timer of gitInvalidationTimers.values()) clearTimeout(timer);
  gitInvalidationTimers.clear();
  for (const disposable of fileWatcherSubscriptions) { try { disposable.dispose(); } catch {} }
  fileWatcherSubscriptions = [];
  if (fileWatcher) { try { fileWatcher.dispose(); } catch {}; fileWatcher = undefined; }
}

module.exports = { activate, deactivate };
