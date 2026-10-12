import {
  LIFE_ENGINE_VERSION, createLife, advanceLife, advanceLifeBatch,
  chooseLifeEvent, setLifePolicy
} from './life-engine.mjs';

export const V2_LOCAL_SAVE_KEY = 'induck-grow-v2-local-0.1';
export const V2_LOCAL_SAVE_SCHEMA = 'grow2.local.preview.1';
const MAX_SAVE_BYTES = 1024 * 1024;
const copy = obj => structuredClone(obj);

export function createLifeSession({storage=null, onUpdate=()=>{}}={}) {
  let current=null,saveError=null,loadError=null;
  function publish() { onUpdate({life:current?copy(current):null,saveError,loadError}); }
  function persist() {
    if (!storage) { saveError='저장소를 사용할 수 없어서 이번 게임은 임시로 진행돼요.'; publish(); return false; }
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
  function inspectSave() {
    if(!storage)return {available:false,error:'저장소 사용 불가'};
    try {
      const raw=storage.getItem(V2_LOCAL_SAVE_KEY);
      if(!raw)return {available:false,error:null};
      if(raw.length>MAX_SAVE_BYTES)return {available:false,error:'세이브 용량이 허용 범위를 넘었어요.'};
      const parsed=JSON.parse(raw),life=parsed?.life;
      if(parsed?.schema!==V2_LOCAL_SAVE_SCHEMA || life?.version!==LIFE_ENGINE_VERSION)
        throw new Error('VERSION_MISMATCH');
      // Validate through the existing pure engine without advancing the original snapshot.
      advanceLifeBatch(life,{maxWeeks:1});
      if(!Number.isInteger(life.weeksCompleted)||life.weeksCompleted>120||life.weeksCompleted<0)
        throw new Error('INVALID_PROGRESS');
      return {available:true,error:null,summary:{majorId:life.majorId,weeksCompleted:life.weeksCompleted,year:life.year,term:life.term}};
    } catch {
      return {available:false,error:'이전 v2 기록을 읽을 수 없어요. 원본은 삭제하지 않았어요.'};
    }
  }
  function load() {
    const preview=inspectSave();
    if(!preview.available) {loadError=preview.error||'이어할 기록이 없어요.';publish();return false;}
    try {
      const parsed=JSON.parse(storage.getItem(V2_LOCAL_SAVE_KEY));
      current=copy(parsed.life); loadError=null; saveError=null;publish();return true;
    } catch {
      loadError='기록을 불러오지 못했어요. 원본은 그대로 남아 있어요.';publish();return false;
    }
  }
  function start({majorId,seed=1,policy='balanced'}={}) {
    const fresh=createLife({majorId,seed,policy});
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
