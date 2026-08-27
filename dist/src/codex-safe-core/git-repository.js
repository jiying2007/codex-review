'use strict';

const crypto = require('crypto');
const path = require('path');

const DEFAULT_GIT_TIMEOUT_MS = 15000;
const DEFAULT_STAGED_DIFF_LIMIT = 32 * 1024 * 1024;
const DEFAULT_BRANCH_DIFF_LIMIT = 64 * 1024 * 1024;

function assertSafeGitToken(value, name = 'Git token') {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function createGitRepository({ runProcess, runProcessBuffer, ui = (_zh, en) => en }) {
  if (typeof runProcess !== 'function' || typeof runProcessBuffer !== 'function') {
    throw new TypeError('createGitRepository requires process runners.');
  }
  if (typeof ui !== 'function') throw new TypeError('ui must be a function.');

  const git = async (args, cwd, token, options = {}) => runProcess(
    'git',
    args,
    {
      cwd,
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      ...options
    },
    '',
    token
  );

  function normalizeFsPath(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  async function getHeadOid(repoRoot, token) {
    try {
      const { stdout } = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repoRoot, token);
      const oid = stdout.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
        throw new Error(ui('Git HEAD 返回了无效 object id。', 'Git HEAD returned an invalid object id.'));
      }
      return oid;
    } catch (error) {
      const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr || '');
      if (error?.code === 1 && !stderr.trim()) return '<unborn>';
      throw error;
    }
  }

  async function getIndexFingerprint(repoRoot, token) {
    const { stdout } = await runProcessBuffer(
      'git',
      ['ls-files', '--stage', '-z'],
      {
        cwd: repoRoot,
        timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
        maxStdoutBytes: 16 * 1024 * 1024,
        maxStderrBytes: 256 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      },
      token
    );
    return crypto.createHash('sha256').update(stdout).digest('hex');
  }

  async function getRepositorySnapshot(repoRoot, token) {
    const [headOid, indexFingerprint] = await Promise.all([
      getHeadOid(repoRoot, token),
      getIndexFingerprint(repoRoot, token)
    ]);
    return Object.freeze({ headOid, indexFingerprint });
  }

  function repositorySnapshotsEqual(a, b) {
    return Boolean(a && b && a.headOid === b.headOid && a.indexFingerprint === b.indexFingerprint);
  }

  async function getStagedDiff(repoRoot, token, unified = 3) {
    const contextLines = Math.max(0, Math.min(1000, Math.round(Number(unified) || 0)));
    return (await git(
      ['diff', '--cached', '--no-ext-diff', '--no-textconv', `--unified=${contextLines}`],
      repoRoot,
      token,
      { maxStdoutBytes: DEFAULT_STAGED_DIFF_LIMIT }
    )).stdout;
  }

  async function getStagedPaths(repoRoot, token) {
    const { stdout } = await git(
      ['diff', '--cached', '--name-only', '--diff-filter=ACMRDTUXB', '-z'],
      repoRoot,
      token
    );
    return stdout.split('\0').filter(Boolean);
  }

  async function getChangedPaths(repoRoot, base, head = 'HEAD', token) {
    const safeBase = assertSafeGitToken(base, 'base ref');
    const safeHead = assertSafeGitToken(head, 'head ref');
    const { stdout } = await git(
      ['diff', '--name-only', '--diff-filter=ACMRDTUXB', '-z', `${safeBase}...${safeHead}`],
      repoRoot,
      token
    );
    return stdout.split('\0').filter(Boolean);
  }

  async function getBranchDiff(repoRoot, base, head = 'HEAD', token, unified = 3) {
    const safeBase = assertSafeGitToken(base, 'base ref');
    const safeHead = assertSafeGitToken(head, 'head ref');
    const contextLines = Math.max(0, Math.min(1000, Math.round(Number(unified) || 0)));
    return (await git(
      ['diff', '--no-ext-diff', '--no-textconv', `--unified=${contextLines}`, `${safeBase}...${safeHead}`],
      repoRoot,
      token,
      { maxStdoutBytes: DEFAULT_BRANCH_DIFF_LIMIT }
    )).stdout;
  }

  async function hasUnmergedEntries(repoRoot, token) {
    return (await git(['ls-files', '-u', '-z'], repoRoot, token)).stdout.length > 0;
  }

  async function getCurrentBranch(repoRoot, token) {
    return (await git(['branch', '--show-current'], repoRoot, token)).stdout.trim();
  }

  async function getRemoteUrl(repoRoot, remote = 'origin', token) {
    const safeRemote = assertSafeGitToken(remote, 'remote name');
    return (await git(['remote', 'get-url', safeRemote], repoRoot, token)).stdout.trim();
  }

  async function getRecentCommitSubjects(repoRoot, limit = 12, ref = 'HEAD', token) {
    const bounded = Math.max(0, Math.min(100, Number(limit) || 0));
    if (!bounded) return [];
    const safeRef = assertSafeGitToken(ref, 'history ref');
    const { stdout } = await git(
      ['log', '--no-merges', '-n', String(bounded), '--format=%s%x00', safeRef, '--'],
      repoRoot,
      token
    );
    return stdout.split('\0').map(value => value.trim()).filter(Boolean).slice(0, bounded);
  }

  function fingerprintDiff(diff) {
    return crypto.createHash('sha256').update(String(diff || ''), 'utf8').digest('hex');
  }

  return Object.freeze({
    git,
    normalizeFsPath,
    getHeadOid,
    getIndexFingerprint,
    getRepositorySnapshot,
    repositorySnapshotsEqual,
    getStagedDiff,
    getStagedPaths,
    getChangedPaths,
    getBranchDiff,
    hasUnmergedEntries,
    getCurrentBranch,
    getRemoteUrl,
    getRecentCommitSubjects,
    fingerprintDiff
  });
}

module.exports = {
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_STAGED_DIFF_LIMIT,
  DEFAULT_BRANCH_DIFF_LIMIT,
  assertSafeGitToken,
  createGitRepository
};
