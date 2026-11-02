'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
let quality;
try {
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return {
      extensions: { getExtension: () => undefined },
      workspace: { workspaceFolders: [], textDocuments: [] },
      window: {},
      l10n: { t: message => String(message) }
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  quality = require('../src/quality');
} finally {
  Module._load = originalLoad;
}
const { MAX_SARIF_BYTES, importSarifFile, loadSarifFiles } = quality;

function report(message = 'original finding') {
  return JSON.stringify({ version: '2.1.0', runs: [{
    tool: { driver: { name: 'fixture' } },
    results: [{ ruleId: 'fixture/rule', message: { text: message }, locations: [{
      physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 1 } }
    }] }]
  }] });
}

function fixture(t) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'review-sarif-safety-')));
  const root = path.join(temporary, 'repo');
  const outside = path.join(temporary, 'repo-neighbor');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const file = path.join(root, 'report.sarif');
  fs.writeFileSync(file, report());
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return { temporary, root, outside, file };
}

// Inject changes at descriptor boundaries while retaining real files, stats,
// reads and closes. No report bytes come from mocks or generated source code.
function withFileHooks(file, hooks, run) {
  const original = Object.fromEntries(['openSync', 'fstatSync', 'readSync', 'closeSync'].map(name => [name, fs[name]]));
  const observed = { fd: undefined, stats: 0, reads: 0, bytes: 0, closes: 0 };
  fs.openSync = function(target, flags, ...args) {
    const selected = target === file && typeof flags === 'number' && !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
    if (selected) hooks.beforeOpen?.();
    const fd = original.openSync.call(this, target, flags, ...args);
    if (selected) observed.fd = fd;
    return fd;
  };
  fs.fstatSync = function(fd, ...args) {
    const stat = original.fstatSync.call(this, fd, ...args);
    if (fd === observed.fd) {
      observed.stats++;
      hooks.afterStat?.(stat, observed);
    }
    return stat;
  };
  fs.readSync = function(fd, ...args) {
    const count = original.readSync.call(this, fd, ...args);
    if (fd === observed.fd) {
      observed.reads++;
      observed.bytes += count;
      hooks.afterRead?.(observed);
    }
    return count;
  };
  fs.closeSync = function(fd, ...args) {
    const result = original.closeSync.call(this, fd, ...args);
    if (fd === observed.fd) {
      observed.closes++;
      observed.fd = undefined;
      hooks.afterClose?.();
    }
    return result;
  };
  try {
    run(observed);
  } finally {
    Object.assign(fs, original);
  }
}

test('ordinary SARIF imports and configured reports retain deduplication', t => {
  const { root, file } = fixture(t);
  const findings = importSarifFile(root, file);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'original finding');
  assert.deepEqual(loadSarifFiles(root, ['report.sarif', 'report.sarif']), findings);
});

test('the byte limit accepts its exact boundary and rejects one byte more', t => {
  const { root, file } = fixture(t);
  const text = report('UTF-8 finding: 中文');
  fs.writeFileSync(file, text + ' '.repeat(MAX_SARIF_BYTES - Buffer.byteLength(text)));
  assert.equal(importSarifFile(root, file).length, 1);
  fs.appendFileSync(file, ' ');
  assert.throws(() => importSarifFile(root, file), { code: 'ELOCALFILE' });
});

test('directories and absent reports fail closed', t => {
  const { root } = fixture(t);
  assert.throws(() => importSarifFile(root, root), { code: 'ELOCALFILE' });
  assert.throws(() => loadSarifFiles(root, ['missing.sarif']), /inside the repository/);
});

test('absolute, relative and directory-alias escapes remain outside the repository', t => {
  const { root, outside } = fixture(t);
  const externalFile = path.join(outside, 'report.sarif');
  fs.writeFileSync(externalFile, report('external finding'));
  assert.throws(() => importSarifFile(root, externalFile), /inside the current repository/);
  assert.throws(() => loadSarifFiles(root, ['../repo-neighbor/report.sarif']), /inside the repository/);
  fs.symlinkSync(outside, path.join(root, 'external'), 'junction');
  assert.throws(() => loadSarifFiles(root, ['external/report.sarif']), /inside the repository/);
});

