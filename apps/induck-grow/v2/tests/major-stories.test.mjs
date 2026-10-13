import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FOUNDATION_MAJOR_IDS,findMajor} from '../major-registry.mjs';
import {createLife,advanceLife,chooseLifeEvent,simulateCompleteLife} from '../life-engine.mjs';
import {FOLLOWUP_CONTENT_VERSION,LEGACY_CONTENT_VERSION,MAJOR_STORIES,validateStoryState} from '../major-stories.mjs';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
const options=majorId=>({majorId,seed:2026,contentVersion:FOLLOWUP_CONTENT_VERSION});
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}
function run(majorId,path) {
  return simulateCompleteLife(options(majorId),{pickChoice:event=>
    event.choices[event.type==='signature'?path[0]:event.type==='followup'?path[event.year-1]:0].id});
}
test('all 12 foundation majors have exactly two authored scenes and 72 unique choices',()=>{
  assert.deepEqual(Object.keys(MAJOR_STORIES).sort(),[...FOUNDATION_MAJOR_IDS].sort());
  let count=0;
  for(const scenes of Object.values(MAJOR_STORIES)){
    assert.equal(scenes.length,2);
    for(const [title,intro,branches,choices] of scenes){
      assert.ok(title.length>3 && intro.length>10);
      assert.equal(branches.length,3);assert.equal(new Set(branches).size,3);
      assert.equal(choices.length,3);assert.equal(new Set(choices.map(c=>c[0])).size,3);
      for(const [label,skill,result] of choices){
        assert.ok(label.length>3 && result.length>10);
        assert.ok(['analysis','creative','expression','collaboration','execution','recovery'].includes(skill));
        count++;
      }
    }
  }
  assert.equal(count,72);
});
test('all 27 story paths per major complete 120 weeks and retain distinct epilogues',()=>{
  for(const major of FOUNDATION_MAJOR_IDS){
    const endings=new Set();
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++){
      const life=run(major,[a,b,c]);
      assert.equal(life.weeksCompleted,120);assert.equal(life.semesters.length,8);
      assert.equal(life.completedEventInstances.length,19);
      assert.equal(life.ending.epilogue.chapters.length,3);
      validateStoryState(life);
      const signature=findMajor(major).signatureEvent.choices[a];
      assert.ok(life.ending.epilogue.chapters[1].text.includes(signature.label));
      assert.ok(life.ending.epilogue.chapters[2].text.includes(MAJOR_STORIES[major][0][3][b][0]));
      assert.ok(life.ending.epilogue.chapters[2].text.includes(MAJOR_STORIES[major][1][3][c][2]));
      endings.add(JSON.stringify(life.ending.epilogue));
    }
    assert.equal(endings.size,27);
  }
});
test('expanded runs are deterministic; previous choices change later situations',()=>{
  for(const major of FOUNDATION_MAJOR_IDS){
    const a=run(major,[0,1,2]),b=run(major,[0,1,2]),c=run(major,[1,1,2]),d=run(major,[0,2,2]);
    assert.deepEqual(a,b);
    assert.notEqual(a.ending.epilogue.chapters[1].text,c.ending.epilogue.chapters[1].text);
    assert.notEqual(a.ending.epilogue.chapters[2].text,d.ending.epilogue.chapters[2].text);
  }
});
test('legacy remains 17 choices without contentVersion or retroactive epilogue',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS){
    const legacy=simulateCompleteLife({majorId,seed:2026});
    const explicit=simulateCompleteLife({majorId,seed:2026,contentVersion:LEGACY_CONTENT_VERSION});
    assert.deepEqual(legacy,explicit);
    assert.equal(legacy.completedEventInstances.length,17);
    assert.equal(Object.hasOwn(legacy,'contentVersion'),false);
    assert.equal(Object.hasOwn(legacy.ending,'epilogue'),false);
  }
});
test('followups pause at year2/year3 week6 and apply once without advancing or mutating input',()=>{
  let life=createLife(options('culture')),seen=0;
  while(life.status!=='complete'){
    const before=JSON.stringify(life);
    if(life.pendingEvent){
      const ev=life.pendingEvent;
      if(ev.type==='followup'){
        seen++;assert.equal(life.weeksCompleted,ev.year===2?35:65);
        assert.deepEqual(advanceLife(life),life);
        assert.throws(()=>chooseLifeEvent(life,'foreign-choice'));
        const next=chooseLifeEvent(life,ev.choices[0].id);
        assert.equal(next.weeksCompleted,life.weeksCompleted);
        assert.equal(JSON.stringify(life),before);
        assert.throws(()=>chooseLifeEvent(next,ev.choices[0].id));
        life=next;continue;
      }
      life=chooseLifeEvent(life,ev.choices[0].id);
    }else life=advanceLife(life);
  }
  assert.equal(seen,2);
});
test('expanded save reloads at every transition including pending followups and graduation',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS){
    const store=storage(),session=createLifeSession({storage:store});
    store.setItem('induck-grow-p0','v1-sentinel');
    session.start(options(majorId));
    for(let i=0;i<330;i++){
      const life=session.life(),loaded=createLifeSession({storage:store});
      assert.equal(loaded.load(),true,majorId+' '+life.weeksCompleted);
      assert.deepEqual(loaded.life(),life);
      assert.equal(store.getItem('induck-grow-p0'),'v1-sentinel');
      if(life.status==='complete')break;
      if(life.pendingEvent)session.choose(life.pendingEvent.choices[0].id);
      else session.nextWeek();
      if(i===329)assert.fail('incomplete');
    }
  }
});
test('unknown content and corrupt followups are rejected without replacing the original save',()=>{
  let pending=createLife(options('cse'));
  while(pending.pendingEvent?.type!=='followup'){
    pending=pending.pendingEvent?chooseLifeEvent(pending,pending.pendingEvent.choices[0].id):advanceLife(pending);
  }
  const mutations=[
    x=>{x.contentVersion='future-unknown';},
    x=>{x.contentVersion=null;},
    x=>{x.pendingEvent.choices[0].id='other';},
    x=>{x.pendingEvent.description='forged';},
    x=>{x.flags={};},
    x=>{x.completedEventInstances.push(x.pendingEvent.instanceId);},
  ];
  for(const change of mutations){
    const life=structuredClone(pending);change(life);
    const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life}),store=storage();
    store.setItem(V2_LOCAL_SAVE_KEY,raw);
    const session=createLifeSession({storage:store});
    assert.equal(session.load(),false);
    assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
    assert.equal(session.life(),null);
  }
  assert.throws(()=>createLife({...options('cse'),contentVersion:'unsupported'}));
});
test('completed story epilogue cannot silently disappear or be forged on reload',()=>{
  for(const mutation of [x=>{delete x.ending.epilogue;},x=>{x.ending.epilogue.chapters[0].text='wrong';}]){
    const life=run('culture',[2,1,0]);mutation(life);
    const store=storage(),raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life});
    store.setItem(V2_LOCAL_SAVE_KEY,raw);
    assert.equal(createLifeSession({storage:store}).load(),false);
    assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  }
});
test('UI opts new games into stories and renders narrative using safe text nodes',()=>{
  const ui=readFileSync(new URL('../ui.mjs',import.meta.url),'utf8');
  assert.match(ui,/contentVersion:FOLLOWUP_CONTENT_VERSION/);
  assert.match(ui,/ev\.recall/);
  assert.match(ui,/life\.ending\.epilogue/);
  assert.match(ui,/for\(const chapter of epilogue\.chapters\)/);
  assert.doesNotMatch(ui,/innerHTML/);
});
