'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

function runProcess(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: 'inherit',
      windowsHide: true,
      shell: false
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`VS Code trust test failed (${code ?? signal})`));
    });
  });
}

async function runHost(vscodeExecutablePath, root, suitePath, base, label, trusted) {
  const workspace = trusted
    ? path.join(root, 'test', 'trust', 'trusted-workspace')
    : path.join(base, 'untrusted-workspace');
  const userDataDir = path.join(base, `u-${label}`);
  const extensionsDir = path.join(base, `e-${label}`);

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  if (!trusted) {
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Restricted Mode test workspace\n');
  }

  const args = [
    workspace,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-cached-data',
    '--disable-extensions',
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    `--extensionDevelopmentPath=${root}`,
    `--extensionTestsPath=${suitePath}`
  ];
  if (trusted) args.splice(1, 0, '--disable-workspace-trust');

  console.log(`[trust-test] ${label}: expected workspace.isTrusted=${trusted}`);
  await runProcess(vscodeExecutablePath, args, {
    ...process.env,
    CODEX_REVIEW_TRUST_EXPECTED: String(trusted)
  });
}

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const suitePath = path.resolve(__dirname, 'suite', 'index.js');
  // macOS os.tmpdir() is commonly a long /var/folders/... path. VS Code derives
  // an IPC socket below --user-data-dir and macOS rejects paths beyond 103 bytes.
  // Use /tmp directly on POSIX so Family CI remains valid regardless of checkout depth.
  const base = process.platform === 'win32'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'crt-'))
    : fs.mkdtempSync('/tmp/crt-');

  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    await runHost(vscodeExecutablePath, root, suitePath, base, 'trusted', true);
    await runHost(vscodeExecutablePath, root, suitePath, base, 'untrusted', false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().then(
  () => {
    console.log('[trust-test] complete: trusted and untrusted hosts passed');
    // @vscode/test-electron may leave downloader/helper handles alive even after
    // both VS Code hosts have closed. This file is a standalone test driver, so
    // successful completion is authoritative only after main() and cleanup finish.
    process.exit(0);
  },
  error => {
    console.error(error);
    process.exit(1);
  }
);
