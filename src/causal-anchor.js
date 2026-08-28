'use strict';

const SUPPORT_KINDS = Object.freeze(['symptom','dependency','test','config','state','other']);

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
function validateCausalAnchor(fileValue,lineValue,stagedPathSet,changedLineRanges,endLineValue=lineValue) {
  const file=normalizeGitPath(fileValue),line=Math.max(1,Math.floor(Number(lineValue)||1)),endLine=Math.max(line,Math.floor(Number(endLineValue)||line));
  if(!stagedPathSet.has(file)) throw new Error(`Hypothesis causal path is not staged: ${file}`);
  if(!spanInRanges(line,endLine,changedLineRanges.get(file)||[])) throw new Error(`Hypothesis causal anchor span is not entirely on exact changed lines: ${file}:${line}-${endLine}`);
  return Object.freeze({file,line});
}

module.exports={SUPPORT_KINDS,normalizeGitPath,lineInRanges,spanInRanges,normalizeSupportingLocations,validateCausalAnchor};
