import {
  LIFE_ENGINE_VERSION, createLife, advanceLife, advanceLifeBatch,
  chooseLifeEvent, setLifePolicy
} from './life-engine.mjs';

import {findMajor} from './major-registry.mjs';

export const V2_LOCAL_SAVE_KEY = 'induck-grow-v2-local-0.1';
export const V2_LOCAL_SAVE_SCHEMA = 'grow2.local.preview.1';
const MAX_SAVE_BYTES = 1024 * 1024;
const copy = obj => structuredClone(obj);


function validateSaveLife(life) {
  // Check the stored snapshot itself, not merely the engine's next transition.
  const major=findMajor(life?.majorId),w=life?.weeksCompleted;
  if(!major || major.playability!=='foundation' || major.calendarTemplate!=='four_year_8_terms')
    throw new Error('INVALID_MAJOR');
  if(!Number.isInteger(w)||w<0||w>120)throw new Error('INVALID_PROGRESS');
  const done=w===120,terms=Math.floor(w/15);
  if(life.status!==(done?'complete':'running') ||
     life.year!==(done?4:Math.floor(w/30)+1) ||
     life.term!==(done?2:Math.floor(w/15)%2+1) ||
     life.week!==(done?15:w%15+1))throw new Error('INVALID_CURSOR');
  if(!Array.isArray(life.semesters)||life.semesters.length!==terms ||
     !Array.isArray(life.weeklyHistory)||life.weeklyHistory.length!==w ||
     life.credits!==terms*18 || !Number.isFinite(life.gradePoints) ||
     !Number.isFinite(life.gpa)||life.gpa<0||life.gpa>4.5 ||
     !Number.isInteger(life.seed)||life.seed<0||life.seed>0xffffffff ||
     !Number.isInteger(life.rngState)||life.rngState>0xffffffff)
    throw new Error('INVALID_RECORD');
  let points=0;
  life.semesters.forEach((record,i)=>{
    if(!record || record.year!==Math.floor(i/2)+1 || record.term!==i%2+1 ||
       record.credits!==18 || !Number.isFinite(record.gpa)||record.gpa<0||record.gpa>4.5)
      throw new Error('INVALID_SEMESTER');
    points+=record.gpa*18;
  });
  if(Math.abs(points-life.gradePoints)>1e-7 ||
     life.gpa!==(terms?Number((points/life.credits).toFixed(2)):0))
    throw new Error('INVALID_GPA');
  if(done) {
    const e=life.ending;
    if(!e || typeof e.title!=='string'||!e.title.trim() ||
       e.totalWeeks!==120||e.semesters!==8||e.years!==4||e.gpa!==life.gpa ||
       e.memories!==life.memories?.length||life.pendingEvent!==null)
      throw new Error('INVALID_ENDING');
  } else if(life.ending!==null)throw new Error('EARLY_ENDING');
  // Retain the engine's own resource/history checks on a copy.
  advanceLifeBatch(life,{maxWeeks:1});
}

export function createLifeSession({storage=null, onUpdate=()=>{}}={}) {
  let current=null,saveError=null,loadError=null,writesBlocked=false;
  function publish() { onUpdate({life:current?copy(current):null,saveError,loadError}); }
  function persist() {
    if (!storage || writesBlocked) { saveError='저장소를 사용할 수 없어서 이번 게임은 임시로 진행돼요.'; publish(); return false; }
    try {
      const payload=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life:current});
      if (payload.length>MAX_SAVE_BYTES) throw new Error('SAVE_TOO_LARGE');
      storage.setItem(V2_LOCAL_SAVE_KEY,payload);
      saveError=null; publish(); return true;
    } catch {
      saveError='기기 저장에 실패했어요. 브라우저를 닫으면 진행 기록이 사라질 수 있어요.';
      publish(); return false;
    }
  }
  function readSave() {
    if(!storage)return {exists:null,available:false,error:'저장소 사용 불가'};
    let raw;
    try {raw=storage.getItem(V2_LOCAL_SAVE_KEY);}
    catch {return {exists:null,available:false,error:'저장 기록을 확인할 수 없어요. 기존 기록 보호를 위해 임시로 진행해요.'};}
    if(raw===null)return {exists:false,available:false,error:null};
    try {
      if(raw.length>MAX_SAVE_BYTES)throw new Error('SAVE_TOO_LARGE');
      const parsed=JSON.parse(raw),life=parsed?.life;
      if(parsed?.schema!==V2_LOCAL_SAVE_SCHEMA || life?.version!==LIFE_ENGINE_VERSION)
        throw new Error('VERSION_MISMATCH');
      validateSaveLife(life);
      return {exists:true,available:true,error:null,life,
        summary:{majorId:life.majorId,weeksCompleted:life.weeksCompleted,year:life.year,term:life.term}};
    } catch {
      return {exists:true,available:false,error:'이전 v2 기록을 읽을 수 없어요. 원본은 삭제하지 않았어요.'};
    }
  }
  function inspectSave() {
    const {life:ignored,...preview}=readSave();
    return preview;
  }
  function load() {
    const snapshot=readSave();
    if(!snapshot.available) {loadError=snapshot.error||'이어할 기록이 없어요.';publish();return false;}
    // Apply exactly the validated read; a second read could return another value.
    current=copy(snapshot.life);loadError=null;saveError=null;writesBlocked=false;
    publish();return true;
  }
  function start({majorId,seed=1,policy='balanced',replaceExisting=false,contentVersion}={}) {
    const fresh=createLife({majorId,seed,policy,contentVersion}),existing=readSave();
    if(existing.exists===true && !replaceExisting)
      throw new Error('기존 v2 기록을 교체하려면 먼저 확인해 주세요.');
    writesBlocked=existing.exists===null;
    current=fresh;loadError=null;persist();return copy(current);
  }
  function life() {return current?copy(current):null;}
  function transition(kind) {
    if(!current)throw new Error('시작된 게임이 없어요.');
    if(current.status==='complete')return {kind:'complete',life:copy(current)};
    if(current.pendingEvent)return {kind:'choice',life:copy(current)};
    const priorSemesters=current.semesters.length;
    const priorWeeks=current.weeksCompleted;
    current=advanceLife(current);
    persist();
    if(current.pendingEvent)return {kind:'choice',life:copy(current)};
    if(current.status==='complete')return {kind:'complete',life:copy(current)};
    if(current.semesters.length>priorSemesters)return {kind:'semester',life:copy(current)};
    if(current.weeksCompleted===priorWeeks)throw new Error('시뮬레이션 주차가 진행되지 않았어요.');
    return {kind:kind||'week',life:copy(current)};
  }
  function choose(choiceId) {
    if(!current?.pendingEvent)throw new Error('선택을 기다리는 사건이 없어요.');
    current=chooseLifeEvent(current,choiceId);
    persist();return copy(current);
  }
  function setPolicy(policy) {
    if(!current)throw new Error('시작된 게임이 없어요.');
    current=setLifePolicy(current,policy);
    persist();return copy(current);
  }
  return Object.freeze({start,load,life,inspectSave,
    nextWeek:()=>transition('week'),choose,setPolicy,
    status:()=>({saveError,loadError})});
}
