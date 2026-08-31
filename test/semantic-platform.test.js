'use strict';

const assert=require('assert');
const fs=require('fs');
const core=require('../src/codex-safe-core/semantic-review');

const evidenceSource=fs.readFileSync('src/semantic-evidence.js','utf8');
const semanticSource=fs.readFileSync('src/semantic-review.js','utf8');
const cacheSource=fs.readFileSync('src/review-cache.js','utf8');
const codexSource=fs.readFileSync('src/codex.js','utf8');
const extensionSource=fs.readFileSync('extension.js','utf8');

const trimDiff=[
  'diff --git a/app.c b/app.c','--- a/app.c','+++ b/app.c','@@ -10,1 +10,3 @@',
  '+VSAPISTRING_Trim(&pcFileName);','+VSHDIOS_MemFree(pcFileName);'
].join('\n');
assert.ok(core.extractCallSymbols(trimDiff).includes('VSAPISTRING_Trim'));
assert.ok(core.extractCallSymbols(trimDiff).includes('VSHDIOS_MemFree'));

const manifest=core.buildEvidenceManifest([
  {kind:'staged',source:'index',path:'app.c',content:'VSAPISTRING_Trim(&pcFileName);\nVSHDIOS_MemFree(pcFileName);',relatedPaths:['app.c']},
  {kind:'symbol-definition',source:'index',path:'modules/api/src/api_utils/api_string.c',symbol:'VSAPISTRING_Trim',content:'VSAPISTRING_TrimLeft(ppcText); VSAPISTRING_TrimRight(ppcText);',relatedPaths:['app.c']},
  {kind:'ownership-contract',source:'index',path:'modules/api/src/api_utils/api_string.c',symbol:'VSAPISTRING_Trim',content:'pcNewString = VSAPISTRING_Duplicate(...); VSHDIOS_MemFree(*ppcText); *ppcText = pcNewString; *ppcText = VSHDIOS_MemRealloc(*ppcText, ...);',relatedPaths:['app.c']}
]);
const ids=manifest.entries.map(item=>item.id);
const contradicted=core.validateEvidenceBackedFinding({
  category:'resource',file:'app.c',line:10,claim:'free may use an interior pointer',claimClass:'invalid-free',rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',
  requiredSymbols:['VSAPISTRING_Trim'],assumptions:['VSAPISTRING_Trim only advances the input pointer'],verificationStatus:'contradicted',evidenceRefs:ids,modelConfidence:0.99
},manifest);
assert.strictEqual(contradicted.publishable,false,'VSAPISTRING_Trim hard negative must never publish after contradictory evidence');
assert.strictEqual(contradicted.evidenceGrade,'X');

const insufficientManifest=core.buildEvidenceManifest([{kind:'staged',source:'index',path:'app.c',content:'VSAPISTRING_Trim(&pcFileName);',relatedPaths:['app.c']}]);
const insufficient=core.validateEvidenceBackedFinding({
  category:'resource',file:'app.c',line:10,claim:'free may use an interior pointer',claimClass:'invalid-free',rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',
  requiredSymbols:['VSAPISTRING_Trim'],assumptions:['VSAPISTRING_Trim only advances the input pointer'],verificationStatus:'verified',evidenceRefs:[insufficientManifest.entries[0].id],modelConfidence:0.99
},insufficientManifest);
assert.strictEqual(insufficient.publishable,false,'0.99 confidence cannot bypass missing semantic evidence');
assert.strictEqual(insufficient.evidenceGrade,'C');

const stableIdA=core.computeStableFindingId({category:'resource',file:'app.c',line:10,rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',claimClass:'invalid-free'});
const stableIdB=core.computeStableFindingId({category:'resource',file:'app.c',line:999,rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',claimClass:'invalid-free',title:'different wording'});
assert.strictEqual(stableIdA,stableIdB);
assert.strictEqual(core.compareFindingSets([{findings:[{stableFindingId:stableIdA,severity:'high',verificationStatus:'verified',evidenceGrade:'B',evidenceDigest:'x'}]},{findings:[{stableFindingId:stableIdB,severity:'high',verificationStatus:'verified',evidenceGrade:'B',evidenceDigest:'x',title:'different wording'}]}]).stable,true);

assert.match(evidenceSource,/\['show', `:\$\{path\}`\]/,'dependency evidence must come from Git Index blobs');
assert.match(evidenceSource,/\['grep','--cached'/,'symbol lookup must be index-pinned');
assert.doesNotMatch(evidenceSource,/fs\.readFileSync/,'semantic dependency evidence must not read working-tree files');
assert.match(semanticSource,/insufficient_evidence/);
assert.match(semanticSource,/contradicted/);
assert.match(codexSource,/hypothesisSchema/);
assert.match(codexSource,/verificationSchema/);
assert.match(extensionSource,/computeReviewSubjectKey/);
assert.match(extensionSource,/createReviewCache/);
assert.match(extensionSource,/createFindingLedger/);
assert.match(extensionSource,/independentReviewStaged/);
assert.match(extensionSource,/result replay: identical ReviewSubject reused without a model call/);
assert.match(extensionSource,/fresh independent model inference completed/);
assert.match(extensionSource,/judgmentContext: resultReplay \? 'replay' : 'blind'/);
assert.doesNotMatch(extensionSource,/forceReviewStaged/,'legacy force-review command must be removed by the hard cut');
assert.doesNotMatch(extensionSource,/suppressUnstableFindings/,'previous judgments must not suppress a fresh reviewer result');
assert.match(cacheSource,/reviewArtifacts\.v2/);
assert.doesNotMatch(cacheSource,/getBySubjectKey/,'v2 cache must not expose the old whole-review semantic cache API');
assert.match(extensionSource,/resolveFinding/);
console.log('Semantic Review independent-review integrity gates passed.');
