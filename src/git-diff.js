'use strict';

const { decodeGitQuotedPath, parseGitDiffHeaderPaths, parseGitFileHeaderPath } = require('./codex-safe-core/context-builder');

// Repository paths and Git's a/ / b/ presentation prefixes are different types.
// Only diff header parsing removes a presentation prefix, exactly once.
function normalizeRepositoryPath(value) {
  return String(value || '');
}

function decodeGitPath(raw) {
  // Git appends a literal tab after ---/+++ names containing spaces, including
  // quoted names. A tab inside a quoted filename is C-escaped as backslash+t.
  return decodeGitQuotedPath(String(raw).split('\t', 1)[0]);
}

function headerPath(raw, prefix) {
  const marker = prefix === 'a/' ? '--- ' : '+++ ';
  const decoded = parseGitFileHeaderPath(marker + raw, marker);
  if (decoded === '/dev/null') return '';
  return decoded;
}

function parseGitDiff(diff = '') {
  const sections = [];
  let section = null, oldLine = 0, newLine = 0, inHunk = false;
  for (const raw of String(diff || '').split(/\r?\n/)) {
    // A backslash belongs only to the escape branch. Overlapping alternatives
    // make unterminated quoted paths backtrack exponentially.
    if (raw.startsWith('diff --git ')) {
      const header = parseGitDiffHeaderPaths(raw);
      if (!header) throw new Error('Invalid or ambiguous Git diff path header.');
      section = { oldPath:header.old, newPath:header.new, lines:[raw], oldLines:new Map(), newLines:new Map() };
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
