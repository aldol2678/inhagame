import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomTransition } from '../src/rooms/room-transition.js';
const PERSONAL='ROOM_PERSONAL_BASIC', LOBBY='ROOM_DORM1_LOBBY';
const options={parentRoomId:LOBBY,returnPosition:{x:0,y:0,z:0},metadata:{personalRoomId:'room'}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function rig(prepareRoom,extra={}) {
 const calls=[],errors=[],states=[]; let deadline; let paused=false;
 const world={createCheckpoint(){calls.push('checkpoint');const previous=paused;return()=>{calls.push('restore');paused=previous}},
 leaveCampus(){calls.push('leave');paused=true},showRoom(){calls.push('show')},placePlayer(){calls.push('place')},
 showCampus(){calls.push('campus')},resumeCampus(){paused=false}};
 const rooms=createRoomTransition({world,prepareRoom,onError:x=>errors.push(x),onPreparationChange:x=>states.push(x),
 setTimer:fn=>(deadline=fn,1),clearTimer:()=>{deadline=null},...extra});
 return {rooms,calls,errors,states,world,get paused(){return paused},timeout:()=>deadline()};
}
test('source and presence stay untouched until preparation, without minimum delay',async()=>{
 const d=deferred();let commits=0;
 const r=rig(()=>d.promise);
 assert.equal(r.rooms.enterNestedFromCampus(PERSONAL,options),true);
 assert.equal(r.rooms.enterNestedFromCampus(PERSONAL,options),false);
 assert.equal(r.rooms.status().busy,true);assert.deepEqual(r.calls,[]);assert.equal(r.paused,false);
 d.resolve({commit(){commits++}});await flush();
 assert.deepEqual(r.calls,['checkpoint','leave','show','place']);assert.equal(r.paused,true);
 assert.equal(r.rooms.currentSpace,PERSONAL);assert.equal(commits,1);assert.equal(r.rooms.status().busy,false);
});
test('cancel pending preparation permits retry; old completion cannot hide new overlay or commit',async()=>{
 const first=deferred(),second=deferred();let count=0,cancelled=0;
 const r=rig(()=>++count===1?first.promise:second.promise);
 r.rooms.enterNestedFromCampus(PERSONAL,options);assert.equal(r.rooms.cancelPending(),true);
 assert.equal(r.rooms.status().busy,false);assert.deepEqual(r.calls,[]);
 r.rooms.enterNestedFromCampus(PERSONAL,options);const countStates=r.states.length;
 first.resolve({cancel(){cancelled++}});await flush();
 assert.equal(cancelled,1);assert.equal(r.states.length,countStates);assert.equal(r.rooms.status().busy,true);
 second.resolve();await flush();assert.equal(r.rooms.currentSpace,PERSONAL);
});
test('timeout immediately releases source, aborts loading and permits retry',async()=>{
 const d=deferred();let signal;const r=rig(x=>(signal=x.signal,d.promise));
 r.rooms.enterNestedFromCampus(PERSONAL,options);r.timeout();
 assert.equal(signal.aborted,true);assert.equal(r.rooms.status().busy,false);assert.equal(r.errors[0].recovered,true);
 assert.deepEqual(r.calls,[]);assert.equal(r.rooms.currentSpace,'campus');
 d.resolve();await flush();assert.deepEqual(r.calls,[]);
});
test('layout rejection leaves source unchanged and reports retry-safe failure',async()=>{
 const r=rig(()=>Promise.reject(Error('LAYOUT_DENIED')));
 r.rooms.enterNestedFromCampus(PERSONAL,options);await flush();
 assert.equal(r.rooms.status().busy,false);assert.equal(r.errors.length,1);assert.equal(r.errors[0].recovered,true);assert.deepEqual(r.calls,[]);
});
test('invalid account epoch after ready cannot commit even if user ID returns to A',async()=>{
 let epoch=0;const original=epoch,d=deferred();const r=rig(()=>d.promise);
 r.rooms.enterNestedFromCampus(PERSONAL,{...options,isValid:()=>epoch===original});epoch+=2;
 d.resolve();await flush();assert.deepEqual(r.calls,[]);assert.equal(r.rooms.status().busy,false);
});
test('world failure after readiness restores source and cancels lease',async()=>{
 let cancelled=0;const r=rig(()=>Promise.resolve({cancel(){cancelled++}}));
 r.world.showRoom=()=>{throw Error('show failed')};r.rooms.enterNestedFromCampus(PERSONAL,options);await flush();
 assert.equal(cancelled,1);assert.equal(r.paused,false);assert.equal(r.errors[0].recovered,true);assert.equal(r.rooms.status().busy,false);
});
test('forced exit during preparation cancels before campus pause',async()=>{
 const d=deferred(),r=rig(()=>d.promise);r.rooms.enterNestedFromCampus(PERSONAL,options);
 r.rooms.exit({force:true});d.resolve();await flush();assert.equal(r.rooms.currentSpace,'campus');assert.deepEqual(r.calls,[]);
});

test('lease commit throwing restores source instead of stranding overlay',async()=>{
 const r=rig(()=>Promise.resolve({commit(){throw Error('commit')},cancel(){}}));
 r.rooms.enterNestedFromCampus(PERSONAL,options);await flush();
 assert.equal(r.paused,false);assert.equal(r.rooms.status().busy,false);assert.equal(r.errors[0].recovered,true);
 assert.equal(r.states.at(-1).active,false);
});
test('lease cleanup throwing reports fail-closed, with overlay dismissed',async()=>{
 const r=rig(()=>Promise.resolve({cancel(){throw Error('cleanup')}}));
 r.world.showRoom=()=>{throw Error('show')};r.rooms.enterNestedFromCampus(PERSONAL,options);await flush();
 assert.equal(r.errors[0].recovered,false);assert.equal(r.rooms.status().busy,true);assert.equal(r.states.at(-1).active,false);
});
test('abort cleanup callback failure retains input lock and reports reload',async()=>{
 const d=deferred();const r=rig(({signal,onCleanupError})=>{
 signal.addEventListener('abort',()=>onCleanupError(Error('cleanup')));return d.promise;
 });
 r.rooms.enterNestedFromCampus(PERSONAL,options);r.rooms.cancelPending();
 assert.equal(r.errors[0].recovered,false);assert.equal(r.rooms.status().busy,true);
 d.resolve();await flush();
});

test('only a new stage rearms watchdog; stale cleared deadlines cannot undo arrival',async()=>{
 const timers=[],d=deferred();let stage;
 const r=rig(context=>(stage=context.stage,d.promise),{setTimer:fn=>(timers.push(fn),timers.length),clearTimer(){}});
 r.rooms.enterNestedFromCampus(PERSONAL,options);assert.equal(timers.length,1);
 stage('visuals');assert.equal(timers.length,2);stage('visuals');assert.equal(timers.length,2);
 timers[0]();assert.equal(r.rooms.status().busy,true);assert.equal(r.errors.length,0);
 d.resolve();await flush();const calls=[...r.calls];timers[1]();
 assert.deepEqual(r.calls,calls);assert.equal(r.rooms.currentSpace,PERSONAL);assert.equal(r.errors.length,0);
});

test('visual deadline only renews on new actual bytes, deduplicates shared sources and has an unmovable overall cap',async()=>{
 let now=0,context;const timers=[],d=deferred();
 const r=rig(x=>(context=x,x.stage('furniture'),d.promise),{clock:{now:()=>now},setTimer:(fn,delay)=>(timers.push({fn,delay}),timers.length),clearTimer(){}});
 r.rooms.enterNestedFromCampus(PERSONAL,options);assert.equal(timers.at(-1).delay,15000);
 now=10000;context.stage('visuals');assert.equal(timers.at(-1).delay,45000);
 const progress=(loadedBytes,totalBytes=100,sourceKey='asset@hash')=>context.onProgress({sourceKey,loadedBytes,totalBytes});
 const before=timers.length;progress(0);assert.equal(timers.length,before);
 now=40000;progress(10);assert.equal(timers.length,before+1);assert.equal(timers.at(-1).delay,45000);
 for(const bytes of [10,9,-1,NaN,101])progress(bytes);progress(11,101);assert.equal(timers.length,before+1);
 progress(5,20,'second@hash');assert.deepEqual(r.states.at(-1).progress,{loadedBytes:15,totalBytes:120});
 now=200000;progress(20);assert.equal(timers.at(-1).delay,10000);
 now=209000;progress(21);assert.equal(timers.at(-1).delay,1000);
 now=210000;timers.at(-1).fn();assert.equal(context.signal.aborted,true);assert.match(r.errors[0].error.message,/overall/);
 const count=r.states.length;progress(22);assert.equal(r.states.length,count);assert.deepEqual(r.calls,[]);
 d.resolve();await flush();assert.deepEqual(r.calls,[]);
});
test('progress from a cancelled attempt cannot renew or dismiss a newer attempt',async()=>{
 const pending=[deferred(),deferred()],contexts=[],timers=[];
 const r=rig(context=>{contexts.push(context);context.stage('visuals');return pending[contexts.length-1].promise;},
   {setTimer:(fn,delay)=>(timers.push({fn,delay}),timers.length),clearTimer(){}});
 r.rooms.enterNestedFromCampus(PERSONAL,options);r.rooms.cancelPending();r.rooms.enterNestedFromCampus(PERSONAL,options);
 const count=timers.length,states=r.states.length;
 contexts[0].onProgress({sourceKey:'one@hash',loadedBytes:1,totalBytes:10});contexts[0].stage('furniture');timers[0].fn();
 assert.equal(timers.length,count);assert.equal(r.states.length,states);assert.equal(r.rooms.status().busy,true);
 pending[0].resolve();pending[1].resolve();await flush();assert.equal(r.rooms.currentSpace,PERSONAL);
});
