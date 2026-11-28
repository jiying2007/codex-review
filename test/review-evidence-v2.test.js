'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReviewHarness}=require('./helpers/review-pipeline');
const harness=createReviewHarness();
test('staged index function callers and risk evidence are bounded, original and controller-owned',async()=>{
 const before={
   'src/motor.c':'int motor_update(int rpm) { return rpm; }\nvoid control(void) {\n motor_update(2);\n}\n',
   'src/irq.c':'void irq_handler(void) {\n old_irq();\n}\n'
 };
 const after={
   'src/motor.c':'int motor_update(int rpm) { return rpm * 2; }\nvoid control(void) {\n motor_update(2);\n}\n',
   'src/irq.c':'void irq_handler(void) {\n mutex_lock(&motor_lock);\n}\n'
 };
 await harness.withGitFixture(before,after,async({repo,snapshot,diff,paths})=>{
   const opts=harness.options('embedded-mcu');
   const evidence=await harness.collectStructuralEvidence(repo,diff,paths,snapshot,opts.profileConfig);
   assert.ok(evidence.functionImpact.seeds.some(x=>x.name==='motor_update'));
   assert.ok(evidence.functionImpact.edges.every(x=>x.verifiedResolution===false));
   assert.ok(evidence.risk.signals.some(x=>x.ruleId==='irq-blocking'));
   assert.ok(evidence.risk.signals.every(x=>x.disposition==='review_hint_not_defect'));
   harness.respond(async request=>{
     assert.equal(request.phase.startsWith('hypothesis'),true);
     assert.match(request.input,/UNTRUSTED DETERMINISTIC REVIEW HINTS/);
     assert.match(request.input,/motor_update|irq-blocking/);
     return {hypotheses:[]};
   });
   const review=await harness.runCodexReview(diff,paths,opts,undefined,{semanticEvidence:evidence});
   assert.equal(review.findings.length,0);
   assert.equal(review.findingEvidence.incomplete,0);
   assert.equal(review.findingEvidence.automaticallyRemoved,0);
   assert.equal(review.executionMeta.deterministicRiskHints>=1,true);
   assert.equal(review.executionMeta.findingAnchorUnverified,0);
   assert.ok(harness.calls.length>0);
 });
});
test('exact old/new anchors remain fail closed with no suppression',()=>{
 const {verifyFindingEvidence}=require('../src/codex-safe-core/review-evidence-v2');
 const diff=['diff --git a/src/irq.c b/src/irq.c','--- a/src/irq.c',
   '+++ b/src/irq.c','@@ -1 +1 @@','-return;','+mutex_lock(&lock);'].join('\n');
 const highRisk=[
 {file:'src/irq.c',side:'new',line:1,category:'concurrency'},
 {file:'src/irq.c',side:'new',line:2,category:'security'}
 ];
 const proof=verifyFindingEvidence({diff,findings:highRisk});
 assert.equal(proof.verifiedAnchorCount,1);
 assert.equal(proof.incomplete,1);
 assert.equal(proof.findings.length,2);
 assert.equal(proof.automaticallyRemoved,0);
});

test('actual staged review delivers only the structural hints in each split hunk of one file',async()=>{
 const file='src/irq.c';
 const rows=Array.from({length:155},(_,i)=>'  /* fixture row '+i+' */');
 const before=[...rows],after=[...rows];
 for(const [start,name] of [[10,'first'],[105,'second']]){
   for(let i=0;i<22;i++){
     before[start+i]='  old_call_'+name+'_'+i+'(); /* '+'a'.repeat(43)+' */';
     after[start+i]='  new_call_'+name+'_'+i+'(); /* '+'b'.repeat(43)+' */';
   }
   after[start]='  mutex_lock(&'+name+');';
 }
 await harness.withGitFixture({[file]:before.join('\n')+'\n'},{[file]:after.join('\n')+'\n'},async({repo,snapshot,diff,paths})=>{
   const opts={...harness.options('embedded-mcu'),contextBudgetBytes:4096,maxDiffBytes:4096,totalContextBudgetBytes:32768,profileConfig:{...harness.options('embedded-mcu').profileConfig,evidenceFactor:1}};
   const evidence=await harness.collectStructuralEvidence(repo,diff,paths,snapshot,opts.profileConfig);
   assert.equal(evidence.risk.signals.length,2);
   const seen=[];
   harness.respond(async request=>{
     const raw=request.input.match(/--- UNTRUSTED DETERMINISTIC REVIEW HINTS \(NOT PROVEN DEFECTS\) ---\n([^\n]+)\n--- END DETERMINISTIC REVIEW HINTS ---/);
     assert.ok(raw,'structural hints must appear in each delivered hunk');
     const value=JSON.parse(raw[1]);
     assert.equal(value.risk.length,1);
     const target=request.input.split('--- STAGED REVIEW TARGET START ---')[1].split('--- STAGED REVIEW TARGET END ---')[0];
     assert.ok(target.includes(value.risk[0].line===11?'mutex_lock(&first)':'mutex_lock(&second)'));
     seen.push(value.risk[0].line);
     return {hypotheses:[]};
   });
   await harness.runCodexReview(diff,paths,opts,undefined,{semanticEvidence:evidence});
   assert.deepEqual(seen.sort((a,b)=>a-b),[11,106]);
 });
});

test('actual staged binary rename to a text suffix is isolated from model review input',async()=>{
 const sentinel='PRIVATE_BINARY_RENAME_REVIEW_FIXTURE';
 const padding='\0\n'+Array.from({length:300},(_,i)=>'unchanged '+String(i).padStart(4,'0')+'\n').join('');
 const before={'.gitattributes':'* diff\n','firmware/image.BIN':padding+sentinel+'-before\n','src/main.c':'int value(void) { return 0; }\n'};
 const after={'firmware/image.BIN':null,'firmware/image.txt':padding+sentinel+'-after\n','src/main.c':'int value(void) { return 1; }\n'};
 await harness.withGitFixture(before,after,async({repo,snapshot,diff,paths})=>{
   assert.match(diff,/^rename from firmware\/image\.BIN$/m);
   assert.ok(diff.includes(sentinel));
   const opts=harness.options();
   const evidence=await harness.collectStructuralEvidence(repo,diff,paths,snapshot,opts.profileConfig);
   harness.respond(async request=>{
     assert.doesNotMatch(request.input,new RegExp(sentinel));
     return {hypotheses:[]};
   });
   await harness.runCodexReview(diff,paths,opts,undefined,{semanticEvidence:evidence});
   assert.ok(harness.calls.length>0);
   assert.ok(harness.calls.some(request=>request.input.includes('return 1;')));
 });
});
