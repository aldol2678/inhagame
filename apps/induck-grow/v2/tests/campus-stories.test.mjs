import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPUS_STORY_VERSION,CAMPUS_SCENES,initializeCampusStories,validateCampusStories,buildCampusEvent,applyCampusChoice,buildTurningPoints} from '../campus-stories.mjs';

function at(life,w) {
  life.weeksCompleted=w;
  const cursor=Math.min(w,119);
  life.year=Math.floor(cursor/30)+1;life.term=Math.floor(cursor/15)%2+1;life.week=cursor%15+1;
  return life;
}
function fixture(money=70000) {
  return initializeCampusStories(at({status:'running',money,stress:20,
    stats:{analysis:20,creative:20,expression:20,collaboration:20,execution:20,recovery:20},
    completedEventInstances:[],memories:[],shownEventSlots:[],pendingEvent:null},0),CAMPUS_STORY_VERSION);
}
function offer(life,w) {
  at(life,w);const event=buildCampusEvent(life);
  if(event){life.pendingEvent=event;life.shownEventSlots.push([life.year,life.term,life.week].join(':'));}
  return event;
}
function choose(life,index=0) {
  validateCampusStories(life);
  applyCampusChoice(life,life.pendingEvent.choices[index].id);life.pendingEvent=null;
  validateCampusStories(life);
}
function run(indices={},money=0) {
  const life=fixture(money);
  for(let w=0;w<120;w++) {
    if(offer(life,w))choose(life,indices[life.pendingEvent.eventId.split('.').at(-1)]||0);
    validateCampusStories(life);
  }
  at(life,120);life.status='complete';validateCampusStories(life);return life;
}
test('legacy absence remains disabled and unknown versions are rejected',()=>{
  const life=fixture();delete life.campusStories;
  assert.equal(initializeCampusStories(life,undefined),life);
  assert.equal(buildCampusEvent(life),null);assert.deepEqual(buildTurningPoints(life),[]);
  validateCampusStories(life);
  assert.throws(()=>initializeCampusStories(life,'future'));
  life.pendingEvent={type:'campus'};assert.throws(()=>validateCampusStories(life));
});
test('named friend remembers earlier choices and all six records are bounded',()=>{
  const life=fixture(0);offer(life,2);choose(life,2);
  const invite=life.memories[0].text;
  offer(life,17);choose(life,1);offer(life,18);
  assert.match(life.pendingEvent.recall,/서윤/);choose(life,2);
  offer(life,21);choose(life,1);offer(life,47);
  assert.match(life.pendingEvent.recall,/내 시간을/);choose(life,2);
  offer(life,116);assert.match(life.pendingEvent.recall,/역할/);choose(life,1);
  at(life,120);life.status='complete';validateCampusStories(life);
  assert.equal(life.campusStories.records.length,6);
  const cards=buildTurningPoints(life);assert.equal(cards.length,2);
  assert.ok(cards[0].text.includes(invite));assert.equal(cards[1].id,'campus.retry');
});
test('money gate does not invent hardship and later low-money slot can start chain',()=>{
  const life=fixture(60000);offer(life,2);choose(life);
  assert.equal(offer(life,17),null);
  life.money=59999;assert.equal(offer(life,32).eventId,'grow2.event.campus.hardship');
  choose(life);offer(life,33);choose(life);offer(life,36);choose(life);
});
test('every support route ends in retry with finite bounded resources',()=>{
  for(let route=0;route<3;route++){
    const life=run({support:route});
    assert.equal(life.campusStories.records.find(r=>r.id==='support').choice,['scholarship','work','help'][route]);
    assert.ok(life.campusStories.records.some(r=>r.id==='retry'));
    assert.ok(Number.isFinite(life.money)&&life.money>=0);
    assert.ok(life.stress>=0&&life.stress<=100);
  }
});
test('all 729 branch combinations are deterministic and valid',()=>{
  const ids=Object.keys(CAMPUS_SCENES);
  for(let n=0;n<729;n++) {
    let value=n;const picks={};
    for(const id of ids){picks[id]=value%3;value=Math.floor(value/3);}
    assert.deepEqual(run(picks),run(picks));
  }
});
test('JSON resume preserves pending choices and next deterministic scene',()=>{
  const life=fixture(0);offer(life,2);choose(life,1);offer(life,17);choose(life,2);offer(life,18);
  const restored=JSON.parse(JSON.stringify(life));validateCampusStories(restored);
  choose(life,1);choose(restored,1);assert.deepEqual(restored,life);
  offer(life,21);offer(restored,21);assert.deepEqual(restored,life);
});
test('tampered state, future records, duplicates and unknown fields are rejected',()=>{
  const valid=run();
  const mutate=[
    s=>s.campusStories.version='future',
    s=>s.campusStories.extra=true,
    s=>s.campusStories.records[0].at=121,
    s=>s.campusStories.records.push({...s.campusStories.records[0]}),
    s=>s.campusStories.records[0].id='__proto__',
    s=>s.campusStories.records[0].choice='unknown',
    s=>s.campusStories.records[0].extra=true,
    s=>s.memories.find(m=>m.eventId==='grow2.event.campus.invite').text='forged',
    s=>s.completedEventInstances.push('grow2.event.campus.fake'),
    s=>s.campusStories.records.splice(1,1),
    s=>s.year=1
  ];
  for(const change of mutate){const bad=structuredClone(valid);change(bad);assert.throws(()=>validateCampusStories(bad));}
});
test('forged pending payload, cursor, choices and replay cannot award effects',()=>{
  const life=fixture();offer(life,2);
  for(const change of [
    s=>s.pendingEvent.choices[0].label='forged',
    s=>s.pendingEvent.choices[0].id='forged',
    s=>s.pendingEvent.week=4,
    s=>s.week=4,
    s=>s.pendingEvent.type='general',
    s=>s.shownEventSlots.push('1:1:3')
  ]) {
    const bad=structuredClone(life);change(bad);
    assert.throws(()=>applyCampusChoice(bad,bad.pendingEvent.choices[0].id));
  }
  const offered=structuredClone(life.pendingEvent);choose(life);
  life.pendingEvent=offered;
  assert.throws(()=>applyCampusChoice(life,offered.choices[0].id));
});
test('wealthy run uses actual project setback for turning point, not invented support',()=>{
  const life=run({},1000000),points=buildTurningPoints(life);
  assert.equal(life.campusStories.records.length,3);
  assert.deepEqual(points.map(x=>x.id),['campus.friend','campus.project']);
  assert.ok(points.every(p=>Object.keys(p).sort().join(',')==='id,kind,text,title'));
  assert.ok(points.every(p=>p.text.length<1000));
});
