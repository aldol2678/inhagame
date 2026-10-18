import {questionKey} from './learning-content.js';
export const learningDay=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
export const shiftDay=(d,n)=>{const date=new Date(`${d}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v));
const count=(v,max=1_000_000)=>Number.isSafeInteger(v)&&v>=0?Math.min(v,max):0;
const safeKey=k=>/^qv:[a-zA-Z0-9_.-]{1,160}@[1-9]\d{0,8}$/.test(k);
const entries=o=>o&&typeof o==='object'&&!Array.isArray(o)?Object.entries(o).slice(0,5000):[];
const clone=v=>JSON.parse(JSON.stringify(v));
export function emptyProgress(){return {version:1,completed:{},masteries:{},wrong:{},skillScores:[40,40,40],languageSkills:{zh:40,ja:40},learningHistory:{},bosses:{},languageBosses:{},speech:{}};}
export function sanitizeProgress(raw={}) {
  const out=emptyProgress();
  for(const [k,v] of entries(raw.completed))if(/^(e|zh|ja)\d{2}$/.test(k)&&v===true)out.completed[k]=true;
  for(const [k,v] of entries(raw.masteries))if(safeKey(k)&&v&&typeof v==='object')out.masteries[k]={
    level:count(v.level,2),errors:count(v.errors),streak:count(v.streak),intervalDays:count(v.intervalDays,14)||1,
    correctDays:count(v.correctDays),lastCorrectDay:day(v.lastCorrectDay)?v.lastCorrectDay:null,
    dueDate:day(v.dueDate)?v.dueDate:null,needsRecheck:v.needsRecheck===true};
  // Persist only identities, never prompts, answers or the legacy reviewCatalog.
  for(const [k,v] of entries(raw.wrong))if(safeKey(k)&&v)out.wrong[k]=true;
  out.skillScores=[0,1,2].map(i=>Number.isFinite(raw.skillScores?.[i])?Math.max(0,Math.min(100,raw.skillScores[i])):40);
  for(const lang of ['zh','ja'])if(Number.isFinite(raw.languageSkills?.[lang]))out.languageSkills[lang]=Math.max(0,Math.min(100,raw.languageSkills[lang]));
  for(const [k,v] of entries(raw.learningHistory))if(day(k)&&v)out.learningHistory[k]={answered:count(v.answered),correct:Math.min(count(v.correct),count(v.answered))};
  for(const field of ['bosses','languageBosses'])for(const [k,v] of entries(raw[field]))if((field==='bosses'?['0','1','2']:['zh','ja']).includes(k)&&v)out[field][k]={count:count(v.count),best:count(v.best,5),passed:v.passed===true,lastDate:day(v.lastDate)?v.lastDate:null};
  for(const [k,v] of entries(raw.speech))if(safeKey(k)&&v)out.speech[k]={typed:count(v.typed),mic:count(v.mic),lastDay:day(v.lastDay)?v.lastDay:null};
  return out;
}
export function reconcileVersions(state,catalog,today=learningDay()) {
  for(const key of new Set([...Object.keys(state.masteries),...Object.keys(state.wrong)])) {
    if(catalog.has(key))continue;
    const match=/^qv:(.+)@(\d+)$/.exec(key),q=match&&catalog.latest(match[1]);
    if(!q||q.version<=Number(match[2]))continue;
    const next=questionKey(q);
    // Keep the historic version intact; a changed question must be practiced again.
    if(!state.masteries[next])state.masteries[next]={level:1,streak:0,intervalDays:1,dueDate:today,lastCorrectDay:null,correctDays:0,needsRecheck:true};
    if(state.wrong[key])state.wrong[next]=true;
  }
  return state;
}
export function recordMastery(state,key,correct,today=learningDay()) {
  const before=state.masteries[key]||{level:0,lastCorrectDay:null,intervalDays:1,streak:0};
  if(!correct){state.masteries[key]={...before,level:1,errors:(before.errors||0)+1,streak:0,intervalDays:1,dueDate:today};return;}
  const otherDay=Boolean(before.lastCorrectDay&&before.lastCorrectDay!==today);
  if(before.lastCorrectDay===today&&before.level>=1){state.masteries[key]={...before,needsRecheck:false};return;}
  const streak=otherDay?(before.streak||1)+1:Math.max(1,before.streak||0);
  const days=otherDay?(streak>=4?14:streak===3?7:3):1;
  state.masteries[key]={...before,level:otherDay?2:Math.max(1,before.level||0),lastCorrectDay:today,
    correctDays:(before.correctDays||0)+1,streak,intervalDays:days,dueDate:shiftDay(today,days),needsRecheck:false};
}
export function createLearningProgress({getStorage=()=>globalThis.localStorage,onWarning=()=>{}}={}) {
  let account=null,state=emptyProgress(),writable=true;
  const key=()=>`inha-world-learning-v1:${account===null?'guest':`user:${encodeURIComponent(account)}`}`;
  function save(){
    if(!writable){onWarning('저장된 기록을 읽지 못해 덮어쓰지 않았어요. 백업 후 다시 접속해 주세요.');return false;}
    try{const storage=getStorage(),raw=JSON.stringify(sanitizeProgress(state));if(!storage)throw Error();storage.setItem(key(),raw);if(storage.getItem(key())!==raw)throw Error();return true;}
    catch{onWarning('학습 기록을 저장하지 못했어요. 이 화면에서 백업할 수 있어요.');return false;}
  }
  function setAccount(id){
    account=typeof id==='string'&&id.length>0?id:null;state=emptyProgress();writable=true;
    try{const raw=getStorage()?.getItem(key());if(raw){const parsed=JSON.parse(raw);if(parsed?.version!==1)throw Error();state=sanitizeProgress(parsed);}}
    catch{writable=false;onWarning('학습 기록을 읽지 못했어요. 원본 기록을 유지해요.');}
  }
  setAccount(null);
  return {get state(){return state;},get scope(){return account;},setAccount,save,
    clearMemory(){state=emptyProgress();account=null;writable=false;},
    export(){return JSON.stringify({format:'induck.learning.backup',version:1,progress:sanitizeProgress(state)},null,2);},
    import(raw,{catalog,confirm=false}={}) {
      if(!confirm)throw Error('IMPORT_CONFIRMATION_REQUIRED');
      if(!writable)throw Error('STORAGE_UNREADABLE');
      if(typeof raw!=='string'||raw.length>2_000_000)throw Error('INVALID_BACKUP');
      const parsed=JSON.parse(raw);
      if(parsed?.format&&(parsed.format!=='induck.learning.backup'||parsed.version!==1))throw Error('INVALID_BACKUP');
      const source=parsed.format==='induck.learning.backup'&&parsed.version===1?parsed.progress:parsed;
      if(!source||typeof source!=='object'||!['completed','masteries','wrong'].every(k=>source[k]&&typeof source[k]==='object'&&!Array.isArray(source[k])))throw Error('INVALID_BACKUP');
      const migrated=clone(source);let unresolved=0;
      for(const key of new Set([...Object.keys(source.masteries),...Object.keys(source.wrong)])) {
        if(safeKey(key))continue;
        // Only the first three static lesson slots have an unambiguous old identity.
        // Adaptive slots are never guessed from today's skill level.
        const match=/^((?:e|zh|ja)\d{2})-([0-2])$/.exec(key);
        const q=match&&catalog.lessons.find(l=>l.id===match[1])?.questions[Number(match[2])];
        if(!q){unresolved++;continue;}
        const to=questionKey(q);
        if(source.masteries[key]&&!migrated.masteries[to])migrated.masteries[to]=q.version>1?
          {...source.masteries[key],level:1,streak:0,lastCorrectDay:null,correctDays:0,intervalDays:1,dueDate:learningDay(),needsRecheck:true}:source.masteries[key];
        if(source.wrong[key])migrated.wrong[to]=true;
      }
      const incoming=sanitizeProgress(migrated),previous=clone(state),merged=clone(state);
      // Preserve existing conflicts. Users explicitly merge into the currently selected account.
      for(const field of ['completed','masteries','wrong','learningHistory','bosses','languageBosses','speech'])merged[field]={...incoming[field],...merged[field]};
      merged.skillScores=merged.skillScores.map((v,i)=>Math.max(v,incoming.skillScores[i]));
      for(const lang of ['zh','ja'])merged.languageSkills[lang]=Math.max(merged.languageSkills[lang],incoming.languageSkills[lang]);
      reconcileVersions(merged,catalog);state=merged;
      if(!save()){state=previous;try{getStorage()?.setItem(key(),JSON.stringify(previous));}catch{}throw Error('IMPORT_SAVE_FAILED');}
      return {unresolved};
    }
  };
}
