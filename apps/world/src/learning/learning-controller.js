import {loadApprovedLearningContent,questionKey} from './learning-content.js';
import {createLearningProgress,learningDay} from './learning-progress.js';
import {createLearningEngine,normalizeSpoken} from './learning-engine.js';
import {createLearningSpeech} from './learning-speech.js';
import {createLearningSync} from './learning-sync.js';
import {renderLearningView} from './learning-view.js';

export function createLearningController({loadContent=options=>loadApprovedLearningContent(undefined,options),content=null,
  getStorage=()=>globalThis.localStorage,doc=globalThis.document,win=globalThis.window,
  onDailyQuiz=()=>false,onError=()=>{},cloudTransport=null}={}) {
  let host=null,catalog=content,engine=null,disposed=false,epoch=0,screen='home',lang='en',notice='',
    speechIndex=0,speechText='',backup='',importText='',importReady=false,exportedRecovery=null,recoveryChoices=[],cloudState={status:'local'};
  const abort=new AbortController();
  const progress=createLearningProgress({getStorage,onWarning:text=>{notice=text;}});
  const sync=createLearningSync({progress,transport:cloudTransport,getStorage,win,
    isBusy:()=>!!engine?.run&&!engine.run.finished,
    onRestore:()=>{engine?.reset();screen='home';guard(render);},
    onStatus:value=>{cloudState=value;if(['home','stats','result'].includes(screen))guard(render);}});
  function speechQuestion(){const qs=catalog?.questions.filter(q=>q.language===lang&&q.type==='order')||[];return qs[speechIndex%qs.length];}
  const speech=createLearningSpeech({win,onStatus:text=>guard(()=>{notice=text;render();}),onText:text=>guard(()=>recordSpeech(text,'mic'))});
  function setup(){if(catalog)engine=createLearningEngine({catalog,progress});}
  setup();
  const ready=content?Promise.resolve(true):Promise.resolve().then(()=>loadContent({signal:abort.signal})).then(value=>{
    if(disposed)return false;catalog=value;setup();return !!catalog;
  }).catch(()=>{if(!disposed){catalog=null;notice='승인된 학습 콘텐츠를 불러오지 못했어요.';}return false;});
  function guard(action){try{return action();}catch{speech.stop();notice='학습 화면을 복구했어요. 홈 또는 스마트폰 닫기를 이용해 주세요.';screen='home';engine?.reset();try{render();}catch{host?.replaceChildren();}onError();return false;}}
  function render(){if(!host||disposed||!catalog)return;renderLearningView({host,doc,model:{catalog,progress:progress.state,engine,screen,lang,notice,speechIndex,speechText,speechSupport:speech.support(),backup,importReady,importText,cloudState,saveState:progress.saveState,exportedRecovery:!!exportedRecovery,recoveryChoices},act,input,guard});}
  function input(kind,value){if(kind==='speech')speechText=value;else{importText=value;importReady=false;}}
  function recordSpeech(text,method){
    if(!host||screen!=='speech'||!text.trim())return;
    const q=speechQuestion();if(!q)return;
    speechText=text;const key=questionKey(q),s=progress.state.speech[key]??={mic:0,typed:0,lastDay:''};s[method]++;s.lastDay=learningDay();
    notice=normalizeSpoken(text)===normalizeSpoken(q.parts.join(' '))?'문장이 일치해요.':'표현을 다시 확인해 보세요.';progress.save();render();
  }
  function act(action,value){
    if(disposed||!host)return false;
    let outcome=true;
    if(['screen','language','lesson','review','boss','next','speech-next','daily'].includes(action)){speech.stop();speechText='';importReady=false;}
    if(action==='screen'){screen=value;backup='';importText='';exportedRecovery=null;recoveryChoices=[];}
    else if(action==='language'){lang=value;speechIndex=0;}
    else if(action==='lesson'){if(engine.startLesson(value))screen='question';}
    else if(action==='review'){if(engine.startReview(value))screen='question';}
    else if(action==='boss'){if(engine.startBoss(lang,value))screen='question';}
    else if(['option','token','remove','left','right'].includes(action))engine.choose(action,value);
    else if(action==='submit')outcome=engine.submit();
    else if(action==='next'){outcome=engine.next();if(engine.run?.finished)screen='result';}
    else if(action==='daily'){if(!onDailyQuiz())notice='오늘의 퀴즈를 지금 열 수 없어요.';}
    else if(action==='play'){const q=speechQuestion();if(q)speech.play(lang,q.parts.join(' '));}
    else if(action==='listen')speech.listen(lang);
    else if(action==='typed')recordSpeech(speechText,'typed');
    else if(action==='speech-next')speechIndex++;
    else if(action==='retry-save'){if(progress.save()){notice='이 기기에 저장했어요. 클라우드 상태는 아래에서 확인하세요.';void sync.retry();}}
    else if(action==='sync')void sync.retry();
    else if(action==='resolve-local'||action==='resolve-cloud')void sync.resolve(action==='resolve-local'?'local':'cloud');
    else if(action==='recovery-export'){
      exportedRecovery=progress.recoveryBackup();
      backup=JSON.stringify({format:'induck.learning.recovery.bundle',version:1,current:JSON.parse(progress.export()),originalStored:progress.originalBackup(),records:exportedRecovery},null,2);
    }else if(action==='recovery-cleanup'&&exportedRecovery){
      const removed=progress.cleanupRecovery(exportedRecovery,{confirmed:true});exportedRecovery=null;
      notice=`백업한 복구 사본 ${removed}개를 정리했어요. 새 사본·현재 기록·구버전 사본은 유지합니다.`;
    }else if(action==='recovery-pick'){
      importText=JSON.stringify({format:'induck.learning.backup',version:1,progress:recoveryChoices[value]});importReady=true;recoveryChoices=[];
    }
    else if(action==='export'){exportedRecovery=null;backup=progress.export();}
    else if(action==='import-preview'){
      if(importText.length>4_500_000)throw Error();const parsed=JSON.parse(importText);recoveryChoices=[];
      if(parsed?.format==='induck.learning.recovery.bundle'&&parsed.version===1){
        if(parsed.current?.progress)recoveryChoices.push(parsed.current.progress);
        for(const entry of parsed.records||[]){const v=typeof entry.raw==='string'?JSON.parse(entry.raw):entry;for(const p of [v.version===1&&v.completed?v:null,v.local,v.cloud?.progress])if(p)recoveryChoices.push(p);}
        for(const p of parsed.localCopies||[])recoveryChoices.push(p);
        for(const v of parsed.cloudCopies?.records||[])for(const p of [v.local,v.cloud?.progress])if(p)recoveryChoices.push(p);
        importReady=false;notice='복원할 사본을 선택한 뒤 현재 계정으로 가져오기를 확인하세요.';
      }else importReady=true;
    } else if(action==='import-confirm'&&importReady){
      let result;try{result=progress.import(importText,{catalog,confirm:true});}catch{notice='가져오기를 적용하지 못했어요. 입력한 원본을 유지합니다. 형식과 저장 공간을 확인하세요.';render();return false;}engine.reset();importReady=false;importText='';
      notice=result.unresolved?`가져오기 완료 · ID가 불명확한 구버전 기록 ${result.unresolved}개는 원본 백업에 보관하세요.`:'현재 계정에 학습 기록을 병합했어요.';
      if(result.legacy)notice+=` 구버전 변환 완료 · 학습 외 필드 ${result.excluded.length}개 제외. 원본 백업을 유지하세요.`;
    }
    render();return outcome;
  }
  function unmount(){epoch++;speech.stop();host?.replaceChildren();host=null;backup='';importText='';importReady=false;exportedRecovery=null;recoveryChoices=[];speechText='';}
  const beforeUnload=e=>{if(engine&&progress.writable&&progress.saveState.status==='unsaved'){e.preventDefault();e.returnValue='';}};
  win?.addEventListener?.('beforeunload',beforeUnload);
  return Object.freeze({ready,available:()=>!disposed&&!!engine,
    mount(target){if(disposed||!engine)return false;if(host!==target)unmount();host=target;return guard(()=>{render();return true;});},
    unmount,
    setAccount(id){if(disposed)return;unmount();screen='home';lang='en';notice='';speechIndex=0;sync.setAccount(null);progress.setAccount(id);engine?.reset();sync.setAccount(id);},
    snapshot:()=>({available:!disposed&&!!engine,mounted:!!host,scope:progress.scope,screen,epoch,run:engine?.snapshot(),progress:JSON.parse(JSON.stringify(progress.state)),cloud:sync.snapshot(),save:progress.saveState}),
    dispose(){if(disposed)return;disposed=true;win?.removeEventListener?.('beforeunload',beforeUnload);abort.abort();sync.dispose();unmount();engine=null;catalog=null;progress.clearMemory();}
  });
}
