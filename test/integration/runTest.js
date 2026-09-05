'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');

function exec(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

function initRepo(root, file) {
  fs.mkdirSync(root, { recursive: true });
  exec('git', ['init'], root);
  exec('git', ['config', 'user.email', 'test@example.com'], root);
  exec('git', ['config', 'user.name', 'Codex Review Safe Test'], root);
  fs.writeFileSync(path.join(root, file), 'int value = 0;\n');
  exec('git', ['add', file], root);
  exec('git', ['commit', '-m', 'initial'], root);
  fs.writeFileSync(path.join(root, file), 'int value = 1;\n');
  exec('git', ['add', file], root);
}

function fakeCodex(base) {
  const js = path.join(base, 'fake-review.js');
  fs.writeFileSync(js, `
const fs=require('fs');
const args=process.argv.slice(2);
if(process.env.CODEX_REVIEW_IT_FAKE_LOG)fs.appendFileSync(process.env.CODEX_REVIEW_IT_FAKE_LOG,'NODE '+JSON.stringify(args)+'\\n');
if(args.includes('--version')){console.log('codex-cli fake');process.exit(0);}
if(args.length===1&&args[0]==='--help'){console.log('--ask-for-approval --config --model');process.exit(0);}
if(args.length===2&&args[0]==='exec'&&args[1]==='--help'){console.log('--json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox --output-schema --config --model');process.exit(0);}
const execIndex=args.indexOf('exec');
const approvalIndex=args.indexOf('--ask-for-approval');
if(execIndex<0||approvalIndex<0||approvalIndex>execIndex||args[approvalIndex+1]!=='never'){console.error("error: unexpected argument '--ask-for-approval'");process.exit(2);}
const delay=Number(process.env.CODEX_REVIEW_IT_DELAY_MS||0);
const mode=process.env.CODEX_REVIEW_IT_MODE||'normal';
const schemaIndex=args.indexOf('--output-schema');
const schemaPath=schemaIndex>=0?String(args[schemaIndex+1]||''):'';
let payload;
if(schemaPath.includes('review-hypothesis-schema')||schemaPath.includes('review-hypothesis-retry-schema')){
  const hypotheses=[{
    severity:'medium',category:'correctness',file:'a.c',line:mode==='farline'?500:1,endLine:mode==='farline'?500:1,
    claim:'测试诊断',suggestion:'修复它',modelConfidence:0.9,assumptions:[],requiredSymbols:[],rootCauseSymbol:'value',claimClass:'incorrect-value',
    supportingLocations:[],scopeDisposition:'in_scope',scopeReason:'The changed assignment is the direct review target.',scopeInvariant:'',
    invariantCandidate:false,invariantText:''
  }];
  if(mode==='malformed')hypotheses.push({
    severity:'high',category:'correctness',file:'not-staged.c',line:1,endLine:1,claim:'应被丢弃',suggestion:'',modelConfidence:1,
    assumptions:[],requiredSymbols:[],rootCauseSymbol:'bad',claimClass:'invalid-path',supportingLocations:[],scopeDisposition:'in_scope',scopeReason:'invalid test case',scopeInvariant:'',invariantCandidate:false,invariantText:''
  });
  payload={hypotheses};
}else if(schemaPath.includes('review-verification-schema')){
  payload={results:[]};
}else{
  payload={summary:'',findings:[]};
}
setTimeout(()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(payload)}})),delay);
`);

  if (process.platform === 'win32') {
    const cmd = path.join(base, 'fake-codex.cmd');
    fs.writeFileSync(cmd, `@echo off\r\n>>"%CODEX_REVIEW_IT_FAKE_LOG%" echo BATCH %*\r\n"${process.execPath}" "${js}" %*\r\n`);
    return cmd;
  }

  const sh = path.join(base, 'fake-codex');
  fs.writeFileSync(sh, `#!/bin/sh\necho "SHELL $*" >> "$CODEX_REVIEW_IT_FAKE_LOG"\nexec "${process.execPath}" "${js}" "$@"\n`);
  fs.chmodSync(sh, 0o755);
  return sh;
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-it-'));
  const userDataDir = process.platform === 'win32'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'crt-ui-'))
    : fs.mkdtempSync('/tmp/crt-ui-');
  const repo1 = path.join(base, 'repo1');
  const repo2 = path.join(base, 'repo2');
  initRepo(repo1, 'a.c');
  initRepo(repo2, 'a.c');

  const fakeLog = path.join(base, 'fake-invocations.log');
  process.env.CODEX_REVIEW_IT_FAKE_LOG = fakeLog;
  const fake = fakeCodex(base);
  const workspace = path.join(base, 'review.code-workspace');
  fs.writeFileSync(workspace, JSON.stringify({ folders: [{ path: repo1 }, { path: repo2 }] }, null, 2));

  process.env.CODEX_REVIEW_IT_REPO1 = repo1;
  process.env.CODEX_REVIEW_IT_REPO2 = repo2;
  process.env.CODEX_REVIEW_IT_FAKE = fake;

  const launchArgs = [workspace, `--user-data-dir=${userDataDir}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'];
  const testLocale = String(process.env.VSCODE_TEST_LOCALE || '').trim().toLowerCase();
  if (testLocale) {
    launchArgs.push('--locale', testLocale);
    if (testLocale === 'zh-cn') process.env.CODEX_REVIEW_IT_ZH_SMOKE = '1';
  }

  const runOptions = {
    extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
    extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
    launchArgs
  };
  if (process.env.VSCODE_TEST_VERSION) runOptions.version = process.env.VSCODE_TEST_VERSION;

  try {
    await runTests(runOptions);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});