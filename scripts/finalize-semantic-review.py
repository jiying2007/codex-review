#!/usr/bin/env python3
from pathlib import Path
import json,re

ROOT=Path(__file__).resolve().parents[1]
CORE='23830be910c2b313d7679ee2c938cb94a1478b7f'
OLD='0caabb91ad7f2bcedb9f3e5ac50ba4c68a315d46'

def read(name): return (ROOT/name).read_text()
def write(name,text): (ROOT/name).write_text(text)
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit(f'missing marker: {label}')
    if text.count(old)!=1: raise SystemExit(f'non-unique marker {label}: {text.count(old)}')
    return text.replace(old,new,1)

# Extension controller wiring.
p=ROOT/'extension.js'; s=p.read_text()
s=replace_once(s,"const { collectImpactEvidence, loadSarifFiles, importSarifFile, applyValidatedPatch } = require('./src/quality');", "const { loadSarifFiles, importSarifFile, applyValidatedPatch } = require('./src/quality');\nconst { collectSemanticEvidence } = require('./src/semantic-evidence');\nconst { createReviewCache } = require('./src/review-cache');\nconst { createFindingLedger, RESOLUTION_VALUES } = require('./src/finding-ledger');\nconst { applyResolutionLedger, suppressUnstableFindings } = require('./src/semantic-review');\nconst { computeReviewKey, canonicalJson, sha256, SEMANTIC_REVIEW_VERSION, digestAnalyzerEvidence } = require('./src/codex-safe-core/semantic-review');\nconst { REVIEW_PROMPT_CONTRACT_VERSION } = require('./src/codex-safe-core/safe-contract');",'extension imports')
s=replace_once(s,"let reviewReceiptStore;\nlet nextReviewId = 1;", "let reviewReceiptStore;\nlet reviewCache;\nlet findingLedger;\nlet nextReviewId = 1;",'extension state')

