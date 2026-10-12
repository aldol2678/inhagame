import test from 'node:test';
import assert from 'node:assert/strict';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';
import {
 LIFE_ENGINE_VERSION,TOTAL_WEEKS,createLife,advanceLife,advanceLifeBatch,
 chooseLifeEvent,setLifePolicy,simulateCompleteLife
} from '../life-engine.mjs';

test('all 12 supported majors finish 120 academic weeks and 8 semesters',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS) {
    for(const seed of [1,999]) {
      const result=simulateCompleteLife({majorId,seed});
      assert.equal(result.version,LIFE_ENGINE_VERSION);
      assert.equal(result.status,'complete',majorId);
      assert.equal(result.weeksCompleted,TOTAL_WEEKS,majorId);
      assert.equal(result.weeklyHistory.length,TOTAL_WEEKS);
      assert.equal(result.semesters.length,8);
      assert.equal(result.credits,144);
      assert.equal(result.ending.totalWeeks,TOTAL_WEEKS);
      assert.equal(result.ending.semesters,8);
      assert.equal(result.timeline.filter(x=>x.type==='semester').length,8);
      assert.equal(result.timeline.filter(x=>x.type==='vacation').length,7);
      assert(result.timeline.some(x=>x.type==='event'));
      assert(Number.isFinite(result.gpa)&&result.gpa>=0&&result.gpa<=4.5);
      assert(result.weeklyHistory.every(x=>x.money>=0 && x.stress>=0 && x.stress<=100));
      assert.equal(result.pendingEvent,null);
      assert.equal(new Set(result.completedEventInstances).size,result.completedEventInstances.length);
      assert.equal(new Set(result.shownEventSlots).size,result.shownEventSlots.length);
      assert.equal(result.completedEventInstances.length,17);
      assert(result.completedEventInstances.includes('grow2.event.'+majorId+'.signature'));
    }
  }
});

test('same seed and policy/choices give byte-identical stable chronicle and GPA',()=>{
  const opts={majorId:'culture',seed:123456,policy:'academic'};
  const a=simulateCompleteLife(opts,{pickChoice:event=>event.choices[1].id});
  const b=simulateCompleteLife(opts,{pickChoice:event=>event.choices[1].id});
  assert.deepEqual(a,b);
  assert.deepEqual(a.timeline,b.timeline);
  assert.deepEqual(a.semesters,b.semesters);
});

test('event scheduling always pauses before a week; only a valid choice resumes it',()=>{
  let state=createLife({majorId:'ai',seed:70});
  assert.equal(state.week,1);
  const old=structuredClone(state);
  for(let i=0;i<4;i++) state=advanceLife(state);
  assert.equal(state.week,5);
  assert.equal(state.weeksCompleted,4);
  const prompted=advanceLife(state);
  assert.equal(prompted.pendingEvent.year,1);
  assert.equal(prompted.pendingEvent.week,5);
  assert.equal(prompted.weeksCompleted,4);
  assert.deepEqual(state,advanceLife(advanceLife(state)).pendingEvent?state:state); // pre-event state remains unchanged
  assert.deepEqual(old,createLife({majorId:'ai',seed:70}));
  assert.deepEqual(advanceLife(prompted),prompted);
  assert.throws(()=>chooseLifeEvent(prompted,'not-offered'),RangeError);
  const after=chooseLifeEvent(prompted,prompted.pendingEvent.choices[0].id);
  assert.equal(after.pendingEvent,null);
  assert.equal(after.weeksCompleted,4);
  assert.equal(after.memories.length,1);
  const tick=advanceLife(after);
  assert.equal(tick.weeksCompleted,5);
  assert.equal(tick.week,6);
  assert.notDeepEqual(tick,after);
  assert.throws(()=>chooseLifeEvent(tick,'join'),/No pending/);
  const signature=advanceLife(tick);
  assert.equal(signature.pendingEvent.type,'signature');
  assert.equal(signature.pendingEvent.eventId,'grow2.event.ai.signature');
  assert.equal(signature.weeksCompleted,5);
  const chosen=chooseLifeEvent(signature,signature.pendingEvent.choices[1].id);
  assert.equal(chosen.completedEventInstances.filter(k=>k==='grow2.event.ai.signature').length,1);
  const resumed=advanceLife(chosen);
  assert.equal(resumed.week,7);
  assert.equal(resumed.weeksCompleted,6);
});

test('choices fork alternate lives deterministically and never mutate input',()=>{
  let state=createLife({majorId:'media',seed:1});
  while(!state.pendingEvent)state=advanceLife(state);
  const snapshot=structuredClone(state);
  const a=chooseLifeEvent(state,state.pendingEvent.choices[0].id);
  const b=chooseLifeEvent(state,state.pendingEvent.choices[1].id);
  assert.deepEqual(state,snapshot);
  assert.notDeepEqual(a.stats,b.stats);
  assert.notDeepEqual(a.timeline,b.timeline);
  assert.equal(a.memories.length,1);
  assert.equal(b.memories.length,1);
  assert.equal(a.pendingEvent,null);
  assert.equal(b.pendingEvent,null);
});

test('batch speed is bounded; pause wins before progress; policy can change locally',()=>{
  let state=createLife({majorId:'nursing',seed:99});
  const start=structuredClone(state);
  let result=advanceLifeBatch(state,{maxWeeks:8});
  assert.equal(result.processed,4);
  assert.equal(result.paused,true);
  assert.equal(result.life.pendingEvent.week,5);
  assert.deepEqual(state,start);
  assert.deepEqual(advanceLifeBatch(result.life,{maxWeeks:8}).life,result.life);
  assert.throws(()=>advanceLifeBatch(state,{maxWeeks:100}),RangeError);
  const altered=setLifePolicy(state,'work');
  assert.equal(altered.policy,'work');
  assert.equal(state.policy,'balanced');
  assert.throws(()=>setLifePolicy(state,'unknown'),RangeError);
});

test('unsupported paths and invalid snapshots fail closed, completed life cannot replay',()=>{
  assert.throws(()=>createLife({majorId:'premed'}),/Unsupported/);
  assert.throws(()=>createLife({majorId:'not-there'}),/Unsupported/);
  assert.throws(()=>createLife({majorId:'cse',seed:-5}),RangeError);
  assert.throws(()=>createLife({majorId:'cse',seed:1.1}),RangeError);
  assert.throws(()=>advanceLife({}),TypeError);
  const done=simulateCompleteLife({majorId:'cse',seed:10,policy:'social'});
  assert.deepEqual(advanceLife(done),done);
  assert.deepEqual(advanceLifeBatch(done,{maxWeeks:8}).life,done);
  assert.throws(()=>chooseLifeEvent(done,'x'),/No pending/);
  assert(done.timeline.every(item=>!JSON.stringify(item).includes('currency.induck_coin')));
});

test('academic/financial results remain finite across deterministic stress and budget paths',()=>{
  for(const policy of ['balanced','academic','social','work','creative']) {
    for(const seed of [0,1,99,123456789,0xffffffff]) {
      const life=simulateCompleteLife({majorId:'design',seed,policy});
      assert(life.money>=0 && Number.isFinite(life.money));
      assert(life.gpa>=0 && life.gpa<=4.5);
      assert(life.semesters.every(rec=>rec.credits===18 && rec.gpa>=0 && rec.gpa<=4.5));
      assert(life.weeklyHistory.every(rec=>Number.isFinite(rec.money)&&rec.money>=0&&Number.isFinite(rec.stress)));
    }
  }
});
