'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'test'), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => path.join('test', entry.name)).sort();
if (!files.length) throw new Error('No unit test files discovered.');
// Only direct unit files belong here. Extension Host suites keep their separate
// runners, platform matrix and workspace-trust setup.
const result = spawnSync(process.execPath,
  ['--test', '--test-concurrency=1', 'test.js', ...files],
  { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
