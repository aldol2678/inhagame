import {questionKey} from './learning-content.js';
import {sanitizeProgress} from './learning-contract.js';
import {writeRecovery,recoveryEntries,cleanupRecovery} from './learning-recovery.js';
export {sanitizeProgress} from './learning-contract.js';
export const learningDay=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
export const shiftDay=(d,n)=>{const date=new Date(`${d}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
const safeKey=k=>/^qv:[a-zA-Z0-9_.-]{1,160}@[1-9]\d{0,8}$/.test(k);
const clone=v=>JSON.parse(JSON.stringify(v));
export function emptyProgress(){return {version:1,completed:{},masteries:{},wrong:{},skillScores:[40,40,40],languageSkills:{zh:40,ja:40},learningHistory:{},bosses:{},languageBosses:{},speech:{}};}
// Explicit import-only migration: fill missing historic fields, never coerce values.
// Content/economy fields are excluded only after the user's import review/confirmation.
function convertLegacyProgress(raw) {
  const out=emptyProgress();
  for(const k of Object.keys(out))if(k!=='version'&&Object.hasOwn(raw,k))out[k]=clone(raw[k]);
  const record=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_PROGRESS');return v;};
  for(const f of ['completed','masteries','wrong','learningHistory','bosses','languageBosses','speech'])record(out[f]);
  // Historic wrong entries embedded a question object. Explicit migration keeps
  // only membership, never the embedded prompt/answer. Native v1 rejects objects.
  for(const [k,v] of Object.entries(out.wrong))if(v&&typeof v==='object'&&!Array.isArray(v))out.wrong[k]=true;
  for(const [k,v] of Object.entries(out.masteries))out.masteries[k]={level:0,errors:0,streak:0,intervalDays:1,correctDays:0,lastCorrectDay:null,dueDate:null,needsRecheck:false,...record(v)};
  for(const f of ['bosses','languageBosses'])for(const [k,v] of Object.entries(out[f]))out[f][k]={count:0,best:0,passed:false,lastDate:null,...record(v)};
  for(const [k,v] of Object.entries(out.speech))out.speech[k]={typed:0,mic:0,lastDay:null,...record(v)};
  return sanitizeProgress(out);
}
export function reconcileVersions(state,catalog,today=learningDay()) {
  for(const key of new Set([...Object.keys(state.masteries),...Object.keys(state.wrong)])) {
    if(catalog.has(key))continue;
    const match=/^qv:(.+)@(\d+)$/.exec(key),q=match&&catalog.latest(match[1]);
    if(!q||q.version<=Number(match[2]))continue;
    const next=questionKey(q);
    // Keep the historic version intact; a changed question must be practiced again.
    if(!state.masteries[next])state.masteries[next]={level:1,errors:0,streak:0,intervalDays:1,dueDate:today,lastCorrectDay:null,correctDays:0,needsRecheck:true};
    if(state.wrong[key])state.wrong[next]=true;
  }
  return state;
}
export function recordMastery(state,key,correct,today=learningDay()) {
  const before=state.masteries[key]||{level:0,errors:0,lastCorrectDay:null,dueDate:null,intervalDays:1,streak:0,correctDays:0,needsRecheck:false};
  if(!correct){state.masteries[key]={...before,level:1,errors:(before.errors||0)+1,streak:0,intervalDays:1,dueDate:today};return;}
  const otherDay=Boolean(before.lastCorrectDay&&before.lastCorrectDay!==today);
  if(before.lastCorrectDay===today&&before.level>=1){state.masteries[key]={...before,needsRecheck:false};return;}
  const streak=otherDay?(before.streak||1)+1:Math.max(1,before.streak||0);
  const days=otherDay?(streak>=4?14:streak===3?7:3):1;
  state.masteries[key]={...before,level:otherDay?2:Math.max(1,before.level||0),lastCorrectDay:today,
    correctDays:(before.correctDays||0)+1,streak,intervalDays:days,dueDate:shiftDay(today,days),needsRecheck:false};
}
export function createLearningProgress({getStorage=()=>globalThis.localStorage,onWarning=()=>{}}={}) {
  let account=null,state=emptyProgress(),writable=true,lastRaw=null,lastSnapshot=null,recoverySequence=0,previousRecovery=null,saveState={status:'empty',reason:null};
  // Recovery names are local identifiers, not authentication or RPC tokens.
  const listeners=new Set(),writer=globalThis.crypto?.randomUUID?.()??`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const key=()=>`inha-world-learning-v1:${account===null?'guest':`user:${encodeURIComponent(account)}`}`;
  function report(status,reason=null){saveState={status,reason};for(const listener of listeners)listener(saveState);}
  function save(){
    try{
      if(!writable)throw Error('STORAGE_UNREADABLE');
      const storage=getStorage(),raw=JSON.stringify(sanitizeProgress(state));
      if(!storage)throw Error('LOCAL_STORAGE_FAILED');
      if(storage.getItem(key())!==lastRaw)throw Error('LOCAL_CONFLICT');
      // Write a new immutable key; cleanup can never race an in-place journal edit.
      // Keep the prior snapshot until BOTH this copy and primary are verified.
      const recovery={key:`${key()}:recovery:${writer}:snapshot:${++recoverySequence}`,raw};
      writeRecovery(storage,account,recovery.key,raw,previousRecovery);
      storage.setItem(key(),raw);if(storage.getItem(key())!==raw)throw Error('LOCAL_STORAGE_FAILED');
      lastRaw=raw;lastSnapshot=raw;
      const retired=previousRecovery;previousRecovery=recovery;
      // Failure to retire an older immutable copy cannot invalidate the verified save.
      try{if(retired&&storage.getItem(retired.key)===retired.raw)storage.removeItem(retired.key);}catch{}
      report('saved');return true;
    }catch(error){
      const reason=error.name==='QuotaExceededError'?'QUOTA':error.message;
      report('unsaved',reason);
      onWarning(reason==='LOCAL_CONFLICT'?'다른 탭에서 기록이 바뀌었어요. 현재 결과를 백업한 뒤 최신 기록에 가져오세요.':reason==='RECOVERY_LIMIT'?'복구 사본 한도에 도달했어요. 사본을 내보내고 보관한 뒤 정리하세요.':'이 기기에 저장하지 못했어요. 현재 결과를 백업하고 저장을 다시 시도하세요.');
      return false;
    }
  }
  function setAccount(id){
    account=typeof id==='string'&&id.length>0?id:null;state=emptyProgress();writable=true;lastRaw=null;lastSnapshot=null;previousRecovery=null;saveState={status:'empty',reason:null};
    try{const raw=getStorage()?.getItem(key())??null;lastRaw=raw;if(raw){const parsed=JSON.parse(raw);if(parsed?.version!==1)throw Error();state=sanitizeProgress(parsed);lastSnapshot=JSON.stringify(state);saveState={status:'saved',reason:null};}}
    catch{writable=false;saveState={status:'unsaved',reason:'STORAGE_UNREADABLE'};onWarning('학습 기록을 읽지 못했어요. 원본 기록을 유지해요.');}
  }
  setAccount(null);
  return {get state(){return state;},get saveState(){return saveState.status==='saved'&&JSON.stringify(state)!==lastSnapshot?{status:'unsaved',reason:'UNSAVED_CHANGES'}:{...saveState};},get scope(){return account;},get writable(){return writable;},setAccount,save,
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    recoveryBackup(){return recoveryEntries(getStorage(),account);},
    originalBackup(){return {key:key(),raw:lastRaw};},
    cleanupRecovery(exported,options){return cleanupRecovery(getStorage(),account,exported,options);},
    recovery(){const storage=getStorage(),records=[];if(storage)for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(`${key()}:recovery:`)){const value=JSON.parse(storage.getItem(k));if(value?.version===1)records.push(sanitizeProgress(value));}}return records;},
    replace(raw){const previous=state,previousStatus=saveState;state=sanitizeProgress(raw);if(save())return true;state=previous;saveState=previousStatus;return false;},
    clearMemory(){state=emptyProgress();account=null;writable=false;saveState={status:'empty',reason:null};},
    export(){return JSON.stringify({format:'induck.learning.backup',version:1,progress:state},null,2);},
    import(raw,{catalog,confirm=false}={}) {
      if(!confirm)throw Error('IMPORT_CONFIRMATION_REQUIRED');
      if(!writable)throw Error('STORAGE_UNREADABLE');
      if(typeof raw!=='string'||raw.length>2_000_000)throw Error('INVALID_BACKUP');
      const parsed=JSON.parse(raw);
      if(parsed?.format&&(parsed.format!=='induck.learning.backup'||parsed.version!==1||Object.keys(parsed).length!==3||parsed.progress?.version!==1))throw Error('INVALID_BACKUP');
      const source=parsed.format==='induck.learning.backup'&&parsed.version===1?parsed.progress:parsed;
      if(!source||typeof source!=='object'||!['completed','masteries','wrong'].every(k=>source[k]&&typeof source[k]==='object'&&!Array.isArray(source[k])))throw Error('INVALID_BACKUP');
      if(source.version!==undefined&&source.version!==1)throw Error('INVALID_BACKUP');
      const native=source.version===1;
      if(native)sanitizeProgress(source);
      else{
        // Validate historic values BEFORE any identity/version conversion. Otherwise
        // a wrong-version reset could conceal a bad type, counter or calendar day.
        const checked=clone(source);
        for(const f of ['masteries','wrong'])checked[f]=Object.fromEntries(Object.entries(source[f]).map(([,v],i)=>[`qv:legacy.validation.${i}@1`,v]));
        convertLegacyProgress(checked);
      }
      const migrated=clone(source);let unresolved=0;
      for(const key of new Set([...Object.keys(source.masteries),...Object.keys(source.wrong)])) {
        if(safeKey(key))continue;
        // Only the first three static lesson slots have an unambiguous old identity.
        // Adaptive slots are never guessed from today's skill level.
        const match=/^((?:e|zh|ja)\d{2})-([0-2])$/.exec(key);
        const q=match&&catalog.lessons.find(l=>l.id===match[1])?.questions[Number(match[2])];
        delete migrated.masteries[key];delete migrated.wrong[key];
        if(!q){unresolved++;continue;}
        const to=questionKey(q);
        if(source.masteries[key]&&!migrated.masteries[to])migrated.masteries[to]=q.version>1?
          {...source.masteries[key],level:1,streak:0,lastCorrectDay:null,correctDays:0,intervalDays:1,dueDate:learningDay(),needsRecheck:true}:source.masteries[key];
        if(source.wrong[key])migrated.wrong[to]=true;
      }
      const incoming=native?sanitizeProgress(migrated):sanitizeProgress(convertLegacyProgress(migrated)),previous=clone(state),merged=clone(state);
      // Preserve existing conflicts. Users explicitly merge into the currently selected account.
      for(const field of ['completed','masteries','wrong','learningHistory','bosses','languageBosses','speech'])merged[field]={...incoming[field],...merged[field]};
      merged.skillScores=merged.skillScores.map((v,i)=>Math.max(v,incoming.skillScores[i]));
      for(const lang of ['zh','ja'])merged.languageSkills[lang]=Math.max(merged.languageSkills[lang],incoming.languageSkills[lang]);
      reconcileVersions(merged,catalog);const previousSaveState=saveState;state=merged;
      if(!save()){state=previous;saveState=previousSaveState;throw Error('IMPORT_SAVE_FAILED');}
      return {unresolved,legacy:!native,excluded:native?[]:Object.keys(source).filter(k=>!Object.hasOwn(emptyProgress(),k))};
    }
  };
}
