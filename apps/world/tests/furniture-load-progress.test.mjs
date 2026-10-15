import test from 'node:test';
import assert from 'node:assert/strict';
import { furnitureLoadPolicy, FURNITURE_LARGE_LOAD_POLICY, createFurnitureLoadWatchdog,
  readFurnitureBytes, withFurnitureLoadDeadline, waitForFurnitureVisuals } from '../src/rooms/furniture-load-progress.js';
import { SOFA_VISUAL, createFurnitureAssetPool } from '../src/rooms/furniture-visual-assets.js';
import { CHARACTER_FURNITURE_CANDIDATES } from '../src/rooms/character-furniture-assets.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function timers() {
  let time=0, id=0; const pending=new Map(), history=[];
  return {
    now:()=>time,
    setTimer(fn,delay) { const entry={fn,at:time+delay,id:++id}; pending.set(id,entry); history.push(entry); return id; },
    clearTimer(id) { pending.delete(id); }, history,
    advance(ms) {
      const until=time+ms;
      while(true) {
        const next=[...pending.values()].filter(entry=>entry.at<=until).sort((a,b)=>a.at-b.at)[0];
        if(!next)break;
        time=next.at; pending.delete(next.id); next.fn();
      }
      time=until;
    },
    count:()=>pending.size
  };
}
function watchdog(policy=FURNITURE_LARGE_LOAD_POLICY) {
  const clock=timers(),errors=[];
  return { clock,errors,watch:createFurnitureLoadWatchdog({policy,onTimeout:e=>errors.push(e.message),...clock}) };
}

