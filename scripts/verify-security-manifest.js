'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const source = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');

assert.strictEqual(
  pkg.capabilities?.untrustedWorkspaces?.supported,
  false,
  'untrustedWorkspaces.supported must remain false'
);
assert.strictEqual(
  pkg.capabilities?.virtualWorkspaces?.supported,
  false,
  'virtualWorkspaces.supported must remain false'
);

for (const [key, value] of Object.entries(pkg.contributes?.configuration?.properties || {})) {
  assert.strictEqual(value.scope, 'application', `${key} must remain application-scoped`);
}

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

assert.match(source, /function assertTrustedWorkspace\(\)[\s\S]*?!vscode\.workspace\.isTrusted/, 'runtime Workspace Trust guard is missing');
assert.match(source, /async function reviewStaged[\s\S]*?assertTrustedWorkspace\(\)/, 'reviewStaged must enforce Workspace Trust');
assert.match(source, /async function checkEnvironment[\s\S]*?assertTrustedWorkspace\(\)/, 'checkEnvironment must enforce Workspace Trust');

console.log('Security manifest/trust-boundary regression checks passed.');
