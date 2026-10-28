import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLearningCatalog,questionKey,LEARNING_RELEASE} from '../src/learning/learning-content.js';
import {createDailySession} from '../src/learning-web/daily-session.js';
import {createLearningProgress} from '../src/learning/learning-progress.js';
import {createLearningEngine} from '../src/learning/learning-engine.js';
import {learningFixture,memoryStorage} from './support/learning-fixture.mjs';
const catalog=createLearningCatalog(learningFixture()),day='2026-10-28';
function setup(storage=memoryStorage(),account=null){return createDailySession({catalog,getStorage:()=>storage,account,today:()=>day});}
function answer(s,{wrong=false,hint=false}={}){const q=s.engine.run.questions[s.engine.run.index];if(hint)s.act('hint');s.act('choose',wrong?1:q.a);s.act('submit');}

test('daily selects ten distinct English choice questions and prioritizes due/wrong',()=>{
  const storage=memoryStorage(),p=createLearningProgress({getStorage:()=>storage});
  const wrong=catalog.questions.find(q=>q.language==='en'&&q.unit===2&&q.options);p.state.wrong[questionKey(wrong)]=true;p.save();
  const s=setup(storage);assert.equal(s.act('start'),true);const qs=s.engine.run.questions;
  assert.equal(qs.length,10);assert.equal(new Set(qs.map(questionKey)).size,10);assert.equal(qs[0],wrong);assert.ok(qs.every(q=>q.language==='en'&&q.options));
});
test('resume preserves selected option, checked explanation and counters without resubmission',()=>{
  const storage=memoryStorage();let s=setup(storage);s.act('start');s.act('choose',1);s=setup(storage);
  assert.equal(s.engine.run.attempt.selection,1);assert.equal(s.engine.run.attempt.checked,false);s.act('submit');s=setup(storage);
  assert.equal(s.engine.run.attempt.checked,true);assert.equal(s.progress.state.learningHistory[day].answered,1);
  s.act('submit');assert.equal(s.progress.state.learningHistory[day].answered,1);s.act('next');s=setup(storage);
  assert.equal(s.engine.run.index,1);assert.equal(s.progress.state.learningHistory[day].answered,1);
});
test('hinted correct does not advance mastery; first ten and bounded rechecks are separate',()=>{
  const storage=memoryStorage();let s=setup(storage);s.act('start');const key=questionKey(s.engine.run.questions[0]);
  answer(s,{hint:true});assert.equal(s.progress.state.masteries[key],undefined);s.act('next');
  for(let i=1;i<10;i++){answer(s,{wrong:i<5});s.act('next');}
  assert.equal(s.engine.run.questions.length,13);assert.equal(s.engine.run.index,10);
  s=setup(storage);assert.equal(s.status.blocked,false);
  for(let i=0;i<3;i++){answer(s,{wrong:true});s.act('next');}
  assert.equal(s.engine.run.finished,true);assert.equal(s.engine.run.answers.length,13);
  const before=JSON.stringify(s.progress.state);s=setup(storage);assert.equal(s.engine.run.finished,true);s.act('next');assert.equal(JSON.stringify(s.progress.state),before);
});
test('all correct completes in ten, preserves native progress contract and native phone sees it',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');for(let i=0;i<10;i++){answer(s);s.act('next');}
  assert.equal(s.engine.run.finished,true);assert.equal(s.engine.run.questions.length,10);
  const native=createLearningProgress({getStorage:()=>storage});assert.equal(native.state.learningHistory[day].answered,10);assert.deepEqual(native.state.completed,{});
});
test('checkpoint contains IDs, learner selections and stats, no question text or answer bank',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');answer(s);
  const raw=storage.getItem('inha-world-learning-daily-v1:guest');assert.doesNotMatch(raw,/"prompt"|"options"|"explanation"|"a"|test-correct|Synthetic|"coins"|"rank"/);
});
test('guest, A, B and logout sessions are isolated; guest is not imported',()=>{
  const storage=memoryStorage(),a=setup(storage,'A');a.act('start');answer(a);a.act('next');
  assert.equal(setup(storage,'B').engine.run,null);assert.equal(setup(storage).engine.run,null);
  assert.equal(setup(storage,'A').engine.run.index,1);
});
test('two tabs refuse a stale cursor write and preserve the newer tab',()=>{
  const storage=memoryStorage(),a=setup(storage);a.act('start');const b=setup(storage);a.act('choose',0);
  const before=storage.getItem('inha-world-learning-daily-v1:guest');assert.equal(b.act('choose',1),false);assert.equal(b.status.blocked,true);assert.equal(storage.getItem('inha-world-learning-daily-v1:guest'),before);
});
test('a native phone progress change blocks session replay instead of overwriting',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');answer(s);const native=createLearningProgress({getStorage:()=>storage});native.state.completed.e01=true;native.save();
  const newer=JSON.stringify(native.state);const resumed=setup(storage);assert.equal(resumed.status.blocked,true);assert.equal(resumed.act('submit'),false);assert.equal(JSON.stringify(resumed.progress.state),newer);
});
test('checkpoint quota failure keeps in-memory answer, exposes dirty state and can retry',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');s.act('choose',0);const set=storage.setItem;
  storage.setItem=(k,v)=>{if(k.includes('daily-v1'))throw new DOMException('full','QuotaExceededError');set(k,v);};
  assert.equal(s.act('submit'),false);assert.equal(s.engine.run.attempt.checked,true);assert.equal(s.status.dirty,true);assert.equal(s.act('next'),false);
  storage.setItem=set;assert.equal(s.retry(),true);assert.equal(setup(storage).engine.run.attempt.checked,true);
});
test('interrupted save between native progress and cursor blocks on reload; no duplicate grade',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');s.act('choose',0);const set=storage.setItem;
  storage.setItem=(k,v)=>{if(k.includes('daily-v1'))throw Error('interrupted');set(k,v);};s.act('submit');storage.setItem=set;
  const resumed=setup(storage);assert.equal(resumed.status.blocked,true);assert.equal(resumed.progress.state.learningHistory[day].answered,1);assert.equal(resumed.act('submit'),false);
  const exported=JSON.parse(resumed.backup());assert.equal(exported.progress.progress.learningHistory[day].answered,1);
  assert.equal(resumed.resetAfterBackup(),true);assert.equal(setup(storage).status.blocked,false);assert.equal(setup(storage).progress.state.learningHistory[day].answered,1);
});
test('native quota failure retains answer until progress and cursor both save',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');s.act('choose',0);const set=storage.setItem;
  storage.setItem=()=>{throw new DOMException('full','QuotaExceededError');};s.act('submit');assert.equal(s.status.dirty,true);assert.equal(s.engine.run.attempt.checked,true);
  storage.setItem=set;assert.equal(s.retry(),true);const resumed=setup(storage);assert.equal(resumed.status.blocked,false);assert.equal(resumed.progress.state.learningHistory[day].answered,1);
});
test('malformed and future session records remain untouched and blocked',()=>{
  for(const raw of ['broken',JSON.stringify({version:99})]){const storage=memoryStorage();storage.setItem('inha-world-learning-daily-v1:guest',raw);const s=setup(storage);assert.equal(s.status.blocked,true);s.act('start');assert.equal(storage.getItem('inha-world-learning-daily-v1:guest'),raw);}
});
test('changed content version cannot restore an obsolete checkpoint',()=>{
  const storage=memoryStorage(),s=setup(storage);s.act('start');const payload=learningFixture();payload.questions.forEach(q=>q.version=2);
  const resumed=createDailySession({catalog:createLearningCatalog(payload),getStorage:()=>storage});assert.equal(resumed.status.blocked,true);
});
test('restore rejects malformed selections, extra fields and invalid review keys without changing progress',()=>{
  const s=setup();s.act('start');answer(s);const base=s.engine.dailyCheckpoint(),before=JSON.stringify(s.progress.state);
  for(const mutate of [c=>c.selection=99,c=>c.answers[0].hinted='true',c=>c.extra=true,c=>c.finished=true,c=>c.keys.push(c.keys[0]),c=>c.answers[0].answer='secret']){
    const c=structuredClone(base);mutate(c);assert.equal(s.engine.restoreDaily(c),false);
  }assert.equal(JSON.stringify(s.progress.state),before);
});
test('same-day independent recheck does not count an extra correct day',()=>{
  const s=setup();s.act('start');answer(s);const key=questionKey(s.engine.run.questions[0]);
  assert.equal(s.progress.state.masteries[key].correctDays,1);
  const engine=createLearningEngine({catalog,progress:s.progress,today:()=>day});s.progress.state.wrong[key]=true;engine.startReview(key);engine.choose('option',0);engine.submit();assert.equal(s.progress.state.masteries[key].correctDays,1);
});
test('public entry retains approved content gate and contains no fixture/global toggle',async()=>{
  assert.equal(LEARNING_RELEASE.enabled,false);const entry=await readFile(new URL('../src/learning-web/entry.js',import.meta.url),'utf8');assert.doesNotMatch(entry,/learning-fixture|window\.|searchParams|localStorage/);
  const html=await readFile(new URL('../learn/index.html',import.meta.url),'utf8');assert.match(html,/lang="ko"/);assert.doesNotMatch(html,/https?:\/\/|iframe/);
});
