'use strict';

const assert = require('assert');
const vscode = require('vscode');

const EXTENSION_ID = 'jiying2007.codex-review-safe';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

suite('Workspace Trust', () => {
  test('matches the configured trust state and enforces activation boundaries', async () => {
    const expected = process.env.CODEX_REVIEW_TRUST_EXPECTED;
    assert.ok(expected === 'true' || expected === 'false', 'test configuration must declare CODEX_REVIEW_TRUST_EXPECTED');
    const shouldBeTrusted = expected === 'true';

    assert.strictEqual(
      vscode.workspace.isTrusted,
      shouldBeTrusted,
      `workspace trust mismatch: expected ${shouldBeTrusted}, got ${vscode.workspace.isTrusted}`
    );

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'Codex Review Safe development extension must be present');

    if (shouldBeTrusted) {
      const api = await extension.activate();
      assert.ok(extension.isActive, 'extension must activate in a trusted workspace');
      assert.strictEqual(api?.contractVersion, 1, 'trusted activation must preserve the public API contract');
      return;
    }

    assert.strictEqual(extension.isActive, false, 'extension must start inactive in Restricted Mode');

    for (const command of [
      'safeCodexReview.reviewStaged',
      'safeCodexReview.checkEnvironment'
    ]) {
      try {
        await vscode.commands.executeCommand(command);
      } catch {
        // VS Code may reject a contributed command while its extension is disabled by Workspace Trust.
      }
    }

    await wait(200);
    assert.strictEqual(
      extension.isActive,
      false,
      'review/environment commands must not bypass Workspace Trust and activate the extension'
    );
    assert.strictEqual(vscode.workspace.isTrusted, false, 'the workspace must remain untrusted throughout the test');
  });
});
