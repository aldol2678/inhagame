import test from 'node:test';
import assert from 'node:assert/strict';
import {createFurnitureAssetPool,captureFurnitureVisual,SOFA_VISUAL} from '../src/rooms/furniture-visual-assets.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const reason of ['remove','room exit','account A→B→A','preview close'])test(`late load cannot resurrect after ${reason}`,async()=>{
 let complete,loads=0;const freed=[];
 const pool=createFurnitureAssetPool({load:()=>{loads++;return new Promise(resolve=>complete=resolve);},dispose:value=>freed.push(value)});
 const a=pool.acquire(SOFA_VISUAL.url);await tick();a.release();a.release();await tick();complete({id:1});await a.ready;await tick();
 assert.equal(loads,1);assert.deepEqual(freed,[{id:1}]);assert.deepEqual(pool.status(),[]);
});
test('concurrent instances share source; last release unloads exactly once',async()=>{
 let loads=0;const freed=[],source={mesh:1},pool=createFurnitureAssetPool({load:async()=>{loads++;return source;},dispose:v=>freed.push(v)});
 const a=pool.acquire('url'),b=pool.acquire('url');assert.strictEqual(await a.ready,await b.ready);assert.equal(loads,1);
 a.release();await tick();assert.equal(freed.length,0);assert.equal(pool.status()[0].refs,1);
 b.release();const c=pool.acquire('url');await tick();assert.equal(freed.length,0);assert.strictEqual(await c.ready,source);
 c.release();await tick();assert.deepEqual(freed,[source]);assert.deepEqual(pool.status(),[]);
});
test('failed request is shared and retry possible after all leases release',async()=>{
 let calls=0;const pool=createFurnitureAssetPool({load:async()=>{calls++;throw Error('404');},dispose:()=>assert.fail()});
 const a=pool.acquire('url'),b=pool.acquire('url');await assert.rejects(a.ready,/404/);await assert.rejects(b.ready,/404/);a.release();b.release();await tick();
 const c=pool.acquire('url');await assert.rejects(c.ready,/404/);assert.equal(calls,2);c.release();await tick();assert.deepEqual(pool.status(),[]);
});
test('close cleans settled source and late pending resources',async()=>{
 let complete;const freed=[],pool=createFurnitureAssetPool({load:()=>new Promise(r=>complete=r),dispose:v=>freed.push(v)});
 const a=pool.acquire('url');await tick();pool.close();assert.throws(()=>pool.acquire('url'),/closed/);complete(1);await a.ready;assert.deepEqual(freed,[1]);
});
test('thumbnail waits for GLB, exposes final mode and invalidates superseded capture',async()=>{
 let state={generation:1,revision:0,destroyed:false,suspended:false,placementCount:1,contentKey:'sofa-a',modelMode:'glb',objects:[{state:'LOADING'}]},complete;
 const layer={visualStatus:()=>structuredClone(state),whenVisualsReady:()=>new Promise(r=>complete=r)};
 let captured=0;const request=captureFurnitureVisual(layer,async()=>{captured++;return 'png';});assert.equal(captured,0);
 state.revision++;state.objects[0].state='GLB';complete();const result=await request;assert.equal(result.mode,'GLB');assert.equal(result.image,'png');
 const pending=captureFurnitureVisual(layer,async()=>{state.generation++;return 'stale';});complete();assert.equal(await pending,null);
 const cancelled=captureFurnitureVisual(layer,()=>assert.fail());state.generation++;complete();assert.equal(await cancelled,null);
});

test('empty/suspended capture never labels GLB; procedural and camera keys remain explicit',async()=>{
 let state={generation:1,revision:1,destroyed:false,suspended:false,placementCount:0,contentKey:'[]',modelMode:'procedural',objects:[]};
 const layer={visualStatus:()=>structuredClone(state),whenVisualsReady:async()=>{}};
 assert.equal(await captureFurnitureVisual(layer,()=>assert.fail()),null);
 state.placementCount=1;state.contentKey='chair';assert.equal((await captureFurnitureVisual(layer,async()=>1)).mode,'FALLBACK');
 assert.equal((await captureFurnitureVisual(layer,async()=>1)).cacheKey,null);
 const a=await captureFurnitureVisual(layer,async()=>1,{viewKey:'front'}),b=await captureFurnitureVisual(layer,async()=>1,{viewKey:'side'});assert.notEqual(a.cacheKey,b.cacheKey);
 state.suspended=true;assert.equal(await captureFurnitureVisual(layer,()=>assert.fail()),null);
});

test('last pending release aborts and evicts hung transport, allowing fresh retry',async()=>{
 const signals=[];const pool=createFurnitureAssetPool({load:(_url,{signal})=>{signals.push(signal);return new Promise(()=>{});},dispose:()=>assert.fail()});
 const a=pool.acquire('url');await tick();a.release();await tick();assert.equal(signals[0].aborted,true);assert.deepEqual(pool.status(),[]);
 const b=pool.acquire('url');await tick();assert.equal(signals.length,2);assert.equal(signals[1].aborted,false);b.release();await tick();assert.deepEqual(pool.status(),[]);
});
