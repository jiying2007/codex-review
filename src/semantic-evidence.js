'use strict';

const { git } = require('./git');
const { normalizeGitPathForComparison } = require('./review-support');
const {
  extractCallSymbols,
  normalizeEvidenceEntry,
  buildEvidenceManifest,
  digestAnalyzerEvidence,
  selectEvidenceForPaths,
  sha256
} = require('./codex-safe-core/semantic-review');
const { extractImpactSignals, buildImpactEvidenceGraph } = require('./codex-safe-core/quality-platform');
const { rehydrateDiscoveryCandidates } = require('./code-intelligence');

const MAX_INDEX_FILE_BYTES = 128 * 1024;
const MAX_SYMBOLS = 64;
const MAX_SYMBOL_MATCHES = 96;
const MAX_SYMBOL_FILE_LIST_BYTES = 512 * 1024;
const MAX_SYMBOL_CANDIDATE_FILES = 96;
const MAX_FILES_PER_BROAD_SYMBOL = 16;
const MAX_EVIDENCE_SNIPPET_LINES = 11;
const TEXT_PATH = /\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx|inc|ipp|m|mm|rs|go|js|jsx|ts|tsx|py|java|kt|kts|cs|swift|dts|dtsi|yaml|yml|json|toml|ini|cmake|mk|txt)$/i;

