import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';

const dir=dirname(fileURLToPath(import.meta.url));
const read=path=>readFileSync(join(dir,'..',path),'utf8');
function storage() {
  const entries=new Map();
  return {entries,getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>{entries.set(key,value);},removeItem:key=>entries.delete(key)};
}
function finish(session) {
  let events=0,terms=0;
  for(let i=0;i<320;i++) {
    const life=session.life();
    if(life.status==='complete')return {life,events,terms};
    if(life.pendingEvent) {session.choose(life.pendingEvent.choices[0].id);events++;continue;}
    const result=session.nextWeek();
    if(result.kind==='semester'||result.kind==='complete')terms++;
  }
  throw new Error('Simulation stuck');
}

test('v2 start saves to an isolated key; reload is paused caller-controlled',()=>{
  const store=storage();
  const session=createLifeSession({storage:store});
  assert.equal(session.inspectSave().available,false);
  const start=session.start({majorId:'culture',seed:77,policy:'academic'});
  assert.equal(start.year,1);
  assert.equal(start.weeksCompleted,0);
  assert.equal(store.getItem('induck-grow-p0'),null);
  assert.equal(store.getItem('induck-grow-v2-account'),null);
  assert.equal(JSON.parse(store.getItem(V2_LOCAL_SAVE_KEY)).schema,V2_LOCAL_SAVE_SCHEMA);
  const fresh=createLifeSession({storage:store});
  assert.equal(fresh.load(),true);
  assert.deepEqual(fresh.life(),session.life());
  fresh.nextWeek();
  assert.equal(fresh.life().weeksCompleted,1);
  assert.equal(session.life().weeksCompleted,0);
});

test('12 foundation majors complete 120 weeks, exactly 17 choices and 8 semesters',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS) {
    const save=storage(),session=createLifeSession({storage:save});
    session.start({majorId,seed:4261,policy:'balanced'});
    const result=finish(session);
    assert.equal(result.life.weeksCompleted,120,majorId);
    assert.equal(result.life.semesters.length,8,majorId);
    assert.equal(result.events,17,majorId);
    assert.equal(result.terms,8,majorId);
    assert.equal(result.life.status,'complete',majorId);
    assert.equal(JSON.parse(save.getItem(V2_LOCAL_SAVE_KEY)).life.ending.id,result.life.ending.id);
    assert.equal(session.nextWeek().kind,'complete');
  }
});

test('preview event is a non-advancing pause and choice cannot apply twice',()=>{
  const session=createLifeSession({storage:storage()});
  session.start({majorId:'ai',seed:9});
  for(let n=0;n<4;n++)assert.equal(session.nextWeek().kind,'week');
  const before=session.life();
  const atChoice=session.nextWeek();
  assert.equal(atChoice.kind,'choice');
  assert.equal(session.life().weeksCompleted,4);
  assert.equal(session.nextWeek().kind,'choice');
  assert.deepEqual(before.completedEventInstances,[]);
  assert.throws(()=>session.choose('not-an-option'),RangeError);
  const pending=session.life().pendingEvent;
  session.choose(pending.choices[0].id);
  assert.equal(session.life().memories.length,1);
  assert.equal(session.life().pendingEvent,null);
  assert.throws(()=>session.choose(pending.choices[0].id),/선택/);
  assert.equal(session.nextWeek().life.weeksCompleted,5);
});

test('policy affects the future but not passed objects, and incoming records stay isolated',()=>{
  const saved=storage();
  const a=createLifeSession({storage:saved});
  a.start({majorId:'media',seed:123});
  const before=a.life();
  a.setPolicy('work');
  a.nextWeek();
  assert.equal(before.policy,'balanced');
  assert.equal(before.money,70000);
  assert.equal(a.life().policy,'work');
  assert.equal(createLifeSession({storage:saved}).load(),true);
  assert.equal(createLifeSession({storage:saved}).inspectSave().available,true);
  assert.throws(()=>a.setPolicy('unapproved'),RangeError);
});

test('malformed/foreign saves do not delete or overwrite user data',()=>{
  const store=storage();
  store.setItem(V2_LOCAL_SAVE_KEY,'{bad');
  const session=createLifeSession({storage:store});
  assert.equal(session.inspectSave().available,false);
  assert.equal(session.load(),false);
  assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),'{bad');
  store.setItem(V2_LOCAL_SAVE_KEY,JSON.stringify({schema:'grow1',life:{version:'bad'}}));
  assert.equal(session.load(),false);
  assert(store.getItem(V2_LOCAL_SAVE_KEY).includes('grow1'));
  assert.throws(()=>session.start({majorId:'premed'}),/Unsupported/);
});

test('storage unavailability never stops simulation or exposes wallet grant',()=>{
  const unavailable={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};
  const session=createLifeSession({storage:unavailable});
  session.start({majorId:'design',seed:1});
  assert.match(session.status().saveError,/저장/);
  assert.equal(session.nextWeek().kind,'week');
  assert.equal(session.life().weeksCompleted,1);
  const source=read('session.mjs')+read('ui.mjs');
  assert(!source.includes('get_my_world_wallet_v1'));
  assert(!source.includes('save_my_grow_progress'));
  assert(!source.includes('induck-grow-p0'));
  assert(!source.includes('currency.induck_coin'));
});

test('static v2 screen includes referenced DOM ids, controls and mobile/reduced-motion styles',()=>{
  const html=read('index.html'),js=read('ui.mjs'),css=read('ui.css');
  for(const [,id] of js.matchAll(/\$\('([a-z-]+)'\)/g)) {
    assert(html.includes('id="'+id+'"'),'Missing DOM control: '+id);
  }
  assert(html.includes('name="speed"'));
  assert(html.includes('id="event-dialog"'));
  assert(html.includes('id="semester-dialog"'));
  assert(html.includes('name="robots" content="noindex, nofollow"'));
  assert(css.includes('prefers-reduced-motion'));
  assert(css.includes('safe-area-inset-bottom'));
  assert(css.includes('focus-visible'));
  assert(html.includes('aria-valuemax="120"'));
});
