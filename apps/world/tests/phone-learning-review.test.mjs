import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningProgress} from '../src/learning/learning-progress.js';
import {createLearningCatalog} from '../src/learning/learning-content.js';
import {memoryStorage,learningFixture} from './support/learning-fixture.mjs';
test('R1-A P1: stale tab must not replace a newer local record',()=>{
 const storage=memoryStorage(),a=createLearningProgress({getStorage:()=>storage}),b=createLearningProgress({getStorage:()=>storage});
 a.setAccount('A');b.setAccount('A');a.state.completed.e01=true;assert.equal(a.save(),true);
 b.state.completed.e02=true;assert.equal(b.save(),false);a.setAccount('A');assert.deepEqual(a.state.completed,{e01:true});assert.equal(b.state.completed.e02,true);
});
test('R1-A P1: rejected stale import cannot roll back another tab',()=>{
 const storage=memoryStorage(),a=createLearningProgress({getStorage:()=>storage}),b=createLearningProgress({getStorage:()=>storage});
 a.state.completed.e01=true;a.save();
 assert.throws(()=>b.import(JSON.stringify({completed:{e02:true},masteries:{},wrong:{}}),{catalog:createLearningCatalog(learningFixture()),confirm:true}),/SAVE_FAILED/);
 a.setAccount(null);assert.deepEqual(a.state.completed,{e01:true});
});
test('future raw progress version must not be accepted as legacy import',()=>{
 const p=createLearningProgress({getStorage:()=>memoryStorage()});
 assert.throws(()=>p.import(JSON.stringify({version:2,completed:{e01:true},masteries:{},wrong:{}}),{catalog:createLearningCatalog(learningFixture()),confirm:true}),/INVALID_BACKUP/);
});
test('simultaneous local writers retain both snapshots in separate recovery copies',()=>{
 const base=memoryStorage();const storage={get length(){return base.rows.size;},key:i=>[...base.rows.keys()][i],getItem:k=>base.getItem(k),setItem:(k,v)=>base.setItem(k,v)};
 const a=createLearningProgress({getStorage:()=>storage}),b=createLearningProgress({getStorage:()=>storage});
 a.state.completed.e01=true;b.state.completed.e02=true;
 let interleave=true;storage.setItem=(key,value)=>{if(interleave&&key==='inha-world-learning-v1:guest'){interleave=false;assert.equal(b.save(),true);}base.setItem(key,value);};
 assert.equal(a.save(),true);assert.deepEqual(a.recovery().map(p=>p.completed).sort((x,y)=>Object.keys(x)[0].localeCompare(Object.keys(y)[0])),[{e01:true},{e02:true}]);
 a.setAccount('B');assert.deepEqual(a.recovery(),[]);
});
test('missing randomUUID must not break World initialization with learning/cloud OFF',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});const storage=memoryStorage();const p=createLearningProgress({getStorage:()=>storage});p.state.completed.e01=true;assert.equal(p.save(),true);assert.ok([...storage.rows.keys()].some(k=>k.includes(':recovery:local-')));}
 finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});