start=s.index('async function reviewStaged(')
end=s.index('\nasync function importSarifEvidence',start)
new_review=r'''function reviewOptionsFingerprint(options) {
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
function semanticSubjectKey(snapshot, diffFingerprint, options, analyzerDigest) {
  return sha256(canonicalJson({
    semanticReviewVersion: SEMANTIC_REVIEW_VERSION,
    headOid: snapshot.headOid, indexFingerprint: snapshot.indexFingerprint, diffFingerprint,
    policyFingerprint: options.policyFingerprint, profile: options.profile, analyzerDigest,
    promptContractVersion: REVIEW_PROMPT_CONTRACT_VERSION,
    modelIdentity: `${options.model || 'cli-default'}|${options.fastModel || ''}`,
    optionsFingerprint: reviewOptionsFingerprint(options)
  }));
}

async function reviewStaged(commandArgs = [], { force = false } = {}) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs);
  if (!repositoryInfo) return;
  const repoRoot = repositoryInfo.root;
  const { key, state } = beginReview(repoRoot);
  log(force ? 'force re-review started' : 'review started');
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
        const subjectKey = semanticSubjectKey(snapshotAfter, diffFingerprint, options, analyzerDigest);
        const previousCached = reviewCache.getBySubjectKey(repoRoot, subjectKey);
        let rawReview, reviewKey, evidenceManifestDigest = previousCached?.evidenceManifestDigest || '', cacheHit = false;

        if (previousCached && !force) {
          rawReview = previousCached.review;
          reviewKey = previousCached.reviewKey;
          cacheHit = true;
          log(t('Review cache hit: reused the validated result for the same immutable ReviewKey.'));
        } else {
          log(`input prepared: files=${stagedPaths.length}, rawDiffBytes=${diffBytes}, modelBudgetBytes=${options.maxDiffBytes}`);
          const semanticEvidence = await collectSemanticEvidence(repoRoot, diff, stagedPaths, snapshotAfter, options.profileConfig, analyzerFindings, token, diffFingerprint);
          evidenceManifestDigest = semanticEvidence.manifest.manifestDigest;
          reviewKey = computeReviewKey({
            subject: snapshotAfter, diffFingerprint, policyFingerprint: options.policyFingerprint, profile: options.profile,
            evidenceManifestDigest, analyzerDigest, promptContractVersion: REVIEW_PROMPT_CONTRACT_VERSION,
            modelIdentity: `${options.model || 'cli-default'}|${options.fastModel || ''}`, optionsFingerprint: reviewOptionsFingerprint(options)
          });
          const exactCached = !force ? reviewCache.get(repoRoot, reviewKey) : null;
          if (exactCached) {
            rawReview = exactCached.review; cacheHit = true;
            log(t('Review cache hit: reused the validated result for the same immutable ReviewKey.'));
          } else {
            const modelReview = await runCodexReview(diff, stagedPaths, options, token, { semanticEvidence, analyzerFindings, resolutions: [] });
            rawReview = force && previousCached ? suppressUnstableFindings(previousCached.review, modelReview, options.language) : modelReview;
            if (force && rawReview.stability?.stable === false) {
              log(t('Force re-review detected unstable model findings; unstable findings were suppressed.'));
            } else {
              await reviewCache.put(repoRoot, { subjectKey, reviewKey, evidenceManifestDigest, findingSetDigest: rawReview.findingSetDigest, review: rawReview });
            }
          }
        }
        rawReview.executionMeta = { ...(rawReview.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest };
        const review = applyResolutionLedger(rawReview, findingLedger.list(repoRoot), options.language);
        review.executionMeta = { ...(review.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest };
        return { rawReview, review, subjectKey, reviewKey, evidenceManifestDigest, cacheHit, snapshot: snapshotAfter, changedLineRanges, stagedChangeMetadata, binaryPathSet, submodulePathSet, stagedPolicyChange, diffFingerprint, diffBytes, diff, options };
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
    if (result.stagedPolicyChange) result.review.policyNotice = t('{0} is modified in the staged changes. This review still uses the policy from HEAD; the new policy takes effect after commit.', PROJECT_RULES_FILE);
    const reviewInputMeta = { ...buildReviewInputMeta(result.snapshot, result.diffFingerprint, result.diffBytes, [...result.stagedChangeMetadata.keys()], currentUnstagedPathSet, {
      ...result.review.executionMeta, policySource: result.options.policySource, policyFingerprint: result.options.policyFingerprint
    }), reviewKey: result.reviewKey, cacheHit: result.cacheHit, evidenceManifestDigest: result.evidenceManifestDigest };
    reviewSnapshotsByRepo.set(normalizeFsPath(repoRoot), result.snapshot);
    lastReviewsByRepo.set(normalizeFsPath(repoRoot), { repoRoot, rawReview: result.rawReview, review: result.review, options: result.options, snapshot: result.snapshot, stagedPaths: [...result.stagedChangeMetadata.keys()], diff: result.diff, subjectKey: result.subjectKey, reviewKey: result.reviewKey });
    const receipt = createReviewReceipt(result.review, reviewInputMeta);
    try { await reviewReceiptStore.persist(repoRoot, receipt); }
    catch (error) { log(`review receipt persistence unavailable: code=${error?.code || error?.name || 'ERROR'}`); }
    renderOutput(repoRoot, result.review, result.options, publishMeta, reviewInputMeta);
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
    log(force ? 'force re-review completed' : 'review completed');
  } finally { finishReview(key, state.id); }
}

async function forceReviewStaged(commandArgs = []) { return reviewStaged(commandArgs, { force: true }); }
'''
s=s[:start]+new_review+s[end:]

insert=s.index('\nasync function clearReview()')
resolution_funcs=r'''
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
  vscode.window.showInformationMessage(t('Finding resolution saved. Reusing the cached ReviewKey with the updated ledger.'));
  await reviewStaged(commandArgs, { force:false });
}
async function clearFindingResolutions(commandArgs = []) {
  assertTrustedWorkspace();
  const repositoryInfo = await chooseRepository(commandArgs); if (!repositoryInfo) return;
  await findingLedger.clear(repositoryInfo.root);
  vscode.window.showInformationMessage(t('Finding resolutions cleared.'));
  if (lastReviewsByRepo.has(normalizeFsPath(repositoryInfo.root))) await reviewStaged(commandArgs, { force:false });
}
'''
s=s[:insert]+resolution_funcs+s[insert:]