test('workspace reports retain their existing owner and write-permission policy', t => {
  const { root, file } = fixture(t);
  fs.chmodSync(file, 0o666);
  withFileHooks(file, { afterStat(stat) {
    // A readable report may belong to another workspace collaborator. Keep the
    // real descriptor metadata except this simulated ownership boundary.
    if (typeof process.getuid === 'function') stat.uid = process.getuid() + 1;
  } }, () => assert.equal(importSarifFile(root, file).length, 1));
});

test('a real file replaced after descriptor validation is rejected', t => {
  const { root, file } = fixture(t);
  withFileHooks(file, { afterStat(_stat, io) {
    if (io.stats !== 1) return;
    fs.renameSync(file, `${file}.previous`);
    fs.writeFileSync(file, report('replacement finding'));
  } }, io => {
    assert.throws(() => importSarifFile(root, file), { code: 'ELOCALFILE' });
    assert.equal(io.closes, 1);
  });
});

test('a real file replaced during descriptor reading is rejected', t => {
  const { root, file } = fixture(t);
  withFileHooks(file, { afterRead(io) {
    if (io.reads !== 1) return;
    fs.renameSync(file, `${file}.previous`);
    fs.writeFileSync(file, report('replacement finding'));
  } }, io => {
    assert.throws(() => importSarifFile(root, file), { code: 'ELOCALFILE' });
    assert.equal(io.closes, 1);
  });
});

test('growth after validation remains bounded to the byte ceiling plus one', t => {
  const { root, file } = fixture(t);
  withFileHooks(file, { afterStat(_stat, io) {
    if (io.stats === 1) fs.appendFileSync(file, Buffer.alloc(MAX_SARIF_BYTES * 2, 0x20));
  } }, io => {
    assert.throws(() => importSarifFile(root, file), { code: 'ELOCALFILE' });
    assert.ok(io.bytes > 0, 'exercise real descriptor reads after the growth');
    assert.ok(io.bytes <= MAX_SARIF_BYTES + 1, 'never allocate/read the entire enlarged report');
    assert.equal(io.closes, 1);
  });
});

test('growth within the byte ceiling is still a changed report', t => {
  const { root, file } = fixture(t);
  withFileHooks(file, { afterStat(_stat, io) {
    if (io.stats === 1) fs.appendFileSync(file, ' ');
  } }, () => assert.throws(() => importSarifFile(root, file), { code: 'ELOCALFILE' }));
});

test('an ancestor redirected outside after containment cannot supply findings', t => {
  const { root, outside } = fixture(t);
  const directory = path.join(root, 'reports');
  fs.mkdirSync(directory);
  const file = path.join(directory, 'report.sarif');
  fs.writeFileSync(file, report());
  fs.writeFileSync(path.join(outside, 'report.sarif'), report('external finding'));
  withFileHooks(file, { beforeOpen() {
    fs.renameSync(directory, `${directory}.previous`);
    fs.symlinkSync(outside, directory, 'junction');
  } }, () => assert.throws(() => loadSarifFiles(root, ['reports/report.sarif']), /inside the repository/));
});

test('an in-repository alias must still resolve to the original report after reading', t => {
  const { root, file } = fixture(t);
  const alternate = path.join(root, 'alternate');
  const alias = path.join(root, 'alias');
  fs.mkdirSync(alternate);
  fs.writeFileSync(path.join(alternate, 'report.sarif'), report('other finding'));
  fs.symlinkSync(root, alias, 'junction');
  assert.equal(loadSarifFiles(root, ['alias/report.sarif']).length, 1);
  withFileHooks(file, { afterClose() {
    fs.unlinkSync(alias);
    fs.symlinkSync(alternate, alias, 'junction');
  } }, () => assert.throws(() => loadSarifFiles(root, ['alias/report.sarif']), /inside the repository/));
});

test('redirecting the repository root itself cannot replace the resolved report', t => {
  const { root, file, outside } = fixture(t);
  fs.writeFileSync(path.join(outside, 'report.sarif'), report('external finding'));
  withFileHooks(file, { beforeOpen() {
    fs.renameSync(root, `${root}.previous`);
    fs.symlinkSync(outside, root, 'junction');
  } }, () => assert.throws(() => importSarifFile(root, file), /inside the repository/));
});
