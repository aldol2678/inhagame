import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalRoomPreparation } from "../src/rooms/personal-room-preparation.js";
const ROOM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function rig() {
  const calls = [];
  let user = "A", valid = true;
  const state = { roomId: ROOM, ready: true };
  const furniture = { bind: async id => { calls.push(["bind", id]); return true; }, state: () => state, reset: () => calls.push("reset") };
  const scene = { root: { enabled: false }, ensureVisualAssets: async () => { calls.push("visuals"); return [false]; }, onDeactivate: () => calls.push("deactivate") };
  const preparation = createPersonalRoomPreparation({ getFurniture: () => furniture, getScene: () => scene, getUserId: () => user });
  const controller = new AbortController();
  const args = { metadata: { personalRoomId: ROOM.toUpperCase() }, signal: controller.signal, isValid: () => valid, stage: s => calls.push(s) };
  return { calls, furniture, scene, state, preparation, controller, args, setUser: v => user=v, invalidate: () => valid=false };
}
test("binds saved layout before visuals, accepts optional fallback, and commits lease", async () => {
  const h = rig(); const lease = await h.preparation.prepare(h.args);
  assert.deepEqual(h.calls, ["furniture", ["bind", ROOM], "visuals", "visuals"]);
  lease.commit(); h.controller.abort(); lease.cancel();
  assert.ok(!h.calls.includes("reset"));
});
test("bind false and unready, wrong-room, or errored layouts fail closed", async () => {
  for (const alteration of [h => h.furniture.bind = async () => false, h => h.state.ready=false,
    h => h.state.roomId="wrong", h => h.state.error="LAYOUT_DENIED"]) {
    const h=rig(); alteration(h); await assert.rejects(h.preparation.prepare(h.args));
    assert.ok(!h.calls.includes("visuals")); assert.deepEqual(h.calls.slice(-2), ["reset", "deactivate"]);
  }
});
test("abort immediately resets pending bind and late completion cannot start visuals", async () => {
  const h=rig(), wait=deferred(); h.furniture.bind=()=>wait.promise;
  const result=h.preparation.prepare(h.args); h.controller.abort();
  await assert.rejects(result, { name:"AbortError" });
  wait.resolve(true); await Promise.resolve();
  assert.deepEqual(h.calls, ["furniture", "reset", "deactivate"]);
});
test("ready but uncommitted lease remains cancellable", async () => {
  const h=rig(); const lease=await h.preparation.prepare(h.args); h.controller.abort();
  assert.deepEqual(h.calls.slice(-2), ["reset", "deactivate"]);
  assert.throws(()=>lease.commit(), { name:"AbortError" });
});
test("account A to B to A is rejected using caller's account epoch", async () => {
  const h=rig(), wait=deferred(); h.furniture.bind=()=>wait.promise;
  const result=h.preparation.prepare(h.args); h.setUser("B"); h.invalidate(); h.setUser("A"); wait.resolve(true);
  await assert.rejects(result, { name:"AbortError" }); assert.ok(!h.calls.includes("visuals"));
});
test("account changes during visuals reject readiness", async () => {
  const h=rig(), wait=deferred(); h.scene.ensureVisualAssets=()=>wait.promise;
  const result=h.preparation.prepare(h.args); await Promise.resolve(); await Promise.resolve();
  h.setUser("B"); wait.resolve(); await assert.rejects(result, { name:"AbortError" });
});
test("superseded completion and old abort cannot reset newer preparation", async () => {
  const h=rig(), wait=deferred(); h.furniture.bind=()=>wait.promise;
  const old=h.preparation.prepare(h.args); const rejection=assert.rejects(old, { name:"AbortError" });
  h.furniture.bind=async()=>true;
  const next=await h.preparation.prepare({ ...h.args, signal:new AbortController().signal });
  const count=h.calls.filter(v=>v==="reset").length;
  h.controller.abort(); wait.resolve(true); await rejection; await Promise.resolve();
  assert.equal(h.calls.filter(v=>v==="reset").length, count); next.commit();
});
test("visual rejection cleans staged resources and never deactivates an enabled scene", async () => {
  const h=rig(); h.scene.root.enabled=true; h.scene.ensureVisualAssets=async()=>{ throw Error("asset failure"); };
  await assert.rejects(h.preparation.prepare(h.args), /asset failure/);
  assert.ok(h.calls.includes("reset")); assert.ok(!h.calls.includes("deactivate"));
});
test("already aborted signal does not bind or clear any scene", async () => {
  const h=rig(); h.controller.abort(); await assert.rejects(h.preparation.prepare(h.args), { name:"AbortError" }); assert.deepEqual(h.calls, []);
});

test('real furniture client binds persisted layout before readiness; committed onChange bind reuses snapshot', async () => {
  const { createFurnitureClient } = await import('../src/rooms/furniture-client.js');
  const account='00000000-0000-4000-8000-000000000001';
  const roomId='00000000-0000-4000-8000-000000000002';
  let calls=0, visibleObjects=null, visualChecks=0;
  const furniture=createFurnitureClient({getUserId:()=>account,getClient:()=>({rpc:async()=>{
    calls++;return {data:{roomId,role:'owner',revision:1,objects:[]}};
  }}),onChange:state=>{visibleObjects=state.objects;}});
  const scene={root:{enabled:false},ensureVisualAssets:async()=>{
    assert.equal(furniture.state().ready,true);assert.deepEqual(visibleObjects,[]);visualChecks++;
  },onDeactivate(){}};
  const service=createPersonalRoomPreparation({getFurniture:()=>furniture,getScene:()=>scene,getUserId:()=>account});
  const lease=await service.prepare({metadata:{personalRoomId:roomId},signal:new AbortController().signal});
  lease.commit();assert.equal(await furniture.bind(roomId),true);
  assert.equal(calls,1);assert.equal(visualChecks,1);
});

test('throwing cleanup callbacks are reported without escaping AbortSignal dispatch',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r});const controller=new AbortController();const errors=[];
  const furniture={bind:()=>pending,state:()=>({ready:true,roomId:'room'}),reset(){throw Error('reset')}};
  const scene={root:{enabled:false},ensureVisualAssets:async()=>{},onDeactivate(){throw Error('deactivate')}};
  const service=createPersonalRoomPreparation({getFurniture:()=>furniture,getScene:()=>scene,getUserId:()=>'account'});
  const result=service.prepare({metadata:{personalRoomId:'room'},signal:controller.signal,onCleanupError:error=>errors.push(error)});
  assert.doesNotThrow(()=>controller.abort());await assert.rejects(result,{name:'AbortError'});
  assert.equal(errors.length,1);assert.equal(errors[0].errors.length,2);resolve(true);
});

test('visual progress is forwarded only for the current valid preparation and shares cancellation signal',async()=>{
 const h=rig(),d=deferred(),events=[];let options;
 h.scene.ensureVisualAssets=value=>{options=value;return d.promise;};
 const result=h.preparation.prepare({...h.args,onProgress:event=>events.push(event)});const failure=assert.rejects(result,{name:'AbortError'});
 await Promise.resolve();await Promise.resolve();assert.strictEqual(options.signal,h.controller.signal);
 const progress={sourceKey:'one@hash',loadedBytes:1,totalBytes:10};options.onProgress(progress);assert.deepEqual(events,[progress]);
 h.controller.abort();options.onProgress({...progress,loadedBytes:2});await failure;assert.equal(events.length,1);d.resolve();
});
