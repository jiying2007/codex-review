'use strict';

const path = require('node:path');

const REVIEW_CACHE_STORAGE_KEY = 'safeCodexReview.evidenceCache.v3';
const LEGACY_REVIEW_CACHE_STORAGE_KEYS = ['safeCodexReview.reviewArtifacts.v2', 'safeCodexReview.semanticRuns.v1'];
const MAX_EVIDENCE_ENTRIES_PER_REPO = 8;
const MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO = 8 * 1024 * 1024;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function repoKey(repoRoot) { const resolved=path.resolve(String(repoRoot||'')); return process.platform==='win32'?resolved.toLowerCase():resolved; }
function validHex64(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function serializeStructuralEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  return {
    impact: clone(evidence.impact || {}),
    callSymbolsByPath: evidence.callSymbolsByPath instanceof Map ? [...evidence.callSymbolsByPath.entries()].map(([k,v])=>[String(k),clone(v)]) : Object.entries(evidence.callSymbolsByPath||{}).map(([k,v])=>[String(k),clone(v)]),
    blocks: clone(evidence.blocks || []),
    manifest: clone(evidence.manifest || {})
  };
}
function hydrateStructuralEvidence(serialized) {
  if (!serialized || typeof serialized !== 'object') return null;
  return { impact:clone(serialized.impact||{}), callSymbolsByPath:new Map(Array.isArray(serialized.callSymbolsByPath)?clone(serialized.callSymbolsByPath):[]), blocks:clone(serialized.blocks||[]), manifest:clone(serialized.manifest||{}) };
}
function entryBytes(entry) { return Buffer.byteLength(JSON.stringify(entry?.structuralEvidence || {}),'utf8'); }

function createReviewCache(globalState) {
  const evidenceByRepo=new Map();
  function restore() {
    evidenceByRepo.clear();
    const stored=globalState?.get(REVIEW_CACHE_STORAGE_KEY,{})||{};
    for (const [repo,entries] of Object.entries(stored.evidence||{})) {
      if(!Array.isArray(entries)) continue;
      const valid=entries.filter(e=>e&&validHex64(e.evidenceKey)&&validHex64(e.structuralManifestDigest)&&e.structuralEvidence&&typeof e.structuralEvidence==='object').slice(0,MAX_EVIDENCE_ENTRIES_PER_REPO);
      if(valid.length)evidenceByRepo.set(repo,valid);
    }
  }
  async function flush() {
    if(!globalState)return;
    const evidence={};
    for(const [repo,entries] of evidenceByRepo.entries()){
      let bytes=0; const kept=[];
      for(const entry of entries.slice(0,MAX_EVIDENCE_ENTRIES_PER_REPO)){
        const size=entryBytes(entry); if(size<=0||bytes+size>MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO)continue; bytes+=size; kept.push(entry);
      }
      if(kept.length)evidence[repo]=kept;
    }
    await globalState.update(REVIEW_CACHE_STORAGE_KEY,{version:3,evidence});
  }
  function getEvidence(repoRoot,evidenceKey){const hit=(evidenceByRepo.get(repoKey(repoRoot))||[]).find(e=>e.evidenceKey===evidenceKey);return hit?{evidenceKey:hit.evidenceKey,structuralManifestDigest:hit.structuralManifestDigest,createdAt:hit.createdAt,structuralEvidence:hydrateStructuralEvidence(hit.structuralEvidence)}:null;}
  async function putEvidence(repoRoot,input){
    if(!input||!validHex64(input.evidenceKey)||!validHex64(input.structuralManifestDigest))throw new Error('Evidence cache entry requires evidenceKey and structural Evidence Manifest digest values.');
    const structuralEvidence=serializeStructuralEvidence(input.structuralEvidence); if(!structuralEvidence?.manifest)throw new Error('Evidence cache entry requires immutable structural evidence.');
    const key=repoKey(repoRoot),compact={evidenceKey:input.evidenceKey,structuralManifestDigest:input.structuralManifestDigest,createdAt:String(input.createdAt||new Date().toISOString()),structuralEvidence};
    evidenceByRepo.set(key,[compact,...(evidenceByRepo.get(key)||[]).filter(x=>x.evidenceKey!==compact.evidenceKey)].slice(0,MAX_EVIDENCE_ENTRIES_PER_REPO)); await flush(); return getEvidence(repoRoot,input.evidenceKey);
  }
  function listEvidence(repoRoot){return (evidenceByRepo.get(repoKey(repoRoot))||[]).map(e=>({evidenceKey:e.evidenceKey,structuralManifestDigest:e.structuralManifestDigest,createdAt:e.createdAt}));}
  async function purgeLegacy(){for(const key of LEGACY_REVIEW_CACHE_STORAGE_KEYS)if(globalState?.get(key,undefined)!==undefined)await globalState.update(key,undefined);}
  async function clear(repoRoot){if(repoRoot)evidenceByRepo.delete(repoKey(repoRoot));else evidenceByRepo.clear();await flush();if(!repoRoot)await purgeLegacy();}
  return {restore,getEvidence,putEvidence,listEvidence,purgeLegacy,clear};
}
module.exports={REVIEW_CACHE_STORAGE_KEY,LEGACY_REVIEW_CACHE_STORAGE_KEYS,MAX_EVIDENCE_ENTRIES_PER_REPO,MAX_PERSISTED_EVIDENCE_BYTES_PER_REPO,serializeStructuralEvidence,hydrateStructuralEvidence,createReviewCache};
