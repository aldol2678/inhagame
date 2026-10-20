// Fictional campus scenes. Game support rewards are not real university programs.
export const CAMPUS_STORY_VERSION='grow2-campus-stories-1';
export const CAMPUS_FRIEND=Object.freeze({id:'seoyun',name:'서윤'});
const PREFIX='grow2.event.campus.';
const fixed={invite:2,project:47,farewell:116};
const hardshipSlots=[17,32,62,77];
const clamp=n=>Math.max(0,Math.min(100,n));
function freeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
// id, label, competency, outcome. Effects remain modest and bounded.
export const CAMPUS_SCENES=freeze({
  invite:{title:'서윤의 동아리 초대',description:'새로 만난 친구 서윤이 작은 동아리 모임에 함께 가자고 한다.',
    choices:[
      ['join','서윤과 함께 가 본다','collaboration','서윤과 낯선 모임에 들어가 첫 활동을 함께했다.'],
      ['help','준비만 함께 돕는다','execution','서윤에게 준비를 도우며 내 속도로 가까워졌다.'],
      ['space','이번에는 내 시간을 지킨다','recovery','서윤에게 이번에는 쉬겠다고 솔직히 말했고 서로의 시간을 존중했다.']
    ]},
  project:{title:'서윤과 어긋난 프로젝트',description:'서윤과 맡은 공동 과제의 첫 시도가 원하는 결과에 미치지 못했다. 마감이 다가오자 서로 기대했던 역할도 달랐다는 걸 알았다.',
    previous:'invite',choices:[
      ['listen','서로의 어려움부터 듣는다','collaboration','서윤의 부담을 듣고 역할을 다시 나누어 작은 결과물을 완성했다.'],
      ['scope','범위를 줄여 다시 만든다','execution','서윤과 꼭 필요한 부분만 남기고 실패한 시도를 다시 고쳤다.'],
      ['boundary','가능한 역할을 분명히 말한다','expression','서윤에게 할 수 있는 일과 어려운 일을 말하고 현실적인 약속을 정했다.']
    ]},
  farewell:{title:'졸업을 앞두고 만난 서윤',description:'서윤과 처음 만난 날부터 어긋났던 공동 과제까지 돌아본다. 늘 같은 선택을 하지는 않았지만 서로의 변화는 기억하고 있다.',
    previous:'project',choices:[
      ['thanks','함께한 순간에 고마움을 전한다','collaboration','서윤에게 함께한 시간 덕분에 혼자서는 몰랐을 내 모습을 알게 됐다고 전했다.'],
      ['lesson','갈등에서 배운 것을 나눈다','expression','서윤과 어긋났던 순간도 관계를 배우는 기억으로 남겼다.'],
      ['future','각자의 다음 도전을 응원한다','recovery','서윤과 서로 다른 다음 길을 응원하며 네 해의 시간을 마무리했다.']
    ]},
  hardship:{title:'생활비 때문에 멈춘 도전',description:'남은 생활비가 빠듯해 준비하던 작은 프로젝트를 잠시 멈췄다. 다음 주에는 다시 시작할 방법을 찾아보기로 한다.',
    choices:[
      ['budget','필요한 비용부터 정리한다','analysis','멈춘 프로젝트의 비용을 정리하고 꼭 필요한 도움을 적었다.'],
      ['talk','서윤에게 상황을 털어놓는다','collaboration','서윤에게 생활비 때문에 도전을 멈췄다고 말하니 함께 방법을 찾아보자고 했다.'],
      ['rest','잠깐 쉬며 계획을 고친다','recovery','당장 무리하기보다 숨을 고르고 다시 시작할 계획을 세웠다.']
    ]},
  support:{title:'다시 시작할 여유 만들기',description:'생활비 문제를 돌아본 뒤 가능한 방법을 골랐다. 아래 지원과 금액은 게임 속 가상 설정이며 실제 학교 제도를 안내하지 않는다.',
    previous:'hardship',choices:[
      ['scholarship','가상의 생활 지원 장학에 도전한다','analysis','게임 속 생활 지원을 받아 작은 도전을 다시 준비할 여유가 생겼다.',18000,0],
      ['work','짧은 근로로 비용을 마련한다','execution','짧은 근로를 마치고 다시 도전할 비용을 마련했다.',24000,4],
      ['help','도움을 요청하고 비용을 나눈다','collaboration','서윤과 재료를 함께 쓰고 비용을 줄여 다시 시작할 여유를 만들었다.',12000,-3]
    ]},
  retry:{title:'멈췄던 프로젝트에 다시 도전',description:'도움을 얻고 계획을 고쳐 멈췄던 프로젝트 앞에 다시 섰다. 이번에는 결과보다 이어 갈 수 있는 방법을 선택한다.',
    previous:'support',choices:[
      ['small','작은 목표 하나부터 완성한다','execution','생활비로 멈췄던 도전을 작은 결과물부터 다시 이어 갔다.'],
      ['together','서윤과 함께 다시 시작한다','collaboration','생활비로 멈췄던 도전을 서윤과 역할을 나누며 다시 시작했다.'],
      ['pace','내 속도에 맞춰 꾸준히 이어 간다','recovery','도움받은 시간을 바탕으로 내 속도에 맞는 재도전 계획을 실행했다.']
    ]}
});
const record=(life,id)=>life.campusStories?.records.find(r=>r.id===id);
const selected=(r)=>CAMPUS_SCENES[r.id].choices.find(c=>c[0]===r.choice);
const eid=id=>PREFIX+id;
const cid=(id,choice)=>eid(id)+'.'+choice;
const coordinates=at=>({year:Math.floor(at/30)+1,term:Math.floor(at/15)%2+1,week:at%15+1});
const slot=at=>Object.values(coordinates(at)).join(':');
function sceneAt(life) {
  const w=life.weeksCompleted;
  for(const [id,at] of Object.entries(fixed))if(w===at&&!record(life,id))return id;
  const hard=record(life,'hardship'),support=record(life,'support');
  if(hard&&!support&&w===hard.at+1)return 'support';
  if(support&&!record(life,'retry')&&w===support.at+3)return 'retry';
  if(!hard&&hardshipSlots.includes(w)&&life.money<60000)return 'hardship';
  return null;
}
function eventFor(life,id,at=life.weeksCompleted) {
  const scene=CAMPUS_SCENES[id],previous=scene.previous&&record(life,scene.previous);
  return {instanceId:eid(id),eventId:eid(id),type:'campus',title:scene.title,
    ...coordinates(at),description:scene.description,
    recall:previous?'지난 선택: '+selected(previous)[1]:'',
    choices:scene.choices.map(c=>({id:cid(id,c[0]),label:c[1]}))};
}
export function initializeCampusStories(life,version) {
  if(version===undefined)return life;
  if(version!==CAMPUS_STORY_VERSION)throw new Error('Unsupported campus story version');
  life.campusStories={version,records:[]};return life;
}
export function buildCampusEvent(life) {
  if(!life.campusStories||life.status!=='running')return null;
  const id=sceneAt(life);return id?eventFor(life,id):null;
}
function memoryFor(r) {
  return {eventId:eid(r.id),choiceId:cid(r.id,r.choice),
    memoryTag:'grow2.memory.campus.'+r.id+'.'+r.choice,text:selected(r)[3]};
}
export function applyCampusChoice(life,choiceId) {
  validateCampusStories(life);
  const event=buildCampusEvent(life);
  if(!event||JSON.stringify(event)!==JSON.stringify(life.pendingEvent))throw new Error('Invalid campus event');
  const id=event.eventId.slice(PREFIX.length);
  const choice=CAMPUS_SCENES[id].choices.find(c=>cid(id,c[0])===choiceId);
  if(!choice||life.completedEventInstances.includes(event.instanceId))throw new Error('Invalid campus choice');
  const r={id,choice:choice[0],at:life.weeksCompleted};
  life.stats[choice[2]]=clamp(life.stats[choice[2]]+3);
  life.money=Math.max(0,life.money+(choice[4]||0));
  life.stress=clamp(life.stress+(choice[5]||0));
  life.campusStories.records.push(r);
  life.completedEventInstances.push(event.instanceId);
  life.memories.push(memoryFor(r));
  return choice[3];
}
export function buildTurningPoints(life) {
  if(!life.campusStories)return [];
  const points=[],farewell=record(life,'farewell'),retry=record(life,'retry'),project=record(life,'project');
  if(farewell)points.push({id:'campus.friend',kind:'함께한 사람',title:'서윤과 함께한 네 해',
    text:selected(record(life,'invite'))[3]+' '+selected(project)[3]+' '+selected(farewell)[3]});
  if(retry)points.push({id:'campus.retry',kind:'실패 후 재도전',title:'도움을 받아 다시 시작한 순간',
    text:selected(record(life,'hardship'))[3]+' '+selected(record(life,'support'))[3]+' '+selected(retry)[3]});
  else if(project)points.push({id:'campus.project',kind:'실패 후 재도전',title:'서윤과 실패한 과제를 다시 마주한 순간',text:selected(project)[3]});
  return points;
}
export function validateCampusStories(life) {
  const pending=life.pendingEvent;
  const campusPending=pending&&(pending.type==='campus'||pending.instanceId?.startsWith(PREFIX)||pending.eventId?.startsWith(PREFIX));
  const completions=life.completedEventInstances?.filter(x=>typeof x==='string'&&x.startsWith(PREFIX))||[];
  const memories=life.memories?.filter(x=>typeof x?.eventId==='string'&&x.eventId.startsWith(PREFIX))||[];
  if(life.campusStories===undefined) {
    if(campusPending||completions.length||memories.length)throw new Error('Campus story requires version');
    return;
  }
  const s=life.campusStories,w=life.weeksCompleted;
  if(!s||s.version!==CAMPUS_STORY_VERSION||Object.keys(s).sort().join(',')!=='records,version'||
     !Array.isArray(s.records)||s.records.length>6||!Number.isInteger(w)||w<0||w>120)
    throw new Error('Invalid campus state');
  const cursor=coordinates(Math.min(w,119));
  if(life.year!==cursor.year||life.term!==cursor.term||life.week!==cursor.week)
    throw new Error('Invalid campus cursor');
  const seen=new Set();let last=-1;
  for(const r of s.records) {
    if(!r||Object.keys(r).sort().join(',')!=='at,choice,id'||!Object.hasOwn(CAMPUS_SCENES,r.id)||
       seen.has(r.id)||!Number.isInteger(r.at)||r.at<0||r.at>w||r.at<=last||
       !CAMPUS_SCENES[r.id].choices.some(c=>c[0]===r.choice))throw new Error('Invalid campus record');
    const before=CAMPUS_SCENES[r.id].previous;
    if(before&&!seen.has(before))throw new Error('Invalid campus order');
    if(Object.hasOwn(fixed,r.id)&&r.at!==fixed[r.id])throw new Error('Invalid campus date');
    if(r.id==='hardship'&&!hardshipSlots.includes(r.at))throw new Error('Invalid hardship date');
    if(r.id==='support'&&r.at!==record(life,'hardship').at+1)throw new Error('Invalid support date');
    if(r.id==='retry'&&r.at!==record(life,'support').at+3)throw new Error('Invalid retry date');
    if(completions.filter(x=>x===eid(r.id)).length!==1||
       memories.filter(x=>x.eventId===eid(r.id)).length!==1||
       JSON.stringify(memories.find(x=>x.eventId===eid(r.id)))!==JSON.stringify(memoryFor(r))||
       life.shownEventSlots?.filter(x=>x===slot(r.at)).length!==1)
      throw new Error('Invalid campus history');
    seen.add(r.id);last=r.at;
  }
  if(completions.length!==s.records.length||memories.length!==s.records.length)throw new Error('Invalid campus history count');
  for(const [id,at] of Object.entries(fixed))if(w>at&&!seen.has(id))throw new Error('Missing campus scene');
  const hard=record(life,'hardship'),support=record(life,'support');
  if(hard&&w>hard.at+1&&!support)throw new Error('Missing campus support');
  if(support&&w>support.at+3&&!record(life,'retry'))throw new Error('Missing campus retry');
  if(campusPending) {
    const expected=buildCampusEvent(life);
    if(!expected||JSON.stringify(expected)!==JSON.stringify(pending)||
       life.shownEventSlots?.filter(x=>x===slot(w)).length!==1)
      throw new Error('Invalid pending campus event');
  }
  const due=buildCampusEvent(life);
  if(due&&!campusPending&&(life.shownEventSlots?.includes(slot(w))||pending))
    throw new Error('Invalid campus slot');
}
