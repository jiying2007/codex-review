'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_FILES = ['CHANGELOG.md', 'package-lock.json', 'package.json'];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) { throw new Error(message); }
function parseVersion(value) {
  const match = SEMVER.exec(String(value || ''));
  if (!match) fail(`版本必须是严格 SemVer（MAJOR.MINOR.PATCH）: ${value || '<empty>'}`);
  return match.slice(1).map(Number);
}
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function updateChangelog(source, version) {
  const marker = '## Unreleased';
  const start = source.indexOf(marker);
  if (start < 0) fail('CHANGELOG.md 缺少 "## Unreleased"');
  const contentStart = start + marker.length;
  const nextHeading = source.indexOf('\n## ', contentStart);
  if (nextHeading < 0) fail('CHANGELOG.md 缺少已有版本标题');
  const notes = source.slice(contentStart, nextHeading).trim();
  if (!notes) fail('CHANGELOG.md 的 Unreleased 区域为空');
  if (source.includes(`\n## ${version}\n`)) fail(`CHANGELOG.md 已存在 ${version}`);
  return `${source.slice(0, contentStart)}\n\n## ${version}\n\n${notes}\n${source.slice(nextHeading)}`;
}
function parseGitHubRemote(remote) {
  const value = String(remote || '').trim().replace(/\.git$/, '');
  const match = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+)$/.exec(value);
  if (!match) fail(`origin 不是受支持的 GitHub URL: ${remote}`);
  return { owner: match[1], repo: match[2] };
}
function sameFiles(actual, expected = RELEASE_FILES) {
  const a = [...new Set(actual)].sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function platformCommand(command, platform = process.platform) {
  return platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
}
function run(command, args, options = {}) {
  const executable = platformCommand(command);
  const result = spawnSync(executable, args, {
    cwd: ROOT, encoding: 'utf8', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) fail(`${command} 启动失败: ${result.error.message}`);
  if (!options.allowCodes?.includes(result.status) && result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || '').trim() : '';
    fail(`${command} ${args.join(' ')} 失败（exit ${result.status}）${detail ? `: ${detail}` : ''}`);
  }
  return options.capture ? (result.stdout || '').trim() : '';
}
function git(args, options = {}) { return run('git', args, { capture: true, ...options }); }
function readJson(name) { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); }
function writeJson(name, value) { fs.writeFileSync(path.join(ROOT, name), `${JSON.stringify(value, null, 2)}\n`); }
function changedFiles() {
  const tracked = git(['diff', '--name-only', 'HEAD', '--']).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}
