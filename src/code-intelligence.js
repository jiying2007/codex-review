'use strict';

const { normalizeGitPathForComparison } = require('./review-support');
const { normalizeEvidenceEntry } = require('./codex-safe-core/semantic-review');

const MAX_DISCOVERY_CANDIDATES = 128;

function normalizeDiscoveryCandidate(raw = {}) {
  const path = normalizeGitPathForComparison(raw.path);
  const line = Math.max(1, Math.floor(Number(raw.line) || 1));
  const symbol = String(raw.symbol || '').trim().slice(0, 256);
  const provider = String(raw.provider || 'external-index').trim().slice(0, 80) || 'external-index';
  const kind = ['definition','declaration','implementation','reference'].includes(String(raw.kind)) ? String(raw.kind) : 'reference';
  if (!path || !symbol) return null;
  return Object.freeze({ path, line, symbol, provider, kind });
}

async function rehydrateDiscoveryCandidates(candidates, { readIndexText, snippet, classifySymbolLine, relatedPaths = [] } = {}) {
  if (typeof readIndexText !== 'function' || typeof snippet !== 'function' || typeof classifySymbolLine !== 'function') throw new TypeError('Index-safe discovery rehydration requires controller-owned index readers.');
  const normalized = (Array.isArray(candidates) ? candidates : []).map(normalizeDiscoveryCandidate).filter(Boolean).slice(0, MAX_DISCOVERY_CANDIDATES);
  const cache = new Map(), blocks = [];
  for (const candidate of normalized) {
    let content = cache.get(candidate.path);
    if (content === undefined) { content = await readIndexText(candidate.path); cache.set(candidate.path, content); }
    if (content == null) continue;
    const part = snippet(content, candidate.line);
    const lineText = String(content).split(/\r?\n/)[candidate.line - 1] || '';
    const inferred = classifySymbolLine(lineText, candidate.symbol);
    const kind = candidate.kind === 'definition' || candidate.kind === 'implementation' ? 'symbol-definition' : candidate.kind === 'declaration' ? 'symbol-declaration' : inferred;
    const entry = normalizeEvidenceEntry({ kind, source:`discovery:${candidate.provider}`, path:candidate.path, symbol:candidate.symbol, line:part.start, endLine:part.end, content:part.text, relatedPaths });
    blocks.push({ entry, content:part.text });
  }
  return blocks;
}

module.exports = { MAX_DISCOVERY_CANDIDATES, normalizeDiscoveryCandidate, rehydrateDiscoveryCandidates };
