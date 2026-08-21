'use strict';

const fs = require('fs');
const path = require('path');

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertSameKeys(aName, a, bName, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
    const onlyA = aKeys.filter(k => !Object.prototype.hasOwnProperty.call(b, k));
    const onlyB = bKeys.filter(k => !Object.prototype.hasOwnProperty.call(a, k));
    console.error(`${aName}/${bName} localization keys differ.`);
    if (onlyA.length) console.error(`Only in ${aName}: ${onlyA.join(', ')}`);
    if (onlyB.length) console.error(`Only in ${bName}: ${onlyB.join(', ')}`);
    process.exit(2);
  }
}

const manifestEn = load('package.nls.json');
const manifestZh = load('package.nls.zh-cn.json');
const runtimeEn = load('l10n/bundle.l10n.json');
const runtimeZh = load('l10n/bundle.l10n.zh-cn.json');
const pkgText = fs.readFileSync('package.json', 'utf8');
const pkg = JSON.parse(pkgText);

assertSameKeys('package.nls.json', manifestEn, 'package.nls.zh-cn.json', manifestZh);
assertSameKeys('l10n/bundle.l10n.json', runtimeEn, 'l10n/bundle.l10n.zh-cn.json', runtimeZh);

for (const [name, bundle] of [
  ['package.nls.json', manifestEn],
  ['package.nls.zh-cn.json', manifestZh],
  ['l10n/bundle.l10n.json', runtimeEn],
  ['l10n/bundle.l10n.zh-cn.json', runtimeZh]
]) {
  for (const [key, value] of Object.entries(bundle)) {
    if (!key || typeof value !== 'string' || !value.trim()) {
      console.error(`${name} contains an empty/invalid translation for ${JSON.stringify(key)}.`);
      process.exit(3);
    }
  }
}

const referenced = [...pkgText.matchAll(/%([^%]+)%/g)].map(match => match[1]);
for (const key of referenced) {
  if (!(key in manifestEn) || !(key in manifestZh)) {
    console.error(`package.json references missing NLS key: ${key}`);
    process.exit(4);
  }
}
if (pkg.l10n !== './l10n') {
  console.error('package.json must declare "l10n": "./l10n".');
  process.exit(5);
}

const runtimeSourceFiles = [
  'extension.js',
  ...fs.readdirSync('src')
    .filter(name => name.endsWith('.js'))
    .sort()
    .map(name => path.join('src', name))
];

for (const sourceFile of runtimeSourceFiles) {
  const sourceText = fs.readFileSync(sourceFile, 'utf8');
  const runtimeReferenced = [...sourceText.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)]
    .map(match => match[1]
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\'));

  for (const key of runtimeReferenced) {
    if (!(key in runtimeEn) || !(key in runtimeZh)) {
      console.error(`${sourceFile} references missing runtime l10n key: ${key}`);
      process.exit(6);
    }
  }
}

console.log('English/Simplified-Chinese localization bundles and runtime module source references verified.');