function assertMainSynced() {
  if (git(['branch', '--show-current']) !== 'main') fail('发布只能从 main 分支执行');
  git(['fetch', '--quiet', 'origin', 'main']);
  const head = git(['rev-parse', 'HEAD']);
  const remote = git(['rev-parse', 'origin/main']);
  if (head !== remote) fail(`本地 main 与 origin/main 不一致（HEAD ${head.slice(0, 12)}，origin ${remote.slice(0, 12)}）`);
  return head;
}
function packageAtHead() { return JSON.parse(git(['show', 'HEAD:package.json'])); }
function assertTagAbsent(tag) {
  const result = spawnSync('git', ['ls-remote', '--exit-code', '--refs', 'origin', `refs/tags/${tag}`], { cwd: ROOT, encoding: 'utf8' });
  if (result.error) fail(`无法检查远端 Tag: ${result.error.message}`);
  if (result.status === 0) fail(`远端 Tag 已存在: ${tag}`);
  if (result.status !== 2) fail(`检查远端 Tag 失败（exit ${result.status}）: ${(result.stderr || '').trim()}`);
}
function releaseState() {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const previous = packageAtHead();
  parseVersion(pkg.version);
  if (compareVersions(pkg.version, previous.version) <= 0) fail(`版本必须递增: ${previous.version} -> ${pkg.version}`);
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) fail('package.json 与 package-lock.json 版本不一致');
  if (!fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').includes(`\n## ${pkg.version}\n`)) fail(`CHANGELOG.md 缺少 ${pkg.version} 标题`);
  return { pkg, previous, tag: `v${pkg.version}` };
}
function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = { dryRun: false, timeoutMinutes: 30 };
  const positional = [];
  while (args.length) {
    const value = args.shift();
    if (value === '--dry-run') options.dryRun = true;
    else if (value === '--timeout-minutes') {
      options.timeoutMinutes = Number(args.shift());
      if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) fail('--timeout-minutes 必须是正数');
    } else if (value === '--help' || value === '-h') options.help = true;
    else if (value.startsWith('-')) fail(`未知选项: ${value}`);
    else positional.push(value);
  }
  return { command, positional, options };
}
function printHelp() {
  console.log(`Usage:
  npm run release:prepare -- X.Y.Z [--dry-run]
  npm run release:check -- [--dry-run]
  npm run release:push -- [--dry-run] [--timeout-minutes 30]

prepare  同步 package/lock 版本并把 Unreleased 迁移到版本标题，不提交
check    校验 main、变更白名单、远端 Tag，并执行 lock/check/package 门禁
push     重跑门禁，仅提交三个发布文件，推送 main，并核验 Actions/Tag/Release

可选环境变量 CODEX_RELEASE_GITHUB_TOKEN 用于提高 GitHub API 限额。脚本永不创建或强推 Tag。`);
}
function prepare(version, dryRun) {
  if (!version) fail('缺少目标版本，例如: npm run release:prepare -- 1.2.3');
  parseVersion(version);
  if (changedFiles().length) fail('prepare 前工作区必须干净');
  assertMainSynced();
  const pkg = readJson('package.json');
  if (compareVersions(version, pkg.version) <= 0) fail(`目标版本必须高于当前版本 ${pkg.version}`);
  assertTagAbsent(`v${version}`);
  const lock = readJson('package-lock.json');
  if (!lock.packages?.['']) fail('package-lock.json 缺少 packages[""]');
  const changelog = updateChangelog(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  console.log(`[release] 准备 ${pkg.version} -> ${version}`);
  if (dryRun) return console.log(`[release] dry-run: 将只修改 ${RELEASE_FILES.join(', ')}`);
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  writeJson('package.json', pkg);
  writeJson('package-lock.json', lock);
  fs.writeFileSync(path.join(ROOT, 'CHANGELOG.md'), changelog);
  console.log('[release] 已准备版本；请审阅 diff，然后运行 npm run release:check');
}
function check(dryRun = false) {
  assertMainSynced();
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  if (staged.length) fail(`check 前不得有已暂存文件: ${staged.join(', ')}`);
  const changes = changedFiles();
  if (!sameFiles(changes)) fail(`发布变更必须且只能包含 ${RELEASE_FILES.join(', ')}；当前: ${changes.join(', ') || '<none>'}`);
  const state = releaseState();
  assertTagAbsent(state.tag);
  console.log(`[release] 静态门禁通过: ${state.previous.version} -> ${state.pkg.version}`);
  if (dryRun) {
    console.log('[release] dry-run: 跳过 npm ci/check/package');
    return state;
  }
  run('npm', ['run', 'verify:lock']);
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['run', 'check']);
  run('npm', ['run', 'package']);
  const vsix = path.join(ROOT, `${state.pkg.name}-${state.pkg.version}.vsix`);
  if (!fs.existsSync(vsix) || fs.statSync(vsix).size === 0) fail(`缺少预期 VSIX: ${path.basename(vsix)}`);
  console.log(`[release] 完整门禁通过: ${path.basename(vsix)}`);
  return state;
}
function apiRequest(owner, repo, pathname) {
  const token = process.env.CODEX_RELEASE_GITHUB_TOKEN;
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: 'api.github.com', path: `/repos/${owner}/${repo}${pathname}`, headers: {
      Accept: 'application/vnd.github+json', 'User-Agent': 'codex-safe-local-release', 'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`GitHub API ${response.statusCode}: ${body.slice(0, 300)}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`GitHub API 返回无效 JSON: ${error.message}`)); }
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('GitHub API 请求超时')));
    request.on('error', reject);
  });
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function verifyPublished(state, sha, timeoutMinutes) {
  const remote = parseGitHubRemote(git(['remote', 'get-url', 'origin']));
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let consecutiveErrors = 0;
  let workflowSucceeded = false;
  console.log(`[release] 等待 Release workflow（最长 ${timeoutMinutes} 分钟）...`);
  while (Date.now() < deadline) {
    try {
      const data = await apiRequest(remote.owner, remote.repo, '/actions/workflows/release.yml/runs?event=push&per_page=30');
      const workflow = data.workflow_runs?.find(item => item.head_sha === sha);
      consecutiveErrors = 0;
      if (workflow?.status === 'completed') {
        if (workflow.conclusion !== 'success') fail(`Release workflow 失败: ${workflow.html_url}`);
        console.log(`[release] Release workflow 成功: ${workflow.html_url}`);
        workflowSucceeded = true;
        break;
      }
      console.log(`[release] workflow 状态: ${workflow ? workflow.status : '尚未出现'}`);
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) fail(`连续 3 次查询 GitHub API 失败: ${error.message}`);
      console.warn(`[release] GitHub API 暂时失败（${consecutiveErrors}/3）: ${error.message}`);
    }
    await delay(45_000);
  }
  if (!workflowSucceeded) fail(`等待 Release workflow 超时（${timeoutMinutes} 分钟）`);
  const refs = git(['ls-remote', 'origin', `refs/tags/${state.tag}`, `refs/tags/${state.tag}^{}`]).split('\n').filter(Boolean);
  const tagShas = refs.map(line => line.split(/\s+/)[0]);
  if (!tagShas.includes(sha)) fail(`${state.tag} 未解析到发布 commit ${sha}`);
  const release = await apiRequest(remote.owner, remote.repo, `/releases/tags/${state.tag}`);
  if (release.draft || release.prerelease) fail(`${state.tag} Release 不是正式已发布状态`);
  const assets = new Map((release.assets || []).map(asset => [asset.name, asset]));
  for (const name of [`${state.pkg.name}-${state.pkg.version}.vsix`, 'SBOM.spdx.json', 'SHA256SUMS']) {
    if (assets.get(name)?.state !== 'uploaded') fail(`Release 缺少已上传附件: ${name}`);
  }
  const checksumAsset = assets.get('SHA256SUMS');
  if (!checksumAsset?.browser_download_url) fail('Release SHA256SUMS 缺少下载 URL');
  console.log(`[release] 发布核验完成: ${release.html_url}`);
}
async function push(options) {
  if (options.dryRun) {
    const state = check(true);
    console.log(`[release] dry-run: 将提交 ${RELEASE_FILES.join(', ')}，推送 main，并核验 ${state.tag}`);
    return;
  }
  const state = check(false);
  git(['add', '--', ...RELEASE_FILES]);
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  if (!sameFiles(staged)) fail(`暂存区白名单校验失败: ${staged.join(', ')}`);
  run('git', ['diff', '--cached', '--check']);
  run('git', ['commit', '-m', `chore(release): 发布 ${state.tag}`]);
  const sha = git(['rev-parse', 'HEAD']);
  try { run('git', ['push', 'origin', 'main']); }
  catch (error) { fail(`本地发布 commit ${sha} 已创建，但推送失败；修复连接后重试 git push origin main。${error.message}`); }
  await verifyPublished(state, sha, options.timeoutMinutes);
}
async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--help' || argv[0] === '-h') return printHelp();
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.options.help) return printHelp();
  if (parsed.command === 'prepare') {
    if (parsed.positional.length !== 1) fail('prepare 只接受一个目标版本参数');
    return prepare(parsed.positional[0], parsed.options.dryRun);
  }
  if (parsed.positional.length) fail(`命令 ${parsed.command} 不接受位置参数`);
  if (parsed.command === 'check') return check(parsed.options.dryRun);
  if (parsed.command === 'push') return push(parsed.options);
  fail(`未知命令: ${parsed.command}`);
}

if (require.main === module) main().catch(error => { console.error(`[release] ${error.message}`); process.exitCode = 1; });

module.exports = { compareVersions, parseGitHubRemote, parseVersion, platformCommand, sameFiles, updateChangelog };
