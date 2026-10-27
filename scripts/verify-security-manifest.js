'use strict';

// Keep the required CI dependency bound to real SARIF, including failed uploads.
{
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const helper = 'src/codex-safe-core/scripts/codeql-findings-gate.js';
  function job(text, name) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const start = lines.indexOf('  ' + name + ':');
    assert.ok(start >= 0, 'missing required workflow job: ' + name);
    let end = start + 1;
    while (end < lines.length && !/^  [A-Za-z0-9_-]+:/.test(lines[end])) end++;
    return lines.slice(start, end).join('\n');
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/codeql.yml'), 'utf8');
  const analysisJob = job(workflow, 'analyze');
  assert.ok(!analysisJob.includes('continue-on-error:'), 'CodeQL failures must remain fatal');
  const steps = analysisJob.split('\n      - ').slice(1).map(block => block.split('\n').map(line => line.trim()));
  function action(name) {
    const matches = steps.filter(lines => lines.some(line => line.startsWith('uses: ' + name + '@')));
    assert.equal(matches.length, 1, 'expected exactly one ' + name + ' step');
    return matches[0];
  }
  assert.ok(action('actions/checkout').includes('submodules: recursive'), 'canonical Core must be checked out');
  assert.ok(action('actions/setup-node').includes("node-version: '24.19.0'"), 'SARIF gate must use supported Node 24.19.0');
  const analyze = action('github/codeql-action/analyze');
  assert.ok(analyze.includes('output: codeql-results'), 'analyze must produce the gated report directory');
  assert.ok(analyze.includes('upload: always'), 'GitHub code scanning upload must stay enabled');
  const findings = steps.filter(lines => lines.includes('run: node ' + helper + ' codeql-results'));
  assert.equal(findings.length, 1, 'the production Core SARIF gate must run exactly once');
  assert.ok(findings[0].includes('if: ${{ always() }}'), 'findings gate must run even when analyze/upload fails');
  assert.ok(steps.indexOf(findings[0]) > steps.indexOf(analyze), 'findings gate must inspect the actual analyze output');
  const evidence = action('actions/upload-artifact');
  assert.ok(evidence.includes('if: ${{ always() }}'), 'SARIF evidence must survive failures');
  assert.ok(evidence.includes('uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2'), 'SARIF artifact action must retain its audited exact pin');
  assert.ok(evidence.includes('name: codeql-sarif-${{ github.run_id }}-${{ github.run_attempt }}'), 'SARIF evidence must bind the run and attempt');
  assert.ok(evidence.includes('path: codeql-results/*.sarif'), 'preserve precisely the analyzed SARIF files');
  assert.ok(evidence.includes('if-no-files-found: error'), 'missing SARIF evidence must fail closed');
  assert.ok(steps.indexOf(evidence) > steps.indexOf(analyze), 'SARIF evidence must come from the current analysis');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const caller = job(ci, 'codeql');
  assert.ok(caller.includes('uses: ./.github/workflows/codeql.yml'), 'CI must invoke the checked CodeQL workflow');
  assert.ok(!caller.includes('continue-on-error:'), 'CI must retain CodeQL failure propagation');
  for (const permission of ['actions: read', 'contents: read', 'security-events: write']) {
    assert.ok(analysisJob.includes(permission) && caller.includes(permission), 'CodeQL caller/callee permission missing: ' + permission);
  }
  const required = job(ci, 'ci-gate').split('\n').map(line => line.trim());
  const needs = required.find(line => line.startsWith('needs: [') && line.endsWith(']'));
  assert.ok(needs && needs.slice(8, -1).split(',').map(value => value.trim()).includes('codeql'),
    'required CI Gate must depend on the checked CodeQL workflow');
  assert.ok(required.includes('if: ${{ always() }}'), 'required CI Gate must still evaluate failed dependencies');
}


const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const source = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');

assert.strictEqual(pkg.capabilities?.untrustedWorkspaces?.supported, false, 'untrustedWorkspaces.supported must remain false');
assert.strictEqual(pkg.capabilities?.virtualWorkspaces?.supported, false, 'virtualWorkspaces.supported must remain false');
assert.deepStrictEqual(pkg.extensionKind, ['workspace'], 'extensionKind must remain workspace');

