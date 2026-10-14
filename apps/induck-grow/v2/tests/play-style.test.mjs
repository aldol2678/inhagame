import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,advanceLife,chooseLifeEvent,setLifePolicy} from '../life-engine.mjs';
import {selectMajorActivity,GROWTH_VERSION} from '../campus-growth.mjs';
import {selectSpending,ECONOMY_VERSION} from '../life-spending.mjs';
import {FOLLOWUP_CONTENT_VERSION} from '../major-stories.mjs';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';
import {AUTO_BUDGETS,PLAY_STYLE_VERSION,configurePlayStyle,getPlayStyle,playStylePlan,advanceStyledLife,playStyleSummary,validatePlayStyle} from '../play-style.mjs';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
import {graduateSummary,rankGraduates,createGraduateArchive,GRADUATE_ARCHIVE_KEY,GRADUATE_ARCHIVE_SCHEMA} from '../graduate-archive.mjs';

const options={majorId:'culture',seed:42,policy:'academic',growthVersion:GROWTH_VERSION,
  economyVersion:ECONOMY_VERSION,contentVersion:FOLLOWUP_CONTENT_VERSION};
function memory(){const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
function engineState(life){const next=structuredClone(life);delete next.playStyle;return next;}
function save(store,life){const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life});store.setItem(V2_LOCAL_SAVE_KEY,raw);return raw;}
function finish(session){
  for(let guard=0;guard<350&&session.life().status!=='complete';guard++){
    const life=session.life();
    if(life.pendingEvent)session.choose(life.pendingEvent.choices[0].id);else session.nextWeek();
  }
  assert.equal(session.life().status,'complete');return session.life();
}

test('styles are optional: old saves load byte-for-byte with the same basic engine',()=>{
  const old=createLife({majorId:'culture',seed:42}),store=memory(),raw=save(store,old);
  const s=createLifeSession({storage:store});assert.equal(s.load(),true);
  assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);assert.deepEqual(s.life(),old);
  assert.deepEqual(getPlayStyle(old),{mode:'basic',budget:0,goal:'balanced'});
  assert.deepEqual(s.nextWeek().life,advanceLife(old));
});

test('mode, budget and goal changes never advance, draw RNG, charge, or award',()=>{
  const before=createLife(options);let after=configurePlayStyle(before,'simple');
  after=configurePlayStyle(after,{budget:15000,goal:'social'});
  after=configurePlayStyle(after,{mode:'basic'});
  assert.deepEqual(engineState(after),before);assert.equal(after.playStyle.history.length,0);
  assert.equal(after.playStyle.prepared,null);assert.equal(before.playStyle,undefined);
  const frozen=JSON.stringify(after);playStylePlan(after);playStylePlan(after);
  assert.equal(JSON.stringify(after),frozen);
  for(const changes of [{mode:'precise'},{budget:8000},{budget:-1},{goal:'invalid'},{extra:1},null])
    assert.throws(()=>configurePlayStyle(after,changes));
});

test('planning uses current visible state only, never future RNG or future income',()=>{
  let life=configurePlayStyle(createLife(options),{mode:'simple',budget:15000});
  const expected=playStylePlan(life);
  Object.defineProperty(life,'rngState',{get(){throw Error('RNG must not be inspected');}});
  Object.defineProperty(life,'seed',{get(){throw Error('Seed must not be inspected');}});
  assert.deepEqual(playStylePlan(life),expected);
  const low=configurePlayStyle(createLife({...options,policy:'work'}),{mode:'simple',budget:15000});
  low.money=0;const plan=playStylePlan(low);
  assert.equal(plan.policy,'work');assert.equal(plan.spending,'none');assert.equal(plan.cost,0);
});

test('free recovery and paid choices respect current funds and the weekly cap',()=>{
  for(const budget of AUTO_BUDGETS){
    const base=configurePlayStyle(createLife(options),{mode:'simple',budget});
    base.stamina=20;const tired=playStylePlan(base);
    assert.equal(tired.policy,'balanced');assert(tired.cost<=budget);
    assert.equal(tired.spending,budget>=6000?'meal':'rest');
    base.money=6000;assert.equal(playStylePlan(base).spending,'rest');
    base.money=70000;base.stamina=75;
    assert.equal(playStylePlan(base).spending,budget===15000?'project':'none');
  }
  const social=configurePlayStyle(createLife(options),{mode:'simple',budget:10000,goal:'social'});
  assert.equal(playStylePlan(social).cost,8000);
  assert.equal(playStylePlan(configurePlayStyle(social,{budget:0})).cost,0);
});

