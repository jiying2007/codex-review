'use strict';

const assert=require('assert');
const fs=require('fs');
const Module=require('module');
const core=require('../src/codex-safe-core/semantic-review');

const evidenceSource=fs.readFileSync('src/semantic-evidence.js','utf8');
const semanticSource=fs.readFileSync('src/semantic-review.js','utf8');
const cacheSource=fs.readFileSync('src/review-cache.js','utf8');
const codexSource=fs.readFileSync('src/codex.js','utf8');
const extensionSource=fs.readFileSync('extension.js','utf8');

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='vscode') return {
    extensions:{getExtension:()=>undefined},
    workspace:{workspaceFolders:[],textDocuments:[]},
    window:{},
    l10n:{t:(message,...args)=>String(message).replace(/\{(\d+)\}/g,(_match,index)=>args[Number(index)]===undefined?`{${index}}`:String(args[Number(index)]))}
  };
  return originalLoad.call(this,request,parent,isMain);
};
const productSemantic=require('../src/semantic-review');
const {renderEvidenceForPaths}=require('../src/semantic-evidence');
Module._load=originalLoad;

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

const localHypothesis={category:'correctness',claim:'changed condition is inverted',claimClass:'bounds',rootCauseSymbol:'',requiredSymbols:[],assumptions:[],supportingLocations:[],file:'app.c'};
const omittedDependency={category:'resource',claim:'free may invalidate ownership after the call',claimClass:'invalid-free',rootCauseSymbol:'',requiredSymbols:[],assumptions:[],supportingLocations:[],file:'app.c'};
assert.strictEqual(productSemantic.requiresIndependentVerification(localHypothesis),false,'strictly local correctness can remain controller-auto-verifiable');
assert.strictEqual(productSemantic.requiresIndependentVerification(omittedDependency),true,'semantic category/text must force verification even when the model omits requiredSymbols and assumptions');
const stagedManifest={manifest:{entries:[{id:'staged-app',kind:'staged',path:'app.c'}]},callSymbolsByPath:new Map(),blocks:[]};
const prepared=productSemantic.prepareVerification([localHypothesis,omittedDependency],stagedManifest);
assert.strictEqual(prepared.automatic.length,1);
assert.strictEqual(prepared.needsModel.length,1);
assert.strictEqual(prepared.needsModel[0].hypothesisIndex,1);