s=replace_once(s,"  try { await reviewReceiptStore?.clear(); }\n  catch (error) { log(`review receipt cleanup unavailable: code=${error?.code || error?.name || 'ERROR'}`); }", "  try { await reviewReceiptStore?.clear(); await reviewCache?.clear(); }\n  catch (error) { log(`review state cleanup unavailable: code=${error?.code || error?.name || 'ERROR'}`); }",'clear cache')
s=replace_once(s,"function activate(context) {\n  reviewReceiptStore = createReviewReceiptStore(context.globalState);\n  reviewReceiptStore.restore();", "function activate(context) {\n  reviewReceiptStore = createReviewReceiptStore(context.globalState);\n  reviewReceiptStore.restore();\n  reviewCache = createReviewCache(context.globalState);\n  reviewCache.restore();\n  findingLedger = createFindingLedger(context.globalState);\n  findingLedger.restore();",'activate stores')
s=replace_once(s,"    vscode.commands.registerCommand('safeCodexReview.reviewStaged', async (...args) => {\n      try { await reviewStaged(args); }", "    vscode.commands.registerCommand('safeCodexReview.reviewStaged', async (...args) => {\n      try { await reviewStaged(args); }",'review command anchor')
cmd_anchor="    vscode.commands.registerCommand('safeCodexReview.clearReview', clearReview),"
s=replace_once(s,cmd_anchor,"    vscode.commands.registerCommand('safeCodexReview.forceReviewStaged', async (...args) => { try { await forceReviewStaged(args); } catch (error) { if (error?.code !== 'ECANCELLED') vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),\n    vscode.commands.registerCommand('safeCodexReview.resolveFinding', async (...args) => { try { await resolveFinding(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),\n    vscode.commands.registerCommand('safeCodexReview.clearFindingResolutions', async (...args) => { try { await clearFindingResolutions(args); } catch (error) { vscode.window.showErrorMessage(t('Codex Review Safe failed: {0}', friendlyError(error))); } }),\n"+cmd_anchor,'semantic commands')
s=replace_once(s,"    getReviewEvidenceForRange: (repoRoot, baseRef, headRef = 'HEAD', token) => reviewReceiptStore.getEvidenceForRange(repoRoot, baseRef, headRef, token)", "    getReviewEvidenceForRange: (repoRoot, baseRef, headRef = 'HEAD', token) => reviewReceiptStore.getEvidenceForRange(repoRoot, baseRef, headRef, token),\n    getFindingResolutions: repoRoot => findingLedger.list(repoRoot)",'api ledger')
s=replace_once(s,"  reviewReceiptStore?.resetMemory();\n  reviewReceiptStore = undefined;", "  reviewReceiptStore?.resetMemory();\n  reviewReceiptStore = undefined;\n  reviewCache = undefined;\n  findingLedger = undefined;",'deactivate stores')
p.write_text(s)

# Make semantic dependency rendering exclude staged blocks (staged target is supplied once, separately).
p=ROOT/'src/semantic-evidence.js'; s=p.read_text()
s=replace_once(s,"function renderEvidenceForPaths(evidence,paths,{maxBytes=96*1024,maxEntries=32}={}) {\n  const selected=selectEvidenceForPaths(evidence?.manifest?.entries||[],paths,{maxBytes,maxEntries});", "function renderEvidenceForPaths(evidence,paths,{maxBytes=96*1024,maxEntries=32,includeStaged=false}={}) {\n  const sourceEntries=(evidence?.manifest?.entries||[]).filter(entry=>includeStaged||entry.kind!=='staged');\n  const selected=selectEvidenceForPaths(sourceEntries,paths,{maxBytes,maxEntries});",'exclude staged context')
# Optional provider seam: callers may supply discovery locations, but content is always index-rehydrated.
s=s.replace("const { extractImpactSignals, buildImpactEvidenceGraph } = require('./codex-safe-core/quality-platform');", "const { extractImpactSignals, buildImpactEvidenceGraph } = require('./codex-safe-core/quality-platform');\nconst { rehydrateDiscoveryCandidates } = require('./code-intelligence');")
s=s.replace("async function collectSemanticEvidence(repoRoot,diff,stagedPaths,snapshot,profile,analyzerFindings,token,diffFingerprint='') {\n  const [impact,symbols]=await Promise.all([collectIndexImpactEvidence(repoRoot,diff,profile,token),collectIndexSymbolEvidence(repoRoot,diff,stagedPaths,token)]);\n  const raw=[...stagedBlocks(diff),...impactBlocks(impact),...symbols.blocks,...analyzerBlocks(analyzerFindings)];", "async function collectSemanticEvidence(repoRoot,diff,stagedPaths,snapshot,profile,analyzerFindings,token,diffFingerprint='',discoveryCandidates=[]) {\n  const [impact,symbols]=await Promise.all([collectIndexImpactEvidence(repoRoot,diff,profile,token),collectIndexSymbolEvidence(repoRoot,diff,stagedPaths,token)]);\n  const discoveryBlocks=await rehydrateDiscoveryCandidates(discoveryCandidates,{readIndexText:file=>readIndexText(repoRoot,file,token),snippet,classifySymbolLine,relatedPaths:stagedPaths});\n  const raw=[...stagedBlocks(diff),...impactBlocks(impact),...symbols.blocks,...discoveryBlocks,...analyzerBlocks(analyzerFindings)];")
p.write_text(s)

