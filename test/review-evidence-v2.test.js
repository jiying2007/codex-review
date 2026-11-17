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
