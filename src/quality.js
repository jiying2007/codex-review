'use strict';
const fs = require('fs');
const path = require('path');
const { git } = require('./git');
const { runProcess } = require('./process');
const { normalizeGitPathForComparison } = require('./review-support');
const {
  extractImpactSignals,
  buildImpactEvidenceGraph,
  normalizeSarif,
  dedupeAnalyzerFindings,
  validatePatchProposal
} = require('./codex-safe-core/quality-platform');

const MAX_CANDIDATE_SCAN = 256;
const MAX_CANDIDATE_FILE_BYTES = 128 * 1024;
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
function textCandidate(pathName) {
  return !/(?:^|\/)(?:node_modules|dist|build|vendor)\//i.test(pathName) &&
    !/\.(?:png|jpe?g|gif|webp|pdf|zip|gz|xz|7z|bin|so|dll|exe|woff2?)$/i.test(pathName);
}
function cheapScore(file, signals) {
  const low=file.toLowerCase(), base=path.posix.basename(low), stem=base.replace(/\.[^.]+$/,''); let score=0;
  if (signals.paths.includes(file)) score += 100;
  for (const inc of signals.includes) if (low.endsWith(String(inc).toLowerCase())) score += 40;
  for (const mod of signals.modules) { const n=String(mod).replace(/^\.\//,'').replace(/\./g,'/').toLowerCase(); if (n && (low.includes(n) || base.startsWith(path.posix.basename(n)))) score += 30; }
  if (signals.changedStems.includes(stem)) score += 10;
  if (/^(?:cmakelists\.txt|makefile|kconfig|meson\.build|build(?:\.bazel)?)$/i.test(base)) score += 8;
  if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|rs|js|ts|tsx|py|java|kt|dts|dtsi|yaml|yml)$/i.test(file)) score += 2;
  return score;
}
async function collectImpactEvidence(repoRoot, diff, profile, token) {
  if (!profile || profile.maxImpactFiles <= 0 || profile.impactDepth <= 0) return { nodes: [], edges: [], text: '', bytes: 0, complete: true, truncated: false };
  const signals = extractImpactSignals(diff);
  const { stdout } = await git(['ls-files','-z'], repoRoot, token, { maxStdoutBytes: 8 * 1024 * 1024 });
  const ranked = stdout.split('\0').filter(Boolean).map(normalizeGitPathForComparison).filter(textCandidate)
    .map(file => ({ file, score: cheapScore(file, signals) })).sort((a,b) => b.score-a.score || a.file.localeCompare(b.file));
  const candidates=[];
  for (const item of ranked.slice(0, MAX_CANDIDATE_SCAN)) {
    const absolute=containedPath(repoRoot,item.file); if (!absolute) continue;
    let stat; try { stat=fs.statSync(absolute); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_CANDIDATE_FILE_BYTES) continue;
    let content; try { content=fs.readFileSync(absolute,'utf8'); } catch { continue; }
    candidates.push({ path:item.file, content });
  }
  return buildImpactEvidenceGraph({
    diff, candidates,
    maxNodes: profile.maxImpactFiles,
    maxEdges: Math.max(32, profile.maxImpactFiles * 6),
    maxBytes: Math.min(256 * 1024, Math.max(32 * 1024, profile.maxImpactFiles * 12 * 1024))
  });
}
function readSarifFile(repoRoot, file) {
  const relative=normalizeGitPathForComparison(file); const absolute=containedPath(repoRoot,relative);
  if (!absolute) throw new Error(`SARIF path must remain inside the repository: ${file}`);
  const stat=fs.statSync(absolute); if (!stat.isFile() || stat.size > MAX_SARIF_BYTES) throw new Error(`SARIF file exceeds ${MAX_SARIF_BYTES} bytes: ${file}`);
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
module.exports={MAX_CANDIDATE_SCAN,MAX_CANDIDATE_FILE_BYTES,MAX_SARIF_BYTES,collectImpactEvidence,loadSarifFiles,importSarifFile,applyValidatedPatch,containedPath,cheapScore};
