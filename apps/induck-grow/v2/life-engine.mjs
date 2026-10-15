import {initializeCampusStories,validateCampusStories,buildCampusEvent,applyCampusChoice} from './campus-stories.mjs';
import {initializeSpending,validateSpending,applySpending} from './life-spending.mjs';
import {initializeGrowth,validateGrowth,advanceGrowth} from './campus-growth.mjs';
import { findMajor } from './major-registry.mjs';
import { applySignatureChoice } from './signature-choice.mjs';
import {contentVersion, LEGACY_CONTENT_VERSION, FOLLOWUP_CONTENT_VERSION, buildFollowupEvent, applyFollowupChoice, buildMajorEpilogue, validateStoryState} from './major-stories.mjs';

// Headless, deterministic prototype. No timers, storage, account, wallet, or WORLD calls.
export const LIFE_ENGINE_VERSION = 'grow2-life-engine-0.1';
export const SUPPORTED_POLICIES = Object.freeze(['balanced','academic','social','work','creative']);
export const WEEKS_PER_TERM = 15;
export const TERMS_PER_YEAR = 2;
export const YEARS = 4;
export const TOTAL_WEEKS = WEEKS_PER_TERM * TERMS_PER_YEAR * YEARS;
const COMPETENCIES = ['analysis','creative','expression','collaboration','execution','recovery'];
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const copy = value => structuredClone(value);
const cursorKey = life => [life.year,life.term,life.week].join(':');

const ROUTINES = Object.freeze({
  balanced: { gains:{analysis:1,collaboration:1},stamina:-2,stress:1,money:2000 },
  academic: { gains:{analysis:2,execution:1},stamina:-5,stress:4,money:-2500 },
  social: { gains:{collaboration:2,expression:1},stamina:-1,stress:-3,money:-6500 },
  work: { gains:{execution:1,recovery:1},stamina:-5,stress:3,money:18000 },
  creative: { gains:{creative:2,expression:1},stamina:-4,stress:2,money:-3000 }
});

const GENERAL_EVENTS = Object.freeze([
  {id:'friend',title:'친구의 동아리 제안',minWeight:3,
   choices:[
     {id:'join',label:'같이 참여한다',gains:{collaboration:3},money:-4000,stress:-2,text:'친구와 새로운 활동을 시작했다.'},
     {id:'help',label:'이번에는 준비만 돕는다',gains:{execution:2},money:0,stress:0,text:'도움이 필요할 때 곁을 지켰다.'},
     {id:'decline',label:'내 시간을 먼저 지킨다',gains:{recovery:2},money:0,stress:-4,text:'이번에는 스스로의 일상에 집중했다.'}
   ]},
  {id:'finance',title:'예상하지 못한 생활비',minWeight:2,
   choices:[
     {id:'job',label:'단기 아르바이트를 한다',gains:{execution:2},money:22000,stress:4,text:'급한 생활비를 스스로 마련했다.'},
     {id:'budget',label:'지출 계획을 다시 세운다',gains:{analysis:2},money:6000,stress:1,text:'이번 달의 작은 지출부터 돌아봤다.'},
     {id:'ask',label:'주변에 조언을 구한다',gains:{collaboration:2},money:0,stress:-3,text:'혼자 해결하지 않아도 된다는 것을 배웠다.'}
   ]},
  {id:'study',title:'전공 과제와 시험의 갈림길',minWeight:3,
   choices:[
     {id:'prepare',label:'시험 대비를 먼저 한다',gains:{analysis:3},money:0,stress:3,text:'공부에 집중해 기초를 다졌다.'},
     {id:'project',label:'팀 프로젝트를 마무리한다',gains:{execution:3},money:-3000,stress:2,text:'동료와 함께 결과물을 완성했다.'},
     {id:'balance',label:'범위를 줄이고 균형을 잡는다',gains:{recovery:2,collaboration:1},money:0,stress:-2,text:'모두 완벽할 필요는 없다는 걸 알았다.'}
   ]},
  {id:'health',title:'지친 인덕이에게 필요한 것',minWeight:1,
   choices:[
     {id:'rest',label:'제대로 쉰다',gains:{recovery:3},stamina:12,stress:-10,text:'휴식이 다음 도전을 가능하게 했다.'},
     {id:'walk',label:'캠퍼스를 산책한다',gains:{creative:2},stamina:5,stress:-6,text:'산책하며 생각을 정리했다.'},
     {id:'friend',label:'친구와 고민을 나눈다',gains:{collaboration:3},stamina:2,stress:-5,text:'마음속 고민을 친구에게 털어놓았다.'}
   ]},
  {id:'creative',title:'새로운 공모전이 열렸다',minWeight:2,
   choices:[
     {id:'challenge',label:'직접 도전한다',gains:{creative:3},money:-4500,stress:4,text:'처음 보는 공모전에 도전했다.'},
     {id:'research',label:'작년 수상작을 연구한다',gains:{analysis:3},money:0,stress:1,text:'실패와 성공의 사례에서 배웠다.'},
     {id:'team',label:'팀을 꾸려 함께한다',gains:{collaboration:3},money:-2000,stress:2,text:'서로 다른 강점을 모아 시작했다.'}
   ]}
]);

