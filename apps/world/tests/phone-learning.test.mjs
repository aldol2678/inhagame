import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {learningFixture,memoryStorage,answerCorrect} from './support/learning-fixture.mjs';
import {createLearningCatalog,loadApprovedLearningContent,LEARNING_RELEASE,questionKey} from '../src/learning/learning-content.js';
import {createLearningProgress,recordMastery,reconcileVersions} from '../src/learning/learning-progress.js';
import {createLearningEngine} from '../src/learning/learning-engine.js';
import {createLearningController} from '../src/learning/learning-controller.js';
import {createLearningSpeech} from '../src/learning/learning-speech.js';
import {createPhoneAppRegistry} from '../src/phone/phone-app-catalog.js';
import {createPhonePreferences,PHONE_APP_IDS} from '../src/phone/phone-preferences.js';
import {createPhoneShell} from '../src/phone/phone-shell.js';
import {createInputFocusManager} from '../src/input/input-focus-manager.js';
const setup=()=>{const catalog=createLearningCatalog(learningFixture()),storage=memoryStorage(),progress=createLearningProgress({getStorage:()=>storage}),engine=createLearningEngine({catalog,progress,today:()=> '2026-10-18'});return {catalog,storage,progress,engine};};

test('release is off, absent/unapproved manifest fails before any content request',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw Error();};
  assert.equal(LEARNING_RELEASE.enabled,false);assert.equal(await loadApprovedLearningContent(undefined,{fetcher}),null);
  for(const manifest of [null,{}, {publicationEligible:false}])await assert.rejects(loadApprovedLearningContent({enabled:true,manifest},{fetcher}),/BLOCKED/);
  assert.equal(calls,0);const controller=createLearningController({getStorage:()=>null});assert.equal(await controller.ready,false);assert.equal(controller.available(),false);controller.dispose();
});
test('reviewed manifest binds exact payload bytes, IDs and versions; demo banks always rejected',async()=>{
  const payload=learningFixture(),bytes=Buffer.from(JSON.stringify(payload));
  const manifest={format:'induck.learning.approved.v1',publicationEligible:true,reviewStatus:'approved',rightsReview:'verified',approvalReference:'TEST ONLY',version:'test-1',sha256:createHash('sha256').update(bytes).digest('hex'),questions:payload.questions.map(q=>({questionId:q.questionId,version:q.version}))};
  const release={enabled:true,resource:'/learning-content/test.json',manifest};
  const fetcher=async()=>new Response(bytes);assert.equal((await loadApprovedLearningContent(release,{fetcher})).lessons.length,25);
  await assert.rejects(loadApprovedLearningContent({...release,manifest:{...manifest,sha256:'0'.repeat(64)}},{fetcher}));
  await assert.rejects(loadApprovedLearningContent({...release,manifest:{...manifest,questions:manifest.questions.slice(1)}},{fetcher}));
  await assert.rejects(loadApprovedLearningContent({...release,resource:'https://outside.invalid/file.json'},{fetcher}));
  payload.questions[0].publicationEligible=false;const bad=Buffer.from(JSON.stringify(payload));
  await assert.rejects(loadApprovedLearningContent({...release,manifest:{...manifest,sha256:createHash('sha256').update(bad).digest('hex')}},{fetcher:async()=>new Response(bad)}));
  payload.questions[0].bank='daily_quiz_demo';assert.throws(()=>createLearningCatalog(payload));
});
test('catalog rejects incomplete English, duplicate IDs and invalid answer structures',()=>{
  for(const mutate of [p=>p.lessons.pop(),p=>p.lessons.splice(0,1),p=>p.questions[1].questionId=p.questions[0].questionId,p=>p.questions[0].answer.index=9,p=>p.questions[2].answer.pairs=[]]){
    const p=learningFixture();mutate(p);assert.throws(()=>createLearningCatalog(p));
  }
});
test('all 15 English lessons preserve six questions, adaptive tier changes, combo and boss gate',()=>{
  const {engine,progress}=setup();assert.equal(engine.startBoss('en',0),false);
  for(let i=1;i<=15;i++){
    assert.equal(engine.startLesson(`e${String(i).padStart(2,'0')}`),true);
    for(let j=0;j<6;j++)answerCorrect(engine);
    assert.equal(engine.run.finished,true);assert.equal(engine.run.correct,6);assert.equal(engine.run.maxCombo,6);
  }
  assert.equal(Object.keys(progress.state.completed).length,15);assert.equal(progress.state.learningHistory['2026-10-18'].answered,90);
  assert.equal(engine.startBoss('en',0),true);for(let i=0;i<5;i++)answerCorrect(engine);
  assert.equal(progress.state.bosses[0].passed,true);assert.equal(progress.state.bosses[0].best,5);
  for(const lang of ['zh','ja']){assert.equal(engine.startLesson(`${lang}01`),true);for(let i=0;i<6;i++)answerCorrect(engine);assert.equal(progress.state.completed[`${lang}01`],true);}
});
test('wrong answer and repeated submit count once; replay and review preserve versioned identities',()=>{
  const {engine,progress,catalog,storage}=setup();engine.startLesson('e01');engine.choose('option',1);engine.submit();engine.submit();
  const key=questionKey(engine.run.questions[0]);assert.equal(progress.state.learningHistory['2026-10-18'].answered,1);assert.equal(progress.state.wrong[key],true);
  progress.setAccount(null);engine.reset();assert.equal(progress.state.wrong[key],true);assert.equal(engine.startReview(key),true);answerCorrect(engine);assert.equal(progress.state.wrong[key],undefined);
  assert.doesNotMatch([...storage.rows.values()].join(''),/prompt|test-correct|explanation/);
  const q=catalog.get(key);const p=learningFixture();p.questions.find(x=>x.questionId===q.questionId).version=2;
  const next=createLearningCatalog(p);reconcileVersions(progress.state,next,'2026-10-18');assert.ok(progress.state.masteries[key]);
  const newer=`qv:${q.questionId}@2`;assert.equal(progress.state.masteries[newer].needsRecheck,true);recordMastery(progress.state,newer,true,'2026-10-18');assert.equal(progress.state.masteries[newer].needsRecheck,false);
});
test('mastery needs another day; same-day recheck clears flag without shortening interval',()=>{
  const {progress}=setup(),key='qv:test.en.e01.p1@1';
  recordMastery(progress.state,key,true,'2026-10-18');recordMastery(progress.state,key,true,'2026-10-18');assert.equal(progress.state.masteries[key].level,1);
  recordMastery(progress.state,key,true,'2026-10-19');assert.equal(progress.state.masteries[key].level,2);assert.equal(progress.state.masteries[key].intervalDays,3);
  progress.state.masteries[key].needsRecheck=true;recordMastery(progress.state,key,true,'2026-10-19');assert.equal(progress.state.masteries[key].intervalDays,3);assert.equal(progress.state.masteries[key].needsRecheck,false);
});
test('guest, A, logout and B isolated; confirmed manual import strips authority and content fields',()=>{
  const {progress,catalog}=setup();progress.state.completed.e01=true;progress.save();progress.setAccount('A');assert.equal(progress.state.completed.e01,undefined);
  progress.state.completed.e02=true;progress.save();const backup=progress.export();progress.setAccount('B');assert.deepEqual(progress.state.completed,{});
  assert.throws(()=>progress.import(backup,{catalog}),/CONFIRMATION/);progress.import(backup,{catalog,confirm:true});assert.equal(progress.state.completed.e02,true);
  const legacy={completed:{zh01:true},masteries:{'e03-3':{level:2}},wrong:{},coins:999,campusXp:999,rank:{x:500},reviewCatalog:{secret:'answer'}};
  assert.equal(progress.import(JSON.stringify(legacy),{catalog,confirm:true}).unresolved,1);assert.doesNotMatch(progress.export(),/coins|campusXp|rank|secret|answer/);
  progress.setAccount(null);assert.equal(progress.state.completed.e01,true);assert.equal(progress.state.completed.e02,undefined);progress.setAccount('A');assert.deepEqual(progress.state.completed,{e02:true});
});
test('storage denied or corrupt keeps original; failed import restores prior memory',()=>{
  const {catalog}=setup(),storage=memoryStorage();storage.setItem('inha-world-learning-v1:guest','{corrupt');
  const p=createLearningProgress({getStorage:()=>storage});assert.equal(p.save(),false);assert.throws(()=>p.import(JSON.stringify({completed:{},masteries:{},wrong:{}}),{catalog,confirm:true}));assert.equal(storage.getItem('inha-world-learning-v1:guest'),'{corrupt');
  const denied=createLearningProgress({getStorage:()=>({getItem:()=>null,setItem:()=>{throw Error();}})});assert.equal(denied.save(),false);
  assert.throws(()=>denied.import(JSON.stringify({completed:{e01:true},masteries:{},wrong:{}}),{catalog,confirm:true}),/SAVE_FAILED/);assert.deepEqual(denied.state.completed,{});
});
test('late content cannot resurrect disposed controller; account changes during load use current scope',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);const c=createLearningController({loadContent:()=>pending,getStorage:()=>null});c.dispose();resolve(createLearningCatalog(learningFixture()));assert.equal(await c.ready,false);assert.equal(c.available(),false);
  const p=createLearningController({loadContent:()=>Promise.resolve(createLearningCatalog(learningFixture())),getStorage:()=>null});p.setAccount('B');await p.ready;assert.equal(p.snapshot().scope,'B');p.dispose();assert.equal(p.snapshot().run,undefined);
});
test('speech unsupported, permission denied, stop and late callbacks use text fallback safely',()=>{
  const texts=[],statuses=[];let rec;
  class Rec {constructor(){rec=this;}start(){}abort(){}}
  const win={isSecureContext:true,SpeechRecognition:Rec,setTimeout,clearTimeout};
  const s=createLearningSpeech({win,onText:t=>texts.push(t),onStatus:t=>statuses.push(t)});
  assert.equal(s.play('en','synthetic'),false);s.listen('en');rec.onerror({error:'not-allowed'});assert.ok(statuses.length);
  s.listen('en');const late=rec.onresult;s.stop();late({results:[[{transcript:'stale'}]]});assert.deepEqual(texts,[]);
  s.listen('en');rec.onresult({results:[[{transcript:'fresh'}]]});assert.deepEqual(texts,['fresh']);s.stop();
});
test('optional app preserves existing home and Dock; inactive catalog cannot launch an empty app',()=>{
  const storage=memoryStorage();let enabled=false;
  const p=createPhonePreferences({getStorage:()=>storage,getScope:()=> 'A',getAppIds:()=>enabled?[...PHONE_APP_IDS,'learning']:PHONE_APP_IDS});
  const original=p.snapshot();assert.equal(original.pages.flat().includes('learning'),false);enabled=true;
  const next=p.snapshot();assert.deepEqual(next.dock,original.dock);for(let i=0;i<12;i++)if(original.pages[0][i])assert.equal(next.pages[0][i],original.pages[0][i]);
  p.move('learning',{area:'dock',slot:3});p.save();enabled=false;p.load();assert.equal(p.snapshot().dock[3],'learning');
  assert.equal(createPhoneAppRegistry([]).find(a=>a.id==='learning').available(),false);
});
test('Phone learning exception and repeated Daily Quiz navigation release world focus',()=>{
  const focus=createInputFocusManager();let closed=0,errors=0;
  const registry=createPhoneAppRegistry([{id:'learning',available:()=>true,open:()=>{throw Error();},close:()=>{closed++;throw Error();}},{id:'daily-quiz',available:()=>true}]);
  const shell=createPhoneShell({inputFocus:focus,registry,onError:()=>errors++});shell.open();shell.launch('learning');assert.equal(focus.can('WORLD_ACTION'),false);
  shell.launch('daily-quiz');shell.back();shell.home();shell.close();assert.equal(focus.size,0);assert.ok(closed>=2&&errors>=2);shell.destroy();
});
test('learning modules have no wallet, ranking, RPC, iframe or global event authority',async()=>{
  const dir=new URL('../src/learning/',import.meta.url);const files=await readdir(dir);const source=(await Promise.all(files.map(f=>readFile(new URL(f,dir),'utf8')))).join('\n');
  assert.doesNotMatch(source,/\.rpc\(|supabase\.from\(|state\.coins|state\.campusXp|dailyBank|rankBank|<iframe|document\.addEventListener|innerHTML/);
  assert.doesNotMatch(await readFile(new URL('../learning.css',import.meta.url),'utf8'),/(^|\n)(body|html|:root|\*)\s*\{/);
});

test('legacy static slots migrate with recheck; ambiguous adaptive slots are explicitly unresolved',()=>{
  const fixture=learningFixture();fixture.questions.find(q=>q.lessonId==='e03'&&q.position===3).version=2;
  const catalog=createLearningCatalog(fixture),storage=memoryStorage(),progress=createLearningProgress({getStorage:()=>storage});
  const legacy={completed:{e03:true,zh01:true},masteries:{'e03-2':{level:2,streak:4},'e03-3':{level:2}},wrong:{'e03-2':{prompt:'private source text'}}};
  const result=progress.import(JSON.stringify(legacy),{catalog,confirm:true});assert.equal(result.unresolved,1);
  assert.equal(progress.state.masteries['qv:test.en.e03.p3@2'].needsRecheck,true);
  assert.equal(progress.state.wrong['qv:test.en.e03.p3@2'],true);assert.equal(progress.state.completed.zh01,true);
  assert.doesNotMatch(progress.export(),/private source text/);
});
