'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, text) => fs.writeFileSync(path.join(root, p), text);
const fail = message => { throw new Error(message); };

function rewrite(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  let text = fs.readFileSync(full, 'utf8');
  text = text.replaceAll("require('./src/safe-contract')", "require('./src/codex-safe-core/safe-contract')");
  text = text.replaceAll("require('./safe-contract')", "require('./codex-safe-core/safe-contract')");
  text = text.replaceAll("require('../src/safe-contract')", "require('../src/codex-safe-core/safe-contract')");
  fs.writeFileSync(full, text);
}

for (const file of ['extension.js', 'test.js']) rewrite(file);
for (const dir of ['src', 'test', 'scripts']) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) continue;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.js')) rewrite(path.relative(root, full));
    }
  };
  visit(base);
}

const wrapper = path.join(root, 'src', 'safe-contract.js');
if (!fs.existsSync(wrapper)) fail('Missing transition wrapper src/safe-contract.js');
fs.unlinkSync(wrapper);

const pkg = JSON.parse(read('package.json'));
let check = String(pkg.scripts?.check || '');
check = check.replace('node --check src/safe-contract.js && ', '');
if (!check.includes('node --check src/codex-safe-core/safe-contract.js')) {
  check = check.replace('node --check src/codex.js && ', 'node --check src/codex.js && node --check src/codex-safe-core/safe-contract.js && node --check src/codex-safe-core/codex-cli.js && ');
}
if (check.includes('src/safe-contract.js')) fail('Legacy wrapper check remains in package.json');
pkg.scripts.check = check;
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  let text = read(workflow);
  const before = 'for module in safe-contract i18n core process git policy review codex; do';
  if (!text.includes(before)) fail(`Legacy VSIX module list not found in ${workflow}`);
  text = text.replace(before, 'for module in i18n core process git policy review codex; do');
  write(workflow, text);
}

let publishing = read('PUBLISHING.md');
if (!publishing.includes('- `src/safe-contract.js`\n')) fail('Legacy package documentation entry not found');
publishing = publishing.replace('- `src/safe-contract.js`\n', '');
write('PUBLISHING.md', publishing);

const manifestPath = 'src/codex-safe-core/manifest.json';
const manifest = JSON.parse(read(manifestPath));
manifest.source.ref = 'main';
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
write(manifestPath, manifestText);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
for (const [name, expected] of Object.entries(manifest.files || {})) {
  const actual = sha256(fs.readFileSync(path.join(root, 'src', 'codex-safe-core', name)));
  if (actual !== expected) fail(`Safe Core runtime hash mismatch: ${name}`);
}
const lock = JSON.parse(read('safe-core.lock.json'));
lock.source = { ...manifest.source };
lock.safeCoreVersion = manifest.safeCoreVersion;
lock.manifestSha256 = sha256(Buffer.from(manifestText, 'utf8'));
lock.files = { ...manifest.files };
write('safe-core.lock.json', `${JSON.stringify(lock, null, 2)}\n`);

const scanFiles = ['extension.js', 'test.js', ...fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).map(name => `src/${name}`)];
for (const file of scanFiles) {
  const text = read(file);
  if (text.includes("require('./safe-contract')") || text.includes('src/safe-contract')) fail(`Transition wrapper reference remains in ${file}`);
}
for (const file of ['package.json', '.github/workflows/ci.yml', '.github/workflows/release.yml', 'PUBLISHING.md']) {
  if (read(file).includes('src/safe-contract.js')) fail(`Legacy packaged shim reference remains in ${file}`);
}
if (read(manifestPath).includes('safe-core-v1') || read('safe-core.lock.json').includes('safe-core-v1')) fail('Legacy Safe Core branch remains in source metadata');

console.log('Final transition cleanup applied for Codex Review Safe.');