function rng(life) {
  let x = life.rngState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  life.rngState = x >>> 0;
  return life.rngState / 4294967296;
}
function ensureLife(life) {
  if (!life || life.version !== LIFE_ENGINE_VERSION || !SUPPORTED_POLICIES.includes(life.policy)) throw new TypeError('Invalid life state/version');
  if (!Number.isInteger(life.year) || life.year < 1 || life.year > 4 ||
      !Number.isInteger(life.term) || life.term < 1 || life.term > 2 ||
      !Number.isInteger(life.week) || life.week < 1 || life.week > 15 ||
      !Number.isInteger(life.weeksCompleted) || life.weeksCompleted < 0 || life.weeksCompleted > TOTAL_WEEKS ||
      !Number.isInteger(life.rngState) || life.rngState < 0 ||
      !['running','complete'].includes(life.status)) throw new TypeError('Invalid life cursor');
  if (!Array.isArray(life.completedEventInstances) || !Array.isArray(life.shownEventSlots) ||
      !Array.isArray(life.memories) || !Array.isArray(life.timeline) ||
      !Array.isArray(life.weeklyHistory) || !Array.isArray(life.semesters)) throw new TypeError('Invalid life history');
  if (!life.stats || COMPETENCIES.some(k=>!Number.isFinite(life.stats[k]) || life.stats[k]<0 || life.stats[k]>100) ||
      !Number.isFinite(life.money) || !Number.isFinite(life.stress) || !Number.isFinite(life.stamina)) throw new TypeError('Invalid life resources');
  validateStoryState(life);
  validateGrowth(life);
  validateSpending(life);
  validateCampusStories(life);
}