# Package manifest, commands, tests.
pkg_path=ROOT/'package.json'; pkg=json.loads(pkg_path.read_text()); pkg['version']='4.2.0'
activation=pkg['activationEvents']
for command in ['safeCodexReview.forceReviewStaged','safeCodexReview.resolveFinding','safeCodexReview.clearFindingResolutions']:
    event=f'onCommand:{command}'
    if event not in activation: activation.append(event)
commands=pkg['contributes']['commands']
new_commands=[
 {'command':'safeCodexReview.forceReviewStaged','title':'%command.forceReview.title%','category':'%extension.displayName%','icon':'$(sync)'},
 {'command':'safeCodexReview.resolveFinding','title':'%command.resolveFinding.title%','category':'%extension.displayName%','icon':'$(feedback)'},
 {'command':'safeCodexReview.clearFindingResolutions','title':'%command.clearResolutions.title%','category':'%extension.displayName%'}]
for item in new_commands:
    if not any(x['command']==item['command'] for x in commands): commands.append(item)
palette=pkg['contributes']['menus']['commandPalette']
for command in ['safeCodexReview.forceReviewStaged','safeCodexReview.resolveFinding','safeCodexReview.clearFindingResolutions']:
    if not any(x['command']==command for x in palette): palette.append({'command':command,'when':'workspaceFolderCount > 0 && isWorkspaceTrusted'})
checks=['src/semantic-evidence.js','src/semantic-review.js','src/review-cache.js','src/finding-ledger.js','src/code-intelligence.js','src/codex-safe-core/semantic-review.js']
for file in checks:
    marker=f'node --check {file}'
    if marker not in pkg['scripts']['check']: pkg['scripts']['check']=pkg['scripts']['check'].replace(' && node scripts/release.test.js',f' && {marker} && node scripts/release.test.js')
if 'node test/semantic-platform.test.js' not in pkg['scripts']['check']: pkg['scripts']['check']=pkg['scripts']['check'].replace(' && npm run build',' && node test/semantic-platform.test.js && npm run build')
if 'node test/semantic-platform.test.js' not in pkg['scripts']['test:unit']: pkg['scripts']['test:unit'] += ' && node test/semantic-platform.test.js'
pkg_path.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

# NLS command labels.
for name,values in [
 ('package.nls.json',{'command.forceReview.title':'Force Re-review Staged Changes','command.resolveFinding.title':'Resolve Review Finding','command.clearResolutions.title':'Clear Finding Resolutions'}),
 ('package.nls.zh-cn.json',{'command.forceReview.title':'强制重新审查 Staged Changes','command.resolveFinding.title':'处理 Review Finding','command.clearResolutions.title':'清除 Finding Resolution'})]:
    path=ROOT/name; data=json.loads(path.read_text()); data.update(values); path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

# Runtime l10n additions.
en={
 'Review cache hit: reused the validated result for the same immutable ReviewKey.':'Review cache hit: reused the validated result for the same immutable ReviewKey.',
 'Force re-review detected unstable model findings; unstable findings were suppressed.':'Force re-review detected unstable model findings; unstable findings were suppressed.',
 'No completed review with a resolvable finding is available.':'No completed review with a resolvable finding is available.',
 'Select a verified finding to resolve':'Select a verified finding to resolve',
 'Select a resolution':'Select a resolution',
 'Optional resolution note':'Optional resolution note',
 'Finding resolution saved. Reusing the cached ReviewKey with the updated ledger.':'Finding resolution saved. Reusing the cached ReviewKey with the updated ledger.',
 'Finding resolutions cleared.':'Finding resolutions cleared.'}