const machineScoped = new Set([
  'safeCodexReview.codexPath',
  'safeCodexReview.providerMode',
  'safeCodexReview.providerBaseUrl',
  'safeCodexReview.providerApiKeyEnv',
  'safeCodexReview.providerCredentialSource',
  'safeCodexReview.providerAllowInsecureHttp'
]);
for (const [key, value] of Object.entries(pkg.contributes?.configuration?.properties || {})) {
  const expected = machineScoped.has(key) ? 'machine' : 'application';
  assert.strictEqual(value.scope, expected, `${key} must remain ${expected}-scoped`);
}

const validation = (pkg.contributes?.jsonValidation || []).find(item => item.fileMatch === '.codex-safe.json');
assert.ok(validation, '.codex-safe.json validation contribution is required');
assert.strictEqual(validation.url, './dist/codex-safe.schema.json', 'Marketplace schema must resolve from dist only');
assert.notStrictEqual(validation.url, './src/codex-safe-core/codex-safe.schema.json', 'source/submodule schema must not be a Marketplace runtime path');
const policyExample = JSON.parse(fs.readFileSync(path.join(root, '.codex-safe.example.json'), 'utf8'));
assert.ok(!Object.prototype.hasOwnProperty.call(policyExample, 'pr'), 'retired PR policy surface must not return');

const scmItems = pkg.contributes?.menus?.['scm/title'] || [];
const paletteItems = pkg.contributes?.menus?.commandPalette || [];
function requireTrustedWhen(items, command) {
  const item = items.find(entry => entry.command === command);
  assert.ok(item, `${command} menu contribution is missing`);
  assert.match(String(item.when || ''), /\bisWorkspaceTrusted\b/, `${command} must require isWorkspaceTrusted`);
}
requireTrustedWhen(scmItems, 'safeCodexReview.reviewStaged');
requireTrustedWhen(paletteItems, 'safeCodexReview.reviewStaged');
requireTrustedWhen(paletteItems, 'safeCodexReview.checkEnvironment');
requireTrustedWhen(paletteItems, 'safeCodexReview.importSarif');
requireTrustedWhen(paletteItems, 'safeCodexReview.generateFix');
requireTrustedWhen(paletteItems, 'safeCodexReview.resolveFinding');
requireTrustedWhen(paletteItems, 'safeCodexReview.clearFindingResolutions');

assert.match(source, /function assertTrustedWorkspace\(\)[\s\S]*?!vscode\.workspace\.isTrusted/, 'runtime Workspace Trust guard is missing');
assert.match(source, /async function reviewStaged\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'reviewStaged must enforce Workspace Trust first');
assert.match(source, /async function importSarifEvidence\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'importSarifEvidence must enforce Workspace Trust first');
assert.match(source, /async function generateFixProposal\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'generateFixProposal must enforce Workspace Trust first');
assert.match(source, /async function resolveFinding\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'resolveFinding must enforce Workspace Trust first');
assert.match(source, /async function clearFindingResolutions\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'clearFindingResolutions must enforce Workspace Trust first');
assert.match(source, /async function checkEnvironment\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'checkEnvironment must enforce Workspace Trust first');
assert.doesNotMatch(source, /safeCodexReview\.(?:forceReviewStaged|independentReviewStaged)/, 'retired force/independent review commands must not return');
assert.ok(!(pkg.activationEvents || []).some(value => String(value).includes('independentReviewStaged')), 'Independent Review activation event must be removed');
assert.ok(!(pkg.contributes?.commands || []).some(value => value.command === 'safeCodexReview.independentReviewStaged'), 'Independent Review command must be removed');
assert.match(source, /createReplayWindow/, 'adaptive session Replay Window must be active');

require('../src/codex-safe-core/scripts/verify-consumer-product-contract').verify(root,require('../product-contract.json').safeCoreCommit,'codex-review-safe');
require('./verify-product-docs');

console.log('Review security manifest, machine-local provider overrides, dist-only schema, adaptive-replay trust boundary, retired PR boundary, and product documentation checks passed.');
