'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planStagedReview}=require('../src/codex');
const {buildPrompt,parseChangedLineRanges,normalizeFinding}=require('../src/review');

const files=[
 ['src/motor.c','-old','+#include "motor.h"'],
 ['docs/readme.md','-old','+new'],
 ['include/motor.h','-old','+int motor_run(void);'],
 ['tests/motor_test.c','-old','+assert(motor_run()==0);']
];
const diff=files.map(([path,old,newLine])=>[
 'diff --git a/'+path+' b/'+path,'--- a/'+path,'+++ b/'+path,
 '@@ -1 +1 @@',old,newLine].join('\n')).join('\n');

test('semantic staged plan deterministically schedules related files together with no LLM',()=>{
 const options={profile:'embedded',contextBudgetBytes:4096,maxDiffBytes:4096,totalContextBudgetBytes:8192};
 const plan=planStagedReview(diff,options);
 assert.equal(plan.preview.modelCalls,0);
 assert.equal(plan.preview.fileCount,4);
 assert.equal(plan.preview.unplannedFiles,0);
 assert.equal(plan.preview.plannedFiles,4);
 assert.equal(plan.preview.complete,true);
 assert.deepEqual(plan.semanticGroups[0].paths,
   ['src/motor.c','include/motor.h','tests/motor_test.c']);
 assert.deepEqual(planStagedReview(diff,options).preview,plan.preview);
 assert.equal(plan.evidence.chunks.length,1);
});

test('huge indivisible changed line is reported as a gap and cannot falsely pass preview',()=>{
 const longDiff=[
   'diff --git a/src/huge.c b/src/huge.c',
   '--- a/src/huge.c','+++ b/src/huge.c',
   '@@ -0,0 +1 @@','+'+'x'.repeat(9000)
 ].join('\n');
 const result=planStagedReview(longDiff,{maxDiffBytes:4096,contextBudgetBytes:4096});
 assert.equal(result.preview.complete,false);
 assert.equal(result.evidence.complete,false);
 assert.ok(result.coverageGaps.some(x=>x.includes('hunk_exceeds_budget')));
 assert.equal(result.preview.modelCalls,0);
});

test('file-scoped rules are trusted and model-provided float/rounded line is rejected',()=>{
 const options={language:'en',confidenceThreshold:0.7,extraInstructions:''};
 const text=buildPrompt(options,['src/motor.c'],0,1);
 assert.match(text,/motor-control/);
 const ranges=parseChangedLineRanges([
  'diff --git a/src/a.c b/src/a.c','--- a/src/a.c','+++ b/src/a.c',
  '@@ -1 +1 @@','-old','+new'
 ].join('\n'));
 const candidate={severity:'high',category:'correctness',file:'src/a.c',
   side:'new',line:1,endLine:1,title:'Bug',description:'Test',suggestion:'',confidence:0.9};
 assert.equal(normalizeFinding(candidate,new Set(['src/a.c']),ranges).line,1);
 for(const wrong of [{line:'1'},{line:1.7},{endLine:1.1},{endLine:99}]){
   assert.throws(()=>normalizeFinding({...candidate,...wrong},new Set(['src/a.c']),ranges),/changed line|report-only/i);
 }
});