test('trusted enabled small manifests keep eight-second cap; large candidate deadlines are safety limits, not performance acceptance',()=>{
  assert.equal(furnitureLoadPolicy(SOFA_VISUAL).overallMs,8000);
  for(const visual of CHARACTER_FURNITURE_CANDIDATES) {
    assert.equal(visual.enabled,true,'verified delivery activation preserves the existing safety deadline');
    assert.deepEqual(furnitureLoadPolicy(visual),{inactivityMs:15000,overallMs:180000,processingMs:30000,renderMs:8000});
  }
  assert.equal(furnitureLoadPolicy(SOFA_VISUAL,12).overallMs,12);
});
test('healthy slow stream survives old eight-second cutoff but trickle cannot extend fixed overall cap',()=>{
  const h=watchdog();
  for(let bytes=1;bytes<=17;bytes++) { h.clock.advance(10000);h.watch.progress(bytes,100);assert.deepEqual(h.errors,[]); }
  h.clock.advance(9999);h.watch.progress(18,100);assert.deepEqual(h.errors,[]);
  h.clock.advance(1);assert.deepEqual(h.errors,['FURNITURE_OVERALL_TIMEOUT']);
  h.watch.progress(19,100);assert.equal(h.clock.count(),0);
});
test('zero, duplicate, regressing, invalid and phase-free fake progress cannot extend inactivity',()=>{
  const h=watchdog();h.clock.advance(10000);assert.equal(h.watch.progress(1,10),true);
  const count=h.clock.history.length;
  for(const [loaded,total] of [[1,10],[0,10],[-1,10],[11,10],[NaN,10],[2,0],[1.5,10]]) assert.equal(h.watch.progress(loaded,total),false);
  assert.equal(h.clock.history.length,count);
  h.clock.advance(15000);assert.deepEqual(h.errors,['FURNITURE_DOWNLOAD_TIMEOUT']);
});
test('completed bytes receive bounded parse budget and render cannot be rearmed by repeated notifications',()=>{
  const h=watchdog();h.clock.advance(14000);h.watch.progress(10,10);
  h.clock.advance(29999);assert.deepEqual(h.errors,[]);h.clock.advance(1);
  assert.deepEqual(h.errors,['FURNITURE_PROCESSING_TIMEOUT']);
  const render=watchdog();render.watch.progress(10,10);render.clock.advance(20000);render.watch.render();
  render.clock.advance(7999);render.watch.render();render.watch.progress(10,10);render.clock.advance(1);
  assert.deepEqual(render.errors,['FURNITURE_RENDER_TIMEOUT']);
});
test('small models retain eight-second total wall cap and cleared timer generations are harmless',()=>{
  const h=watchdog(furnitureLoadPolicy(SOFA_VISUAL));const stale=h.clock.history[0].fn;
  h.clock.advance(7000);h.watch.progress(1,2);stale();assert.deepEqual(h.errors,[]);
  h.clock.advance(999);h.watch.progress(2,2);h.watch.render();h.clock.advance(1);
  assert.deepEqual(h.errors,['FURNITURE_OVERALL_TIMEOUT']);
  const stopped=watchdog();const callback=stopped.clock.history[0].fn;stopped.watch.stop();callback();assert.deepEqual(stopped.errors,[]);
});
test('stream records only copied bytes, bounds allocation and verifies exact manifest length without Content-Length',async()=>{
  const changes=[];
  const response=new Response(new ReadableStream({start(controller) {
    controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array());controller.enqueue(new Uint8Array([3,4,5]));controller.close();
  }}));
  const result=await readFurnitureBytes(response,5,{onProgress:p=>changes.push(p)});
  assert.deepEqual([...new Uint8Array(result)],[1,2,3,4,5]);
  assert.deepEqual(changes,[{loadedBytes:2,totalBytes:5},{loadedBytes:5,totalBytes:5}]);
  let cancelled=0;
  await assert.rejects(readFurnitureBytes(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(6));},cancel(){cancelled++;}})),5),/FURNITURE_BYTE_LENGTH/);
  assert.equal(cancelled,1);
  await assert.rejects(readFurnitureBytes(new Response(new Uint8Array(4)),5),/FURNITURE_BYTE_LENGTH/);
  await assert.rejects(readFurnitureBytes(new Response(new Uint8Array(5),{headers:{'content-length':'6'}}),5),/FURNITURE_BYTE_LENGTH/);
});
test('aborted stream cancels its reader and rejects without a late progress event',async()=>{
  const controller=new AbortController(),changes=[];let cancelled=0;
  const response=new Response(new ReadableStream({cancel(){cancelled++;}}));
  const pending=readFurnitureBytes(response,10,{signal:controller.signal,onProgress:p=>changes.push(p)});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(cancelled,1);assert.deepEqual(changes,[]);
});
test('non-stream fallback reports only completed actual bytes and remains bounded when arrayBuffer ignores abort',async()=>{
  const d=deferred(),changes=[];
  const pending=readFurnitureBytes({arrayBuffer:()=>d.promise},3,{onProgress:p=>changes.push(p)});
  assert.deepEqual(changes,[]);d.resolve(new Uint8Array([1,2,3]).buffer);await pending;
  assert.deepEqual(changes,[{loadedBytes:3,totalBytes:3}]);
  const clock=timers();let workSignal;
  const blocked=withFurnitureLoadDeadline((signal,progress)=>{workSignal=signal;return readFurnitureBytes({body:{},arrayBuffer:()=>new Promise(()=>{})},3,{signal,onProgress:progress});},
    {policy:FURNITURE_LARGE_LOAD_POLICY,...clock});
  const failure=assert.rejects(blocked,/FURNITURE_DOWNLOAD_TIMEOUT/);await flush();clock.advance(15000);await failure;assert.equal(workSignal.aborted,true);
});
test('shared source overall cap survives subscriber turnover and late work cannot publish bytes',async()=>{
  const clock=timers(),d=deferred(),changes=[];let publish,signal;
  const pending=withFurnitureLoadDeadline((s,p)=>{signal=s;publish=p;return d.promise;},{policy:FURNITURE_LARGE_LOAD_POLICY,onProgress:p=>changes.push(p),...clock});
  const failure=assert.rejects(pending,/FURNITURE_OVERALL_TIMEOUT/);await flush();
  for(let bytes=1;bytes<18;bytes++){clock.advance(10000);publish({loadedBytes:bytes,totalBytes:100});}
  clock.advance(10000);await failure;assert.equal(signal.aborted,true);const count=changes.length;
  publish({loadedBytes:50,totalBytes:100});d.resolve('late');await flush();assert.equal(changes.length,count);
});
test('pool fans out one transport, replays snapshot, ignores invalid bytes and detaches only released owners',async()=>{
  const d=deferred();let publish,signal,loads=0;const aEvents=[],bEvents=[],lateEvents=[];
  const pool=createFurnitureAssetPool({load:(_url,options)=>{loads++;publish=options.onProgress;signal=options.signal;return d.promise;},dispose:()=>{}});
  const a=pool.acquire('one'),b=pool.acquire('one');a.subscribeProgress(p=>aEvents.push(p));b.subscribeProgress(p=>bEvents.push(p));b.subscribeProgress(()=>{throw Error('observer')});
  await flush();publish({loadedBytes:2,totalBytes:10});b.subscribeProgress(p=>lateEvents.push(p));
  for(const p of [{loadedBytes:2,totalBytes:10},{loadedBytes:1,totalBytes:10},{loadedBytes:3,totalBytes:11},{loadedBytes:99,totalBytes:10}])publish(p);
  assert.equal(aEvents.length,1);assert.equal(bEvents.length,1);assert.equal(lateEvents.length,1);assert.equal(loads,1);
  a.release();await flush();assert.equal(signal.aborted,false);publish({loadedBytes:3,totalBytes:10});
  assert.equal(aEvents.length,1);assert.equal(bEvents.length,2);assert.equal(lateEvents.length,2);
  b.release();await flush();assert.equal(signal.aborted,true);publish({loadedBytes:4,totalBytes:10});assert.equal(bEvents.length,2);
  d.resolve({});await a.ready;assert.deepEqual(pool.status(),[]);
});
test('cancelled visual waiter removes only its subscriptions; sibling waiter and shared load continue',async()=>{
  const d=deferred(),listeners=new Set();let snapshot={sourceKey:'one@hash',loadedBytes:2,totalBytes:10};
  const handle={ready:d.promise,subscribeProgress(fn){listeners.add(fn);fn(snapshot);return()=>listeners.delete(fn);}};
  const controller=new AbortController(),first=[],second=[];
  const a=waitForFurnitureVisuals([handle,handle],{signal:controller.signal,onProgress:p=>first.push(p)});
  const aFails=assert.rejects(a,{name:'AbortError'});
  const b=waitForFurnitureVisuals([handle],{onProgress:p=>second.push(p)});
  assert.equal(first.length,1);controller.abort();await aFails;assert.equal(listeners.size,1);
  snapshot={...snapshot,loadedBytes:4};for(const listener of listeners)listener(snapshot);
  assert.equal(first.length,1);assert.equal(second.length,2);d.resolve('GLB');assert.deepEqual(await b,['GLB']);assert.equal(listeners.size,0);
});

