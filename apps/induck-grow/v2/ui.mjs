import {FOUNDATION_MAJOR_IDS, findMajor} from './major-registry.mjs';
import {TOTAL_WEEKS} from './life-engine.mjs';
import {createLifeSession} from './session.mjs';
import {FOLLOWUP_CONTENT_VERSION} from './major-stories.mjs';

// Standalone preview only. No v1 account/storage, INHA WORLD, wallet, network or rewards.
const $ = id => document.getElementById(id);
const session=createLifeSession({storage:(()=>{try{return window.localStorage}catch{return null}})()});
const SPEED_MS=Object.freeze({1:650,2:330,4:165,8:85});
let speed=1,playing=false,timer=null,tab='story',autoResumeAfterChoice=false;
const currency=new Intl.NumberFormat('ko-KR');
const setup=$('setup-screen'),game=$('game-screen');
const eventDialog=$('event-dialog'),semesterDialog=$('semester-dialog');

function announce(text) {
  $('status-message').textContent=text;
  $('play-hint').textContent=text;
}
function put(id,text) {$(id).textContent=String(text);}
function setWidth(id,n){$(id).style.width=Math.max(0,Math.min(100,n))+'%';}
function closeDialog(dialog){if(dialog.open)dialog.close();}
function openDialog(dialog) {
  if(!dialog.open)dialog.showModal();
}
function stop(reason,notify=true) {
  const wasPlaying=playing;
  playing=false;
  if(timer!==null){window.clearTimeout(timer);timer=null;}
  $('play-button').textContent='▶ 진행';
  $('play-button').setAttribute('aria-pressed','false');
  if(reason && notify && wasPlaying)announce(reason);
}
function queue() {
  if(!playing || timer!==null || document.hidden)return;
  timer=window.setTimeout(()=>{
    timer=null;
    if(!playing || document.hidden)return;
    try {handleTransition(session.nextWeek());}
    catch(error) {stop();announce('진행에 실패했어. 기록은 유지돼. '+error.message);}
    if(playing)queue();
  },SPEED_MS[speed]);
}
function play() {
  const life=session.life();
  if(!life)return;
  if(life.pendingEvent){showEvent(life);return;}
  if(life.status==='complete'){selectTab('ending');return;}
  if(document.hidden){stop('다른 탭에서는 자동 진행하지 않아.');return;}
  playing=true;
  $('play-button').textContent='⏸ 정지';
  $('play-button').setAttribute('aria-pressed','true');
  announce('인덕이가 대학생활을 보내고 있어. '+speed+'배속');
  queue();
}
function renderMajorPicker() {
  const select=$('major-select');
  for(const id of FOUNDATION_MAJOR_IDS) {
    const major=findMajor(id);
    if(!major || major.playability!=='foundation')continue;
    const option=document.createElement('option');
    option.value=major.id;option.textContent=major.displayName;
    select.appendChild(option);
  }
  describeMajor();
}
function describeMajor() {
  const major=findMajor($('major-select').value);
  $('major-description').textContent=major?
    '대표 활동: '+major.majorAction.label+' · 4년 과정 · 개발용 전공 설정':'';
}
function updateContinue() {
  const available=session.inspectSave();
  $('continue-button').disabled=!available.available;
  $('save-preview').textContent=available.available?
    '저장 기록: '+(findMajor(available.summary.majorId)?.displayName??'학과')+
    ' · '+available.summary.year+'학년 '+available.summary.term+'학기 · '+available.summary.weeksCompleted+'/120주'
    :available.error||'아직 저장된 v2 기록이 없어. 새 게임을 시작해 줘.';
}
function startGame() {
  const existing=session.inspectSave();
  if((session.life()||existing.exists===true) &&
     !window.confirm('기존 v2 인생 기록을 새 게임으로 교체할까? 현재 로컬 기록은 덮어써져.'))return;
  const seedNumber=Number($('seed-input').value);
  if($('seed-input').value.trim()==='' || !Number.isSafeInteger(seedNumber) ||
     seedNumber<0 || seedNumber>4294967295) {
    $('seed-input').focus();
    announce('인생 시드는 0에서 4294967295 사이의 정수로 설정해 줘.');
    return;
  }
  stop(null,false);
  closeDialog(eventDialog);closeDialog(semesterDialog);
  session.start({majorId:$('major-select').value,seed:seedNumber,policy:$('start-policy').value,replaceExisting:existing.exists===true,contentVersion:FOLLOWUP_CONTENT_VERSION});
  tab='story';showGame();
  announce('입학을 축하해! 생활 방침을 고르고 시작 버튼을 눌러 줘.');
}
function showGame() {
  setup.hidden=true;game.hidden=false;
  render();
  if(session.life()?.pendingEvent)showEvent(session.life());
  $('game-title').focus?.();
}
function resume() {
  stop(null,false);
  if(!session.load()) {updateContinue();announce(session.status().loadError||'저장 기록을 불러올 수 없어.');return;}
  tab='story';showGame();
  announce('기록을 불러왔어. 안전을 위해 진행은 멈춘 상태야.');
}
function showSetup() {
  stop(null,false);
  closeDialog(eventDialog);closeDialog(semesterDialog);
  setup.hidden=false;game.hidden=true;
  updateContinue();
  $('setup-title').focus?.();
}
function showEvent(life) {
  if(!life?.pendingEvent)return;
  stop(null,false);
  const ev=life.pendingEvent;
  put('event-time',life.year+'학년 '+life.term+'학기 · '+life.week+'주차');
  put('event-title',ev.title);
  put('event-description',ev.description ? ev.recall+' · '+ev.description : '인덕이의 이야기가 달라지는 순간이야. 어떻게 할까?');
  const options=$('event-options');options.replaceChildren();
  for(const item of ev.choices) {
    const button=document.createElement('button');
    button.type='button';
    button.textContent=item.label;
    button.addEventListener('click',()=>safely(()=>{
      session.choose(item.id);
      closeDialog(eventDialog);
      const shouldResume=autoResumeAfterChoice;
      autoResumeAfterChoice=false;
      render();
      announce('선택을 기록했어. 인덕이의 이야기가 이어져.');
      if(shouldResume && !document.hidden)play();
    }));
    options.appendChild(button);
  }
  openDialog(eventDialog);
  options.querySelector('button')?.focus();
  announce('특별한 사건이 나타났어. 선택할 때까지 시간이 멈춰 있어.');
}
function showSemester(life) {
  const finished=life.status==='complete';
  const last=life.semesters.at(-1);
  put('semester-title',finished?'🎓 인덕이가 졸업했어!':last.year+'학년 '+last.term+'학기 성적표');
  put('semester-summary','이번 학기 '+last.gpa.toFixed(2)+'/4.50 · 누적 '+life.gpa.toFixed(2)+
    '/4.50 · 총 '+life.credits+'학점 (게임 내 가상 성적)');
  put('semester-close',finished?'졸업앨범 열기':'다음 학기 준비하기');
  openDialog(semesterDialog);
  $('semester-close').focus();
}
function handleTransition(result) {
  const life=result.life;
  render();
  if(result.kind==='choice') {
    autoResumeAfterChoice=playing;
    showEvent(life);return;
  }
  if(result.kind==='semester'||result.kind==='complete') {
    stop(null,false);
    showSemester(life);
    announce(result.kind==='complete'?'인덕이가 졸업했어!':'이번 학기가 끝났어. 성적표를 확인해 줘.');
  }
}
function takeStep() {
  stop(null,false);
  const life=session.life();
  if(!life)return;
  if(life.pendingEvent){autoResumeAfterChoice=false;showEvent(life);return;}
  handleTransition(session.nextWeek());
}
function newGame() {
  const saved=session.inspectSave(),life=session.life();
  if((life||saved.available) &&
     !window.confirm('입학 화면으로 돌아갈까? 현재 v2 기록은 유지되고 새 게임을 시작할 때만 덮어써져.'))return;
  showSetup();
}
function line(parent,{label,title,description}) {
  const article=document.createElement('article');article.className='journal-entry';
  const top=document.createElement('small');top.textContent=label;
  const strong=document.createElement('b');strong.textContent=title;
  const p=document.createElement('p');p.textContent=description||'';
  article.append(top,strong,p);parent.appendChild(article);
}
function selectTab(next) {
  tab=next;
  renderJournal();
  document.querySelectorAll('[data-tab]').forEach(button=>
    button.setAttribute('aria-pressed',String(button.dataset.tab===next)));
}
function renderJournal() {
  const life=session.life();if(!life)return;
  const parent=$('journal-list');parent.replaceChildren();
  if(tab==='story') {
    for(const item of [...life.timeline].reverse().slice(0,30))line(parent,{
      label:item.year+'학년 '+item.term+'학기'+(item.week?' · '+item.week+'주차':''),
      title:item.title,description:item.text});
    if(!life.timeline.length) empty(parent,'아직 기록이 없어. 인덕이와 첫 주를 시작해 봐!');
  } else if(tab==='semesters') {
    life.semesters.forEach(x=>line(parent,{label:x.year+'학년 '+x.term+'학기',
      title:'평점 '+x.gpa.toFixed(2)+' / 4.50',
      description:x.credits+'학점 · 학기 말 생활비 '+currency.format(x.money)+'원'}));
    if(!life.semesters.length)empty(parent,'첫 학기가 끝나면 가상 성적표가 나타나.');
  } else if(tab==='memories') {
    [...life.memories].reverse().slice(0,40).forEach((m,i)=>line(parent,{
      label:'추억 '+(life.memories.length-i),title:m.text,description:m.memoryTag}));
    if(!life.memories.length)empty(parent,'사건에서 선택하면 특별한 추억이 기록돼.');
  } else if(tab==='ending') {
    if(life.ending) {
      line(parent,{label:'🎓 '+life.ending.years+'년 · '+life.ending.semesters+'학기',
        title:life.ending.title,description:'졸업 평점 '+life.ending.gpa.toFixed(2)+
          '/4.50 · '+life.ending.memories+'개 추억 · '+life.ending.totalWeeks+'주 완료'});
      if(life.ending.epilogue) {
        const epilogue=life.ending.epilogue;
        line(parent,{label:'전공 이야기',title:epilogue.title,description:epilogue.text});
        for(const chapter of epilogue.chapters)line(parent,{label:chapter.year+'학년의 선택',title:'그때의 인덕이',description:chapter.text});
      }
      line(parent,{label:'기록',title:'또 다른 인생을 시작할 수 있어!',
        description:'같은 인덕이에게도 전공과 선택에 따라 서로 다른 이야기가 생겨.'});
    } else empty(parent,'4학년 2학기를 끝내면 졸업앨범이 열려.');
  }
}
function empty(parent,text) {
  const p=document.createElement('p');p.className='empty';p.textContent=text;parent.appendChild(p);
}
function render() {
  const life=session.life();if(!life)return;
  const major=findMajor(life.majorId);
  put('game-title','인덕이의 대학생활');
  put('school-year',life.status==='complete'?'졸업 완료':life.year+'학년 '+life.term+'학기');
  put('major-label',(major?.displayName??'전공')+' · 인생 시드 '+life.seed);
  put('week-display',life.weeksCompleted+' / '+TOTAL_WEEKS+'주 완료');
  $('life-progress').setAttribute('aria-valuenow',String(life.weeksCompleted));
  setWidth('progress-fill',(life.weeksCompleted/TOTAL_WEEKS)*100);
  put('stamina-value',Math.round(life.stamina)+' / 100');
  put('stress-value',Math.round(life.stress)+' / 100');
  put('money-value',currency.format(life.money)+'원');
  put('gpa-value',life.semesters.length?life.gpa.toFixed(2)+' / 4.50':'미산정');
  setWidth('stamina-fill',life.stamina);
  setWidth('stress-fill',life.stress);
  $('policy-select').value=life.policy;
  const exhausted=life.stamina<38||life.stress>=65;
  $('duck').classList.toggle('tired',exhausted);
  $('duck').classList.toggle('bright',!exhausted&&life.policy==='social');
  put('scene-caption',life.status==='complete'?'졸업을 축하해!':exhausted?'조금 지쳤어':'인덕이가 학교에 있어');
  put('scene-message',life.status==='complete'?'🎓 '+life.ending.title+'!':exhausted?
      '인덕이에게 잠깐의 휴식이 필요해.':({
        balanced:'인덕이는 자기만의 속도로 자라고 있어.',
        academic:'인덕이가 열심히 공부하는 중이야!',
        social:'친구들과 즐거운 시간을 보내고 있어.',
        work:'오늘도 차곡차곡 생활비를 모으고 있어.',
        creative:'새로운 아이디어가 떠오르는 것 같아!'
      })[life.policy]);
  put('save-indicator',session.status().saveError?'⚠ 저장 실패':'💾 v2 기기 저장');
  $('step-button').disabled=life.status==='complete';
  $('play-button').disabled=life.status==='complete';
  $('policy-select').disabled=life.status==='complete';
  renderJournal();
  document.querySelectorAll('[data-tab]').forEach(button=>
    button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
  if(session.status().saveError)announce(session.status().saveError);
}
function safely(action) {
  try {action();}
  catch(error) {
    stop(null,false);
    console.error('Grow v2 UI action failed',error);
    announce('작업을 처리하지 못했어. 현재 기록은 유지돼. '+(error?.message||'다시 시도해 줘.'));
  }
}
renderMajorPicker();
updateContinue();
$('major-select').addEventListener('change',describeMajor);
$('random-seed').addEventListener('click',()=>{
  let seed;
  if(window.crypto?.getRandomValues){const values=new Uint32Array(1);window.crypto.getRandomValues(values);seed=values[0];}
  else seed=(Math.floor(Math.random()*4294967296)>>>0);
  $('seed-input').value=String(seed);
});
$('start-button').addEventListener('click',()=>safely(startGame));
$('continue-button').addEventListener('click',()=>safely(resume));
$('new-life-button').addEventListener('click',()=>safely(newGame));
$('play-button').addEventListener('click',()=>safely(()=>playing?stop('진행을 잠시 멈췄어.'):play()));
$('step-button').addEventListener('click',()=>safely(takeStep));
$('policy-select').addEventListener('change',event=>safely(()=>{
  session.setPolicy(event.target.value);render();announce('생활 방침을 변경했어.');
}));
for(const input of document.querySelectorAll('input[name="speed"]'))input.addEventListener('change',()=>safely(()=>{
  if(!input.checked)return;
  speed=Number(input.value);
  if(!Object.hasOwn(SPEED_MS,speed))throw new Error('지원하지 않는 속도야.');
  if(timer!==null){window.clearTimeout(timer);timer=null;}
  if(playing)queue();
  announce('진행 속도: '+speed+'배속');
}));
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>selectTab(button.dataset.tab)));
$('semester-close').addEventListener('click',()=>safely(()=>{
  closeDialog(semesterDialog);
  if(session.life()?.status==='complete'){selectTab('ending');announce('졸업앨범이 열렸어.');}
  else announce('다음 학기를 시작할 준비가 됐어. 진행을 눌러 줘.');
}));
eventDialog.addEventListener('cancel',event=>event.preventDefault());
semesterDialog.addEventListener('cancel',event=>event.preventDefault());
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){autoResumeAfterChoice=false;stop(null,false);}
});
window.addEventListener('pagehide',()=>{autoResumeAfterChoice=false;stop(null,false);});
window.addEventListener('keydown',event=>{
  if(event.code==='Space' && !event.repeat && event.target===document.body &&
     !eventDialog.open && !semesterDialog.open && !game.hidden) {
    event.preventDefault();safely(()=>playing?stop('진행을 잠시 멈췄어.'):play());
  }
});
// Intentional: remain at setup on every navigation/reload. No surprise autoplay.
