#!/usr/bin/env python3
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(name): return (ROOT / name).read_text()
def write(name, text): (ROOT / name).write_text(text)
def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    return text.replace(old, new, 1)

# Controller: Scope -> cache key -> raw lineage -> human resolution -> convergence.
p = ROOT / 'extension.js'; s = p.read_text()
s = once(s,
"const { createFindingLedger, RESOLUTION_VALUES } = require('./src/finding-ledger');\nconst { applyResolutionLedger, suppressUnstableFindings } = require('./src/semantic-review');",
"const { createFindingLedger, RESOLUTION_VALUES } = require('./src/finding-ledger');\nconst { loadReviewScope } = require('./src/review-scope');\nconst { createReviewLineageStore, buildReviewSessionKey } = require('./src/review-lineage');\nconst { evaluateConvergence } = require('./src/convergence');\nconst { applyResolutionLedger, suppressUnstableFindings } = require('./src/semantic-review');", 'controller imports')
s = once(s, "let findingLedger;\nlet nextReviewId = 1;", "let findingLedger;\nlet reviewLineage;\nlet nextReviewId = 1;", 'controller lineage state')
s = once(s, "function semanticSubjectKey(snapshot, diffFingerprint, options, analyzerDigest) {", "function semanticSubjectKey(snapshot, diffFingerprint, options, analyzerDigest, scopeFingerprint) {", 'subject key signature')
s = once(s, "    policyFingerprint: options.policyFingerprint, profile: options.profile, analyzerDigest,", "    policyFingerprint: options.policyFingerprint, profile: options.profile, analyzerDigest, scopeFingerprint,", 'subject key scope')
s = once(s, "        const options = await getEffectiveOptions(repoRoot, snapshotBefore.headOid, token);", "        const options = await getEffectiveOptions(repoRoot, snapshotBefore.headOid, token);\n        const scope = await loadReviewScope(repoRoot, snapshotBefore.headOid, token);", 'load scope')
s = once(s, "        const subjectKey = semanticSubjectKey(snapshotAfter, diffFingerprint, options, analyzerDigest);", "        const subjectKey = semanticSubjectKey(snapshotAfter, diffFingerprint, options, analyzerDigest, scope.fingerprint);", 'subject key call')
s = once(s, "            const modelReview = await runCodexReview(diff, stagedPaths, options, token, { semanticEvidence, analyzerFindings, resolutions: [] });", "            const modelReview = await runCodexReview(diff, stagedPaths, options, token, { semanticEvidence, analyzerFindings, resolutions: [], scope });", 'scope into model review')
old = """        rawReview.executionMeta = { ...(rawReview.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest };\n        const review = applyResolutionLedger(rawReview, findingLedger.list(repoRoot), options.language);\n        review.executionMeta = { ...(review.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest };\n        return { rawReview, review, subjectKey, reviewKey, evidenceManifestDigest, cacheHit, snapshot: snapshotAfter, changedLineRanges, stagedChangeMetadata, binaryPathSet, submodulePathSet, stagedPolicyChange, diffFingerprint, diffBytes, diff, options };"""
new = """        rawReview.executionMeta = { ...(rawReview.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest, scopeFingerprint: scope.fingerprint, scopePhase: scope.phase };\n        const sessionKey = buildReviewSessionKey({ headOid: snapshotAfter.headOid, policyFingerprint: options.policyFingerprint, scopeFingerprint: scope.fingerprint, profile: options.profile });\n        const lineage = await reviewLineage.record(repoRoot, { sessionKey, phase: scope.phase, reviewKey, subjectKey, coverageVerdict: rawReview.coverageVerdict, findings: rawReview.findings });\n        const review = applyResolutionLedger(rawReview, findingLedger.list(repoRoot), options.language);\n        review.scope = { present: scope.present, source: scope.source, phase: scope.phase, complexityBudget: scope.complexityBudget, goals: scope.goals, invariants: scope.invariants, nonGoals: scope.nonGoals, managedPaths: scope.managedPaths, fingerprint: scope.fingerprint };\n        review.lineage = lineage;\n        review.convergence = evaluateConvergence(review, lineage, scope);\n        review.executionMeta = { ...(review.executionMeta || {}), reviewKey, cacheHit, evidenceManifestDigest, scopeFingerprint: scope.fingerprint, scopePhase: scope.phase };\n        return { rawReview, review, subjectKey, reviewKey, evidenceManifestDigest, cacheHit, snapshot: snapshotAfter, changedLineRanges, stagedChangeMetadata, binaryPathSet, submodulePathSet, stagedPolicyChange, diffFingerprint, diffBytes, diff, options };"""
s = once(s, old, new, 'lineage convergence materialization')
s = once(s, "  findingLedger = createFindingLedger(context.globalState);\n  findingLedger.restore();", "  findingLedger = createFindingLedger(context.globalState);\n  findingLedger.restore();\n  reviewLineage = createReviewLineageStore(context.globalState);\n  reviewLineage.restore();", 'activate lineage')
s = once(s, "    getFindingResolutions: repoRoot => findingLedger.list(repoRoot)", "    getFindingResolutions: repoRoot => findingLedger.list(repoRoot),\n    getReviewLineage: repoRoot => reviewLineage.list(repoRoot)", 'public lineage api')
s = once(s, "  findingLedger = undefined;", "  findingLedger = undefined;\n  reviewLineage = undefined;", 'deactivate lineage')
p.write_text(s)

