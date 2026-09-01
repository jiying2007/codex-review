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

console.log('Review security manifest, dist-only schema, adaptive-replay trust boundary, retired PR boundary, and product documentation checks passed.');
