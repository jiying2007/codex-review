'use strict';

const assert = require('assert');
const vscode = require('vscode');

async function run() {
  assert.strictEqual(vscode.workspace.isTrusted, false, 'workspace must start in Restricted Mode');

  const extension = vscode.extensions.getExtension('jiying2007.codex-review-safe');
  assert.ok(extension, 'Codex Review Safe extension must be installed in the Extension Host');
  assert.strictEqual(extension.isActive, false, 'extension must not activate in an untrusted workspace');

  const commands = new Set(await vscode.commands.getCommands(true));
  assert.strictEqual(commands.has('safeCodexReview.reviewStaged'), false, 'review command must not be registered in Restricted Mode');
  assert.strictEqual(commands.has('safeCodexReview.checkEnvironment'), false, 'environment command must not be registered in Restricted Mode');

  console.log('Codex Review Safe Restricted Mode integration test passed.');
}

module.exports = { run };
