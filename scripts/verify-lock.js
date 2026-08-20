'use strict';

const fs = require('fs');

if (!fs.existsSync('package-lock.json')) {
  console.error(
    'package-lock.json is required for a reproducible official release. ' +
    'Generate it with npm install --package-lock-only, review it, and commit it.'
  );
  process.exit(2);
}

const pkg = require('../package.json');
const lock = require('../package-lock.json');
const root = lock.packages && lock.packages[''];

if (!root) {
  console.error('package-lock.json is missing the root package metadata.');
  process.exit(3);
}

if (root.name && root.name !== pkg.name) {
  console.error('package-lock.json root package name does not match package.json.');
  process.exit(4);
}

if (JSON.stringify(root.devDependencies) !== JSON.stringify(pkg.devDependencies)) {
  console.error('package-lock.json root devDependencies do not match package.json.');
  process.exit(5);
}

console.log('package-lock.json verified.');