const stableIdA=core.computeStableFindingId({category:'resource',file:'app.c',line:10,rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',claimClass:'invalid-free'});
const stableIdB=core.computeStableFindingId({category:'resource',file:'app.c',line:999,rootCauseSymbol:'VSAPISTRING_Trim',anchorContextDigest:'trim-call',claimClass:'invalid-free',title:'different wording'});
assert.strictEqual(stableIdA,stableIdB);
assert.strictEqual(core.compareFindingSets([{findings:[{stableFindingId:stableIdA,severity:'high',verificationStatus:'verified',evidenceGrade:'B',evidenceDigest:'x'}]},{findings:[{stableFindingId:stableIdB,severity:'high',verificationStatus:'verified',evidenceGrade:'B',evidenceDigest:'x',title:'different wording'}]}]).stable,true);

assert.match(evidenceSource,/\['show', `:\$\{path\}`\]/,'dependency evidence must come from Git Index blobs');
assert.match(evidenceSource,/\['grep','--cached'/,'symbol lookup must be index-pinned');
assert.doesNotMatch(evidenceSource,/fs\.readFileSync/,'semantic dependency evidence must not read working-tree files');
assert.match(semanticSource,/insufficient_evidence/);
assert.match(semanticSource,/contradicted/);
assert.match(semanticSource,/requiresIndependentVerification/);
assert.match(codexSource,/hypothesisSchema/);
assert.match(codexSource,/verificationSchema/);
assert.match(codexSource,/HYPOTHESIS_RETRY_LIMIT = 1/);
assert.match(codexSource,/hypothesis-retry:/);
assert.match(codexSource,/repaired\.rejected\.length<validated\.rejected\.length/);
assert.match(extensionSource,/computeReviewSubjectKey/);
assert.match(extensionSource,/structuralEvidenceKey/);
assert.match(extensionSource,/REVIEW_EVIDENCE_PROTOCOL_VERSION = 5/);
assert.match(extensionSource,/findingAnchorVerifierVersion: 1/);
assert.match(codexSource,/verifyFindingEvidence/);
assert.match(evidenceSource,/buildFunctionImpactEvidence/);
assert.match(evidenceSource,/buildReviewRiskEvidence/);
assert.match(extensionSource,/createReviewCache/);
assert.match(extensionSource,/createReplayWindow/);
assert.match(extensionSource,/replayWindow\.tryReplay/);
assert.match(extensionSource,/fresh blind model inference completed/);
assert.match(extensionSource,/judgmentContext: resultReplay \? 'replay' : 'blind'/);
assert.doesNotMatch(extensionSource,/independentReviewStaged/,'Independent Review user/runtime concept must be removed');
assert.doesNotMatch(extensionSource,/forceReviewStaged/,'legacy force-review command must remain removed');
assert.doesNotMatch(extensionSource,/suppressUnstableFindings/,'previous judgments must not suppress a fresh reviewer result');
assert.match(evidenceSource,/collectStructuralEvidence/);
assert.match(evidenceSource,/composeSemanticEvidence/);
assert.match(cacheSource,/evidenceCache\.v3/);
assert.doesNotMatch(cacheSource,/putReplay|getReplay|reviewSubjectKey/,'persistent Evidence Cache must never contain judgment replay');
const replaySource=fs.readFileSync('src/replay-window.js','utf8');
assert.match(replaySource,/MAX_CONSECUTIVE_REPLAYS=2/);
assert.match(replaySource,/MAX_REPLAY_AGE_MS=10\*60\*1000/);
assert.match(extensionSource,/resolveFinding/);

const missingStaged=productSemantic.prepareVerification([localHypothesis],{manifest:{entries:[]},callSymbolsByPath:new Map(),blocks:[]});
assert.strictEqual(missingStaged.automatic[0].verificationStatus,'insufficient_evidence','missing causal evidence must not be auto-verified');
assert.strictEqual(missingStaged.needsModel.length,0,'do not spend model tokens without causal evidence');
const missingRequired={...localHypothesis,requiredSymbols:['required_api']};
const partiallySupplied=productSemantic.prepareVerification([missingRequired],{
  manifest:{entries:[{id:'staged-app',kind:'staged',path:'app.c'},{id:'different-symbol',kind:'symbol-definition',symbol:'unrelated_api',path:'app.c'}]},
  callSymbolsByPath:new Map(),blocks:[]
});
assert.strictEqual(partiallySupplied.automatic[0].verificationStatus,'insufficient_evidence','each required symbol must have evidence');
assert.strictEqual(partiallySupplied.needsModel.length,0);

const claim={hypothesisIndex:0,stagedRef:'E-staged',hypothesis:{requiredSymbols:['required_api']},symbolRefs:[{id:'E-api',symbol:'required_api'}]};
const supplied=[{id:'E-staged',kind:'staged',path:'app.c'},{id:'E-api',kind:'symbol-definition',symbol:'required_api',path:'app.c'}];
const verifiedOutput=evidenceRefs=>({results:[{hypothesisIndex:0,verificationStatus:'verified',evidenceRefs,verificationReason:'checked'}]});
assert.equal(productSemantic.validateVerificationResult(verifiedOutput(['E-staged','E-api']),[claim],supplied)[0].verificationStatus,'verified');
assert.equal(productSemantic.validateVerificationResult(verifiedOutput(['E-api']),[claim],supplied)[0].verificationStatus,'insufficient_evidence','staged citation is mandatory');
assert.equal(productSemantic.validateVerificationResult(verifiedOutput(['E-staged']),[claim],supplied)[0].verificationStatus,'insufficient_evidence','required symbol citation is mandatory');
assert.equal(productSemantic.validateVerificationResult(verifiedOutput(['E-staged','E-api','fake']),[claim],supplied)[0].verificationStatus,'insufficient_evidence','undelivered citation cannot verify a claim');
assert.equal(productSemantic.validateVerificationResult({results:[{hypothesisIndex:0,verificationStatus:'contradicted',evidenceRefs:['E-api'],verificationReason:'checked'}]},[claim],supplied)[0].verificationStatus,'insufficient_evidence','contradictions must cite causal evidence');
assert.equal(productSemantic.validateVerificationResult(verifiedOutput(['E-staged','E-api']),[claim],[])[0].verificationStatus,'insufficient_evidence','manifest-only evidence cannot be cited without delivery');

const delivery=renderEvidenceForPaths({
  manifest:manifest,
  blocks:manifest.entries.map((entry,index)=>({entry,content:['VSAPISTRING_Trim(&pcFileName);','int VSAPISTRING_Trim(...);','char* duplicated = ...;'][index]}))
},['app.c'],{includeStaged:true,maxBytes:160*1024,maxEntries:64,requiredIds:ids});
assert.deepStrictEqual(delivery.missingRequiredIds,[]);
assert.equal(delivery.entries.length,3);
assert.match(delivery.text,/EVIDENCE/);
const noBlocks=renderEvidenceForPaths({manifest,blocks:[]},['app.c'],{includeStaged:true,requiredIds:ids});
assert.equal(noBlocks.entries.length,0);
assert.deepStrictEqual(new Set(noBlocks.missingRequiredIds),new Set(ids));

assert.match(codexSource,/includeStaged:true,requiredIds/,'verifier must receive actual staged evidence under bound budget');
assert.match(codexSource,/verificationEvidence\.entries/,'verifier results must validate against delivered IDs');
assert.match(codexSource,/verification_evidence_budget/,'missing bounded evidence cannot be a clean pass');
assert.match(codexSource,/if\(eligible\.length\)/,'do not spend tokens on candidates with missing mandatory citations');
assert.match(semanticSource,/verification_incomplete:/,'insufficient evidence must become a coverage gap');

console.log('Semantic Review adaptive-replay integrity gates passed.');

// Git paths are opaque identities; no causal evidence may cross a slash/backslash alias.
const rawIdentityManifest=core.buildEvidenceManifest([
  {kind:'staged',source:'index',path:'x\\y.c',content:'left();',relatedPaths:['x\\y.c']},
  {kind:'staged',source:'index',path:'x/y.c',content:'right();',relatedPaths:['x/y.c']}
]);
assert.deepStrictEqual(rawIdentityManifest.entries.map(item=>item.path).sort(),['x/y.c','x\\y.c'].sort());
assert.notStrictEqual(core.computeStableFindingId({...localHypothesis,file:'x\\y.c'}),core.computeStableFindingId({...localHypothesis,file:'x/y.c'}));
assert.strictEqual(productSemantic.stagedEvidenceRef(rawIdentityManifest,'x\\y.c').path,'x\\y.c');
const onlySlash={manifest:core.buildEvidenceManifest([{kind:'staged',source:'index',path:'x/y.c',content:'left();'}]),callSymbolsByPath:new Map(),blocks:[]};
assert.strictEqual(productSemantic.prepareVerification([{...localHypothesis,file:'x\\y.c'}],onlySlash).automatic[0].verificationStatus,'insufficient_evidence');
const {snapshotFinding,transitionBetween:rawTransition}=require('../src/review-lineage');
const rawBefore=snapshotFinding({stableFindingId:'old',file:'x\\y.c'}),rawAfter=snapshotFinding({stableFindingId:'new',file:'x/y.c'});
assert.strictEqual(rawBefore.file,'x\\y.c');
assert.deepStrictEqual(rawTransition([rawBefore],[rawAfter]).likelyFixInducedIds,[]);
