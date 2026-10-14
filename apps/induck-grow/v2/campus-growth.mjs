import {findMajor} from './major-registry.mjs';
export const GROWTH_VERSION='grow2-campus-growth-1';
export const ACTIVITY_STYLES=Object.freeze({
  explore:Object.freeze({label:'탐구하고 정리하기',stat:'analysis'}),
  build:Object.freeze({label:'직접 만들어 보기',stat:'creative'}),
  team:Object.freeze({label:'함께 완성하기',stat:'collaboration'})
});
export const STAT_LABELS=Object.freeze({analysis:'분석',creative:'창의',expression:'표현',collaboration:'협업',execution:'실행',recovery:'회복'});
const copy=x=>structuredClone(x);
export function validateGrowth(life) {
  if(life.growth===undefined)return;
  const g=life.growth,w=life.weeksCompleted;
  if(!g||g.version!==GROWTH_VERSION||!Array.isArray(g.plans)||!Number.isInteger(w)||w<0||w>120)
    throw new Error('Invalid growth version/state');
  const required=Math.ceil(w/15),max=Math.min(8,Math.floor(w/15)+1);
  if(g.plans.length<required||g.plans.length>max)throw new Error('Invalid activity count');
  g.plans.forEach((p,i)=>{
    if(!p||p.term!==i+1||!Object.hasOwn(ACTIVITY_STYLES,p.style)||
       Object.keys(p).sort().join(',')!=='style,term')throw new Error('Invalid activity plan');
  });
}
export function initializeGrowth(life,version) {
  if(version===undefined)return life;
  if(version!==GROWTH_VERSION)throw new Error('Unsupported growth version');
  life.growth={version,plans:[]};return life;
}
export function selectMajorActivity(input,style) {
  validateGrowth(input);
  if(!input.growth||input.status!=='running'||input.pendingEvent||input.weeksCompleted%15!==0)
    throw new Error('전공 활동은 학기 첫 주를 진행하기 전에 선택할 수 있어요.');
  if(!Object.hasOwn(ACTIVITY_STYLES,style))throw new Error('Invalid activity style');
  const life=copy(input),index=life.weeksCompleted/15;
  life.growth.plans[index]={term:index+1,style};return life;
}
export function advanceGrowth(life) {
  if(!life.growth)return;
  validateGrowth(life);
  const index=Math.floor(life.weeksCompleted/15);
  if(!life.growth.plans[index])life.growth.plans.push({term:index+1,style:'explore'});
  if((life.weeksCompleted+1)%5===0) {
    const stat=ACTIVITY_STYLES[life.growth.plans[index].style].stat;
    life.stats[stat]=Math.min(100,life.stats[stat]+1);
  }
}
export function activityProgress(life) {
  validateGrowth(life);
  if(!life.growth)return [];
  const label=findMajor(life.majorId)?.majorAction?.label||'전공 프로젝트';
  return life.growth.plans.map(p=>({term:p.term,style:p.style,label,
    weeks:Math.max(0,Math.min(15,life.weeksCompleted-(p.term-1)*15))}));
}
export function growthCards(life) {
  const cards=[];
  for(const p of activityProgress(life))for(const [weeks,label] of [[5,'탐색 노트'],[10,'중간 결과물'],[15,'학기 포트폴리오']])
    if(p.weeks>=weeks)cards.push({id:'activity.'+p.term+'.'+weeks,kind:'전공 성장',
      title:p.label+' · '+label,text:p.term+'번째 학기 · '+ACTIVITY_STYLES[p.style].label+' · '+STAT_LABELS[ACTIVITY_STYLES[p.style].stat]+' +1'});
  for(const m of life.memories)cards.push({id:'memory.'+m.eventId,kind:'선택의 기억',title:m.text,text:'선택 기록 · '+m.choiceId});
  return cards;
}
export function earnedTraits(life) {
  const policies=life.weeklyHistory.map(x=>x.policy),completed=activityProgress(life).filter(p=>p.weeks===15);
  const traits=[];
  const add=(id,title,condition)=>{if(condition)traits.push({id,title});};
  add('steady','꾸준한 완성가',completed.length>=4);
  add('explorer','깊이 파는 탐구자',completed.filter(p=>p.style==='explore').length>=2);
  add('maker','아이디어 제작자',completed.filter(p=>p.style==='build').length>=2);
  add('team','함께하는 동료',completed.filter(p=>p.style==='team').length>=2);
  add('work','성실한 생활인',policies.filter(x=>x==='work').length>=30);
  add('balanced','여러 길을 걸은 인덕이',new Set(policies).size>=4);
  return traits;
}
