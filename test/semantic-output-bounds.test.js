'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Module=require('module');
const {spawnSync}=require('child_process');

const originalLoad=Module._load;
Module._load=function(request,parent,isMain) {
  if(request==='vscode') return {
    extensions:{getExtension:()=>undefined},
    workspace:{workspaceFolders:[],textDocuments:[]},
    window:{},
    l10n:{t:(message,...args)=>String(message).replace(/\{(\d+)\}/g,(_match,index)=>args[Number(index)]===undefined?`{${index}}`:String(args[Number(index)]))}
  };
  return originalLoad.call(this,request,parent,isMain);
};
const {collectIndexSymbolEvidence}=require('../src/semantic-evidence');
const {
  PATHSPEC_BATCH_MAX_COUNT,
  PATHSPEC_BATCH_MAX_BYTES,
  pathspecBytes,
  batchPathspecs,
  literalPathspecArgs,
  enumerationError,
  getSubmodulePathSet,
  getUnstagedPathSet
}=require('../src/git');
Module._load=originalLoad;

function runGit(cwd,args,options={}) {
  const result=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,...options});
  if(result.status!==0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr||result.error||result.status}`);
  return result.stdout||'';
}
function initRepo(repo) {
  runGit(repo,['init','-q']);
  runGit(repo,['config','user.email','test@example.invalid']);
  runGit(repo,['config','user.name','Codex Review Safe Test']);
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
  } finally {
    fs.rmSync(repo,{recursive:true,force:true});
  }

  const syntheticPaths=Array.from({length:600},(_,index)=>`src/component-${String(index).padStart(4,'0')}/${'segment-'.repeat(12)}file.c`);
  const batches=batchPathspecs(syntheticPaths);
  assert.ok(batches.length>1,'large path sets must be split into bounded command batches');
  for(const batch of batches) {
    assert.ok(batch.length<=PATHSPEC_BATCH_MAX_COUNT,'pathspec batch count must remain bounded');
    const bytes=batch.reduce((sum,file)=>sum+pathspecBytes(file),0);
    assert.ok(bytes<=PATHSPEC_BATCH_MAX_BYTES||batch.length===1,'pathspec batch argv bytes must remain bounded');
  }
  assert.deepStrictEqual(
    literalPathspecArgs(['diff','--name-only'],[':(glob)**/*.c']),
    ['--literal-pathspecs','diff','--name-only','--',':(glob)**/*.c'],
    'scoped file names must be passed under literal Git pathspec semantics'
  );
  const boundedError=enumerationError(
    Object.assign(new Error('Child process stdout exceeded the limit (4194304 bytes)'),{code:'EOUTPUTLIMIT',stdoutBytes:4194305}),
    'staged-submodule-discovery',
    'git ls-files --stage <staged-pathspecs>'
  );
  assert.strictEqual(boundedError.code,'EOUTPUTLIMIT');
  assert.strictEqual(boundedError.phase,'staged-submodule-discovery');
  assert.strictEqual(boundedError.stdoutBytes,4194305);
  assert.match(boundedError.message,/staged-submodule-discovery/);

  const overlayRepo=fs.mkdtempSync(path.join(os.tmpdir(),'review-unstaged-scope-'));
  try {
    initRepo(overlayRepo);
    fs.writeFileSync(path.join(overlayRepo,'reviewed.c'),'int reviewed = 1;\n');
    fs.writeFileSync(path.join(overlayRepo,'noise.c'),'int noise = 1;\n');
    runGit(overlayRepo,['add','.']);
    runGit(overlayRepo,['commit','-qm','base']);

    fs.writeFileSync(path.join(overlayRepo,'reviewed.c'),'int reviewed = 2;\n');
    runGit(overlayRepo,['add','reviewed.c']);
    fs.writeFileSync(path.join(overlayRepo,'reviewed.c'),'int reviewed = 3;\n');
    fs.writeFileSync(path.join(overlayRepo,'noise.c'),'int noise = 2;\n');

    const unstaged=await getUnstagedPathSet(overlayRepo,undefined);
    assert.strictEqual(unstaged.has('reviewed.c'),true,'unstaged overlay on a staged path must be detected');
    assert.strictEqual(unstaged.has('noise.c'),false,'unrelated unstaged paths must not enter Review publication scope');
  } finally {
    fs.rmSync(overlayRepo,{recursive:true,force:true});
  }

  const submoduleRepo=fs.mkdtempSync(path.join(os.tmpdir(),'review-submodule-scope-'));
  try {
    initRepo(submoduleRepo);
    fs.writeFileSync(path.join(submoduleRepo,'base.txt'),'base\n');
    runGit(submoduleRepo,['add','base.txt']);
    runGit(submoduleRepo,['commit','-qm','base']);
    const head=runGit(submoduleRepo,['rev-parse','HEAD']).trim();
    runGit(submoduleRepo,['update-index','--add','--cacheinfo',`160000,${head},vendor/dependency`]);

    const submodules=await getSubmodulePathSet(submoduleRepo,undefined);
    assert.strictEqual(submodules.has('vendor/dependency'),true,'staged gitlinks must still be classified as submodule changes');
  } finally {
    fs.rmSync(submoduleRepo,{recursive:true,force:true});
  }

  console.log('Semantic/Git output bounds and staged-scope regressions passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
