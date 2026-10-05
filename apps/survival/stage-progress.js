// Stage 1 구형 기록을 보존하는 스테이지별 로컬 진행 데이터.
(function(root){
  'use strict';
  const key='inha-duck-survival-progress-v2';
  const legacyKey='inha-duck-survival-stage1-p14';
  let accountId=null;
  function blank(){return {schemaVersion:2,stages:{}}}
  function scopedKey(){return accountId?`${key}-account-${accountId}`:key}
  function readJSON(name){
    try{const value=JSON.parse(localStorage.getItem(name));return value&&typeof value==='object'&&!Array.isArray(value)?value:null}
    catch{return null}
  }
  function normalizeStage(entry){
    const kills=Number(entry?.bestKills);
    return {clear:entry?.clear===true,bestKills:Number.isFinite(kills)?Math.max(0,Math.floor(kills)):0};
  }
  function normalize(value){
    const out=blank();
    if(value?.schemaVersion!==2||!value.stages||typeof value.stages!=='object'||Array.isArray(value.stages))return out;
    for(const [id,entry] of Object.entries(value.stages)){
      if(/^[1-6]$/.test(id))out.stages[id]=normalizeStage(entry);
    }
    return out;
  }
  function merge(a,b){
    const left=normalize(a),right=normalize(b),out=blank();
    for(const id of new Set([...Object.keys(left.stages),...Object.keys(right.stages)])){
      const l=normalizeStage(left.stages[id]),r=normalizeStage(right.stages[id]);
      out.stages[id]={clear:l.clear||r.clear,bestKills:Math.max(l.bestKills,r.bestKills)};
    }
    return out;
  }
  function guestProgress(){
    const saved=readJSON(key);
    if(saved?.schemaVersion===2&&saved.stages&&typeof saved.stages==='object'&&!Array.isArray(saved.stages)){
      return normalize(saved);
    }
    const out=blank();
    const legacy=readJSON(legacyKey);
    if(legacy)out.stages['1']=normalizeStage(legacy);
    try{localStorage.setItem(key,JSON.stringify(out))}catch{}
    // 구형 키는 삭제하지 않아 이전 버전의 기록과 복구 경로를 남긴다.
    return out;
  }
  function read(){return accountId?normalize(readJSON(scopedKey())):guestProgress()}
  function save(progress){
    const result=normalize(progress);
    try{localStorage.setItem(scopedKey(),JSON.stringify(result))}catch{}
    root.dispatchEvent?.(new CustomEvent('survival-progress-changed'));
    return result;
  }
  function useAccount(userId,cloudProgress){
    if(!/^[0-9a-f-]{36}$/i.test(String(userId)))throw Error('Invalid account id');
    accountId=String(userId);
    return save(merge(read(),cloudProgress));
  }
  function clearAccount(){accountId=null;root.dispatchEvent?.(new CustomEvent('survival-progress-changed'));return read()}
  function importGuest(){if(!accountId)return read();return save(merge(read(),guestProgress()))}
  function recordResult(stageId,result){
    const id=String(stageId);
    if(!/^[1-6]$/.test(id))return read();
    const progress=read(),previous=normalizeStage(progress.stages[id]);
    const kills=Number(result?.kills);
    progress.stages[id]={
      clear:previous.clear||result?.clear===true,
      bestKills:Math.max(previous.bestKills,Number.isFinite(kills)?Math.max(0,Math.floor(kills)):0)
    };
    return save(progress);
  }
  function isUnlocked(stageId,stages){
    const stage=stages.get(stageId);
    if(!stage?.implemented)return false;
    if(Number(stageId)===1)return true;
    return read().stages[String(Number(stageId)-1)]?.clear===true;
  }
  function campaignClear(){const p=read();return [1,2,3,4,5,6].every(id=>p.stages[String(id)]?.clear===true)}
  root.InduckSurvivalProgress=Object.freeze({read,recordResult,isUnlocked,campaignClear,useAccount,clearAccount,importGuest,guestProgress,merge,normalize});
})(window);
