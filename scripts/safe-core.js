'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const coreDir = path.join(root, 'src', 'codex-safe-core');
const lockPath = path.join(root, 'safe-core.lock.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(message) {
  const error = new Error(message);
  error.code = 'ESAFECORE';
  throw error;
}

function sameSource(a, b) {
  return Boolean(a && b && a.repository === b.repository && a.ref === b.ref && a.path === b.path);
}

function verify() {
  const lock = readJson(lockPath);
  const manifestPath = path.join(coreDir, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));

  if (lock.schemaVersion !== 1 || manifest.schemaVersion !== 1) fail('Unsupported Safe Core schema version.');
  if (lock.safeCoreVersion !== manifest.safeCoreVersion) fail('Safe Core version differs between lock and manifest.');
  if (!sameSource(lock.source, manifest.source)) fail('Safe Core source differs between lock and manifest.');
  if (sha256(manifestBytes) !== lock.manifestSha256) fail('Vendored Safe Core manifest hash does not match safe-core.lock.json.');

  const names = Object.keys(manifest.files || {}).sort();
  if (!names.length) fail('Safe Core manifest has no runtime files.');
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(lock.files || {}).sort())) fail('Safe Core lock file list differs from manifest.');

  for (const name of names) {
    const expected = manifest.files[name];
    if (lock.files[name] !== expected) fail(`Safe Core lock hash differs for ${name}.`);
    const actual = sha256(fs.readFileSync(path.join(coreDir, name)));
    if (actual !== expected) fail(`Vendored Safe Core file hash mismatch: ${name}.`);
  }

  console.log(`Safe Core v${manifest.safeCoreVersion} verified (${names.join(', ')}).`);
  return { lock, manifest };
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'codex-safe-core-sync', Accept: 'application/octet-stream' }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return getText(response.headers.location).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Safe Core download failed (${response.statusCode}): ${url}`));
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(15000, () => request.destroy(new Error(`Safe Core download timed out: ${url}`)));
    request.on('error', reject);
  });
}

function rawUrl(source, name) {
  const [owner, repo] = String(source.repository).split('/');
  if (!owner || !repo || !source.ref || !source.path) fail('Safe Core source is invalid.');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(source.ref)}/${source.path}/${name}`;
}

async function fetchUpstream() {
  const lock = readJson(lockPath);
  const manifestBytes = await getText(rawUrl(lock.source, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!sameSource(lock.source, manifest.source)) fail('Upstream Safe Core source identity changed.');

  const files = {};
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const bytes = await getText(rawUrl(lock.source, name));
    if (sha256(bytes) !== expected) fail(`Upstream Safe Core manifest/file hash mismatch: ${name}.`);
    files[name] = bytes;
  }
  return { manifest, manifestBytes, files };
}

async function verifyUpstream() {
  const lock = readJson(lockPath);
  const upstream = await fetchUpstream();
  if (sha256(upstream.manifestBytes) !== lock.manifestSha256) {
    fail('Locked Safe Core manifest differs from canonical upstream; run `node scripts/safe-core.js sync` and review the diff.');
  }
  for (const [name, expected] of Object.entries(lock.files || {})) {
    if (upstream.manifest.files?.[name] !== expected) fail(`Locked upstream hash drifted: ${name}.`);
  }
  verify();
  console.log('Safe Core upstream lock verified.');
}

async function sync() {
  const upstream = await fetchUpstream();
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'manifest.json'), upstream.manifestBytes);
  for (const [name, bytes] of Object.entries(upstream.files)) fs.writeFileSync(path.join(coreDir, name), bytes);

  const nextLock = {
    schemaVersion: 1,
    safeCoreVersion: upstream.manifest.safeCoreVersion,
    source: upstream.manifest.source,
    manifestSha256: sha256(upstream.manifestBytes),
    files: upstream.manifest.files
  };
  fs.writeFileSync(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`);
  verify();
  console.log('Safe Core synchronized from canonical upstream; review and commit the resulting diff.');
}

async function main() {
  const command = process.argv[2] || 'verify';
  if (command === 'verify') return verify();
  if (command === 'upstream') return verifyUpstream();
  if (command === 'sync') return sync();
  fail(`Unknown command: ${command}. Use verify, upstream, or sync.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Safe Core check failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { verify, verifyUpstream, sync, sha256 };