function safeIndexPath(value) {
  const path = normalizeGitPathForComparison(value);
  if (!path || path.startsWith('-') || path.startsWith('/') || path.includes('\0') || path.includes('\r') || path.includes('\n') || path.split('/').includes('..')) throw new Error(`Invalid index path: ${value}`);
  return path;
}
function diffSections(diff = '') {
  const sections = new Map();
  let current = '';
  for (const line of String(diff || '').split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = normalizeGitPathForComparison(header[2] || header[1]);
      sections.set(current, [line]);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return new Map([...sections.entries()].map(([path, lines]) => [path, lines.join('\n')]));
}
function callSymbolsByPath(diff = '') {
  const result = new Map();
  for (const [path, section] of diffSections(diff)) result.set(path, extractCallSymbols(section, { maxSymbols: MAX_SYMBOLS }));
  return result;
}
function addedLineTextByPath(diff = '') {
  const result = new Map();
  for (const [path, section] of diffSections(diff)) {
    let newLine = 0;
    const lines = new Map();
    for (const raw of section.split(/\r?\n/)) {
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { newLine = Number(hunk[1]); continue; }
      if (!newLine) continue;
      if (raw.startsWith('+') && !raw.startsWith('+++')) { lines.set(newLine, raw.slice(1)); newLine += 1; }
      else if (raw.startsWith('-') && !raw.startsWith('---')) {}
      else if (!raw.startsWith('\\')) newLine += 1;
    }
    result.set(path, lines);
  }
  return result;
}
function anchorContextDigest(diff, file, line) {
  const map = addedLineTextByPath(diff).get(normalizeGitPathForComparison(file));
  if (!map) return '';
  const target = String(map.get(Number(line)) || '').trim().replace(/\s+/g, ' ');
  return target ? sha256(target) : '';
}
async function indexBlobSize(repoRoot, file, token) {
  const path = safeIndexPath(file);
  try {
    const { stdout } = await git(['cat-file', '-s', `:${path}`], repoRoot, token, { maxStdoutBytes: 1024, maxStderrBytes: 64 * 1024 });
    const size = Number(stdout.trim());
    return Number.isFinite(size) && size >= 0 ? size : null;
  } catch (error) {
    if (error?.code === 'ECANCELLED') throw error;
    return null;
  }
}
async function readIndexText(repoRoot, file, token, maxBytes = MAX_INDEX_FILE_BYTES) {
  const path = safeIndexPath(file);
  const size = await indexBlobSize(repoRoot, path, token);
  if (size == null || size > maxBytes) return null;
  try {
    const { stdout } = await git(['show', `:${path}`], repoRoot, token, { maxStdoutBytes: maxBytes + 4096, maxStderrBytes: 64 * 1024 });
    if (Buffer.byteLength(stdout, 'utf8') > maxBytes || stdout.includes('\0')) return null;
    return stdout;
  } catch (error) {
    if (error?.code === 'ECANCELLED') throw error;
    return null;
  }
}
function cheapScore(file, signals) {
  const low=file.toLowerCase(), base=low.slice(low.lastIndexOf('/')+1), stem=base.replace(/\.[^.]+$/,''); let score=0;
  if (signals.paths.includes(file)) score += 100;
  for (const inc of signals.includes) if (low.endsWith(String(inc).toLowerCase())) score += 40;
  for (const mod of signals.modules) { const n=String(mod).replace(/^\.\//,'').replace(/\./g,'/').toLowerCase(); if (n && (low.includes(n) || base.startsWith(n.slice(n.lastIndexOf('/')+1)))) score += 30; }
  if (signals.changedStems.includes(stem)) score += 10;
  if (/^(?:cmakelists\.txt|makefile|kconfig|meson\.build|build(?:\.bazel)?)$/i.test(base)) score += 8;
  if (TEXT_PATH.test(file)) score += 2;
  return score;
}
async function collectIndexImpactEvidence(repoRoot, diff, profile, token) {
  if (!profile || profile.maxImpactFiles <= 0 || profile.impactDepth <= 0) return { nodes: [], edges: [], text: '', bytes: 0, complete: true, truncated: false, signals: extractImpactSignals(diff) };
  const signals = extractImpactSignals(diff);
  const { stdout } = await git(['ls-files','-z'], repoRoot, token, { maxStdoutBytes: 8 * 1024 * 1024 });
  const ranked = stdout.split('\0').filter(Boolean).map(normalizeGitPathForComparison).filter(path => TEXT_PATH.test(path))
    .map(file => ({ file, score: cheapScore(file, signals) })).sort((a,b) => b.score-a.score || a.file.localeCompare(b.file));
  const candidates=[];
  for (const item of ranked.slice(0, 256)) {
    const content = await readIndexText(repoRoot, item.file, token);
    if (content == null) continue;
    candidates.push({ path:item.file, content });
  }
  return buildImpactEvidenceGraph({ diff, candidates, maxNodes: profile.maxImpactFiles, maxEdges: Math.max(32, profile.maxImpactFiles * 6), maxBytes: Math.min(256 * 1024, Math.max(32 * 1024, profile.maxImpactFiles * 12 * 1024)) });
}
function classifySymbolLine(line, symbol) {
  const escaped = String(symbol).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if (new RegExp(`^\\s*#\\s*define\\s+${escaped}\\b`).test(line)) return 'symbol-definition';
  if (new RegExp(`\\b${escaped}\\s*\\([^;{}]*\\)\\s*\\{`).test(line)) return 'symbol-definition';
  if (new RegExp(`\\b${escaped}\\s*\\([^{}]*\\)\\s*;`).test(line)) return 'symbol-declaration';
  return 'dependency';
}
function snippet(content, lineNumber, radius = Math.floor(MAX_EVIDENCE_SNIPPET_LINES / 2)) {
  const lines = String(content || '').split(/\r?\n/);
  const start = Math.max(1, Number(lineNumber) - radius), end = Math.min(lines.length, Number(lineNumber) + radius);
  return { start, end, text: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n') };
}
function exactSymbolRegex(symbol) {
  return new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`);
}
function parseCandidateFiles(stdout) {
  const files=[];
  for (const raw of String(stdout || '').split('\0').filter(Boolean)) {
    try {
      const file=safeIndexPath(raw);
      if (TEXT_PATH.test(file)) files.push(file);
    } catch {}
  }
  return [...new Set(files)].sort((a,b)=>a.localeCompare(b));
}
async function symbolCandidateGroups(repoRoot, batch, token) {
  if (!batch.length) return [];
  const args=['grep','--cached','-l','-z','-I','-F'];
  for (const symbol of batch) args.push('-e',symbol);
  args.push('--');
  let files;
  try {
    const {stdout}=await git(args,repoRoot,token,{maxStdoutBytes:MAX_SYMBOL_FILE_LIST_BYTES,maxStderrBytes:128*1024});
    files=parseCandidateFiles(stdout);
  } catch(error) {
    if(error?.code==='ECANCELLED') throw error;
    if(Number(error?.code)===1) return [];
    if(error?.code==='EOUTPUTLIMIT') {
      if(batch.length===1) return [];
      const mid=Math.ceil(batch.length/2);
      return [...await symbolCandidateGroups(repoRoot,batch.slice(0,mid),token),...await symbolCandidateGroups(repoRoot,batch.slice(mid),token)];
    }
    throw error;
  }
  if(files.length>MAX_SYMBOL_CANDIDATE_FILES && batch.length>1) {
    const mid=Math.ceil(batch.length/2);
    return [...await symbolCandidateGroups(repoRoot,batch.slice(0,mid),token),...await symbolCandidateGroups(repoRoot,batch.slice(mid),token)];
  }
  const limit=batch.length===1?MAX_FILES_PER_BROAD_SYMBOL:MAX_SYMBOL_CANDIDATE_FILES;
  return [{symbols:batch,files:files.slice(0,limit)}];
}
async function grepIndexSymbols(repoRoot, symbols, token) {
  const unique = [...new Set((symbols || []).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!unique.length) return [];
  const matches=[], cache=new Map(), regexes=new Map(unique.map(symbol=>[symbol,exactSymbolRegex(symbol)]));
  for (let start=0; start<unique.length; start+=16) {
    const groups=await symbolCandidateGroups(repoRoot,unique.slice(start,start+16),token);
    for(const group of groups) for(const file of group.files) {
      let content=cache.get(file);
      if(content===undefined){content=await readIndexText(repoRoot,file,token);cache.set(file,content);}
      if(content==null) continue;
      const lines=content.split(/\r?\n/);
      for(let index=0;index<lines.length;index++) {
        const lineText=lines[index];
        for(const symbol of group.symbols) if(regexes.get(symbol).test(lineText)) {
          matches.push({file,line:index+1,text:lineText,symbol});
          if(matches.length>=MAX_SYMBOL_MATCHES) return matches;
        }
      }
    }
  }
  return matches;
}
async function collectIndexSymbolEvidence(repoRoot, diff, stagedPaths, token) {
  const byPath = callSymbolsByPath(diff), symbols=[...new Set([...byPath.values()].flat())].slice(0,MAX_SYMBOLS);
  const matches=await grepIndexSymbols(repoRoot,symbols,token), cache=new Map(), blocks=[];
  for(const match of matches) {
    let content=cache.get(match.file);
    if(content===undefined){content=await readIndexText(repoRoot,match.file,token);cache.set(match.file,content);}
    if(content==null) continue;
    const connected=[...byPath.entries()].filter(([,values])=>values.includes(match.symbol)).map(([path])=>path);
    if(!connected.length) continue;
    const part=snippet(content,match.line), kind=classifySymbolLine(match.text,match.symbol);
    const entry=normalizeEvidenceEntry({kind,source:'index',path:match.file,symbol:match.symbol,line:part.start,endLine:part.end,content:part.text,relatedPaths:connected});
    blocks.push({entry,content:part.text});
  }
  const deduped=new Map();
  for(const block of blocks){const key=`${block.entry.kind}|${block.entry.path}|${block.entry.symbol}|${block.entry.line}|${block.entry.contentDigest}`;if(!deduped.has(key))deduped.set(key,block);}
  return {callSymbolsByPath:byPath,blocks:[...deduped.values()].slice(0,MAX_SYMBOL_MATCHES)};
}
function impactBlocks(impact) {
  const relatedByNode=new Map();
  for(const edge of impact?.edges||[]){if(!relatedByNode.has(edge.to))relatedByNode.set(edge.to,new Set());relatedByNode.get(edge.to).add(edge.from);}
  return (impact?.nodes||[]).map(node=>{
    const entry=normalizeEvidenceEntry({kind:'dependency',source:'index',path:node.path,content:node.content,relatedPaths:[...(relatedByNode.get(node.path)||[])]});
    return {entry,content:node.content};
  });
}
function stagedBlocks(diff) {
  return [...diffSections(diff)].map(([path,content])=>({entry:normalizeEvidenceEntry({kind:'staged',source:'index',path,content,relatedPaths:[path]}),content}));
}
function analyzerBlocks(findings=[]) {
  return (findings||[]).map(item=>{
    const content=`[${item.tool||'analyzer'}/${item.ruleId||'unknown'}] ${item.severity||'medium'}/${item.category||'other'} ${item.file}:${item.line}-${item.endLine||item.line}\n${item.message||item.description||''}${item.suggestion?`\nSuggestion: ${item.suggestion}`:''}`;
    return {entry:normalizeEvidenceEntry({kind:'analyzer',source:'sarif',path:item.file,line:item.line,endLine:item.endLine||item.line,content,relatedPaths:[item.file]}),content};
  });
}
async function collectStructuralEvidence(repoRoot,diff,stagedPaths,snapshot,profile,token,diffFingerprint='',discoveryCandidates=[]) {
  const [impact,symbols]=await Promise.all([collectIndexImpactEvidence(repoRoot,diff,profile,token),collectIndexSymbolEvidence(repoRoot,diff,stagedPaths,token)]);
  const discoveryBlocks=await rehydrateDiscoveryCandidates(discoveryCandidates,{readIndexText:file=>readIndexText(repoRoot,file,token),snippet,classifySymbolLine,relatedPaths:stagedPaths});
  const raw=[...stagedBlocks(diff),...impactBlocks(impact),...symbols.blocks,...discoveryBlocks];
  const deduped=new Map();for(const block of raw)if(!deduped.has(block.entry.id))deduped.set(block.entry.id,block);
  const blocks=[...deduped.values()];
  const manifest=buildEvidenceManifest(blocks.map(block=>block.entry),{headOid:snapshot?.headOid,indexFingerprint:snapshot?.indexFingerprint,diffFingerprint});
  return {impact,callSymbolsByPath:symbols.callSymbolsByPath,blocks,manifest};
}
function composeSemanticEvidence(structuralEvidence,analyzerFindings,snapshot,diffFingerprint='') {
  const raw=[...(structuralEvidence?.blocks||[]),...analyzerBlocks(analyzerFindings)];
  const deduped=new Map();for(const block of raw)if(!deduped.has(block.entry.id))deduped.set(block.entry.id,block);
  const blocks=[...deduped.values()];
  const manifest=buildEvidenceManifest(blocks.map(block=>block.entry),{headOid:snapshot?.headOid,indexFingerprint:snapshot?.indexFingerprint,diffFingerprint});
  return {impact:structuralEvidence?.impact||{},callSymbolsByPath:structuralEvidence?.callSymbolsByPath||new Map(),blocks,manifest,analyzerDigest:digestAnalyzerEvidence(analyzerFindings)};
}
function renderEvidenceForPaths(evidence,paths,{maxBytes=96*1024,maxEntries=32,includeStaged=false}={}) {
  const sourceEntries=(evidence?.manifest?.entries||[]).filter(entry=>includeStaged||entry.kind!=='staged');
  const selected=selectEvidenceForPaths(sourceEntries,paths,{maxBytes,maxEntries});
  const contentById=new Map((evidence?.blocks||[]).map(block=>[block.entry.id,block.content]));
  const text=selected.entries.map(entry=>`--- EVIDENCE ${entry.id} kind=${entry.kind} source=${entry.source} path=${entry.path}${entry.symbol?` symbol=${entry.symbol}`:''} ---\n${contentById.get(entry.id)||''}\n--- END EVIDENCE ${entry.id} ---`).join('\n');
  return {...selected,text};
}
function evidenceForSymbols(evidence,symbols=[]) {
  const wanted=new Set(symbols||[]);return (evidence?.manifest?.entries||[]).filter(entry=>entry.symbol&&wanted.has(entry.symbol));
}

module.exports={MAX_INDEX_FILE_BYTES,MAX_SYMBOLS,MAX_SYMBOL_MATCHES,safeIndexPath,diffSections,callSymbolsByPath,addedLineTextByPath,anchorContextDigest,readIndexText,collectIndexImpactEvidence,collectIndexSymbolEvidence,collectStructuralEvidence,composeSemanticEvidence,renderEvidenceForPaths,evidenceForSymbols,classifySymbolLine,snippet};
