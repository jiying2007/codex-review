'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

function createReviewHarness() {
  const root = path.resolve(__dirname, '..', '..');
  const codexPath = path.join(root, 'src', 'codex.js');
  const calls = [];
  let responder = async () => ({ hypotheses:[] });
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return {
      extensions:{ getExtension:() => undefined }, workspace:{ workspaceFolders:[], textDocuments:[] }, window:{},
      l10n:{ t:(message, ...args) => String(message).replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)] === undefined ? `{${index}}` : String(args[Number(index)])) }
    };
    if (request === './codex-safe-core/codex-cli' && parent?.filename === codexPath) return {
      createCodexCli:() => ({ runStructuredCodex:async request => {
        calls.push(request);
        return { parsed:await responder(request), resolved:{ version:'controlled-fixture-cli' }, requestEstimate:{ totalTokens:1 }, usage:{} };
      } })
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  let api;
  try {
    delete require.cache[codexPath];
    api = {
      ...require(codexPath),
      ...require(path.join(root, 'src', 'semantic-evidence')),
      ...require(path.join(root, 'src', 'review')),
      ...require(path.join(root, 'src', 'review-lineage')),
      ...require(path.join(root, 'src', 'convergence')),
      ...require(path.join(root, 'src', 'git')),
      ...require(path.join(root, 'src', 'codex-safe-core', 'review-profile-pack')),
      ...require(path.join(root, 'src', 'codex-safe-core', 'judgment-lifecycle'))
    };
  } finally { Module._load = originalLoad; }

  function options(pack = 'general', mode = 'fast') {
    return {
      language:'en', profile:mode, profilePack:pack, mode, profileConfig:api.resolveReviewModeProfile(mode, pack),
      maxFindings:10, maxDiffBytes:524288, contextBudgetBytes:524288, totalContextBudgetBytes:1048576,
      maxTokenBudget:250000, confidenceThreshold:0.7, model:'controlled-fixture', codexPath:'controlled-fixture', reviewRules:{}
    };
  }

  async function withGitFixture(beforeFiles, afterFiles, action) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-fixture-'));
    const git = args => execFileSync('git', args, { cwd:repo, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
    const write = files => {
      for (const [file, contents] of Object.entries(files)) {
        const target = path.resolve(repo, file);
        if (!target.startsWith(repo + path.sep)) throw new Error('Fixture path escapes its temporary repository.');
        if (contents == null) fs.rmSync(target, { force:true });
        else { fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, contents); }
      }
    };
    try {
      git(['init','-q']); git(['config','user.name','Codex Safe Fixture']); git(['config','user.email','fixture@example.invalid']);
      write(beforeFiles); git(['add','--all']); git(['commit','-qm','Fixture baseline']);
      write(afterFiles); git(['add','--all']);
      const snapshot = await api.getRepositorySnapshot(repo);
      const diff = await api.getStagedDiff(repo);
      const paths = [...(await api.getStagedChangeMetadata(repo)).keys()];
      return await action({ repo, snapshot, diff, paths, git });
    } finally { fs.rmSync(repo, { recursive:true, force:true }); }
  }

  function verificationSubjects(input) {
    const match = String(input).match(/Hypotheses:\n(\[[\s\S]*?\])\n\n/);
    if (!match) throw new Error('Verification input has no controller hypothesis block.');
    return JSON.parse(match[1]);
  }
  function evidenceIds(input) { return [...String(input).matchAll(/^--- EVIDENCE ([^\s]+) /gm)].map(match => match[1]); }

  return { ...api, calls, options, withGitFixture, verificationSubjects, evidenceIds, respond:fn => { calls.length = 0; responder = fn; } };
}

module.exports = { createReviewHarness };
