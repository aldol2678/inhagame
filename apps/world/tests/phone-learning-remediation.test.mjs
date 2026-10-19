import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningProgress,emptyProgress,sanitizeProgress} from '../src/learning/learning-progress.js';
import {createLearningEngine} from '../src/learning/learning-engine.js';
import {createLearningCatalog} from '../src/learning/learning-content.js';
import {memoryStorage,learningFixture,answerCorrect} from './support/learning-fixture.mjs';
const catalog=createLearningCatalog(learningFixture());
function lesson(){const storage=memoryStorage(),progress=createLearningProgress({getStorage:()=>storage}),engine=createLearningEngine({catalog,progress,today:()=> '2026-10-19'});engine.startLesson('e01');return {storage,progress,engine};}
test('F-01: final answer and completion expose write failure while retaining checked results for backup',()=>{
 const {storage,progress,engine}=lesson();for(let i=0;i<5;i++)answerCorrect(engine);
 storage.setItem=()=>{throw new DOMException('full','QuotaExceededError');};engine.choose('option',0);
 assert.equal(engine.submit(),false,'submit must propagate persistence failure');
 assert.equal(engine.run.attempt.checked,true);assert.equal(engine.run.correct,6);
 assert.equal(engine.next(),false,'completion must propagate persistence failure');assert.equal(engine.run.finished,true);
 assert.equal(progress.saveState.status,'unsaved');assert.equal(JSON.parse(progress.export()).progress.completed.e01,true);
});
test('F-03: malformed native records cannot be silently repaired into uploadable progress',()=>{
 for(const value of ['1',2])assert.throws(()=>sanitizeProgress({...emptyProgress(),version:value}),/INVALID_PROGRESS/);
 assert.throws(()=>sanitizeProgress({...emptyProgress(),learningHistory:{'2025-02-29':{answered:1,correct:1}}}),/INVALID_PROGRESS/);
 assert.throws(()=>sanitizeProgress({...emptyProgress(),coins:100}),/INVALID_PROGRESS/);
});
test('F-02: new browser writers stop before recovery copies grow without bound',()=>{
 const storage=memoryStorage();let rejected=false;
 for(let i=0;i<20;i++){const p=createLearningProgress({getStorage:()=>storage});p.state.completed.e01=true;if(!p.save()){rejected=true;break;}}
 assert.equal(rejected,true,'a recovery cap must stop growth without deleting unexported copies');
 assert.ok([...storage.rows.keys()].filter(k=>k.includes(':recovery:')).length<=8);
});
for(const name of ['Error','QuotaExceededError'])test(`F-01: ${name} retry is durable, does not recount, and restores after reentry`,()=>{
 const {storage,progress,engine}=lesson(),set=storage.setItem;storage.setItem=()=>{const e=Error('write denied');e.name=name;throw e;};
 engine.choose('option',0);assert.equal(engine.submit(),false);assert.equal(engine.run.correct,1);assert.equal(engine.submit(),false);
 const backup=progress.export();assert.equal(JSON.parse(backup).progress.learningHistory['2026-10-19'].answered,1);
 storage.setItem=set;assert.equal(progress.save(),true);assert.equal(progress.saveState.status,'saved');
 const reload=createLearningProgress({getStorage:()=>storage});assert.deepEqual(reload.state,progress.state);assert.equal(engine.run.correct,1);
});
test('F-01: stale tab can export and explicitly import onto the newer record without overwriting it',()=>{
 const storage=memoryStorage(),a=createLearningProgress({getStorage:()=>storage}),b=createLearningProgress({getStorage:()=>storage});
 const ea=createLearningEngine({catalog,progress:a}),eb=createLearningEngine({catalog,progress:b});ea.startLesson('e01');eb.startLesson('e02');
 for(let i=0;i<6;i++){answerCorrect(ea);answerCorrect(eb);}
 assert.equal(b.saveState.reason,'LOCAL_CONFLICT');const backup=b.export(),latest=storage.getItem('inha-world-learning-v1:guest');
 assert.equal(b.save(),false);assert.equal(storage.getItem('inha-world-learning-v1:guest'),latest);
 b.setAccount(null);b.import(backup,{catalog,confirm:true});assert.deepEqual(b.state.completed,{e02:true,e01:true});
 assert.equal(Object.values(b.state.learningHistory)[0].answered,6,'conflicting counters use the explicit existing-wins import policy, never fabricated sum');
});
test('F-01: boss completion write failure keeps the result, retries without duplicate boss counts',()=>{
 const {storage,progress,engine}=lesson();for(let i=1;i<=5;i++)progress.state.completed[`e0${i}`]=true;
 assert.equal(engine.startBoss('en',0),true);for(let i=0;i<4;i++)answerCorrect(engine);
 engine.choose('option',0);assert.equal(engine.submit(),true);const set=storage.setItem;storage.setItem=()=>{throw Error('disk');};
 assert.equal(engine.next(),false);assert.equal(engine.run.finished,true);assert.equal(progress.state.bosses[0].count,1);
 assert.equal(engine.next(),false);storage.setItem=set;assert.equal(progress.save(),true);assert.equal(progress.state.bosses[0].count,1);
});
test('F-02: backup confirmation and unchanged-byte cleanup preserve new copies, primary, outbox and A/B scope',()=>{
 const storage=memoryStorage(),p=createLearningProgress({getStorage:()=>storage});p.setAccount('A');p.state.completed.e01=true;p.save();
 const exported=p.recoveryBackup(),backup=p.export();assert.throws(()=>p.cleanupRecovery(exported),/CONFIRMATION/);
 p.state.completed.e02=true;p.save();assert.equal(p.cleanupRecovery(exported,{confirmed:true}),0,'retired immutable key is gone; newer snapshot has a different key');
 const latest=p.recoveryBackup();storage.setItem('inha-world-learning-sync-v1:user:A','outbox sentinel');
 p.setAccount('B');assert.equal(p.cleanupRecovery(latest,{confirmed:true}),0);p.setAccount('A');
 assert.equal(p.cleanupRecovery(latest,{confirmed:true}),1);assert.equal(storage.getItem('inha-world-learning-sync-v1:user:A'),'outbox sentinel');
 assert.equal(p.state.completed.e02,true);p.import(backup,{catalog,confirm:true});assert.equal(p.save(),true);
});
test('F-02: byte ceiling refuses a new archive without evicting any original',async()=>{
 const {writeRecovery,RECOVERY_LIMIT}=await import('../src/learning/learning-recovery.js');const storage=memoryStorage();
 const key='inha-world-learning-v1:guest:recovery:synthetic';storage.setItem(key,'original');
 assert.throws(()=>writeRecovery(storage,null,key+':new','x'.repeat(RECOVERY_LIMIT.bytes)),/RECOVERY_LIMIT/);
 assert.equal(storage.getItem(key),'original');
});
test('F-03: legacy migration fills absent fields only and rejects malformed existing values',()=>{
 const progress=createLearningProgress({getStorage:()=>memoryStorage()});
 for(const bad of [{level:'1'},{level:-1},{level:1.5},{lastCorrectDay:'2025-02-29'},{answer:'injected'}]){
  assert.throws(()=>progress.import(JSON.stringify({completed:{},masteries:{'e01-0':bad},wrong:{}}),{catalog,confirm:true}),/INVALID_PROGRESS/);
 }
 assert.deepEqual(progress.state,emptyProgress());
});
import {validProgress} from '../src/learning/learning-contract.js';
import {learningContractCases} from './support/learning-contract-cases.mjs';
for(const c of learningContractCases())test(`F-03 shared contract: ${c.name}`,()=>{
 assert.equal(validProgress(c.progress),c.valid);
 if(c.valid)assert.deepEqual(sanitizeProgress(c.progress),c.progress);else assert.throws(()=>sanitizeProgress(c.progress),/INVALID_PROGRESS/);
});
test('F-02: immutable snapshot keys prevent cleanup from deleting an in-flight writer update',()=>{
 const storage=memoryStorage(),p=createLearningProgress({getStorage:()=>storage});p.state.completed.e01=true;p.save();const exported=p.recoveryBackup();
 const get=storage.getItem;let interleave=true;
 storage.getItem=k=>{const raw=get(k);if(interleave&&k===exported[0].key){interleave=false;p.state.completed.e02=true;assert.equal(p.save(),true);}return raw;};
 p.cleanupRecovery(exported,{confirmed:true});
 const copies=p.recovery();assert.equal(copies.length,1);assert.equal(copies[0].completed.e02,true);
});
test('F-02: old mutable rolling keys are exported but excluded from deletion',()=>{
 const storage=memoryStorage(),p=createLearningProgress({getStorage:()=>storage}),key='inha-world-learning-v1:guest:recovery:old-writer';storage.setItem(key,JSON.stringify(emptyProgress()));
 const exported=p.recoveryBackup();assert.equal(exported.length,1);assert.equal(p.cleanupRecovery(exported,{confirmed:true}),0);assert.ok(storage.getItem(key));
});
test('F-01 regression: disabled learning with unreadable storage must not intercept World unload',async()=>{
 const {createLearningController}=await import('../src/learning/learning-controller.js');const win=new EventTarget();
 const controller=createLearningController({loadContent:async()=>null,win,getStorage:()=>{throw new DOMException('blocked','SecurityError');}});
 await controller.ready;const event=new Event('beforeunload',{cancelable:true});win.dispatchEvent(event);assert.equal(event.defaultPrevented,false);controller.dispose();
 const storage=memoryStorage(),seed=createLearningProgress({getStorage:()=>storage});seed.state.wrong['qv:test.en.e01.p1@1']=true;seed.save();
 const fixture=learningFixture();fixture.questions.find(q=>q.questionId==='test.en.e01.p1').version=2;
 const active=createLearningController({content:createLearningCatalog(fixture),win,getStorage:()=>storage});
 const unsaved=new Event('beforeunload',{cancelable:true});win.dispatchEvent(unsaved);assert.equal(unsaved.defaultPrevented,true);
 active.dispose();const disposed=new Event('beforeunload',{cancelable:true});win.dispatchEvent(disposed);assert.equal(disposed.defaultPrevented,false);
});
