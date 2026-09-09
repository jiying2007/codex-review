'use strict';

const crypto = require('node:crypto');

const SUPPORT_KINDS = Object.freeze(['symptom','dependency','test','config','state','other']);
const CAUSAL_SIDES = Object.freeze(['new','old']);

function normalizeGitPath(value) { return String(value||'').replace(/\\/g,'/').replace(/^\.\//,'').replace(/^a\//,'').replace(/^b\//,''); }
function lineInRanges(line, ranges=[]) { const n=Number(line); return ranges.some(range=>n>=Number(range.start)&&n<=Number(range.end)); }
function spanInRanges(line, endLine, ranges=[]) {
  const start=Math.max(1,Math.floor(Number(line)||1));
  const end=Math.max(start,Math.floor(Number(endLine)||start));
  return ranges.some(range=>start>=Number(range.start)&&end<=Number(range.end));
}
function normalizeSupportingLocations(raw=[]) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0,12).map(item=>{
    const line=Math.max(1,Math.floor(Number(item?.line)||1));
    return {
      file:normalizeGitPath(item?.file||''),
      line,
      endLine:Math.max(line,Math.floor(Number(item?.endLine)||line)),
      kind:SUPPORT_KINDS.includes(String(item?.kind))?String(item.kind):'other',
      reason:String(item?.reason||'').trim().slice(0,500)
    };
  }).filter(item=>item.file&&item.reason);
}
function changedLinesBySide(diff='', side='new') {
  const wanted = side === 'old' ? 'old' : 'new';
  const byPath = new Map();
  let oldPath='', newPath='', oldLine=0, newLine=0, inHunk=false;
  const add=(file,line,text)=>{
    const path=normalizeGitPath(file);
    if(!path||line<1)return;
    if(!byPath.has(path))byPath.set(path,new Map());
    byPath.get(path).set(line,String(text||''));
  };
  for(const raw of String(diff||'').split(/\r?\n/)) {
    const header=raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if(header){oldPath=normalizeGitPath(header[1]);newPath=normalizeGitPath(header[2]);oldLine=0;newLine=0;inHunk=false;continue;}
    if(raw.startsWith('--- ')){
      const value=raw.slice(4).trim();
      if(value!=='/dev/null')oldPath=normalizeGitPath(value);
      continue;
    }
    if(raw.startsWith('+++ ')){
      const value=raw.slice(4).trim();
      if(value!=='/dev/null')newPath=normalizeGitPath(value);
      continue;
    }
    const hunk=raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);inHunk=true;continue;}
    if(!inHunk)continue;
    if(raw.startsWith('-')&&!raw.startsWith('---')){if(wanted==='old')add(oldPath,oldLine,raw.slice(1));oldLine+=1;continue;}
    if(raw.startsWith('+')&&!raw.startsWith('+++')){if(wanted==='new')add(newPath,newLine,raw.slice(1));newLine+=1;continue;}
    if(!raw.startsWith('\\')){oldLine+=1;newLine+=1;}
  }
  return byPath;
}
function rangesForPath(diff,file,side) {
  const lines=[...(changedLinesBySide(diff,side).get(normalizeGitPath(file))?.keys()||[])].sort((a,b)=>a-b);
  const ranges=[];
  for(const line of lines){const last=ranges[ranges.length-1];if(last&&last.end+1===line)last.end=line;else ranges.push({start:line,end:line});}
  return ranges;
}
function anchorContextDigestForSide(diff,file,line,side='new') {
  const text=String(changedLinesBySide(diff,side).get(normalizeGitPath(file))?.get(Number(line))||'').trim().replace(/\s+/g,' ');
  return text ? crypto.createHash('sha256').update(`${side}\n${text}`,'utf8').digest('hex') : '';
}
function validateCausalAnchor(fileValue,lineValue,stagedPathSet,changedLineRanges,endLineValue=lineValue,options={}) {
  const file=normalizeGitPath(fileValue),line=Math.max(1,Math.floor(Number(lineValue)||1)),endLine=Math.max(line,Math.floor(Number(endLineValue)||line));
  const side=String(options?.side||'new');
  if(!CAUSAL_SIDES.includes(side)) throw new Error(`Invalid causal anchor side: ${side}`);
  if(!stagedPathSet.has(file)) throw new Error(`Hypothesis causal path is not staged: ${file}`);
  const ranges=side==='old'?rangesForPath(options?.diff||'',file,'old'):(changedLineRanges.get(file)||[]);
  if(!spanInRanges(line,endLine,ranges)) throw new Error(`Hypothesis causal anchor span is not entirely on exact ${side}-side changed lines: ${file}:${line}-${endLine}`);
  return Object.freeze({file,line,side});
}

module.exports={SUPPORT_KINDS,CAUSAL_SIDES,normalizeGitPath,lineInRanges,spanInRanges,normalizeSupportingLocations,changedLinesBySide,rangesForPath,anchorContextDigestForSide,validateCausalAnchor};
