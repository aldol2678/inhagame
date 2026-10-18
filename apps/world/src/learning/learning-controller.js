import {loadApprovedLearningContent,questionKey} from './learning-content.js';
import {createLearningProgress,learningDay} from './learning-progress.js';
import {createLearningEngine,normalizeSpoken} from './learning-engine.js';
import {createLearningSpeech} from './learning-speech.js';
import {renderLearningView} from './learning-view.js';

export function createLearningController({loadContent=options=>loadApprovedLearningContent(undefined,options),content=null,
  getStorage=()=>globalThis.localStorage,doc=globalThis.document,win=globalThis.window,
  onDailyQuiz=()=>false,onError=()=>{}}={}) {
  let host=null,catalog=content,engine=null,disposed=false,epoch=0,screen='home',lang='en',notice='',
    speechIndex=0,speechText='',backup='',importText='',importReady=false;
  const abort=new AbortController();
  const progress=createLearningProgress({getStorage,onWarning:text=>{notice=text;}});
  function speechQuestion(){const qs=catalog?.questions.filter(q=>q.language===lang&&q.type==='order')||[];return qs[speechIndex%qs.length];}
  const speech=createLearningSpeech({win,onStatus:text=>guard(()=>{notice=text;render();}),onText:text=>guard(()=>recordSpeech(text,'mic'))});
  function setup(){if(catalog)engine=createLearningEngine({catalog,progress});}
  setup();
  const ready=content?Promise.resolve(true):Promise.resolve().then(()=>loadContent({signal:abort.signal})).then(value=>{
    if(disposed)return false;catalog=value;setup();return !!catalog;
  }).catch(()=>{if(!disposed){catalog=null;notice='승인된 학습 콘텐츠를 불러오지 못했어요.';}return false;});
  function guard(action){try{return action();}catch{speech.stop();notice='학습 화면을 복구했어요. 홈 또는 스마트폰 닫기를 이용해 주세요.';screen='home';engine?.reset();try{render();}catch{host?.replaceChildren();}onError();return false;}}
  function render(){if(!host||disposed||!catalog)return;renderLearningView({host,doc,model:{catalog,progress:progress.state,engine,screen,lang,notice,speechIndex,speechText,speechSupport:speech.support(),backup,importReady},act,input,guard});}
  function input(kind,value){if(kind==='speech')speechText=value;else{importText=value;importReady=false;}}
  function recordSpeech(text,method){
    if(!host||screen!=='speech'||!text.trim())return;
    const q=speechQuestion();if(!q)return;
    speechText=text;const key=questionKey(q),s=progress.state.speech[key]??={mic:0,typed:0,lastDay:''};s[method]++;s.lastDay=learningDay();
    notice=normalizeSpoken(text)===normalizeSpoken(q.parts.join(' '))?'문장이 일치해요.':'표현을 다시 확인해 보세요.';progress.save();render();
  }
  function act(action,value){
    if(disposed||!host)return false;
    if(['screen','language','lesson','review','boss','next','speech-next','daily'].includes(action)){speech.stop();speechText='';importReady=false;}
    if(action==='screen'){screen=value;backup='';importText='';}
    else if(action==='language'){lang=value;speechIndex=0;}
    else if(action==='lesson'){if(engine.startLesson(value))screen='question';}
    else if(action==='review'){if(engine.startReview(value))screen='question';}
    else if(action==='boss'){if(engine.startBoss(lang,value))screen='question';}
    else if(['option','token','remove','left','right'].includes(action))engine.choose(action,value);
    else if(action==='submit')engine.submit();
    else if(action==='next'){engine.next();if(engine.run?.finished)screen='result';}
    else if(action==='daily'){if(!onDailyQuiz())notice='오늘의 퀴즈를 지금 열 수 없어요.';}
    else if(action==='play'){const q=speechQuestion();if(q)speech.play(lang,q.parts.join(' '));}
    else if(action==='listen')speech.listen(lang);
    else if(action==='typed')recordSpeech(speechText,'typed');
    else if(action==='speech-next')speechIndex++;
    else if(action==='export')backup=progress.export();
    else if(action==='import-preview'){
      if(importText.length>2_000_000)throw Error();JSON.parse(importText);importReady=true;
    } else if(action==='import-confirm'&&importReady){
      const result=progress.import(importText,{catalog,confirm:true});engine.reset();importReady=false;importText='';
      notice=result.unresolved?`가져오기 완료 · ID가 불명확한 구버전 기록 ${result.unresolved}개는 원본 백업에 보관하세요.`:'현재 계정에 학습 기록을 병합했어요.';
    }
    render();return true;
  }
  function unmount(){epoch++;speech.stop();host?.replaceChildren();host=null;backup='';importText='';importReady=false;speechText='';}
  return Object.freeze({ready,available:()=>!disposed&&!!engine,
    mount(target){if(disposed||!engine)return false;if(host!==target)unmount();host=target;return guard(()=>{render();return true;});},
    unmount,
    setAccount(id){if(disposed)return;unmount();screen='home';lang='en';notice='';speechIndex=0;progress.setAccount(id);engine?.reset();},
    snapshot:()=>({available:!disposed&&!!engine,mounted:!!host,scope:progress.scope,screen,epoch,run:engine?.snapshot(),progress:JSON.parse(JSON.stringify(progress.state))}),
    dispose(){if(disposed)return;disposed=true;abort.abort();unmount();engine=null;catalog=null;progress.clearMemory();}
  });
}
