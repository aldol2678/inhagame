import {SUPPORTED_POLICIES,setLifePolicy,advanceLife} from './life-engine.mjs';
import {ACTIVITY_STYLES,selectMajorActivity} from './campus-growth.mjs';
import {LIFE_OPTIONS,spendingPreview,selectSpending} from './life-spending.mjs';

// Optional controller metadata. All outcomes still come from the shared life engine.
export const PLAY_STYLE_VERSION='grow2-play-style-1';
export const PLAY_STYLES=Object.freeze(['basic','simple']);
export const AUTO_BUDGETS=Object.freeze([0,6000,10000,15000]);
const copy=x=>structuredClone(x);
const option=id=>LIFE_OPTIONS.find(x=>x.id===id);
const keys=(x,expected)=>x&&Object.keys(x).sort().join(',')===expected;
const activityAt=(life,week)=>life.growth?.plans.find(p=>p.term===Math.ceil(week/15))?.style||null;
const validAction=p=>p&&PLAY_STYLES.includes(p.mode)&&SUPPORTED_POLICIES.includes(p.policy)&&
  AUTO_BUDGETS.includes(p.budget)&&(p.activity===null||Object.hasOwn(ACTIVITY_STYLES,p.activity))&&
  (p.spending===null||!!option(p.spending));

export function validatePlayStyle(life) {
  if(life.playStyle===undefined)return;
  const s=life.playStyle,w=life.weeksCompleted;
  if(!keys(s,'budget,goal,history,mode,prepared,startedAt,version')||
    s.version!==PLAY_STYLE_VERSION||!PLAY_STYLES.includes(s.mode)||
    !AUTO_BUDGETS.includes(s.budget)||!SUPPORTED_POLICIES.includes(s.goal)||
    !Number.isInteger(s.startedAt)||s.startedAt<0||s.startedAt>w||
    !Array.isArray(s.history)||s.history.length!==w-s.startedAt)
    throw Error('Invalid play style state');
  s.history.forEach((h,i)=>{
    const week=s.startedAt+i+1,spent=life.spending?.history[week-1];
    if(!keys(h,'activity,budget,cost,mode,policy,spending,week')||!validAction(h)||
      h.week!==week||h.policy!==life.weeklyHistory[week-1]?.policy||
      h.activity!==activityAt(life,week)||h.spending!==(spent?.id??null)||
      h.cost!==(spent?.cost??0)||(h.mode==='simple'&&h.cost>h.budget))
      throw Error('Invalid play style history');
  });
  if(s.prepared!==null) {
    const p=s.prepared;
    if(!keys(p,'activity,budget,mode,policy,spending,week')||!validAction(p)||
      p.mode!=='simple'||life.status!=='running'||p.week!==w+1||
      p.policy!==life.policy||p.activity!==activityAt(life,w+1)||
      p.spending!==(life.spending?.selected??null)||
      (p.spending!==null&&option(p.spending).cost>p.budget)||
      !life.shownEventSlots.includes([life.year,life.term,life.week].join(':')))
      throw Error('Invalid prepared play style plan');
  }
}

export function getPlayStyle(life) {
  validatePlayStyle(life);
  return life.playStyle?{mode:life.playStyle.mode,budget:life.playStyle.budget,goal:life.playStyle.goal}:
    {mode:'basic',budget:0,goal:life.policy};
}

export function configurePlayStyle(input,changes={}) {
  validatePlayStyle(input);
  if(input.status!=='running')throw Error('졸업한 인생의 플레이스타일은 바꿀 수 없어요.');
  if(typeof changes==='string')changes={mode:changes};
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||
    Object.keys(changes).some(k=>!['mode','budget','goal'].includes(k)))
    throw Error('Invalid play style settings');
  const settings={...getPlayStyle(input),...changes};
  if(!PLAY_STYLES.includes(settings.mode)||!AUTO_BUDGETS.includes(settings.budget)||
    !SUPPORTED_POLICIES.includes(settings.goal))throw Error('Invalid play style settings');
  const life=copy(input);
  if(!life.playStyle)life.playStyle={version:PLAY_STYLE_VERSION,...settings,
    startedAt:life.weeksCompleted,history:[],prepared:null};
  else Object.assign(life.playStyle,settings);
  return life;
}