# Package/build/test surface.
p = ROOT / 'package.json'; pkg = json.loads(p.read_text())
for file in ['src/review-scope.js','src/review-lineage.js','src/convergence.js','src/causal-anchor.js']:
    marker = f'node --check {file}'
    if marker not in pkg['scripts']['check']:
        pkg['scripts']['check'] = pkg['scripts']['check'].replace(' && node scripts/release.test.js', f' && {marker} && node scripts/release.test.js')
for test in ['test/review-lineage.test.js','test/causal-scope.test.js','test/semantic-corpus.test.js']:
    marker = f'node {test}'
    if marker not in pkg['scripts']['check']:
        pkg['scripts']['check'] = pkg['scripts']['check'].replace(' && npm run build', f' && {marker} && npm run build')
    if marker not in pkg['scripts']['test:unit']:
        pkg['scripts']['test:unit'] += f' && {marker}'
p.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

p = ROOT / 'scripts/build.js'; s = p.read_text()
s = s.replace("'semantic-evidence.js', 'semantic-review.js', 'review-cache.js', 'finding-ledger.js', 'code-intelligence.js'", "'semantic-evidence.js', 'semantic-review.js', 'review-cache.js', 'finding-ledger.js', 'review-scope.js', 'review-lineage.js', 'convergence.js', 'causal-anchor.js', 'code-intelligence.js'")
p.write_text(s)

# Correct module layering: extension owns product orchestration; code-intelligence stays behind semantic-evidence.
p = ROOT / 'scripts/verify-module-boundaries.js'; s = p.read_text()
s = s.replace("'./src/semantic-evidence', './src/semantic-review', './src/review-cache', './src/finding-ledger', './src/code-intelligence']", "'./src/semantic-evidence', './src/semantic-review', './src/review-cache', './src/finding-ledger', './src/review-scope', './src/review-lineage', './src/convergence']")
anchor = "assert.doesNotMatch(fs.readFileSync('src/semantic-evidence.js','utf8'), /fs\\.readFileSync/, 'semantic dependency evidence must never read the working tree');"
if anchor in s and "semantic-evidence must own the code-intelligence provider seam" not in s:
    s = s.replace(anchor, anchor + "\nassert.match(fs.readFileSync('src/semantic-evidence.js','utf8'), /require\\(['\\\"]\\.\\/code-intelligence['\\\"]\\)/, 'semantic-evidence must own the code-intelligence provider seam');\nassert.doesNotMatch(extension, /require\\(['\\\"]\\.\\/src\\/code-intelligence['\\\"]\\)/, 'extension must not bypass semantic-evidence to import code-intelligence directly');\nassert.match(fs.readFileSync('src/semantic-review.js','utf8'), /require\\(['\\\"]\\.\\/causal-anchor['\\\"]\\)/, 'semantic-review must delegate causal anchoring to the headless causal-anchor module');")
p.write_text(s)

# Product docs.
p = ROOT / 'docs/SEMANTIC_REVIEW.md'; s = p.read_text()
if 'Review lineage and Scope Contract' not in s:
    s += "\n\n## Review lineage and Scope Contract\n\nReview 4.2 can read an optional `.codex-review-scope.json` from HEAD and records cross-index Review Lineage inside one HEAD/Policy/Scope/Profile session. See [Review Convergence](REVIEW_CONVERGENCE.md).\n"
p.write_text(s)
p = ROOT / 'docs/SEMANTIC_REVIEW.zh-CN.md'; s = p.read_text()
if 'Review Lineage 与 Scope Contract' not in s:
    s += "\n\n## Review Lineage 与 Scope Contract\n\nReview 4.2 可从 HEAD 读取可选 `.codex-review-scope.json`，并在同一 HEAD/Policy/Scope/Profile Session 内记录跨 index 的 Review Lineage。参见 [Review 收敛机制](REVIEW_CONVERGENCE.zh-CN.md)。\n"
p.write_text(s)

p = ROOT / 'CHANGELOG.md'; s = p.read_text()
needle = '- Add immutable Evidence Manifests, stable ReviewKeys/Finding IDs, same-subject result caching, evidence-scoped human resolutions, Force Re-review stability suppression, and chunk-scoped evidence.'
replacement = needle + '\n- Add HEAD-pinned Scope Contracts, cross-index Review Lineage, changed causal anchors with unchanged supporting locations, convergence metrics, deterministic invariant candidates, and repeated-review hard-positive regression cases.'
if needle in s and 'cross-index Review Lineage' not in s:
    s = s.replace(needle, replacement, 1)
p.write_text(s)

print('Review 4.2 convergence finalizer applied')