test('same selected actions have exactly the same engine outcomes across all majors',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS){
    let assisted=configurePlayStyle(createLife({...options,majorId}),{mode:'simple',budget:15000});
    let manual=engineState(assisted),events=0;
    for(let guard=0;guard<350&&assisted.status!=='complete';guard++){
      if(assisted.pendingEvent){
        const id=assisted.pendingEvent.choices[0].id;events++;
        assisted=chooseLifeEvent(assisted,id);manual=chooseLifeEvent(manual,id);
      }else{
        const plan=playStylePlan(assisted);
        if(!plan.locked){
          manual=setLifePolicy(manual,plan.policy);
          if(manual.growth&&manual.weeksCompleted%15===0)manual=selectMajorActivity(manual,plan.activity);
          if(manual.spending)manual=selectSpending(manual,plan.spending);
        }
        assisted=advanceStyledLife(assisted);manual=advanceLife(manual);
      }
      assert.deepEqual(engineState(assisted),manual,majorId+' at '+assisted.weeksCompleted);
      validatePlayStyle(assisted);
    }
    assert.equal(assisted.weeksCompleted,120);assert.equal(events,19);
    assert.equal(assisted.playStyle.history.length,120);
    assert.equal(playStyleSummary(assisted).simpleWeeks,120);
  }
});

test('simple event plan freezes once, reloads, and is recorded only after completion',()=>{
  const store=memory(),s=createLifeSession({storage:store});
  s.start({...options,playStyle:'simple',autoBudget:15000});
  for(let i=0;i<4;i++)s.nextWeek();
  const before=s.life();assert.equal(s.nextWeek().kind,'choice');
  const pending=s.life(),plan=s.playStylePlan();
  assert.equal(plan.locked,true);assert.equal(pending.weeksCompleted,4);
  assert.equal(pending.money,before.money);assert.equal(pending.playStyle.history.length,4);
  assert.deepEqual(s.nextWeek().life,pending);assert.equal(pending.memories.length,0);
  const resumed=createLifeSession({storage:store});assert.equal(resumed.load(),true);
  assert.deepEqual(resumed.life(),pending);
  resumed.setPlayStyle({mode:'basic',budget:0,goal:'social'});
  assert.deepEqual(resumed.playStylePlan(),plan);
  resumed.choose(pending.pendingEvent.choices[0].id);
  assert.equal(resumed.playStylePlan().locked,true);
  assert.throws(()=>resumed.setSpending('walk'));assert.throws(()=>resumed.setActivity('team'));
  const next=resumed.nextWeek().life;
  assert.equal(next.weeksCompleted,5);assert.equal(next.playStyle.history.length,5);
  assert.equal(next.playStyle.history.at(-1).mode,'simple');
  assert.equal(next.playStyle.prepared,null);assert.equal(getPlayStyle(next).mode,'basic');
  assert.throws(()=>resumed.choose(pending.pendingEvent.choices[0].id));
});

test('a prepared paid plan cancels safely if an event leaves insufficient money',()=>{
  const store=memory(),s=createLifeSession({storage:store});
  s.start({...options,playStyle:'simple',autoBudget:0});
  for(let i=0;i<4;i++)s.nextWeek();
  s.setAutoBudget(15000);s.nextWeek();
  let life=s.life();assert(life.pendingEvent);assert(life.playStyle.prepared);
  assert.equal(life.playStyle.prepared.spending,'project');
  const id=life.pendingEvent.choices[0].id;
  life=chooseLifeEvent(life,id);life.money=0;save(store,life);
  assert.equal(s.load(),true);assert.equal(s.playStylePlan().cost,0);
  const result=s.nextWeek().life;
  assert.equal(result.spending.history.at(-1).id,'none');
  assert.equal(result.playStyle.history.at(-1).cost,0);assert(result.money>=0);
});