zh={
 'Review cache hit: reused the validated result for the same immutable ReviewKey.':'Review 缓存命中：复用同一不可变 ReviewKey 的已验证结果。',
 'Force re-review detected unstable model findings; unstable findings were suppressed.':'强制重新 Review 检测到不稳定模型 Finding；不稳定 Finding 已被抑制。',
 'No completed review with a resolvable finding is available.':'没有可处理 Finding 的已完成 Review。',
 'Select a verified finding to resolve':'选择一个已验证 Finding 进行处理',
 'Select a resolution':'选择处理结果',
 'Optional resolution note':'可选的处理备注',
 'Finding resolution saved. Reusing the cached ReviewKey with the updated ledger.':'Finding Resolution 已保存；将使用更新后的 Ledger 复用缓存 ReviewKey。',
 'Finding resolutions cleared.':'Finding Resolution 已清除。'}
for name,values in [('l10n/bundle.l10n.json',en),('l10n/bundle.l10n.zh-cn.json',zh)]:
    path=ROOT/name; data=json.loads(path.read_text()); data.update(values); path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

# Build runtime assets.
p=ROOT/'scripts/build.js'; s=p.read_text()
s=s.replace("'review.js', 'report.js', 'receipts.js', 'codex.js', 'quality.js'", "'review.js', 'report.js', 'receipts.js', 'codex.js', 'quality.js',\n  'semantic-evidence.js', 'semantic-review.js', 'review-cache.js', 'finding-ledger.js', 'code-intelligence.js'")
s=s.replace("'git-repository.js', 'context-builder.js', 'efficiency-planner.js', 'quality-platform.js', 'policy.js', 'review-rules.js'", "'git-repository.js', 'context-builder.js', 'efficiency-planner.js', 'quality-platform.js', 'semantic-review.js', 'policy.js', 'review-rules.js'")
p.write_text(s)

# Quality adapter regression expectations.
p=ROOT/'test/quality-platform.test.js'; s=p.read_text()
s=s.replace("const extension=fs.readFileSync('extension.js','utf8');", "const extension=fs.readFileSync('extension.js','utf8');\nconst semanticEvidence=fs.readFileSync('src/semantic-evidence.js','utf8');\nconst semanticReview=fs.readFileSync('src/semantic-review.js','utf8');")
s=s.replace("assert.match(codex,/formatAnalyzerEvidence/); assert.match(codex,/runCodexPatchProposal/); assert.match(codex,/deterministicSummary/);", "assert.match(codex,/hypothesisSchema/); assert.match(codex,/verificationSchema/); assert.match(codex,/runCodexPatchProposal/); assert.match(codex,/deterministicSummary/);")
s=s.replace("assert.match(quality,/buildImpactEvidenceGraph/); assert.match(quality,/normalizeSarif/); assert.match(quality,/validatePatchProposal/);", "assert.match(quality,/normalizeSarif/); assert.match(quality,/validatePatchProposal/);\nassert.match(semanticEvidence,/git\(\['show'/); assert.match(semanticEvidence,/grep','--cached/); assert.match(semanticReview,/insufficient_evidence/); assert.match(semanticReview,/contradicted/);")
s=s.replace("assert.match(extension,/importSarifEvidence/); assert.match(extension,/generateFixProposal/); assert.match(extension,/showTextDocument/);", "assert.match(extension,/importSarifEvidence/); assert.match(extension,/generateFixProposal/); assert.match(extension,/forceReviewStaged/); assert.match(extension,/resolveFinding/); assert.match(extension,/showTextDocument/);")
p.write_text(s)

# Module boundaries.
p=ROOT/'scripts/verify-module-boundaries.js'; s=p.read_text()
s=s.replace("'./src/receipts', './src/codex', './src/quality']", "'./src/receipts', './src/codex', './src/quality', './src/semantic-evidence', './src/semantic-review', './src/review-cache', './src/finding-ledger', './src/code-intelligence']")
s=s.replace("'efficiency-planner.js','quality-platform.js','policy.js'", "'efficiency-planner.js','quality-platform.js','semantic-review.js','policy.js'")
s=s.replace("`Safe Core v4.4 runtime missing ${name}`", "`Safe Core v4.5 runtime missing ${name}`")
s=s.replace("assert.match(codexModule, /quality-platform/, 'Review profile/analyzer/patch validation must delegate to Core');", "assert.match(codexModule, /quality-platform/, 'Review profile/patch validation must delegate to Core');\nassert.match(codexModule, /semantic-review/, 'Review semantic verification contracts must delegate to Core');\nassert.doesNotMatch(fs.readFileSync('src/semantic-evidence.js','utf8'), /fs\\.readFileSync/, 'semantic dependency evidence must never read the working tree');")
s=s.replace("console.log('Review runtime boundaries verified against Codex Safe Core v4.4 with quality/impact planning, exact-line-only publication and contract manifest.');", "console.log('Review runtime boundaries verified against Codex Safe Core v4.5 with index-pinned semantic evidence, exact-line-only publication and evidence-backed verification.');")
p.write_text(s)

