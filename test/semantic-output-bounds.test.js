'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {collectIndexSymbolEvidence}=require('../src/semantic-evidence');

function runGit(cwd,args,options={}) {
  const result=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,...options});
  if(result.status!==0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr||result.error||result.status}`);
  return result.stdout||'';
}

(async()=>{
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'review-semantic-output-'));
  try {
    runGit(repo,['init','-q']);
    const symbol='review_safe_high_fanout_symbol';
    const line=`int ${symbol}(void); /* deterministic high-fanout fixture */\n`;
    fs.writeFileSync(path.join(repo,'huge.c'),line.repeat(90000));
    runGit(repo,['add','huge.c']);

    const legacy=runGit(repo,['grep','--cached','-n','-I','-F','-e',symbol,'--']);
    assert.ok(Buffer.byteLength(legacy,'utf8')>4*1024*1024,'fixture must reproduce >4 MiB legacy git grep stdout');

    const diff=[
      'diff --git a/app.c b/app.c',
      '--- a/app.c',
      '+++ b/app.c',
      '@@ -1,0 +1,1 @@',
      `+${symbol}();`
    ].join('\n');
    const result=await collectIndexSymbolEvidence(repo,diff,['app.c'],undefined);
    assert.ok(result&&Array.isArray(result.blocks),'bounded symbol discovery must complete instead of throwing EOUTPUTLIMIT');
    assert.strictEqual(result.blocks.length,0,'oversized index blobs remain excluded by the 128 KiB evidence-file safety ceiling');
    console.log('Semantic symbol discovery >4 MiB stdout regression passed.');
  } finally {
    fs.rmSync(repo,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
