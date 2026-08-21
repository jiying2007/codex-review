'use strict';

const assert = require('assert');
const vscode = require('vscode');

async function executeWithoutActivation(command) {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // Commands may be unavailable while the extension is disabled by Workspace Trust.
  }
}

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

  assert.strictEqual(extension.isActive, false, 'extension must start inactive in Restricted Mode');
  await executeWithoutActivation('safeCodexReview.reviewStaged');
  await executeWithoutActivation('safeCodexReview.checkEnvironment');
  assert.strictEqual(extension.isActive, false, 'review commands must not activate the extension in Restricted Mode');
  assert.strictEqual(vscode.workspace.isTrusted, false, 'Restricted Mode must remain active');
  console.log('[trust-test] untrusted: workspace.isTrusted=false and review activation remained blocked');
}

module.exports = { run };
