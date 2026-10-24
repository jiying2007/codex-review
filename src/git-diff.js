'use strict';

// Repository paths and Git's a/ / b/ presentation prefixes are different types.
// Only diff header parsing removes a presentation prefix, exactly once.
function normalizeRepositoryPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function decodeGitPath(raw) {
  if (!raw.startsWith('"')) return raw.split('\t', 1)[0];
  if (!raw.endsWith('"')) throw new Error('Unterminated quoted Git diff path.');
  const bytes = [];
  const escapes = { a:7, b:8, t:9, n:10, v:11, f:12, r:13, '"':34, '\\':92 };
  for (let index = 1; index < raw.length - 1; index++) {
    const character = raw[index];
    if (character !== '\\') {
      const codepoint = raw.codePointAt(index);
      const text = String.fromCodePoint(codepoint);
      bytes.push(...Buffer.from(text, 'utf8'));
      index += text.length - 1;
      continue;
    }
    const escaped = raw[++index];
    if (escaped in escapes) { bytes.push(escapes[escaped]); continue; }
    const octal = raw.slice(index).match(/^[0-7]{1,3}/)?.[0];
    if (!octal) throw new Error('Invalid quoted Git diff path escape.');
    bytes.push(parseInt(octal, 8));
    index += octal.length - 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

function headerPath(raw, prefix) {
  const decoded = decodeGitPath(raw);
  if (decoded === '/dev/null') return '';
  return normalizeRepositoryPath(decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded);
}

function parseGitDiff(diff = '') {
  const sections = [];
  let section = null, oldLine = 0, newLine = 0, inHunk = false;
  for (const raw of String(diff || '').split(/\r?\n/)) {
    const header = raw.match(/^diff --git ("(?:\\.|[^"])*"|a\/.*?) ("(?:\\.|[^"])*"|b\/.*)$/);
    if (header) {
      section = { oldPath:headerPath(header[1], 'a/'), newPath:headerPath(header[2], 'b/'), lines:[raw], oldLines:new Map(), newLines:new Map() };
      sections.push(section); oldLine = 0; newLine = 0; inHunk = false;
      continue;
    }
    if (!section) continue;
    section.lines.push(raw);
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; continue; }
    if (!inHunk) {
      if (raw.startsWith('--- ')) section.oldPath = headerPath(raw.slice(4), 'a/');
      else if (raw.startsWith('+++ ')) section.newPath = headerPath(raw.slice(4), 'b/');
      continue;
    }
    // Inside a hunk, +++counter and ---counter are source changes, not headers.
    if (raw.startsWith('-')) { if (oldLine > 0) section.oldLines.set(oldLine, raw.slice(1)); oldLine++; }
    else if (raw.startsWith('+')) { if (newLine > 0) section.newLines.set(newLine, raw.slice(1)); newLine++; }
    else if (raw.startsWith(' ')) { oldLine++; newLine++; }
  }
  return sections.map(section => ({ ...section, path:section.newPath || section.oldPath, text:section.lines.join('\n') }));
}

module.exports = { normalizeRepositoryPath, decodeGitPath, headerPath, parseGitDiff };