# Security manifest commands/trust.
p=ROOT/'scripts/verify-security-manifest.js'; s=p.read_text()
s=s.replace("requireTrustedWhen(paletteItems, 'safeCodexReview.generateFix');", "requireTrustedWhen(paletteItems, 'safeCodexReview.generateFix');\nrequireTrustedWhen(paletteItems, 'safeCodexReview.forceReviewStaged');\nrequireTrustedWhen(paletteItems, 'safeCodexReview.resolveFinding');\nrequireTrustedWhen(paletteItems, 'safeCodexReview.clearFindingResolutions');")
s=s.replace("assert.match(source, /async function generateFixProposal\\([^)]*\\)\\s*\\{\\s*assertTrustedWorkspace\\(\\);/, 'generateFixProposal must enforce Workspace Trust first');", "assert.match(source, /async function generateFixProposal\\([^)]*\\)\\s*\\{\\s*assertTrustedWorkspace\\(\\);/, 'generateFixProposal must enforce Workspace Trust first');\nassert.match(source, /async function resolveFinding\\([^)]*\\)\\s*\\{\\s*assertTrustedWorkspace\\(\\);/, 'resolveFinding must enforce Workspace Trust first');\nassert.match(source, /async function clearFindingResolutions\\([^)]*\\)\\s*\\{\\s*assertTrustedWorkspace\\(\\);/, 'clearFindingResolutions must enforce Workspace Trust first');")
p.write_text(s)

# Version/identity/docs.
for name in ['package-lock.json']:
    path=ROOT/name; data=json.loads(path.read_text()); data['version']='4.2.0';
    if data.get('packages',{}).get('') is not None: data['packages']['']['version']='4.2.0'
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for name in ['.codex-safe.example.json','scripts/release.test.js']:
    path=ROOT/name
    if path.exists(): path.write_text(path.read_text().replace(OLD,CORE))
for name in ['docs/QUALITY_PLATFORM.md','docs/QUALITY_PLATFORM.zh-CN.md']:
    path=ROOT/name
    if path.exists():
        text=path.read_text().replace('Core 4.4','Core 4.5')
        if 'SEMANTIC_REVIEW' not in text: text += '\n\nSee [Semantic Review](SEMANTIC_REVIEW.md) for index-pinned symbol evidence, evidence-backed verification and repeated-review convergence.\n' if not name.endswith('zh-CN.md') else '\n\n参见 [Semantic Review](SEMANTIC_REVIEW.zh-CN.md)，了解绑定 Git Index 的符号证据、证据验证与重复 Review 收敛。\n'
        path.write_text(text)
p=ROOT/'CHANGELOG.md'; text=p.read_text()
entry='''\n## 4.2.0 - 2026-08-28\n\n### Evidence-centric semantic review\n\n- Bind dependency context to the Git Index, never the unstaged working tree, and resolve ordinary C/C++ call symbols to bounded declaration/definition evidence.\n- Split model work into hypothesis and evidence-verification stages; high model confidence cannot publish an external-semantics finding without supporting evidence.\n- Add immutable Evidence Manifests, stable ReviewKeys/Finding IDs, same-subject result caching, evidence-scoped human resolutions, Force Re-review stability suppression, and chunk-scoped evidence.\n- Add a hard-negative gate for ownership-replacing APIs such as `VSAPISTRING_Trim`, plus an index-safe discovery adapter boundary for future Tree-sitter/SCIP/LSP providers.\n'''
if '\n## 4.2.0 - 2026-08-28\n' not in text: text=text.replace('# Changelog\n','# Changelog\n'+entry,1)
p.write_text(text)

print('Review 4.2 semantic finalizer applied')
