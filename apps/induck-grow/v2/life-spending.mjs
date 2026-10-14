// Optional weekly leisure slot. No wallet, network, real currency or wall clock.
export const ECONOMY_VERSION='grow2-life-spending-1';
export const LIFE_OPTIONS=Object.freeze([
 Object.freeze({id:'none',label:'생활 방침에 집중',cost:0,stamina:0,stress:0,stat:null}),
 Object.freeze({id:'walk',label:'무료 캠퍼스 산책',cost:0,stamina:5,stress:-5,stat:'recovery'}),
 Object.freeze({id:'meal',label:'든든한 식사',cost:6000,stamina:14,stress:-3,stat:null}),
 Object.freeze({id:'rest',label:'무료 휴식·생각 정리',cost:0,stamina:10,stress:-7,stat:null}),
 Object.freeze({id:'culture',label:'전시 관람·감상 정리',cost:10000,stamina:-3,stress:-8,stat:'creative'}),
 Object.freeze({id:'social',label:'친구와 식사·대화',cost:8000,stamina:3,stress:-8,stat:'collaboration'}),
 Object.freeze({id:'project',label:'전공 작품 제작',cost:15000,stamina:-8,stress:4,stat:'execution'})
]);
const option=id=>LIFE_OPTIONS.find(x=>x.id===id);
const clamp=n=>Math.max(0,Math.min(100,n));
export function initializeSpending(life,version) {
 if(version===undefined)return life;
 if(version!==ECONOMY_VERSION)throw Error('Unknown spending version');
 life.spending={version,selected:'none',history:[]};return life;
}
export function validateSpending(life) {
 if(life.spending===undefined)return;
 const s=life.spending;
 if(!s||s.version!==ECONOMY_VERSION||Object.keys(s).sort().join(',')!=='history,selected,version'||
 !option(s.selected)||!Array.isArray(s.history)||s.history.length!==life.weeksCompleted)
 throw Error('Invalid spending state');
 for(let i=0;i<s.history.length;i++) {
  const h=s.history[i];
  if(!h||Object.keys(h).sort().join(',')!=='cost,id,week'||h.week!==i+1||!option(h.id)||h.cost!==option(h.id).cost)
  throw Error('Invalid spending history');
 }
 if(life.status==='complete'&&s.selected!=='none')throw Error('Completed spending selection');
}
export function spendingPreview(life,id=life.spending?.selected) {
 const o=option(id);if(!o||!life.spending)return null;
 const repeats=life.spending.history.slice(-2).filter(x=>x.id===id).length;
 const factor=repeats===0?1:repeats===1?0.75:0.5;
 const fatigue=life.stamina<30||life.stress>=75;
 const effort=['culture','social','project'].includes(id)?(fatigue?0.5:1):1;
 const recoveryBonus=id==='walk'||id==='rest'?Math.floor(life.stats.recovery/25):0;
 const skill=id==='project'?(life.stats.analysis+life.stats.creative+life.stats.collaboration)/3:0;
 const gain=o.stat?Number(((id==='project'?(skill>=50?3:2):1)*factor*effort).toFixed(2)):0;
 return {...o,factor,effort,gain,stamina:Number(((o.stamina>0?o.stamina*factor:o.stamina)+recoveryBonus).toFixed(2)),stress:Number((o.stress<0?o.stress*factor:o.stress).toFixed(2)),
 affordable:life.money>=o.cost,routineScale:id==='none'?1:0.5};
}
export function selectSpending(input,id) {
 validateSpending(input);
 if(!input.spending||input.status!=='running'||input.pendingEvent)throw Error('지금은 생활 활동을 선택할 수 없어요.');
 const p=spendingPreview(input,id);if(!p)throw Error('Unknown spending option');
 if(!p.affordable)throw Error('생활비가 부족해요. 무료 활동을 선택할 수 있어요.');
 const life=structuredClone(input);life.spending.selected=id;return life;
}
export function applySpending(life) {
 if(!life.spending)return 1;
 let p=spendingPreview(life);
 if(!p.affordable) {
  life.timeline.push({type:'spending',year:life.year,term:life.term,week:life.week,title:'생활 활동 취소',text:'사건 이후 생활비가 부족해 결제하지 않고 생활 방침에 집중했다.'});
  p=spendingPreview(life,'none');
 }
 life.money-=p.cost;
 life.stamina=clamp(life.stamina+p.stamina);life.stress=clamp(life.stress+p.stress);
 if(p.stat)life.stats[p.stat]=clamp(life.stats[p.stat]+p.gain);
 life.spending.history.push({week:life.weeksCompleted+1,id:p.id,cost:p.cost});
 life.spending.selected='none';
 if(p.id!=='none')life.timeline.push({type:'spending',year:life.year,term:life.term,week:life.week,
 title:p.label,text:p.cost+'원 · 체력 '+p.stamina+' · 스트레스 '+p.stress+' · '+(p.stat?p.stat+' +'+p.gain:'회복')+' · 이번 주 기본 역량 성장·양수 수입 50% (시간 사용)'});
 return p.routineScale;
}
export function spendingCards(life) {
 const seen=new Set();
 return (life.spending?.history||[]).filter(x=>x.id!=='none'&&!seen.has(x.id)&&seen.add(x.id)).map(x=>({
 id:'spending.'+x.id,kind:'생활 경험',title:option(x.id).label,text:x.week+'주차에 처음 경험했다. 생활비 '+x.cost+'원.'
 }));
}
