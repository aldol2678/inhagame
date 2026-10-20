import {CAMPUS_STORY_VERSION,buildTurningPoints} from './campus-stories.mjs';
import {getPlayStyle} from './play-style.mjs';
import {ECONOMY_VERSION,LIFE_OPTIONS,spendingPreview,spendingCards} from './life-spending.mjs';
import {GROWTH_VERSION,STAT_LABELS,ACTIVITY_STYLES,activityProgress,growthCards,earnedTraits,traitProgress,nextGrowthReward,competencyChanges} from './campus-growth.mjs';
import {rankGraduates} from './graduate-archive.mjs';
import {FOUNDATION_MAJOR_IDS, findMajor} from './major-registry.mjs';
import {TOTAL_WEEKS} from './life-engine.mjs';
import {createLifeSession} from './session.mjs';
import {FOLLOWUP_CONTENT_VERSION} from './major-stories.mjs';

// Standalone preview only. No v1 account/storage, INHA WORLD, wallet, network or rewards.
const $ = id => document.getElementById(id);
const session=createLifeSession({storage:(()=>{try{return window.localStorage}catch{return null}})()});
const SPEED_MS=Object.freeze({1:650,2:330,4:165,8:85});
let speed=1,playing=false,timer=null,tab='story',autoResumeAfterChoice=false;
let lastRenderedStats=null;
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
  session.start({majorId:$('major-select').value,seed:seedNumber,policy:$('start-policy').value,replaceExisting:existing.exists===true,contentVersion:FOLLOWUP_CONTENT_VERSION,growthVersion:GROWTH_VERSION,economyVersion:ECONOMY_VERSION,campusStoryVersion:CAMPUS_STORY_VERSION,playStyle:$('start-play-style').value,autoBudget:0});
  tab='story';showGame();renderArchive();
  announce('입학을 축하해! 생활 방침을 고르고 시작 버튼을 눌러 줘.');
}
function showGame() {
  lastRenderedStats=null;
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
  updateContinue();renderArchive();
  $('setup-title').focus?.();
}
function showEvent(life) {
  if(!life?.pendingEvent)return;
  stop(null,false);
  const ev=life.pendingEvent;
  put('event-time',life.year+'학년 '+life.term+'학기 · '+life.week+'주차');
  put('event-title',ev.title);
  put('event-description',ev.description ? [ev.recall,ev.description].filter(Boolean).join(' · ') : '인덕이의 이야기가 달라지는 순간이야. 어떻게 할까?');
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
    '/4.50 · 총 '+life.credits+'학점 (게임 내 가상 성적)'+(session.status().archiveError?' · ⚠ '+session.status().archiveError:''));
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
    const cards=[...growthCards(life),...spendingCards(life)];
    [...cards].reverse().forEach(card=>line(parent,{label:card.kind,title:card.title,description:card.text}));
    if(!cards.length)empty(parent,'전공 활동과 사건 선택이 기억카드로 남아.');
  } else if(tab==='ending') {
    if(life.ending) {
      for(const point of buildTurningPoints(life))line(parent,{label:'나를 바꾼 순간 · '+point.kind,title:point.title,description:point.text});
      line(parent,{label:'🎓 '+life.ending.years+'년 · '+life.ending.semesters+'학기',
        title:life.ending.title,description:'졸업 평점 '+life.ending.gpa.toFixed(2)+
          '/4.50 · '+life.ending.memories+'개 추억 · '+life.ending.totalWeeks+'주 완료'});
      if(life.ending.epilogue) {
        const epilogue=life.ending.epilogue;
        line(parent,{label:'전공 이야기',title:epilogue.title,description:epilogue.text});
        for(const chapter of epilogue.chapters)line(parent,{label:chapter.year+'학년의 선택',title:'그때의 인덕이',description:chapter.text});
      }
      line(parent,{label:'획득 특성',title:earnedTraits(life).map(t=>t.title).join(' · ')||'나만의 첫 걸음',description:'활동과 생활 방침의 기록에서 얻은 특성이야.'});
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
  put('save-indicator',session.status().archiveError?'⚠ 졸업기록 보관 실패':session.status().saveError?'⚠ 저장 실패':'💾 v2 기기 저장');
  $('step-button').disabled=life.status==='complete';
  $('play-button').disabled=life.status==='complete';
  $('policy-select').disabled=life.status==='complete';
  const changes=competencyChanges(lastRenderedStats,life);
  put('competency-change',changes.length?'직전 변화: '+changes.map(x=>x.label+' '+(x.delta>0?'+':'')+x.delta).join(' · '):'직전 표시 이후 역량 변화 없음');
  lastRenderedStats={stats:{...life.stats}};
  renderGrowth(life);
  renderSpending(life);
  renderPlayStyle(life);
  renderCampusStories(life);
  renderJournal();
  if(life.status==='complete')renderArchive();
  document.querySelectorAll('[data-tab]').forEach(button=>
    button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
  if(session.status().saveError)announce(session.status().saveError);
}

function renderGrowth(life) {
  const stats=$('growth-stats');stats.replaceChildren();
  for(const [key,label] of Object.entries(STAT_LABELS)) {
    const row=document.createElement('div');row.className='stat-row';
    const text=document.createElement('span');text.textContent=label+' '+life.stats[key]+'/100';
    const bar=document.createElement('progress');bar.max=100;bar.value=life.stats[key];bar.setAttribute('aria-label',label);
    row.append(text,bar);stats.append(row);
  }
  const active=activityProgress(life).at(-1),termIndex=Math.min(8,Math.floor(life.weeksCompleted/15)+1);
  const thisTerm=active?.term===termIndex?active:null;
  $('activity-select').disabled=!life.growth||life.status==='complete'||life.pendingEvent!==null||life.weeksCompleted%15!==0;
  $('activity-select').value=thisTerm?.style||'explore';
  put('activity-summary',!life.growth?'이전 저장은 기존 진행 방식을 유지해. 새 게임부터 전공 활동을 선택할 수 있어.':
    (findMajor(life.majorId)?.majorAction.label||'전공 활동')+' · '+termIndex+'번째 학기 · '+(thisTerm?.weeks||0)+'/15주');
  put('growth-traits',earnedTraits(life).map(t=>t.title).join(' · ')||'아래 조건을 채워 나만의 특성을 얻어 봐.');
  const reward=nextGrowthReward(life);
  put('next-growth-reward',reward?'다음 '+reward.title+'까지 '+reward.remaining+'주 · '+reward.label+(reward.capped?' 100 상한 도달 (카드는 획득)':' 최대 +1 (100 상한)'):life.growth?'이번 인생의 전공 활동을 모두 마쳤어.':'이전 저장에는 추가 성장 보상이 없어.');
  const traits=$('trait-progress');traits.replaceChildren();
  for(const t of traitProgress(life)) {
    const row=document.createElement('div');row.className='trait-row';
    const label=document.createElement('p');label.textContent=(t.earned?'✓ ':'○ ')+t.title+' · '+t.condition+' '+Math.min(t.current,t.goal)+'/'+t.goal+(t.available?'':' · 새 게임부터 가능');
    const bar=document.createElement('progress');bar.max=t.goal;bar.value=Math.min(t.current,t.goal);bar.setAttribute('aria-label',t.title+' 진행률');
    row.append(label,bar);traits.append(row);
  }
}

function renderSpending(life) {
 const select=$('spending-select'),note=$('spending-note');
 select.replaceChildren();
 for(const o of LIFE_OPTIONS) {
  const element=document.createElement('option');element.value=o.id;
  element.textContent=o.label+' · '+currency.format(o.cost)+'원';
  element.disabled=!!life.spending&&life.money<o.cost;select.append(element);
 }
 select.value=life.spending?.selected||'none';
 select.disabled=!life.spending||life.status==='complete'||!!life.pendingEvent;
 const p=spendingPreview(life);
 note.textContent=!p?'이전 저장은 기존 규칙을 유지해. 새 게임부터 생활 활동을 이용할 수 있어.':
 p.id==='none'?'이번 주 생활 방침에 집중해. 선택은 주차 완료 시 한 번 실행되고 자동으로 초기화돼.':
 '주차 완료 시 '+currency.format(p.cost)+'원 · 체력 '+(p.stamina>=0?'+':'')+p.stamina+
 ' · 스트레스 '+(p.stress>=0?'+':'')+p.stress+(p.stat?' · '+STAT_LABELS[p.stat]+' 최대 +'+p.gain:'')+
 ' · 기본 역량 성장·양수 수입 50% (여가 시간 사용)'+(p.factor<1?' · 최근 반복으로 효과 감소':'')+
 (p.effort<1?' · 피로로 활동 효과 감소':'')+
 (p.id==='project'?' · 분석·창의·협업 평균 50 이상이면 제작 성장 증가':'')+
 (p.id==='walk'||p.id==='rest'?' · 회복 역량에 따라 체력 회복 증가':'')+
 ' · 사건 후 잔액 부족 시 결제 없이 취소';
}

const POLICY_LABELS={balanced:'균형 잡힌 생활',academic:'학업 중심',social:'친구·동아리 중심',work:'아르바이트 중심',creative:'창작·도전 중심'};
const spendingLabel=id=>LIFE_OPTIONS.find(x=>x.id===id)?.label||'기존 소비 규칙 유지';
function planText(plan){
 if(!plan)return '이번 인생의 운영을 마쳤어요.';
 return plan.week+'주차 · '+POLICY_LABELS[plan.policy]+
  (plan.activity?' · '+(ACTIVITY_STYLES[plan.activity]?.label||plan.activity):'')+
  ' · '+spendingLabel(plan.spending)+' · 활동비 '+currency.format(plan.cost)+'원'+
  (plan.locked?' · 사건 전에 정한 이번 주 계획 유지':'');
}
function renderPlayStyle(life){
 const settings=getPlayStyle(life),plan=session.playStylePlan(),simple=settings.mode==='simple';
 const completed=life.status==='complete';
 $('play-style-select').value=settings.mode;$('play-style-select').disabled=completed;
 $('simple-goal').value=settings.goal;$('simple-budget').value=String(settings.budget);
 $('simple-goal').disabled=completed;$('simple-budget').disabled=completed;
 $('simple-controls').hidden=!simple;
 for(const id of ['manual-policy','manual-activity','manual-spending'])$(id).hidden=simple;
 if(simple||plan?.locked||life.pendingEvent||completed)for(const id of ['policy-select','activity-select','spending-select'])$(id).disabled=true;
 const history=life.playStyle?.history||[],simpleWeeks=history.filter(x=>x.mode==='simple').length;
 put('play-style-status',(simple?'간편: 현재 상태와 목표로 계획을 준비해요.':'기본: 생활 방침과 활동을 직접 선택해요.')+
  (plan?.locked?' 이번 주는 '+(plan.mode==='simple'?'간편':'기본')+'으로 준비한 계획을 유지하고 설정 변경은 다음 주부터 반영해요.':'')+
  ' · 간편 운영 완료 '+simpleWeeks+'주 · 모드 자체의 추가 보상 없음');
 $('simple-plan').hidden=!simple&&!plan?.locked;
 put('simple-plan',planText(plan));
 const detail=$('play-style-explanation');detail.replaceChildren();
 if(plan){
  line(detail,{label:'이번 주 실행 전 계획',title:planText(plan),description:(plan.reasons||[]).join(' · ')});
  line(detail,{label:'결제 범위',title:'이번 주 자동 생활 활동 한도 '+currency.format(plan.budget)+'원',
   description:'주간 활동비 한도이며 기본 생활비와 사건 지출은 별도예요. 미사용 예산은 다음 주 한도에 더하지 않아요. 사건 후 잔액이 부족하면 기존 규칙대로 활동을 취소해요.'});
 }
 if(!life.spending||!life.growth)line(detail,{label:'이전 저장 호환',title:'기존 성장·소비 규칙 유지',description:'플레이 스타일을 바꿔도 없던 성장 보상이나 소비 기능을 새로 붙이지 않아요.'});
 const latest=history.slice(-8).reverse();
 for(const h of latest)line(detail,{label:h.week+'주차 · '+(h.mode==='simple'?'간편 운영':'직접 운영'),
  title:POLICY_LABELS[h.policy]+' · '+spendingLabel(h.spending),description:'완료 시 활동비 '+currency.format(h.cost)+'원 · 설정 예산 '+currency.format(h.budget)+'원'});
 if(!latest.length)empty(detail,'아직 이 운영 기록이 없어요. 주차가 실제로 완료되면 남아요.');
}

function renderCampusStories(life) {
  const list=$('campus-story-list');list.replaceChildren();
  put('campus-story-note',life.campusStories?
    '등장인물과 지원 제도는 게임 속 가상 설정이야. 만남과 재도전은 성적과 별개로 기록돼.':
    '이전 저장의 진행은 그대로 유지해. 새 게임부터 친구와 지원·재도전 이야기가 열려.');
  const points=buildTurningPoints(life);
  for(const point of points)line(list,{label:point.kind,title:point.title,description:point.text});
  if(!points.length) {
    const memories=life.campusStories?life.memories.filter(m=>m.eventId.startsWith('grow2.event.campus.')):[];
    for(const memory of memories.slice(-6).reverse())line(list,{label:'이어지는 캠퍼스 이야기',title:'기억에 남은 선택',description:memory.text});
    if(!memories.length)empty(list,life.campusStories?'사람과의 만남, 도움을 청한 선택이 이곳에 남아.':'기존 기억카드와 전공 이야기는 계속 볼 수 있어.');
  }
}

function renderArchive() {
  const result=session.graduateArchive(),list=$('archive-list');list.replaceChildren();
  put('archive-status',session.status().archiveError||result.error||(result.records.length+' / 50개 기록 · 남은 공간 '+(50-result.records.length)+'건 · 같은 완료 요약은 중복 보관하지 않아.'));
  if(!result.ok)return;
  if(!result.records.length){empty(list,'졸업하면 기록이 자동으로 보관돼. 저장된 기록은 새 게임을 시작해도 남아.');return;}
  for(const item of rankGraduates(result.records)) {
    const r=item.record,details=document.createElement('details');details.className='graduate-record';
    const summary=document.createElement('summary');
    summary.textContent=item.rank+'위 · '+(findMajor(r.majorId)?.displayName||r.majorId)+' · '+r.gpa.toFixed(2)+' / 4.50 · '+r.title;
    if(r.turningPoints?.length)summary.textContent=r.title+' · '+(findMajor(r.majorId)?.displayName||r.majorId)+' · '+r.turningPoints[0].title;
    details.append(summary);
    for(const point of r.turningPoints||[])line(details,{label:'나를 바꾼 순간 · '+point.kind,title:point.title,description:point.text});
    if(r.turningPoints?.length)line(details,{label:'참고 성적',title:'같은 조건 '+item.rank+'위 · '+r.gpa.toFixed(2)+' / 4.50',description:'성적 순위가 대학생활 전체의 가치를 결정하지는 않아.'});
    line(details,{label:'비교 그룹',title:r.growth==='legacy'?'기존 성장 규칙':'전공 활동 성장 규칙',
      description:(r.campusStoryVersion||'기존 사건 규칙')+' · '+(r.economy||'기존 소비 규칙')+' · '+r.content+' · '+r.engine+' · 시드 '+r.seed+' · '+(r.playStyle?.simpleWeeks>0?'간편 운영 '+r.playStyle.simpleWeeks+'주 포함':'간편 운영 기록 없음')+' · 같은 전공·버전·운영 분류끼리 비교'});
    line(details,{label:'8학기 성적',title:r.semesters.map(s=>s.gpa.toFixed(2)).join(' → '),
      description:r.traits.map(t=>t.title).join(' · ')||'나만의 첫 걸음'});
    r.epilogue.forEach((text,i)=>line(details,{label:(i+1)+'학년의 선택',title:'전공 이야기',description:text}));
    const cards=document.createElement('details'),caption=document.createElement('summary');
    caption.textContent='기억카드 '+r.cards.length+'장';cards.append(caption);
    r.cards.forEach(c=>line(cards,{label:c.kind,title:c.title,description:c.text}));details.append(cards);
    const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='이 졸업 기록 삭제';
    const recordKey=JSON.stringify(r);
    remove.addEventListener('click',()=>safely(()=>{
      if(!window.confirm('선택한 졸업 기록 1건을 삭제할까? 되돌릴 수 없어. 필요하면 먼저 JSON 백업을 내려받아 보관해 줘. 현재 게임 저장은 삭제하지 않아.'))return;
      const result=session.removeGraduate(recordKey);renderArchive();
      put('archive-status',result.ok?'선택한 졸업 기록 1건을 삭제했어.':result.error);
    }));
    details.append(remove);list.append(details);
  }
}

function exportGraduateBackup() {
  const result=session.exportGraduates();
  if(!result.ok){put('archive-status',result.error);return;}
  const blob=new Blob([result.json],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  try {
    link.href=url;link.download='induck-grow-graduates.json';document.body.append(link);link.click();
    put('archive-status',result.count+'건의 졸업 기록 백업 다운로드를 요청했어. 기기의 다운로드 목록을 확인해 줘.');
  } finally {
    link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
function safely(action) {
  try {action();}
  catch(error) {
    stop(null,false);
    console.error('Grow v2 UI action failed',error);
    announce('작업을 처리하지 못했어. 현재 기록은 유지돼. '+(error?.message||'다시 시도해 줘.'));
  }
}
$('spending-select').addEventListener('change',e=>safely(()=>{stop(null,false);session.setSpending(e.target.value);render();announce('이번 주 생활 활동을 예약했어. 진행을 누르면 주차 완료 시 한 번 실행돼.');}));

function updatePlayStyle(config){
 stop(null,false);session.setPlayStyle(config);render();
 announce('운영 설정을 바꿨어. 주차나 보상은 진행되지 않았어. 이번 주 계획을 확인해 줘.');
}
$('play-style-select').addEventListener('change',e=>safely(()=>updatePlayStyle({mode:e.target.value})));
$('simple-goal').addEventListener('change',e=>safely(()=>updatePlayStyle({goal:e.target.value})));
$('simple-budget').addEventListener('change',e=>safely(()=>updatePlayStyle({budget:Number(e.target.value)})));

renderMajorPicker();
updateContinue();
renderArchive();
$('archive-export').addEventListener('click',()=>safely(exportGraduateBackup));
$('archive-retry').addEventListener('click',()=>safely(()=>{session.retryArchive();if(session.life())render();renderArchive();}));
$('archive-details').addEventListener('toggle',()=>{if($('archive-details').open)renderArchive();});
$('activity-select').addEventListener('change',e=>safely(()=>{session.setActivity(e.target.value);render();announce('이번 학기 전공 활동을 선택했어. 첫 주 진행 전까지 바꿀 수 있어.');}));
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