function action(life,mode,policy,activity,spending,budget) {
  return {week:life.weeksCompleted+1,mode,policy,activity,spending,budget};
}
function describe(life,plan,reasons,locked=false) {
  const p=plan.spending===null?null:spendingPreview(life,plan.spending);
  return {...plan,cost:p?.affordable?p.cost:0,reasons:[...reasons,
    ...(p&&!p.affordable?['사건 뒤 잔액이 부족해 생활 활동은 결제 없이 취소돼요.']:[])],locked};
}
export function playStylePlan(life) {
  validatePlayStyle(life);
  if(life.status==='complete')return null;
  const settings=getPlayStyle(life),week=life.weeksCompleted+1;
  if(life.playStyle?.prepared)return describe(life,life.playStyle.prepared,
    ['사건 전에 준비한 이번 주 계획이에요. 설정 변경은 다음 주부터 반영돼요.'],true);
  if(settings.mode==='basic'||life.pendingEvent)return describe(life,
    action(life,'basic',life.policy,activityAt(life,week)??(life.growth?'explore':null),
      life.spending?.selected??null,settings.budget),
    [life.pendingEvent?'중요한 사건은 직접 선택해 주세요.':'직접 고른 생활 방침과 활동으로 진행해요.']);
  const tired=life.stamina<45||life.stress>=60,lowFunds=life.money<18000;
  let policy=settings.goal,spending=life.spending?'none':null;
  const reasons=[];
  if(tired){policy='balanced';reasons.push('체력 45 미만 또는 스트레스 60 이상이라 회복을 우선해요.');}
  else if(lowFunds){policy='work';reasons.push('생활비가 18,000원 미만이라 아르바이트를 우선해요.');}
  else reasons.push('선택한 생활 방향을 따라가요.');
  if(life.spending) {
    const canPay=id=>option(id).cost<=settings.budget&&life.money-option(id).cost>=18000;
    if(tired)spending=life.stamina<35&&canPay('meal')?'meal':'rest';
    else if(!lowFunds&&settings.goal==='creative'&&canPay('culture'))spending='culture';
    else if(!lowFunds&&settings.goal==='social'&&canPay('social'))spending='social';
    else if(!lowFunds&&settings.goal==='academic'&&life.stamina>=60&&life.stress<50&&canPay('project'))spending='project';
    else if(!lowFunds&&settings.goal!=='work'&&(life.stamina<70||life.stress>35))spending='walk';
    reasons.push(spending==='none'?'이번 주는 생활 방침에 집중해요.':
      option(spending).cost?'현재 잔액에서 한도 안으로 선택하고 18,000원을 남겨요.':'무료 활동을 선택해요.');
  } else reasons.push('이전 저장의 생활 활동 규칙은 그대로 유지해요.');
  const activity=!life.growth?null:life.weeksCompleted%15===0?
    (settings.goal==='creative'?'build':settings.goal==='social'?'team':'explore'):
    activityAt(life,week);
  return describe(life,action(life,'simple',policy,activity,spending,settings.budget),reasons);
}

export function advanceStyledLife(input) {
  validatePlayStyle(input);
  if(input.status==='complete'||input.pendingEvent)return advanceLife(input);
  const plan=playStylePlan(input);
  let selected=copy(input);
  if(plan.mode==='simple'&&!plan.locked) {
    selected=setLifePolicy(selected,plan.policy);
    if(selected.growth&&selected.weeksCompleted%15===0)
      selected=selectMajorActivity(selected,plan.activity);
    if(selected.spending)selected=selectSpending(selected,plan.spending);
  }
  const life=advanceLife(selected);
  if(!life.playStyle)return life;
  if(life.pendingEvent&&plan.mode==='simple')life.playStyle.prepared={
    week:plan.week,mode:plan.mode,policy:plan.policy,activity:plan.activity,
    spending:plan.spending,budget:plan.budget
  };
  if(life.weeksCompleted===input.weeksCompleted+1) {
    const spent=life.spending?.history.at(-1);
    life.playStyle.history.push({week:life.weeksCompleted,mode:plan.mode,
      policy:life.weeklyHistory.at(-1).policy,activity:activityAt(life,life.weeksCompleted),
      spending:spent?.id??null,cost:spent?.cost??0,budget:plan.budget});
    life.playStyle.prepared=null;
  }
  validatePlayStyle(life);
  return life;
}

export function playStyleSummary(life) {
  validatePlayStyle(life);
  if(!life.playStyle)return undefined;
  const simpleWeeks=life.playStyle.history.filter(h=>h.mode==='simple').length;
  return {version:PLAY_STYLE_VERSION,simpleWeeks,basicWeeks:life.weeksCompleted-simpleWeeks};
}
