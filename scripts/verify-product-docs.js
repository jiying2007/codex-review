'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../product-contract.json');

const root = path.resolve(__dirname, '..');
const required = ['README.md','README.zh-CN.md','docs/GETTING_STARTED.md','docs/GETTING_STARTED.zh-CN.md','SUPPORT.md','SECURITY.md','PUBLISHING.md','VERIFY_RELEASE.md'];
for (const name of required) assert.ok(fs.existsSync(path.join(root, name)), `missing product document: ${name}`);

const docs = required.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const readmes = `${fs.readFileSync(path.join(root,'README.md'),'utf8')}\n${fs.readFileSync(path.join(root,'README.zh-CN.md'),'utf8')}`;
assert.match(docs, /Review Receipt v4/);
assert.match(docs, /Safe Contract v2/);
assert.match(docs, /Policy Schema v4|schemaVersion: 4/);
assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /First successful review/);
assert.match(fs.readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8'), /第一次成功 Review/);
assert.match(docs, new RegExp(contract.safeCoreCommit));
assert.match(readmes, /Codex Change Safe/);
assert.match(readmes, /\.codex-safe\.json/);
assert.doesNotMatch(readmes, /Policy Schema v3|schemaVersion: 3|\.codex-change-safe\.json/);
assert.doesNotMatch(docs, /4dc4de836625a8b70084531eb3321734eca675d0|d49dc356824b984166e81e42bb5f9d7abfb90099|6c0417a376179c295433c18b1b077854d290243d/);
assert.doesNotMatch(readmes, /Safe Core v[123]\b|Review Receipt v[123]\b/);

console.log('Review product documentation verified for Policy Schema v4 and Change Safe family flow.');
