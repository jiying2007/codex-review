'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests
} = require('@vscode/test-electron');

function exec(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
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
const execIndex=args.indexOf('exec');
const approvalIndex=args.indexOf('--ask-for-approval');
if(execIndex<0||approvalIndex<0||approvalIndex>execIndex||args[approvalIndex+1]!=='never'){console.error("error: unexpected argument '--ask-for-approval'");process.exit(2);}
const delay=Number(process.env.CODEX_REVIEW_IT_DELAY_MS||0);
const mode=process.env.CODEX_REVIEW_IT_MODE||'normal';
const findings=[{severity:'medium',category:'correctness',file:'a.c',line:mode==='farline'?500:1,endLine:mode==='farline'?500:1,title:'测试问题',description:'测试诊断',suggestion:'修复它',confidence:0.9}];
if(mode==='malformed')findings.push({severity:'high',category:'correctness',file:'not-staged.c',line:1,endLine:1,title:'无效路径',description:'应被丢弃',suggestion:'',confidence:1});
setTimeout(()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'发现问题',findings})}})),delay);
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

async function installLanguagePack(vscodeExecutablePath) {
  const [cliPath, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  const result = spawnSync(
    cliPath,
    [...baseArgs, '--install-extension', 'MS-CEINTL.vscode-language-pack-zh-hans', '--force'],
    {
      encoding: 'utf8',
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    throw new Error(`Failed to install Simplified-Chinese VS Code language pack (exit ${result.status}).`);
  }
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-it-'));
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

  const locale = process.env.VSCODE_TEST_LOCALE || '';
  const runOptions = {
    extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
    extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
    launchArgs: [workspace, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes']
  };

  if (locale) {
    const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION || 'stable');
    await installLanguagePack(vscodeExecutablePath);
    runOptions.vscodeExecutablePath = vscodeExecutablePath;
    runOptions.launchArgs.push(`--locale=${locale}`);
  } else {
    runOptions.launchArgs.splice(1, 0, '--disable-extensions');
    if (process.env.VSCODE_TEST_VERSION) runOptions.version = process.env.VSCODE_TEST_VERSION;
  }

  try {
    await runTests(runOptions);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
