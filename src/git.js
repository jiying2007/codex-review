'use strict';

const path = require('path');
const vscode = require('vscode');
const { runProcess, runProcessBuffer } = require('./process');
const { createGitRepository } = require('./codex-safe-core/git-repository');
const {
  normalizeFsPath,
  normalizeGitPathForComparison
} = require('./review-support');
const { t } = require('./i18n');

const coreGit = createGitRepository({
  runProcess,
  runProcessBuffer,
  ui: (_zh, en) => t(en)
});
const git = coreGit.git;

const STAGED_ENUMERATION_STDOUT_LIMIT = 32 * 1024 * 1024;
const CONFLICT_ENUMERATION_STDOUT_LIMIT = 4 * 1024 * 1024;
const SCOPED_ENUMERATION_STDOUT_LIMIT = 1024 * 1024;
const ENUMERATION_STDERR_LIMIT = 256 * 1024;
const PATHSPEC_BATCH_MAX_COUNT = 96;
const PATHSPEC_BATCH_MAX_BYTES = 12 * 1024;

function pathspecBytes(value) {
  return Buffer.byteLength(String(value || ''), 'utf8') + 1;
}

function batchPathspecs(paths, maxCount = PATHSPEC_BATCH_MAX_COUNT, maxBytes = PATHSPEC_BATCH_MAX_BYTES) {
  const unique = [...new Set((paths || []).map(normalizeGitPathForComparison).filter(Boolean))];
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of unique) {
    const bytes = pathspecBytes(file);
    if (current.length && (current.length >= maxCount || currentBytes + bytes > maxBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

function literalPathspecArgs(commandArgs, batch) {
  return ['--literal-pathspecs', ...commandArgs, '--', ...batch];
}

function enumerationError(error, phase, commandClass) {
  if (error?.code !== 'EOUTPUTLIMIT') return error;
  const wrapped = new Error(`Git enumeration exceeded bounded output during ${phase} (${commandClass}). ${error.message}`);
  wrapped.code = error.code;
  wrapped.phase = phase;
  wrapped.commandClass = commandClass;
  wrapped.stdoutBytes = error.stdoutBytes;
  wrapped.stdoutTruncated = error.stdoutTruncated;
  wrapped.stdoutTail = error.stdoutTail;
  wrapped.stderrTail = error.stderrTail;
  wrapped.cause = error;
  return wrapped;
}

async function runGitEnumeration(args, repoRoot, token, { phase, commandClass, maxStdoutBytes }) {
  try {
    return await git(args, repoRoot, token, {
      maxStdoutBytes,
      maxStderrBytes: ENUMERATION_STDERR_LIMIT
    });
  } catch (error) {
    throw enumerationError(error, phase, commandClass);
  }
}

async function getGitApi() {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) return undefined;
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports?.getAPI?.(1);
}

async function getRepositories() {
  const api = await getGitApi();
  if (api?.repositories?.length) {
    return api.repositories.map(repo => ({ root: repo.rootUri.fsPath, repo }));
  }

  const result = [];
  const seen = new Set();
  for (const folder of vscode.workspace.workspaceFolders || []) {
    try {
      const { stdout } = await git(['rev-parse', '--show-toplevel'], folder.uri.fsPath);
      const root = stdout.trim();
      const key = normalizeFsPath(root);
      if (root && !seen.has(key)) {
        seen.add(key);
        result.push({ root, repo: undefined });
      }
    } catch {}
  }
  return result;
}

function repositoryFromCommandContext(repositories, commandArgs) {
  for (const arg of commandArgs || []) {
    const candidateUri = arg?.rootUri || arg?.resourceUri || arg?.sourceControl?.rootUri;
    const fsPath = candidateUri?.fsPath;
    if (!fsPath) continue;
    const normalized = normalizeFsPath(fsPath);
    const match = repositories.find(r => normalizeFsPath(r.root) === normalized);
    if (match) return match;
  }
  return undefined;
}

async function chooseRepository(commandArgs = []) {
  const repositories = await getRepositories();
  if (!repositories.length) throw new Error(t('No Git repository was detected in the current workspace.'));

  const contextual = repositoryFromCommandContext(repositories, commandArgs);
  if (contextual) return { ...contextual, repositoryCount: repositories.length };

  const activePath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (activePath) {
    const matches = repositories
      .filter(item => {
        const root = normalizeFsPath(item.root);
        const active = normalizeFsPath(activePath);
        return active === root || active.startsWith(root + path.sep);
      })
      .sort((a, b) => b.root.length - a.root.length);
    if (matches.length) return { ...matches[0], repositoryCount: repositories.length };
  }

  if (repositories.length === 1) return { ...repositories[0], repositoryCount: 1 };

  const selected = await vscode.window.showQuickPick(
    repositories.map(item => ({ label: path.basename(item.root), description: item.root, item })),
    { placeHolder: t('Select the Git repository whose staged changes should be reviewed') }
  );
  return selected?.item ? { ...selected.item, repositoryCount: repositories.length } : undefined;
}

async function getStagedDiff(repoRoot, token) {
  const { stdout } = await git([
    '-c', 'core.quotePath=false',
    'diff', '--cached', '-M', '-C',
    '--src-prefix=a/', '--dst-prefix=b/',
    '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3'
  ], repoRoot, token, { maxStdoutBytes: 32 * 1024 * 1024 });
  return stdout;
}

const getIndexFingerprint = coreGit.getIndexFingerprint;
const getHeadOid = coreGit.getHeadOid;
const getRepositorySnapshot = coreGit.getRepositorySnapshot;
const snapshotsEqual = coreGit.repositorySnapshotsEqual;

function toRepoRelativeGitPath(repoRoot, fsPath) {
  const relative = path.relative(repoRoot, fsPath);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

function getDirtyOpenPathSet(repoRoot) {
  const result = new Set();
  for (const document of vscode.workspace.textDocuments || []) {
    if (!document.isDirty || document.uri?.scheme !== 'file') continue;
    const relative = toRepoRelativeGitPath(repoRoot, document.uri.fsPath);
    if (relative) result.add(normalizeGitPathForComparison(relative));
  }
  return result;
}

function parseNameStatusZ(stdout) {
  const tokens = String(stdout || '').split('\0');
  const metadata = new Map();
  let i = 0;
  while (i < tokens.length) {
    const statusToken = tokens[i++];
    if (!statusToken) continue;
    const status = statusToken[0];
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (!oldPath || !newPath) break;
      metadata.set(normalizeGitPathForComparison(newPath), {
        status,
        score: statusToken.slice(1),
        oldPath: normalizeGitPathForComparison(oldPath),
        path: normalizeGitPathForComparison(newPath)
      });
    } else {
      const file = tokens[i++];
      if (!file) break;
      metadata.set(normalizeGitPathForComparison(file), {
        status,
        score: '',
        path: normalizeGitPathForComparison(file)
      });
    }
  }
  return metadata;
}

async function getStagedPathList(repoRoot, token) {
  const { stdout } = await runGitEnumeration(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRDTUXB', '-z'],
    repoRoot,
    token,
    { phase: 'staged-path-discovery', commandClass: 'git diff --cached --name-only', maxStdoutBytes: STAGED_ENUMERATION_STDOUT_LIMIT }
  );
  return stdout.split('\0').filter(Boolean).map(normalizeGitPathForComparison);
}

async function getStagedChangeMetadata(repoRoot, token) {
  const { stdout } = await runGitEnumeration(
    ['diff', '--cached', '--name-status', '-z', '-M', '-C', '--diff-filter=ACMRDTUXB'],
    repoRoot,
    token,
    { phase: 'staged-metadata-discovery', commandClass: 'git diff --cached --name-status', maxStdoutBytes: STAGED_ENUMERATION_STDOUT_LIMIT }
  );
  return parseNameStatusZ(stdout);
}

async function getBinaryPathSet(repoRoot, token) {
  const { stdout } = await runGitEnumeration(
    ['diff', '--cached', '--numstat', '-z', '--no-renames'],
    repoRoot,
    token,
    { phase: 'staged-binary-discovery', commandClass: 'git diff --cached --numstat', maxStdoutBytes: STAGED_ENUMERATION_STDOUT_LIMIT }
  );
  const result = new Set();
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const firstTab = record.indexOf('\t');
    const secondTab = firstTab >= 0 ? record.indexOf('\t', firstTab + 1) : -1;
    if (firstTab < 0 || secondTab < 0) continue;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    const file = record.slice(secondTab + 1);
    if ((added === '-' || deleted === '-') && file) result.add(normalizeGitPathForComparison(file));
  }
  return result;
}

async function getSubmodulePathSet(repoRoot, token) {
  const stagedPaths = await getStagedPathList(repoRoot, token);
  const result = new Set();
  for (const batch of batchPathspecs(stagedPaths)) {
    const { stdout } = await runGitEnumeration(
      literalPathspecArgs(['ls-files', '--stage', '-z'], batch),
      repoRoot,
      token,
      { phase: 'staged-submodule-discovery', commandClass: 'git ls-files --stage <staged-pathspecs>', maxStdoutBytes: SCOPED_ENUMERATION_STDOUT_LIMIT }
    );
    for (const record of stdout.split('\0')) {
      if (!record) continue;
      const match = record.match(/^(\d{6}) [0-9a-f]+ \d\t([\s\S]*)$/i);
      if (match?.[1] === '160000') result.add(normalizeGitPathForComparison(match[2]));
    }
  }
  return result;
}

async function getUnmergedPaths(repoRoot, token) {
  const { stdout } = await runGitEnumeration(
    ['ls-files', '--unmerged', '-z'],
    repoRoot,
    token,
    { phase: 'unmerged-path-discovery', commandClass: 'git ls-files --unmerged', maxStdoutBytes: CONFLICT_ENUMERATION_STDOUT_LIMIT }
  );
  const paths = new Set();
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const file = record.slice(tab + 1);
    if (file) paths.add(normalizeGitPathForComparison(file));
  }
  return [...paths];
}

