import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,advanceLife,chooseLifeEvent,simulateCompleteLife} from '../life-engine.mjs';
import {ECONOMY_VERSION,LIFE_OPTIONS,selectSpending,spendingPreview,spendingCards} from '../life-spending.mjs';
import {GROWTH_VERSION} from '../campus-growth.mjs';
import {FOLLOWUP_CONTENT_VERSION} from '../major-stories.mjs';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
import {graduateSummary,rankGraduates} from '../graduate-archive.mjs';
const opts={majorId:'culture',seed:42,growthVersion:GROWTH_VERSION,contentVersion:FOLLOWUP_CONTENT_VERSION,economyVersion:ECONOMY_VERSION};
function memory(){const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
test('spending is opt-in and legacy continuation is unchanged',()=>{
 const legacy=createLife({majorId:'culture'});assert.equal(legacy.spending,undefined);
 assert.throws(()=>selectSpending(legacy,'walk'));
 assert.throws(()=>createLife({...opts,economyVersion:'unknown'}));
 const normal=simulateCompleteLife({majorId:'culture',seed:42});
 const enabled=simulateCompleteLife({majorId:'culture',seed:42,economyVersion:ECONOMY_VERSION});
 delete enabled.spending;assert.deepEqual(enabled,normal);
});
test('selection charges nothing, completes once, resets and consumes half routine growth',()=>{
 const initial=createLife(opts),selected=selectSpending(initial,'meal');
 assert.equal(initial.spending.selected,'none');assert.equal(selected.money,initial.money);
 let changed=selectSpending(selectSpending(selected,'walk'),'meal');
 assert.deepEqual(changed,selected);
 const normal=advanceLife(initial),paid=advanceLife(selected);
 assert.equal(normal.money-paid.money,6000);assert.equal(paid.weeksCompleted,1);
 assert.equal(paid.stats.analysis,20.5);assert.equal(paid.spending.selected,'none');
 assert.equal(paid.spending.history.length,1);assert.equal(paid.spending.history[0].cost,6000);
 assert.equal(advanceLife(paid).spending.history[1].cost,0);
});
test('pending events and reload never charge; changed funds cancel safely',()=>{
 const store=memory(),s=createLifeSession({storage:store});s.start(opts);
 for(let i=0;i<4;i++)s.nextWeek();
 s.setSpending('project');s.nextWeek();
 assert(s.life().pendingEvent);const pending=s.life();
 assert.throws(()=>s.setSpending('meal'));assert.deepEqual(s.nextWeek().life,pending);
 const r=createLifeSession({storage:store});assert.equal(r.load(),true);assert.deepEqual(r.life(),pending);
 let chosen=chooseLifeEvent(pending,pending.pendingEvent.choices[0].id);chosen.money=0;
 const next=advanceLife(chosen);assert.equal(next.spending.history.at(-1).id,'none');assert(next.money>=0);
});
test('free alternatives, insufficient funds, repeated effect and high recovery apply',()=>{
 let x=createLife(opts);x.money=0;assert.throws(()=>selectSpending(x,'meal'));
 for(const id of ['walk','rest','none'])assert.equal(selectSpending(x,id).money,0);
 x=advanceLife(selectSpending(x,'walk'));assert.equal(spendingPreview(x,'walk').factor,.75);
 x=advanceLife(selectSpending(x,'walk'));assert.equal(spendingPreview(x,'walk').factor,.5);
 const low=spendingPreview(x,'rest');x.stats.recovery=100;assert(spendingPreview(x,'rest').stamina>low.stamina);
});
test('project depends on existing skills and fatigue; caps preserve resources',()=>{
 const x=createLife(opts),low=spendingPreview(x,'project');
 x.stats.analysis=x.stats.creative=x.stats.collaboration=70;
 assert(spendingPreview(x,'project').gain>low.gain);
 const fit=spendingPreview(x,'project').gain;x.stress=90;assert(spendingPreview(x,'project').gain<fit);
 x.stats.execution=100;x.stamina=1;
 const y=advanceLife(selectSpending(x,'project'));assert.equal(y.stats.execution,100);assert(y.stamina>=0&&y.stress<=100);
});
test('corrupt spending saves fail closed without overwriting current or raw storage',()=>{
 const store=memory(),s=createLifeSession({storage:store});s.start(opts);s.nextWeek();
 const before=s.life();
 for(const mutate of [x=>x.spending=null,x=>x.spending.version='bad',x=>x.spending.history=[],x=>x.spending.selected='__proto__',x=>x.spending.history[0].cost=-1,x=>x.spending.history[0].week=120]){
  const life=structuredClone(before);mutate(life);const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life});
  store.setItem(V2_LOCAL_SAVE_KEY,raw);assert.equal(s.load(),false);assert.deepEqual(s.life(),before);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
 }
});
test('all12 majors reload mixed paid/free activities across120 weeks and19 events',()=>{
 for(const majorId of FOUNDATION_MAJOR_IDS){
  const store=memory(),s=createLifeSession({storage:store});s.start({...opts,majorId,policy:'work'});
  for(let guard=0;guard<350&&s.life().status!=='complete';guard++){
   let life=s.life();
   if(life.pendingEvent)s.choose(life.pendingEvent.choices[0].id);
   else {const o=LIFE_OPTIONS[(life.weeksCompleted%6)+1];s.setSpending(life.money>=o.cost?o.id:'walk');s.nextWeek();}
   const r=createLifeSession({storage:store});assert.equal(r.load(),true,majorId);assert.deepEqual(r.life(),s.life());
  }
  const done=s.life();assert.equal(done.status,'complete');assert.equal(done.memories.length,19);
  assert.equal(done.spending.history.length,120);assert(spendingCards(done).length<=6);
  assert.equal(s.graduateArchive().records.length,1);assert.throws(()=>s.setSpending('walk'));
 }
});
test('economy versions are separated in graduate rankings with old record compatibility',()=>{
 const modern=graduateSummary(simulateCompleteLife(opts));
 const legacy=graduateSummary(simulateCompleteLife({...opts,economyVersion:undefined}));
 assert.equal(modern.economy,ECONOMY_VERSION);assert.equal(legacy.economy,undefined);
 assert.deepEqual(rankGraduates([modern,legacy]).map(x=>x.rank),[1,1]);
});
