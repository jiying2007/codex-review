'use strict';
const path=require('node:path');
const MAX_CONSECUTIVE_REPLAYS=2;
const MAX_REPLAY_AGE_MS=10*60*1000;
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function repoKey(v){const r=path.resolve(String(v||''));return process.platform==='win32'?r.toLowerCase():r;}
function createReplayWindow({now=()=>Date.now(),maxConsecutiveReplays=MAX_CONSECUTIVE_REPLAYS,maxReplayAgeMs=MAX_REPLAY_AGE_MS}={}){
  const byRepo=new Map();
  function subjectMap(repoRoot){const key=repoKey(repoRoot);if(!byRepo.has(key))byRepo.set(key,new Map());return byRepo.get(key);}
  function tryReplay(repoRoot,reviewSubjectKey){
    const state=subjectMap(repoRoot).get(reviewSubjectKey); if(!state)return{replayed:false,reason:'no_session_fresh',replayStreak:0,replayAgeMs:0,nextReviewFresh:false};
    const age=Math.max(0,now()-state.freshAtMs);
    if(age>=maxReplayAgeMs)return{replayed:false,reason:'replay_age_expired',replayStreak:state.replayStreak,replayAgeMs:age,nextReviewFresh:true};
    if(state.replayStreak>=maxConsecutiveReplays)return{replayed:false,reason:'replay_limit_reached',replayStreak:state.replayStreak,replayAgeMs:age,nextReviewFresh:true};
    state.replayStreak+=1;
    return{replayed:true,reason:'recent_result_replay',review:clone(state.review),originReviewRunId:state.reviewRunId,replayStreak:state.replayStreak,replayAgeMs:age,nextReviewFresh:state.replayStreak>=maxConsecutiveReplays};
  }
  function recordFresh(repoRoot,{reviewSubjectKey,reviewRunId,review}){subjectMap(repoRoot).set(reviewSubjectKey,{reviewSubjectKey,reviewRunId,review:clone(review),freshAtMs:now(),replayStreak:0});}
  function clear(repoRoot){if(repoRoot)byRepo.delete(repoKey(repoRoot));else byRepo.clear();}
  return{tryReplay,recordFresh,clear,maxConsecutiveReplays,maxReplayAgeMs};
}
module.exports={MAX_CONSECUTIVE_REPLAYS,MAX_REPLAY_AGE_MS,createReplayWindow};
