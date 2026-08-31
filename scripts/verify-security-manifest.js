'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const source = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');

assert.strictEqual(pkg.capabilities?.untrustedWorkspaces?.supported, false, 'untrustedWorkspaces.supported must remain false');
assert.strictEqual(pkg.capabilities?.virtualWorkspaces?.supported, false, 'virtualWorkspaces.supported must remain false');
assert.deepStrictEqual(pkg.extensionKind, ['workspace'], 'extensionKind must remain workspace');

for (const [key, value] of Object.entries(pkg.contributes?.configuration?.properties || {})) {
  const expected = key === 'safeCodexReview.codexPath' ? 'machine' : 'application';
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
assert.ok(!scmItems.some(entry => entry.command === 'safeCodexReview.independentReviewStaged'), 'Independent Review must remain a secondary action outside scm/title');
requireTrustedWhen(paletteItems, 'safeCodexReview.reviewStaged');
requireTrustedWhen(paletteItems, 'safeCodexReview.checkEnvironment');
requireTrustedWhen(paletteItems, 'safeCodexReview.importSarif');
requireTrustedWhen(paletteItems, 'safeCodexReview.generateFix');
requireTrustedWhen(paletteItems, 'safeCodexReview.independentReviewStaged');
requireTrustedWhen(paletteItems, 'safeCodexReview.resolveFinding');
requireTrustedWhen(paletteItems, 'safeCodexReview.clearFindingResolutions');

assert.match(source, /function assertTrustedWorkspace\(\)[\s\S]*?!vscode\.workspace\.isTrusted/, 'runtime Workspace Trust guard is missing');
assert.match(source, /async function reviewStaged\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'reviewStaged must enforce Workspace Trust first');
assert.match(source, /async function independentReviewStaged\([^)]*\)\s*\{\s*return reviewStaged\([^;]*mode:\s*'independent'/, 'independentReviewStaged must delegate to the trusted reviewStaged controller in independent mode');
assert.match(source, /async function importSarifEvidence\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'importSarifEvidence must enforce Workspace Trust first');
assert.match(source, /async function generateFixProposal\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'generateFixProposal must enforce Workspace Trust first');
assert.match(source, /async function resolveFinding\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'resolveFinding must enforce Workspace Trust first');
assert.match(source, /async function clearFindingResolutions\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'clearFindingResolutions must enforce Workspace Trust first');
assert.match(source, /async function checkEnvironment\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'checkEnvironment must enforce Workspace Trust first');
assert.doesNotMatch(source, /safeCodexReview\.forceReviewStaged/, 'retired force-review command must not return');

require('../src/codex-safe-core/scripts/verify-consumer-product-contract').verify(root,require('../product-contract.json').safeCoreCommit,'codex-review-safe');
require('./verify-product-docs');

console.log('Review security manifest, dist-only schema, independent-review trust boundary, retired PR boundary, and product documentation checks passed.');
