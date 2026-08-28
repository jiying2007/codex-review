'use strict';
const fs = require('fs');
const path = require('path');
const { runProcess } = require('./process');
const { normalizeGitPathForComparison } = require('./review-support');
const { normalizeSarif, dedupeAnalyzerFindings, validatePatchProposal } = require('./codex-safe-core/quality-platform');

const MAX_SARIF_BYTES = 4 * 1024 * 1024;

function containedPath(repoRoot, candidate) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, candidate);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  try {
    const realRoot = fs.realpathSync.native(root);
    const real = fs.realpathSync.native(absolute);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return real;
  } catch { return null; }
}
function readSarifFile(repoRoot, file) {
  const relative=normalizeGitPathForComparison(file), absolute=containedPath(repoRoot,relative);
  if (!absolute) throw new Error(`SARIF path must remain inside the repository: ${file}`);
  const stat=fs.statSync(absolute);
  if (!stat.isFile() || stat.size > MAX_SARIF_BYTES) throw new Error(`SARIF file exceeds ${MAX_SARIF_BYTES} bytes: ${file}`);
  return normalizeSarif(fs.readFileSync(absolute,'utf8'));
}
function loadSarifFiles(repoRoot, files=[]) {
  const findings=[]; for (const file of files || []) findings.push(...readSarifFile(repoRoot,file));
  return dedupeAnalyzerFindings(findings);
}
function importSarifFile(repoRoot, absoluteFile) {
  const root=path.resolve(repoRoot), absolute=path.resolve(absoluteFile);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error('SARIF import must be inside the current repository.');
  return readSarifFile(repoRoot,path.relative(root,absolute).split(path.sep).join('/'));
}
async function applyValidatedPatch(repoRoot, proposal, allowedPaths, token) {
  const validated=validatePatchProposal(proposal,{ allowedPaths, maxBytes:256*1024 });
  await runProcess('git',['apply','--check','--whitespace=nowarn','-'],{cwd:repoRoot,timeoutMs:15000,maxStdoutBytes:1024*1024,maxStderrBytes:1024*1024},validated.patch,token);
  await runProcess('git',['apply','--whitespace=nowarn','-'],{cwd:repoRoot,timeoutMs:15000,maxStdoutBytes:1024*1024,maxStderrBytes:1024*1024},validated.patch,token);
  return validated;
}
module.exports={MAX_SARIF_BYTES,loadSarifFiles,importSarifFile,applyValidatedPatch,containedPath};
