'use strict';

const assert = require('assert');
const vscode = require('vscode');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function executeWithoutActivation(command) {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // A contributed command may be unavailable while its extension is disabled by Workspace Trust.
  }
}

async function run() {
  assert.strictEqual(vscode.workspace.isTrusted, false, 'workspace must start in Restricted Mode');

  const extension = vscode.extensions.getExtension('jiying2007.codex-review-safe');
  assert.ok(extension, 'Codex Review Safe extension must be installed in the Extension Host');
  assert.strictEqual(extension.isActive, false, 'extension must not activate in an untrusted workspace');

  await executeWithoutActivation('safeCodexReview.reviewStaged');
  await executeWithoutActivation('safeCodexReview.checkEnvironment');
  await wait(100);

  assert.strictEqual(extension.isActive, false, 'review commands must not bypass Workspace Trust and activate the extension');
  assert.strictEqual(vscode.workspace.isTrusted, false, 'the test workspace must remain untrusted');

  console.log('Codex Review Safe Restricted Mode integration test passed.');
}

module.exports = { run };