export function createLife({majorId,seed=1,policy='balanced',contentVersion:requestedContent=LEGACY_CONTENT_VERSION,growthVersion,economyVersion,campusStoryVersion}={}) {
  const major = findMajor(majorId);
  if (!major || major.playability !== 'foundation' || major.calendarTemplate !== 'four_year_8_terms') throw new Error('Unsupported V2 foundation major');
  if (!SUPPORTED_POLICIES.includes(policy)) throw new RangeError('Unsupported life policy');
  if (!Number.isSafeInteger(seed) || seed<0 || seed>0xffffffff) throw new RangeError('Seed must be uint32');
  contentVersion({contentVersion:requestedContent});
  return initializeCampusStories(initializeSpending(initializeGrowth({
    ...(requestedContent===FOLLOWUP_CONTENT_VERSION?{contentVersion:requestedContent}:{}),
    version:LIFE_ENGINE_VERSION, majorId, seed, rngState:seed || 0x6d2b79f5,
    policy,year:1,term:1,week:1,weeksCompleted:0,status:'running',
    stats:{analysis:20,creative:20,expression:20,collaboration:20,execution:20,recovery:20},
    stamina:75,stress:20,money:70000,
    gpa:0,credits:0,gradePoints:0,semesters:[],ending:null,
    pendingEvent:null,shownEventSlots:[],completedEventInstances:[],flags:{},memories:[],
    timeline:[],weeklyHistory:[]
  },growthVersion),economyVersion),campusStoryVersion);
}
export function setLifePolicy(input,policy) {
  ensureLife(input);
  if (!SUPPORTED_POLICIES.includes(policy)) throw new RangeError('Unsupported life policy');
  const life=copy(input);
  if (life.status==='complete') return life;
  life.policy=policy;
  return life;
}
function generalCandidate(life) {
  // Weighted pool respects the state, but never relies on wall-clock or Math.random.
  const pool=GENERAL_EVENTS.map(event=>({
    event,
    weight:event.minWeight + (event.id==='finance' && life.money<90000 ? 7 : 0) +
      (event.id==='health' && (life.stress>45 || life.stamina<45) ? 8 : 0) +
      (event.id==='study' && life.policy==='academic' ? 3 : 0) +
      (event.id==='friend' && life.policy==='social' ? 3 : 0) +
      (event.id==='creative' && life.policy==='creative' ? 3 : 0)
  }));
  const total=pool.reduce((sum,item)=>sum+item.weight,0);
  let draw=rng(life)*total;
  return pool.find(item=>(draw-=item.weight)<0)?.event || pool[pool.length-1].event;
}
function scheduleEvent(life) {
  const slot=cursorKey(life);
  if (life.shownEventSlots.includes(slot)) return;
  const major=findMajor(life.majorId);
  let pending=buildCampusEvent(life);
  if (!pending && life.year===1 && life.term===1 && life.week===6 && major.signatureEvent &&
      !life.completedEventInstances.includes(major.signatureEvent.id)) {
    const event=major.signatureEvent;
    pending={instanceId:event.id,eventId:event.id,type:'signature',
      title:event.title,year:life.year,term:life.term,week:life.week,
      choices:event.choices.map(choice=>({id:choice.id,label:choice.label}))};
  } else if (!pending && contentVersion(life)===FOLLOWUP_CONTENT_VERSION && [2,3].includes(life.year) && life.term===1 && life.week===6) {
    const candidate=buildFollowupEvent(life);
    if(!life.completedEventInstances.includes(candidate.instanceId))pending=candidate;
  } else if (!pending && (life.week===5 || life.week===10)) {
    const event=generalCandidate(life);
    const instanceId='grow2.event.general.'+event.id+'.'+slot;
    pending={instanceId,eventId:'grow2.event.general.'+event.id,type:'general',
      title:event.title,year:life.year,term:life.term,week:life.week,
      choices:event.choices.map(choice=>({id:choice.id,label:choice.label}))};
  }
  if (pending) {life.shownEventSlots.push(slot);life.pendingEvent=pending;}
}
function finishSemester(life) {
  const skill=(life.stats.analysis+life.stats.execution)/2;
  const base=2.45+(skill-20)*0.021-life.stress*0.006;
  const fluctuation=(rng(life)-0.5)*0.45;
  const grade=Number(clamp(base+fluctuation,0,4.5).toFixed(2));
  const record={year:life.year,term:life.term,credits:18,gpa:grade,
    money:life.money,stress:life.stress};
  life.semesters.push(record);
  life.gradePoints+=grade*18;
  life.credits+=18;
  life.gpa=Number((life.gradePoints/life.credits).toFixed(2));
  life.timeline.push({type:'semester',year:life.year,term:life.term,
    title:life.year+'학년 '+life.term+'학기 종료',text:'학기 평점 '+grade.toFixed(2)+' · 누적 '+life.gpa.toFixed(2)});
  if (life.year===YEARS && life.term===TERMS_PER_YEAR) {
    life.status='complete';
    const s=life.stats;
    const best=COMPETENCIES.reduce((a,b)=>s[a]>=s[b]?a:b);
    const endingName={analysis:'탐구하는',creative:'창작하는',expression:'소통하는',
      collaboration:'함께하는',execution:'실행하는',recovery:'균형을 찾는'}[best];
    life.ending={id:'grow2.ending.'+best,title:endingName+' 인덕이',years:YEARS,
      semesters:life.semesters.length,totalWeeks:life.weeksCompleted,
      gpa:life.gpa,memories:life.memories.length};
    if(contentVersion(life)===FOLLOWUP_CONTENT_VERSION)life.ending.epilogue=buildMajorEpilogue(life);
    life.timeline.push({type:'ending',year:YEARS,term:TERMS_PER_YEAR,
      title:life.ending.title,text:'네 해의 선택이 하나의 이야기가 되었다.'});
  } else {
    life.timeline.push({type:'vacation',year:life.year,term:life.term,
      title:'방학',text:'다음 학기를 준비하며 잠시 숨을 고른다.'});
    life.stamina=clamp(life.stamina+15,0,100);
    life.stress=clamp(life.stress-12,0,100);
    if (life.term===TERMS_PER_YEAR) {life.year++;life.term=1;}
    else life.term++;
    life.week=1;
  }
}
function completeWeek(life) {
  advanceGrowth(life);
  const routineScale=applySpending(life);
  const routine=ROUTINES[life.policy];
  const noise=Math.floor(rng(life)*3)-1;
  for (const [competency,value] of Object.entries(routine.gains)) life.stats[competency]=clamp(life.stats[competency]+value*routineScale,0,100);
  if (noise>0) life.stats.recovery=clamp(life.stats.recovery+1,0,100);
  life.stamina=clamp(life.stamina+routine.stamina+4,0,100);
  life.stress=clamp(life.stress+routine.stress-2+(life.week===8||life.week===15?3:0),0,100);
  life.money=Math.max(0,life.money+(routine.money>0?routine.money*routineScale:routine.money)-4000+noise*500);
  life.weeksCompleted++;
  life.weeklyHistory.push({year:life.year,term:life.term,week:life.week,policy:life.policy,
    stamina:life.stamina,stress:life.stress,money:life.money});
  if (life.week===WEEKS_PER_TERM) finishSemester(life);
  else life.week++;
}
export function advanceLife(input) {
  ensureLife(input);
  const life=copy(input);
  if (life.status==='complete' || life.pendingEvent) return life;
  scheduleEvent(life);
  if (!life.pendingEvent) completeWeek(life);
  return life;
}
export function chooseLifeEvent(input,choiceId) {
  ensureLife(input);
  const life=copy(input),event=life.pendingEvent;
  if (!event || life.status!=='running') throw new Error('No pending event');
  if (typeof choiceId!=='string' || !event.choices.some(choice=>choice.id===choiceId)) throw new RangeError('Choice is not offered');
  if (life.completedEventInstances.includes(event.instanceId)) throw new Error('Event already completed');
  let summary='';
  if (event.type==='signature') {
    const result=applySignatureChoice(life.majorId,choiceId,life);
    if (!result.applied) throw new Error('Event was already applied');
    Object.assign(life,result.state);
    summary=life.memories.at(-1).text;
  } else if(event.type==='campus') {
    summary=applyCampusChoice(life,choiceId);
  } else if(event.type==='followup') {
    summary=applyFollowupChoice(life,choiceId);
  } else {
    const template=GENERAL_EVENTS.find(item=>'grow2.event.general.'+item.id===event.eventId);
    if (!template) throw new Error('Unknown event template');
    const choice=template.choices.find(item=>item.id===choiceId);
    if (!choice) throw new Error('Unknown event choice');
    for (const [key,value] of Object.entries(choice.gains||{})) life.stats[key]=clamp(life.stats[key]+value,0,100);
    life.money=Math.max(0,life.money+(choice.money||0));
    life.stress=clamp(life.stress+(choice.stress||0),0,100);
    life.stamina=clamp(life.stamina+(choice.stamina||0),0,100);
    life.completedEventInstances.push(event.instanceId);
    life.memories.push({eventId:event.instanceId,choiceId,
      memoryTag:'grow2.memory.general.'+template.id+'.'+choice.id,text:choice.text});
    summary=choice.text;
  }
  const label=event.choices.find(choice=>choice.id===choiceId).label;
  life.timeline.push({type:'event',year:event.year,term:event.term,week:event.week,
    eventId:event.instanceId,title:event.title,choice:label,text:summary});
  life.pendingEvent=null;
  return life;
}
export function advanceLifeBatch(input,{maxWeeks=1}={}) {
  ensureLife(input);
  if (![1,2,4,8,16,120].includes(maxWeeks)) throw new RangeError('Batch size must be 1, 2, 4, 8, 16 or 120');
  let life=copy(input),processed=0;
  while (processed<maxWeeks && life.status==='running' && !life.pendingEvent) {
    const before=life.weeksCompleted;
    life=advanceLife(life);
    if (life.weeksCompleted===before) break; // User choice pauses before weekly advancement.
    processed++;
  }
  return {life,processed,paused:!!life.pendingEvent};
}
export function simulateCompleteLife(options,{pickChoice=event=>event.choices[0].id}={}) {
  let life=createLife(options);
  // Maximum 120 weeks + 17 pauses plus ample headroom. No external effects.
  for (let i=0;i<300 && life.status!=='complete';i++) {
    if (life.pendingEvent) life=chooseLifeEvent(life,pickChoice(life.pendingEvent,life));
    else life=advanceLife(life);
  }
  if (life.status!=='complete') throw new Error('Life simulation did not finish');
  return life;
}
