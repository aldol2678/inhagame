import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('./browser/furniture-showroom-lifecycle-smoke.mjs',import.meta.url),'utf8');
const sofa='furniture.dorm_single_sofa';
for(const state of ['LOADING','GLB']) test(`showroom ${state} wait observes the sofa, never another enabled replacement`,()=>{
 const line=source.split('\n').find(line=>line.includes('page.waitForFunction(')&&line.includes('.status().objects.some(')&&line.includes(`'${state}'`));
 assert.ok(line,'real browser predicate is present');
 const expression=line.trim().replace(/^await page.waitForFunction\(/,'').replace(/\);$/,'');
 const check=objects=>runInNewContext(`(${expression})()`,{window:{__FURNITURE_SHOWROOM_QA__:{previews:[{status:()=>({objects})}]}}});
 assert.equal(check([{itemId:'furniture.campus_rug_blue',state}]),false,'rug cannot complete sofa wait');
 assert.equal(check([{itemId:'furniture.induck_chair',state},{itemId:sofa,state:'FALLBACK'}]),false);
 assert.equal(check([{itemId:sofa,state}]),true);
 assert.equal(check([{itemId:sofa,state},{itemId:'furniture.induck_chair',state:'FALLBACK'}]),true);
 assert.equal(check([]),false);
});

test('exact sofa route wait is bounded and clears its deadline after arrival or failure', async()=>{
 const block=source.slice(source.indexOf('  let routeTimer;'),source.indexOf('  assert.ok(pendingRoute);'));
 assert.ok(block.includes('Promise.race'));
 const run=routeReady=>{
  let callback,delay,cleared=false;
  const promise=runInNewContext(`(async()=>{${block}})()`,{routeReady,
   setTimeout(fn,ms){callback=fn;delay=ms;return 17;},clearTimeout(id){assert.equal(id,17);cleared=true;}});
  return {promise,expire:()=>callback(),get delay(){return delay;},get cleared(){return cleared;}};
 };
 let arrive;const waiting=run(new Promise(resolve=>{arrive=resolve;}));
 assert.equal(waiting.delay,30000);assert.equal(waiting.cleared,false);
 arrive();await waiting.promise;assert.equal(waiting.cleared,true);
 const missing=run(new Promise(()=>{}));missing.expire();
 await assert.rejects(missing.promise,/sofa route did not arrive/);assert.equal(missing.cleared,true);
});
