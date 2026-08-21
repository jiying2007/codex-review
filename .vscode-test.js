'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineConfig } = require('@vscode/test-cli');

const root = __dirname;
const runId = `${process.pid}-${Date.now()}`;
const untrustedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-safe-untrusted-workspace-'));
fs.writeFileSync(path.join(untrustedWorkspace, 'README.md'), '# Untrusted Workspace Trust fixture\n');
process.on('exit', () => {
  try { fs.rmSync(untrustedWorkspace, { recursive: true, force: true }); } catch {}
});

function userData(name) {
  return path.join(os.tmpdir(), `codex-review-safe-${name}-${runId}`);
}

module.exports = defineConfig([
  {
    label: 'workspace-trust-trusted',
    files: 'test/trust/**/*.test.js',
    extensionDevelopmentPath: root,
    workspaceFolder: path.join(root, 'test', 'trust', 'trusted-workspace'),
    launchArgs: [
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes'
    ],
    env: {
      CODEX_REVIEW_TRUST_EXPECTED: 'true'
    },
    mocha: {
      timeout: 10000
    }
  },
  {
    label: 'workspace-trust-untrusted',
    files: 'test/trust/**/*.test.js',
    extensionDevelopmentPath: root,
    workspaceFolder: untrustedWorkspace,
    launchArgs: [
      '--disable-extensions',
      '--user-data-dir',
      userData('untrusted'),
      '--skip-welcome',
      '--skip-release-notes'
    ],
    env: {
      CODEX_REVIEW_TRUST_EXPECTED: 'false'
    },
    mocha: {
      timeout: 10000
    }
  }
]);
