import {createLearningEngine} from '../learning/learning-engine.js';
import {createLearningProgress,sanitizeProgress} from '../learning/learning-progress.js';

// The native progress store remains authoritative. A cursor never replays a
// submission. If either half of a save is interrupted, require explicit recovery.
export function createDailySession({catalog,getStorage=()=>globalThis.localStorage,account=null,today}={}) {
  const progress=createLearningProgress({getStorage});progress.setAccount(account);
  const engine=createLearningEngine({catalog,progress,today});
  const key=`inha-world-learning-daily-v1:${progress.scope===null?'guest':`user:${encodeURIComponent(progress.scope)}`}`;
  let lastRaw=null,blocked=false,dirty=false,message='';
  function block(text){blocked=true;message=text;return false;}
  try {
    const storage=getStorage();if(!storage)throw Error();lastRaw=storage.getItem(key);
    if(!progress.writable)throw Error();
    if(lastRaw!==null){
      if(lastRaw.length>600000)throw Error();const v=JSON.parse(lastRaw);
      if(!v||Object.keys(v).length!==5||v.format!=='induck.learning.daily'||v.version!==1||v.scope!==progress.scope||
        JSON.stringify(sanitizeProgress(v.progress))!==JSON.stringify(progress.state)||!engine.restoreDaily(v.session))throw Error();
    }
  } catch {block('저장된 세션과 학습 기록을 함께 확인하지 못했어요. 원본을 백업한 뒤 세션만 초기화할 수 있어요.');}
  function unchanged(){
    try {
      const storage=getStorage(),original=progress.originalBackup();
      if(storage.getItem(key)!==lastRaw||storage.getItem(original.key)!==original.raw)return block('다른 화면에서 기록이 바뀌었어요. 이 화면의 기록을 백업한 뒤 새로고침해 주세요.');
      return true;
    } catch {dirty=true;message='저장소를 사용할 수 없어요. 현재 기록을 백업해 주세요.';return false;}
  }
  function persist(){
    dirty=true;
    if(blocked||!unchanged())return false;
    if(progress.saveState.status==='unsaved'&&!progress.save()){message='학습 기록을 저장하지 못했어요. 닫기 전에 백업하고 다시 시도해 주세요.';return false;}
    try {
      const raw=JSON.stringify({format:'induck.learning.daily',version:1,scope:progress.scope,progress:progress.state,session:engine.dailyCheckpoint()});
      const storage=getStorage();storage.setItem(key,raw);
      if(storage.getItem(key)!==raw)throw Error();
      lastRaw=raw;dirty=false;message='풀던 위치까지 이 기기에 저장했어요.';return true;
    } catch {message='풀던 위치를 저장하지 못했어요. 현재 기록을 백업하거나 저장을 다시 시도해 주세요.';return false;}
  }
  function act(action,value){
    if(blocked||dirty||!unchanged())return false;
    let ok=false;
    if(action==='start'&&(!engine.run||engine.run.finished))ok=engine.startDaily();
    else if(action==='choose')ok=engine.choose('option',value);
    else if(action==='hint')ok=engine.hint();
    else if(action==='submit'){ok=engine.submit();if(engine.run?.attempt.checked)ok=true;}
    else if(action==='next'){ok=engine.next();if(engine.run?.finished)ok=true;}
    return ok?persist():false;
  }
  return {engine,progress,act,
    get status(){return {blocked,dirty,message};},
    retry(){return engine.run&&!blocked?persist():false;},
    backup(){let stored=null;try{stored=getStorage()?.getItem(key);}catch{}
      return JSON.stringify({format:'induck.learning.daily.recovery',version:1,scope:progress.scope,
        progress:JSON.parse(progress.export()),session:engine.dailyCheckpoint(),storedSession:stored,
        originalProgress:progress.originalBackup()},null,2);},
    resetAfterBackup(){
      // Explicitly acknowledged by the UI; do not touch native learning progress.
      try{const storage=getStorage();if(storage.getItem(key)!==lastRaw)return false;storage.removeItem(key);return storage.getItem(key)===null;}catch{return false;}
    }
  };
}