test('legacy opt-in does not create spending or growth and retains prior choices',()=>{
  const store=memory();let old=createLife({majorId:'culture',seed:42});
  for(let i=0;i<4;i++)old=advanceLife(old);
  old=advanceLife(old);old=chooseLifeEvent(old,old.pendingEvent.choices[0].id);
  const memories=structuredClone(old.memories);save(store,old);
  const s=createLifeSession({storage:store});assert.equal(s.load(),true);
  s.setPlayStyle('simple');assert.deepEqual(engineState(s.life()),old);
  assert.equal(s.life().playStyle.startedAt,4);
  const plan=s.playStylePlan();assert.equal(plan.activity,null);assert.equal(plan.spending,null);
  s.nextWeek();assert.equal(s.life().growth,undefined);assert.equal(s.life().spending,undefined);
  assert.deepEqual(s.life().memories,memories);
});

test('all majors reload every week, event pause and graduation with mixed styles',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS){
    const store=memory(),s=createLifeSession({storage:store});
    s.start({...options,majorId,playStyle:'simple',autoBudget:10000});
    for(let guard=0;guard<350&&s.life().status!=='complete';guard++){
      const life=s.life();
      if(life.pendingEvent)s.choose(life.pendingEvent.choices[0].id);
      else{
        if(life.weeksCompleted===60)s.setPlayStyle({mode:'basic'});
        s.nextWeek();
      }
      const r=createLifeSession({storage:store});assert.equal(r.load(),true,majorId);
      assert.deepEqual(r.life(),s.life());
    }
    const done=s.life();assert.equal(done.weeksCompleted,120);
    assert.equal(done.playStyle.history.filter(h=>h.mode==='simple').length,60);
    assert.equal(s.graduateArchive().records.length,1);
    assert.equal(s.graduateArchive().records[0].playStyle.simpleWeeks,60);
    const before=JSON.stringify(done);s.nextWeek();assert.equal(JSON.stringify(s.life()),before);
  }
});

test('corrupt style metadata or ledgers fail closed without overwriting current/save',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start({...options,playStyle:'simple'});
  s.nextWeek();const original=s.life();
  const mutations=[x=>x.playStyle=null,x=>x.playStyle.version='bad',x=>x.playStyle.mode='precise',
    x=>x.playStyle.budget=8000,x=>x.playStyle.history=[],x=>x.playStyle.startedAt=2,
    x=>x.playStyle.history[0].week=2,x=>x.playStyle.history[0].cost=1,
    x=>x.playStyle.history[0].policy='work',x=>x.playStyle.history[0].activity='team',
    x=>x.playStyle.prepared={week:2,mode:'simple',policy:x.policy,activity:'explore',spending:'none',budget:0}];
  for(const mutate of mutations){
    const life=structuredClone(original);mutate(life);const raw=save(store,life);
    assert.equal(s.load(),false);assert.deepEqual(s.life(),original);
    assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  }
});

test('archive labels and ranking follow completed assisted weeks, not final mode',()=>{
  const a=createLifeSession({storage:memory()});a.start(options);
  a.setPlayStyle('simple');a.setPlayStyle('basic');
  const basic=graduateSummary(finish(a));assert.equal(basic.playStyle.simpleWeeks,0);
  const b=createLifeSession({storage:memory()});b.start({...options,playStyle:'simple'});
  b.nextWeek();b.setPlayStyle('basic');const mixed=graduateSummary(finish(b));
  assert.equal(mixed.playStyle.simpleWeeks,1);assert.equal(mixed.playStyle.basicWeeks,119);
  assert.deepEqual(rankGraduates([basic,mixed]).map(x=>x.rank),[1,1]);
  const legacy=structuredClone(basic);delete legacy.playStyle;
  assert.equal(rankGraduates([basic,legacy])[0].group,rankGraduates([basic,legacy])[1].group);
  const store=memory(),archive=createGraduateArchive(store);
  store.setItem(GRADUATE_ARCHIVE_KEY,JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[legacy,mixed]}));
  assert.equal(archive.read().ok,true);
  mixed.playStyle.simpleWeeks=121;
  const raw=JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[mixed]});
  store.setItem(GRADUATE_ARCHIVE_KEY,raw);assert.equal(archive.read().ok,false);
  assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),raw);
});