async function getUnstagedPathSet(repoRoot, token) {
  const stagedPaths = await getStagedPathList(repoRoot, token);
  const result = new Set();
  for (const batch of batchPathspecs(stagedPaths)) {
    const { stdout } = await runGitEnumeration(
      literalPathspecArgs(['diff', '--name-only', '--diff-filter=ACMRDTUXB', '-z'], batch),
      repoRoot,
      token,
      { phase: 'unstaged-overlay-discovery', commandClass: 'git diff --name-only <staged-pathspecs>', maxStdoutBytes: SCOPED_ENUMERATION_STDOUT_LIMIT }
    );
    for (const file of stdout.split('\0').filter(Boolean)) result.add(normalizeGitPathForComparison(file));
  }
  return result;
}

module.exports = {
  STAGED_ENUMERATION_STDOUT_LIMIT,
  CONFLICT_ENUMERATION_STDOUT_LIMIT,
  SCOPED_ENUMERATION_STDOUT_LIMIT,
  ENUMERATION_STDERR_LIMIT,
  PATHSPEC_BATCH_MAX_COUNT,
  PATHSPEC_BATCH_MAX_BYTES,
  pathspecBytes,
  batchPathspecs,
  literalPathspecArgs,
  enumerationError,
  runGitEnumeration,
  git,
  getGitApi,
  getRepositories,
  repositoryFromCommandContext,
  chooseRepository,
  getStagedDiff,
  getIndexFingerprint,
  getHeadOid,
  getRepositorySnapshot,
  snapshotsEqual,
  toRepoRelativeGitPath,
  getDirtyOpenPathSet,
  parseNameStatusZ,
  getStagedPathList,
  getStagedChangeMetadata,
  getBinaryPathSet,
  getSubmodulePathSet,
  getUnmergedPaths,
  getUnstagedPathSet
};
