'use strict';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return { workspace:{}, window:{}, extensions:{}, languages:{}, scm:{}, Uri:{file:x=>({fsPath:x,toString:()=>x})}, Range:class{}, Position:class{}, Diagnostic:class{}, DiagnosticSeverity:{Error:0,Warning:1,Information:2,Hint:3} };
  }
  return originalLoad.apply(this, arguments);
};

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { __test } = require('./extension.js');
const pkg = require('./package.json');

(async () => {
  assert.strictEqual(__test.severityPasses('high','medium'), true);
  assert.strictEqual(__test.severityPasses('low','medium'), false);
  const schema = __test.outputSchema({maxFindings:12});
  assert.strictEqual(schema.properties.findings.maxItems,12);

  const staged=['src/a.c'];
  const result=__test.validateReviewResult({summary:'存在一个边界问题',findings:[{severity:'medium',category:'correctness',file:'src/a.c',line:10,endLine:10,title:'边界判断错误',description:'条件会漏掉零值。',suggestion:'显式处理零值。',confidence:0.9}]},{maxFindings:40},staged);
  assert.strictEqual(result.findings[0].file,'src/a.c');
  const partiallyRejected=__test.validateReviewResult({summary:'',findings:[{severity:'high',category:'correctness',file:'../outside.c',line:1,endLine:1,title:'x',description:'x',suggestion:'',confidence:1},{severity:'medium',category:'correctness',file:'src/a.c',line:10,endLine:10,title:'有效问题',description:'有效描述',suggestion:'',confidence:0.8}]},{maxFindings:40},staged);
  assert.strictEqual(partiallyRejected.findings.length,1);
  assert.strictEqual(partiallyRejected.rejectedFindings.length,1);
  assert.strictEqual(partiallyRejected.verdict,'needs_attention');

  const jsonl=[JSON.stringify({type:'thread.started'}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'ok',findings:[]})}})].join('\n');
  assert.strictEqual(JSON.parse(__test.parseCodexJsonl(jsonl)).summary,'ok');

  const englishPrompt=__test.buildPrompt({language:'en',extraInstructions:''},['src/a.c']);
  assert.match(englishPrompt,/You are a strict code reviewer/);
  assert.match(englishPrompt,/Write summary, title, description, and suggestion in English/);
  assert.doesNotMatch(englishPrompt,/你是严格的代码审查器/);

  const chinesePrompt=__test.buildPrompt({language:'zh-CN',extraInstructions:''},['src/a.c']);
  assert.match(chinesePrompt,/Write summary, title, description, and suggestion in Simplified Chinese/);

  const cliArgs=__test.buildCodexArgs('/tmp/schema.json','gpt-test');
  const execIndex=cliArgs.indexOf('exec');
  const approvalIndex=cliArgs.indexOf('--ask-for-approval');
  assert.ok(approvalIndex>=0 && approvalIndex<execIndex,'--ask-for-approval must be before exec');
  for(const flag of ['--json','--ephemeral','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--sandbox','--output-schema','--config','--model']){
    assert.ok(cliArgs.indexOf(flag)>execIndex,`${flag} must remain after exec`);
  }
  assert.strictEqual(cliArgs.at(-1),'-');
  assert.strictEqual(__test.isCliCompatibilityError({stderr:'error: unexpected argument --output-schema'}),true);
  assert.strictEqual(__test.isCliCompatibilityError({stderr:'error: invalid value for model'}),false);

  if(process.platform!=='win32'){
    const cliDir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-review-safe-cli-'));
    try{
      const good=path.join(cliDir,'codex-good');
      fs.writeFileSync(good,'#!/bin/sh\necho "codex-cli 9.9.9"\n'); fs.chmodSync(good,0o755);
      const resolved=await __test.resolveCodexExecutable(good);
      assert.strictEqual(resolved.version,'codex-cli 9.9.9');

      const bad=path.join(cliDir,'codex-bad');
      fs.writeFileSync(bad,'#!/bin/sh\necho "broken" >&2\nexit 2\n'); fs.chmodSync(bad,0o755);
      await assert.rejects(
        () => __test.resolveCodexExecutable(bad),
        error => error && error.code==='ECODEXUNUSABLE'
      );

      const empty=path.join(cliDir,'codex-empty');
      fs.writeFileSync(empty,'#!/bin/sh\nexit 0\n'); fs.chmodSync(empty,0o755);
      await assert.rejects(
        () => __test.resolveCodexExecutable(empty),
        error => error && error.code==='ECODEXUNUSABLE'
      );
    }finally{fs.rmSync(cliDir,{recursive:true,force:true});}
  }

  const reportFinding={severity:'medium',category:'correctness',file:'src/a.c',line:10,endLine:10,title:'边界判断错误',description:'条件会漏掉零值。',suggestion:'显式处理零值。',confidence:0.9};
  const reportMeta=new Map([[reportFinding,{published:true,mappedLine:10,reason:'exact'}]]);
  const rendered=__test.buildReviewReport({summary:'存在一个边界问题',verdict:'needs_attention',findings:[reportFinding],rejectedFindings:[],modelFindingCount:1},{severityThreshold:'low',policySource:'head-policy'},reportMeta);
  assert.match(rendered,/Verdict: needs_attention/);
  assert.match(rendered,/Review policy: head-policy/);
  assert.match(rendered,/\[MEDIUM\].*src\/a\.c:10/);
  assert.match(rendered,/Problems: published at src\/a\.c:10/);

  const thresholded=__test.buildReviewReport({summary:'',verdict:'needs_attention',findings:[reportFinding],rejectedFindings:[],modelFindingCount:1},{severityThreshold:'high',policySource:'head-default'},reportMeta);
  assert.match(thresholded,/0 visible, 1 hidden/);
  assert.doesNotMatch(thresholded,/\[MEDIUM\]/);

  assert.strictEqual(__test.computeVerdict([]),'pass');
  assert.strictEqual(__test.computeVerdict([{severity:'low'}]),'needs_attention');
  assert.strictEqual(__test.computeVerdict([{severity:'high'}]),'block');

  const ranges=__test.parseChangedLineRanges(['diff --git a/src/a.c b/src/a.c','--- a/src/a.c','+++ b/src/a.c','@@ -10,3 +10,5 @@',' context','+added1','+added2',' context'].join('\n'));
  assert.deepStrictEqual(ranges.get('src/a.c'),[{start:11,end:12}]);
  assert.strictEqual(__test.lineInChangedRanges(11,ranges.get('src/a.c')),true);
  assert.strictEqual(__test.lineInChangedRanges(9,ranges.get('src/a.c')),false);
  assert.strictEqual(__test.nearestChangedLine(14,ranges.get('src/a.c')),12);
  assert.strictEqual(__test.nearestChangedLine(20,ranges.get('src/a.c')),undefined);

  const metadata=__test.parseNameStatusZ(['M','src/a.c','R100','old.c','new.c','C90','src/a.c','copy.c','D','gone.c',''].join('\0'));
  assert.strictEqual(metadata.get('src/a.c').status,'M');
  assert.strictEqual(metadata.get('new.c').status,'R');
  assert.strictEqual(metadata.get('copy.c').status,'C');
  assert.strictEqual(metadata.get('gone.c').status,'D');

  const policyRepo=fs.mkdtempSync(path.join(os.tmpdir(),'codex-review-safe-policy-'));
  try {
    const git=args=>{const r=spawnSync('git',args,{cwd:policyRepo,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout.trim();};
    git(['init']); git(['config','user.email','test@example.com']); git(['config','user.name','Codex Review Safe Test']);
    fs.writeFileSync(path.join(policyRepo,'.codex-review.json'),JSON.stringify({severityThreshold:'low',maxFindings:40})); fs.writeFileSync(path.join(policyRepo,'a.c'),'int a = 1;\n'); git(['add','.codex-review.json','a.c']); git(['commit','-m','base policy']);
    fs.writeFileSync(path.join(policyRepo,'.codex-review.json'),JSON.stringify({severityThreshold:'critical',maxFindings:1})); git(['add','.codex-review.json']);
    const policy=await __test.readProjectRulesAtHead(policyRepo,git(['rev-parse','HEAD']));
    assert.strictEqual(policy.rules.severityThreshold,'low'); assert.strictEqual(policy.rules.maxFindings,40);
  } finally { fs.rmSync(policyRepo,{recursive:true,force:true}); }

  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'codex-review-safe-test-'));
  try {
    const git=args=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);};
    git(['init']); git(['config','user.email','test@example.com']); git(['config','user.name','Codex Review Safe Test']); fs.writeFileSync(path.join(repo,'a.c'),'int a = 1;\n'); git(['add','a.c']);
    const index1=await __test.getIndexFingerprint(repo); const head1=await __test.getHeadOid(repo); assert.strictEqual(head1,'<unborn>'); git(['commit','-m','initial']); const index2=await __test.getIndexFingerprint(repo); const head2=await __test.getHeadOid(repo); assert.strictEqual(index1,index2); assert.notStrictEqual(head1,head2);
  } finally { fs.rmSync(repo,{recursive:true,force:true}); }

  console.log(`All Codex Review Safe ${pkg.version} unit/regression tests passed.`);
})().catch(error=>{console.error(error);process.exit(1);});