test('exact bytes with missing EOF still expire at processing cap and release the reader',async()=>{
  const clock=timers();let cancelled=0;const events=[];
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled++;}}));
  const pending=withFurnitureLoadDeadline((signal,onProgress)=>readFurnitureBytes(response,3,{signal,onProgress}),
    {policy:FURNITURE_LARGE_LOAD_POLICY,onProgress:p=>events.push(p),...clock});
  const failure=assert.rejects(pending,/FURNITURE_PROCESSING_TIMEOUT/);await flush();
  assert.deepEqual(events,[{loadedBytes:3,totalBytes:3}]);clock.advance(29999);assert.equal(cancelled,0);clock.advance(1);await failure;await flush();
  assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});
test('rotating shared pool owners cannot restart the original source overall clock',async()=>{
  const clock=timers(),d=deferred();let publish,loads=0;const disposed=[];
  const pool=createFurnitureAssetPool({load:(_url,{signal,onProgress})=>{
    loads++;return withFurnitureLoadDeadline((_signal,progress)=>{publish=progress;return d.promise;},{signal,onProgress,policy:FURNITURE_LARGE_LOAD_POLICY,...clock});
  },dispose:value=>disposed.push(value)});
  let owner=pool.acquire('one');const failure=assert.rejects(owner.ready,/FURNITURE_OVERALL_TIMEOUT/);await flush();
  for(let bytes=1;bytes<18;bytes++) {
    clock.advance(10000);publish({loadedBytes:bytes,totalBytes:100});
    const next=pool.acquire('one');owner.release();owner=next;await flush();
  }
  clock.advance(10000);await failure;assert.equal(loads,1);await assert.rejects(owner.ready,/FURNITURE_OVERALL_TIMEOUT/);
  owner.release();await flush();assert.deepEqual(pool.status(),[]);d.resolve('late raw work');await flush();assert.deepEqual(disposed,[]);
});
