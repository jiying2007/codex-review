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

assert.match(source, /function assertTrustedWorkspace\(\)[\s\S]*?!vscode\.workspace\.isTrusted/, 'runtime Workspace Trust guard is missing');
assert.match(source, /async function reviewStaged\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'reviewStaged must enforce Workspace Trust first');
assert.match(source, /async function importSarifEvidence\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'importSarifEvidence must enforce Workspace Trust first');
assert.match(source, /async function generateFixProposal\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'generateFixProposal must enforce Workspace Trust first');
assert.match(source, /async function checkEnvironment\([^)]*\)\s*\{\s*assertTrustedWorkspace\(\);/, 'checkEnvironment must enforce Workspace Trust first');

require('./verify-product-docs');

console.log('Review security manifest, dist-only schema, trust boundary, and product documentation checks passed.');
