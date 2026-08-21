'use strict';

const assert = require('assert');
const vscode = require('vscode');

async function run() {
  const expected = process.env.CODEX_REVIEW_TRUST_EXPECTED === 'true';
  assert.strictEqual(vscode.workspace.isTrusted, expected, 'workspace trust mismatch');

  const extension = vscode.extensions.getExtension('jiying2007.codex-review-safe');
  assert.ok(extension, 'Codex Review Safe extension must be present in the Extension Host');

  if (expected) {
    const api = await extension.activate();
    assert.strictEqual(extension.isActive, true, 'extension must activate in a trusted workspace');
    assert.strictEqual(api?.contractVersion, 1, 'trusted activation must preserve the public API contract');
    console.log('[trust-test] trusted: workspace.isTrusted=true and extension activation succeeded');
    return;
  }

  // Extension Development Host may load/activate a development extension more permissively
  // than a normally installed extension. The runtime command guards are verified separately
  // as first-statement invariants by scripts/verify-security-manifest.js.
  assert.strictEqual(extension.isActive, false, 'extension must start inactive in Restricted Mode');
  assert.strictEqual(vscode.workspace.isTrusted, false, 'Restricted Mode must be active');
  console.log('[trust-test] untrusted: workspace.isTrusted=false and extension starts inactive');
}

module.exports = { run };
