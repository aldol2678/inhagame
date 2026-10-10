import test from "node:test";
import assert from "node:assert/strict";
import { startWorldPopulationHeartbeat, WORLD_HEARTBEAT_MS, WORLD_VISITOR_STORAGE_KEY } from "../src/online/world-population-heartbeat.js";

function harness(snapshot = { placeZoneId:"AREA_MAIN_HALL", space:"campus" }, options = {}) {
  const calls = [];
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimer = 0;
  let authCallback = null;
  let authUnsubscribes = 0;
  const client = { rpc(name,args) {
    calls.push([name,args]);
    return options.rpc?.(name,args) ?? Promise.resolve({ data:null,error:null });
  } };
  if (options.auth) {
    client.auth = { onAuthStateChange(callback) {
      authCallback = callback;
      return { data:{ subscription:{ unsubscribe(){ authUnsubscribes++; authCallback = null; } } } };
    } };
  }
  const scheduler = {
    setInterval(fn,ms) { const id=++nextTimer; intervals.set(id,{fn,ms}); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn,ms) { const id=++nextTimer; timeouts.set(id,{fn,ms}); return id; },
    clearTimeout(id) { timeouts.delete(id); }
  };
  const listeners = new Map();
  const visitorStore = new Map([[WORLD_VISITOR_STORAGE_KEY, options.visitorId || "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]]);
  const visitorStorage = {
    getItem(key){ return visitorStore.get(key) ?? null; },
    setItem(key,value){ visitorStore.set(key,value); }
  };
  const windowTarget = {
    addEventListener(type,fn){ listeners.set(type,fn); },
    removeEventListener(type,fn){ if(listeners.get(type)===fn) listeners.delete(type); }
  };
  const hb = startWorldPopulationHeartbeat({
    client, getSnapshot:()=>snapshot, randomId:options.randomId || (()=> "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    visitorStorage, scheduler, windowTarget, onRevoked:options.onRevoked, ...(options.start ?? {})
  });
  return { hb,calls,scheduler,listeners,visitorStore,intervals,timeouts,
    emitAuth(event,uid){ authCallback?.(event, uid ? { user:{ id:uid } } : null); },
    get authUnsubscribes(){ return authUnsubscribes; },
    get authSubscribed(){ return authCallback !== null; },
    get interval(){return [...intervals.values()][0] ?? null;} };
}

test("heartbeat sends an immediate world session and repeats every 20s", async () => {
  const h=harness();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(WORLD_HEARTBEAT_MS,20000);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0][0],"touch_world_online_session_v2");
  assert.deepEqual(h.calls[0][1],{
    p_session_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    p_visitor_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    p_place_zone_id:"AREA_MAIN_HALL",
    p_space:"campus"
  });
  assert.equal(h.hb.visitorId,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(h.interval.ms,20000);
  h.interval.fn();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.calls.length,2);
  h.hb.stop();
});

test("invalid zone is suppressed and room state is preserved", async () => {
  const h=harness({ placeZoneId:"RC_0_0", space:"club_room" });
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.calls[0][1].p_place_zone_id,null);
  assert.equal(h.calls[0][1].p_space,"club_room");
  h.hb.stop();
});

test("pagehide stops local heartbeat; server expiry handles cleanup", async () => {
  const h=harness();
  await new Promise(resolve=>setTimeout(resolve,0));
  const before=h.calls.length;
  h.listeners.get("pagehide")();
  assert.equal(h.hb.status().stopped,true);
  assert.equal(h.interval,null);
  assert.equal(h.calls.length,before,"no destructive end RPC is exposed");
});


test("housing lobby and personal room keep distinct heartbeat spaces", async () => {
  for (const space of ["housing_lobby","personal_room"]) {
    const h=harness({ placeZoneId:null, space });
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.calls[0][1].p_place_zone_id,null);
    assert.equal(h.calls[0][1].p_space,space);
    h.hb.stop();
  }
});


test("heartbeat creates and persists a shared Hub/World visitor id when missing", async () => {
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  ];
  const h = harness(undefined, {
    visitorId: null,
    randomId: () => ids.shift()
  });
  h.visitorStore.delete(WORLD_VISITOR_STORAGE_KEY);
  // Recreate with an actually empty store because harness construction already starts the heartbeat.
  h.hb.stop();

  const calls = [];
  const store = new Map();
  const visitorStorage = {
    getItem(key){ return store.get(key) ?? null; },
    setItem(key,value){ store.set(key,value); }
  };
  const created = startWorldPopulationHeartbeat({
    client:{rpc(name,args){calls.push([name,args]);return Promise.resolve({data:null,error:null});}},
    randomId:(() => {
      const queue=["dddddddd-dddd-4ddd-8ddd-dddddddddddd","eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
      return () => queue.shift();
    })(),
    visitorStorage,
    scheduler:{setInterval(){return 1;},clearInterval(){}},
    windowTarget:{addEventListener(){},removeEventListener(){}}
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store.get(WORLD_VISITOR_STORAGE_KEY),"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  assert.equal(created.visitorId,"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  assert.equal(calls[0][1].p_visitor_id,"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  created.stop();
});


const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve=yes; reject=no; });
  return { promise, resolve, reject };
}

test("persisted pagehide pauses without permanently stopping or sending cleanup", async () => {
  const h=harness();
  await h.hb.initialPulse;
  const queuedTick=h.interval.fn;
  const lastSentAt=h.hb.status().lastSentAt;
  h.listeners.get("pagehide")({ persisted:true });
  assert.equal(h.hb.status().stopped,false);
  assert.equal(h.hb.status().paused,true);
  assert.equal(h.interval,null);
  queuedTick();
  assert.equal(await h.hb.pulse(),false);
  await settle();
  assert.equal(h.calls.length,1);
  assert.equal(h.hb.status().lastSentAt,lastSentAt);
  h.hb.stop();
});

test("persisted pageshow immediately refreshes the same session and resumes one 20s interval", async () => {
  const snapshot={ placeZoneId:"AREA_MAIN_HALL", space:"campus" };
  const h=harness(snapshot);
  await h.hb.initialPulse;
  const { sessionId, visitorId }=h.hb;
  const onShow=h.listeners.get("pageshow");
  assert.equal(typeof onShow,"function");
  onShow({ persisted:true }); // A show without a matching suspension is a no-op.
  assert.equal(h.calls.length,1);
  for (let round=0; round<3; round++) {
    h.listeners.get("pagehide")({ persisted:true });
    h.listeners.get("pagehide")({ persisted:true });
    snapshot.space="personal_room";
    snapshot.placeZoneId=null;
    onShow({ persisted:false });
    assert.equal(h.interval,null);
    const before=h.calls.length;
    onShow({ persisted:true });
    onShow({ persisted:true });
    await settle();
    assert.equal(h.calls.length,before+1,"one immediate restore heartbeat");
    assert.equal(h.hb.status().paused,false);
    assert.equal(h.hb.status().stopped,false);
    assert.equal(h.intervals.size,1);
    assert.equal(h.interval.ms,20_000);
    assert.deepEqual(h.calls.at(-1),["touch_world_online_session_v2",{
      p_session_id:sessionId, p_visitor_id:visitorId, p_place_zone_id:null, p_space:"personal_room"
    }]);
    h.interval.fn();
    await settle();
    assert.equal(h.calls.length,before+2,"the normal poll continues after restore");
  }
  h.hb.stop();
});

test("permanent stop removes both lifecycle listeners and cannot be resumed", async () => {
  for (const reason of ["explicit", "unload", "stop-while-paused"]) {
    const h=harness();
    await h.hb.initialPulse;
    const onHide=h.listeners.get("pagehide");
    const onShow=h.listeners.get("pageshow");
    assert.equal(typeof onShow,"function");
    if (reason==="stop-while-paused") onHide({ persisted:true });
    if (reason==="unload") onHide({ persisted:false });
    else h.hb.stop();
    h.hb.stop();
    onShow({ persisted:true });
    onHide({ persisted:true });
    assert.equal(await h.hb.pulse(),false);
    assert.equal(h.hb.status().stopped,true);
    assert.equal(h.interval,null);
    assert.equal(h.listeners.size,0);
    assert.equal(h.calls.length,1);
  }
});

test("pending pre-cache writes settle before one fresh restore write uses current client identity", async () => {
  const pending=deferred();
  const fresh=deferred();
  const identities=[];
  let identity="old-account";
  const h=harness(undefined,{ rpc() {
    identities.push(identity);
    return identities.length===1 ? pending.promise : fresh.promise;
  } });
  h.interval.fn();
  h.hb.pulse();
  await settle();
  assert.deepEqual(identities,["old-account"],"ordinary ticks do not overlap a pending write");
  h.listeners.get("pagehide")({ persisted:true });
  identity="guest"; // Represents auth changing while this document is cached.
  h.listeners.get("pageshow")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  h.interval.fn();
  assert.equal(h.calls.length,1,"restore must not race the previous auth-derived write");
  pending.resolve({ error:null });
  assert.equal(await h.hb.initialPulse,false,"pre-cache completion cannot publish current status");
  await settle();
  assert.deepEqual(identities,["old-account","guest"]);
  assert.equal(h.hb.status().lastSentAt,null);
  assert.equal(h.hb.status().lastError,null);
  assert.equal(h.intervals.size,1);
  fresh.resolve({ error:null });
  await settle();
  assert.equal(typeof h.hb.status().lastSentAt,"number");
  assert.equal(h.calls.length,2);
  h.hb.stop();
});

test("late failures from a suspended generation cannot overwrite a fresh restore status", async () => {
  const pending=deferred();
  let count=0;
  const h=harness(undefined,{ rpc() {
    return ++count===1 ? pending.promise : Promise.resolve({ error:null });
  } });
  h.listeners.get("pagehide")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  pending.reject(new Error("stale transport failure"));
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(h.calls.length,2);
  assert.equal(h.hb.status().lastError,null);
  assert.equal(typeof h.hb.status().lastSentAt,"number");
  h.hb.stop();
});

test("a second suspension cancels a queued restore until the next persisted show", async () => {
  const pending=deferred();
  let count=0;
  const h=harness(undefined,{ rpc() {
    return ++count===1 ? pending.promise : Promise.resolve({ error:null });
  } });
  h.listeners.get("pagehide")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  h.listeners.get("pagehide")({ persisted:true });
  pending.resolve({ error:null });
  await h.hb.initialPulse;
  await settle();
  assert.equal(h.calls.length,1);
  assert.equal(h.hb.status().lastSentAt,null);
  h.listeners.get("pageshow")({ persisted:true });
  await settle();
  assert.equal(h.calls.length,2);
  assert.equal(h.intervals.size,1);
  h.hb.stop();
});

test("explicit stop drops a pending restore and ignores late completion", async () => {
  const pending=deferred();
  const h=harness(undefined,{ rpc:()=>pending.promise });
  h.listeners.get("pagehide")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  h.hb.stop();
  pending.resolve({ error:{ message:"stale response" } });
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(h.calls.length,1);
  assert.equal(h.hb.status().lastError,null);
  assert.equal(h.hb.status().lastSentAt,null);
  assert.equal(h.listeners.size,0);
});

test("transport rejection is best effort and the next heartbeat can recover", async () => {
  let count=0;
  const h=harness(undefined,{ rpc() {
    if (++count===1) throw new Error("synthetic offline");
    return Promise.resolve({ error:null });
  } });
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(h.hb.status().lastError,"synthetic offline");
  assert.equal(await h.hb.pulse(),true);
  assert.equal(h.hb.status().lastError,null);
  h.hb.stop();
});


test("a queued tick from before suspension cannot duplicate the restored heartbeat", async () => {
  const h=harness();
  await h.hb.initialPulse;
  const staleTick=h.interval.fn;
  h.listeners.get("pagehide")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  await settle();
  assert.equal(h.calls.length,2);
  staleTick();
  await settle();
  assert.equal(h.calls.length,2);
  assert.equal(h.intervals.size,1);
  h.hb.stop();
});


test("a never-settling request times out after 10s without ending the heartbeat", async () => {
  // Contract change (session-kick hardening): timeout used to stop the heartbeat for good, which silently
  // removed a live player from the roster. The server now serializes per account and owns the session
  // UUID, so abandoning the slow request and trying again is safe.
  const pending=deferred();
  let signal;
  let count=0;
  const h=harness(undefined,{ rpc:()=>++count===1 ? ({
    abortSignal(value) { signal=value; return this; },
    then(resolve,reject) { return pending.promise.then(resolve,reject); }
  }) : Promise.resolve({ error:null }) });
  await settle();
  assert.equal(h.timeouts.size,1);
  const deadline=[...h.timeouts.values()][0];
  assert.equal(deadline.ms,10_000);
  assert.equal(signal.aborted,false);
  deadline.fn();
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(signal.aborted,true,"the abandoned request is aborted");
  assert.equal(h.hb.status().stopped,false,"timeout is recoverable, not terminal");
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(h.hb.status().consecutiveFailures,1);
  assert.equal(h.timeouts.size,0);
  assert.equal(h.intervals.size,1,"the 20s cadence keeps running");
  pending.reject(new Error("late network abort"));
  await settle();
  assert.equal(h.calls.length,1,"the abandoned request never triggers a duplicate write by itself");
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT","a late transport error cannot overwrite the timeout status");
  h.interval.fn();
  await settle();
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[1][1].p_session_id,h.calls[0][1].p_session_id,"same session UUID continues");
  assert.equal(h.hb.status().lastError,null);
  assert.equal(h.hb.status().consecutiveFailures,0);
  assert.equal(typeof h.hb.status().lastSentAt,"number");
  h.hb.stop();
});

test("a pending request without abortSignal still has a deadline and the next tick recovers", async () => {
  let count=0;
  const h=harness(undefined,{ rpc:()=>++count===1 ? new Promise(()=>{}) : Promise.resolve({ error:null }) });
  assert.equal(h.timeouts.size,1);
  [...h.timeouts.values()][0].fn();
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(h.hb.status().stopped,false);
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(await h.hb.pulse(),true);
  assert.equal(h.calls.length,2);
  h.hb.stop();
});

test("a pre-cache request that times out after a persisted restore is replaced by one fresh write", async () => {
  const pending=deferred();
  let count=0;
  const h=harness(undefined,{ rpc:()=>++count===1 ? pending.promise : Promise.resolve({ error:null }) });
  const deadline=[...h.timeouts.values()][0];
  h.listeners.get("pagehide")({ persisted:true });
  h.listeners.get("pageshow")({ persisted:true });
  h.interval.fn();
  assert.equal(h.calls.length,1,"restore waits for the pending write");
  deadline.fn();
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(h.calls.length,2,"exactly one replacement write");
  assert.equal(h.hb.status().lastError,null,"a superseded timeout cannot overwrite the fresh status");
  assert.equal(h.hb.status().stopped,false);
  h.hb.stop();
});

test("explicit stop clears a request deadline and settles its pending pulse", async () => {
  const pending=deferred();
  const h=harness(undefined,{ rpc:()=>pending.promise });
  assert.equal(h.timeouts.size,1);
  const staleDeadline=[...h.timeouts.values()][0].fn;
  h.hb.stop();
  assert.equal(h.timeouts.size,0);
  assert.equal(await h.hb.initialPulse,false);
  staleDeadline();
  pending.resolve({ error:null });
  await settle();
  assert.equal(h.hb.status().lastError,null);
  assert.equal(h.hb.status().lastSentAt,null);
  assert.equal(h.calls.length,1);
});

test("completed requests clear their deadlines and ignore queued deadline callbacks", async () => {
  const h=harness();
  assert.equal(h.timeouts.size,1);
  const staleDeadline=[...h.timeouts.values()][0].fn;
  await h.hb.initialPulse;
  assert.equal(h.timeouts.size,0);
  staleDeadline();
  assert.equal(h.hb.status().stopped,false);
  assert.equal(h.hb.status().lastError,null);
  assert.equal(await h.hb.pulse(),true);
  assert.equal(h.timeouts.size,0);
  h.hb.stop();
});

test("operator ejection stops the heartbeat and invokes disconnect exactly once", async () => {
  let revocations = 0;
  const h = harness(undefined, {
    onRevoked: () => { revocations += 1; },
    rpc: () => Promise.resolve({ data:null, error:{ code:"42501", message:"WORLD_SESSION_REVOKED" } })
  });
  assert.equal(await h.hb.initialPulse, false);
  assert.equal(revocations, 1);
  assert.equal(h.hb.status().stopped, true);
  assert.equal(h.hb.status().lastError, "WORLD_SESSION_REVOKED");
  assert.equal(h.intervals.size, 0);
  assert.equal(await h.hb.pulse(), false);
  assert.equal(revocations, 1);
  assert.equal(h.calls.length, 1);
});


const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const idQueue = (...ids) => { const queue=[...ids]; return () => queue.shift(); };
// First id is the heartbeat session, second is the visitor id (already persisted by the harness), then rotations.
const rotating = (...rotations) => idQueue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...rotations);

test("a late revocation after a timeout still ends the heartbeat once for the same account", async () => {
  const pending=deferred();
  let revocations=0;
  const h=harness(undefined,{ onRevoked:()=>{ revocations++; }, rpc:()=>({
    abortSignal() { return this; },
    then(resolve,reject) { return pending.promise.then(resolve,reject); }
  }) });
  [...h.timeouts.values()][0].fn();
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(h.hb.status().stopped,false);
  pending.resolve({ error:{ code:"42501", message:"WORLD_SESSION_REVOKED" } });
  await settle();
  assert.equal(revocations,1);
  assert.equal(h.hb.status().stopped,true);
  assert.equal(h.hb.status().revoked,true);
  assert.equal(h.hb.status().lastError,"WORLD_SESSION_REVOKED");
  assert.equal(h.intervals.size,0);
  assert.equal(h.listeners.size,0);
});

test("a revocation that arrives while the page is cached still ends the heartbeat", async () => {
  const pending=deferred();
  let revocations=0;
  const h=harness(undefined,{ onRevoked:()=>{ revocations++; }, rpc:()=>pending.promise });
  h.listeners.get("pagehide")({ persisted:true });
  pending.resolve({ error:{ message:"WORLD_SESSION_REVOKED" } });
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(revocations,1);
  assert.equal(h.hb.status().stopped,true);
  h.listeners.get("pageshow")?.({ persisted:true });
  assert.equal(await h.hb.pulse(),false);
  assert.equal(h.calls.length,1);
});

test("a revocation answer for the previous account is ignored after an account switch", async () => {
  const oldAccount=deferred();
  let count=0;
  let revocations=0;
  const h=harness(undefined,{ auth:true, randomId:rotating(UUID_A), onRevoked:()=>{ revocations++; },
    rpc:()=>++count===1 ? oldAccount.promise : Promise.resolve({ error:null }) });
  h.emitAuth("INITIAL_SESSION","user-old");
  h.emitAuth("SIGNED_IN","user-new");
  oldAccount.resolve({ error:{ message:"WORLD_SESSION_REVOKED" } });
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(revocations,0,"revocation belongs to the previous account only");
  assert.equal(h.hb.status().stopped,false);
  assert.equal(h.calls.length,2);
  assert.equal(h.hb.status().lastError,null);
  h.hb.stop();
});

test("an account switch takes a new session UUID, aborts the old request and writes once", async () => {
  const oldRequest=deferred();
  let count=0;
  let aborted=false;
  const h=harness(undefined,{ auth:true, randomId:rotating(UUID_A),
    rpc:()=>++count===1 ? ({
      abortSignal(signal) { signal.addEventListener("abort",()=>{ aborted=true; }); return this; },
      then(resolve,reject) { return oldRequest.promise.then(resolve,reject); }
    }) : Promise.resolve({ error:null }) });
  const firstId=h.calls[0][1].p_session_id;
  h.emitAuth("INITIAL_SESSION","user-a");
  assert.equal(h.calls.length,1,"learning the first identity does not rotate");
  h.emitAuth("TOKEN_REFRESHED","user-a");
  assert.equal(h.calls.length,1,"token refresh for the same account does not rotate");
  h.emitAuth("SIGNED_IN","user-b");
  assert.equal(aborted,true,"the request that carried account A is abandoned");
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(h.calls.length,2,"exactly one write for account B");
  assert.equal(h.calls[1][1].p_session_id,UUID_A);
  assert.notEqual(h.calls[1][1].p_session_id,firstId);
  assert.equal(h.hb.sessionId,UUID_A);
  assert.equal(h.hb.status().sessionId,UUID_A);
  oldRequest.resolve({ error:{ message:"stale failure for account A" } });
  await settle();
  assert.equal(h.hb.status().lastError,null,"late result of the previous identity is dropped");
  assert.equal(typeof h.hb.status().lastSentAt,"number");
  h.hb.stop();
});

test("signing out also rotates the session UUID so a guest never downgrades a member row", async () => {
  const h=harness(undefined,{ auth:true, randomId:rotating(UUID_A) });
  await h.hb.initialPulse;
  h.emitAuth("INITIAL_SESSION","user-a");
  h.emitAuth("SIGNED_OUT",null);
  await settle();
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[1][1].p_session_id,UUID_A);
  h.hb.stop();
});

test("owner mismatch from the server rotates the UUID, retries once, and never stops the heartbeat", async () => {
  let count=0;
  const h=harness(undefined,{ randomId:rotating(UUID_A,UUID_B),
    rpc:()=>++count<=2 ? Promise.resolve({ error:{ code:"42501", message:"WORLD_SESSION_OWNER_MISMATCH" } })
      : Promise.resolve({ error:null }) });
  assert.equal(await h.hb.initialPulse,false);
  await settle();
  assert.equal(h.calls.length,2,"one immediate retry with a fresh UUID");
  assert.equal(h.calls[1][1].p_session_id,UUID_A);
  await settle();
  assert.equal(h.calls.length,2,"a second mismatch does not loop");
  assert.equal(h.hb.status().stopped,false);
  assert.equal(h.hb.status().lastError,"WORLD_SESSION_OWNER_MISMATCH");
  h.interval.fn();
  await settle();
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[2][1].p_session_id,UUID_B);
  assert.equal(h.hb.status().lastError,null);
  h.hb.stop();
});

test("revocation is terminal: later auth events cannot resume the heartbeat, and stop() unsubscribes", async () => {
  let revocations=0;
  const h=harness(undefined,{ auth:true, randomId:rotating(UUID_A), onRevoked:()=>{ revocations++; },
    rpc:()=>Promise.resolve({ error:{ message:"WORLD_SESSION_REVOKED" } }) });
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(revocations,1);
  assert.equal(h.authSubscribed,false);
  assert.equal(h.authUnsubscribes,1);
  h.emitAuth("SIGNED_IN","user-b");
  assert.equal(await h.hb.pulse(),false);
  assert.equal(h.calls.length,1);
  const live=harness(undefined,{ auth:true });
  assert.equal(live.authSubscribed,true);
  live.hb.stop();
  assert.equal(live.authUnsubscribes,1);
  assert.equal(live.authSubscribed,false);
});

test("heartbeats work with a client that has no auth API", async () => {
  const h=harness();
  assert.equal(await h.hb.initialPulse,true);
  h.hb.stop();
});

// ---- thenable request builders -----------------------------------------------------------------
// @supabase/postgrest-js' PostgrestBuilder is a thenable whose then() sends a NEW HTTP request every
// time it is called (verified against postgrest-js 1.21.4: then() calls fetch() unconditionally).
// This double keeps those semantics: `executions` is the number of HTTP requests that would be sent.
function builderDouble(outcome) {
  const builder = {
    executions: 0,
    aborted: false,
    abortSignal(signal) { signal.addEventListener("abort", () => { builder.aborted = true; }); return builder; },
    then(resolve, reject) {
      builder.executions += 1;
      return Promise.resolve(outcome()).then(resolve, reject);
    }
  };
  return builder;
}

test("one heartbeat pulse sends exactly one HTTP request for a thenable query builder", async () => {
  const builders = [];
  const h = harness(undefined, { rpc: () => {
    const builder = builderDouble(() => ({ error: null }));
    builders.push(builder);
    return builder;
  } });
  assert.equal(await h.hb.initialPulse, true);
  await settle();
  assert.equal(builders.length, 1);
  assert.equal(builders[0].executions, 1, "Promise.resolve() and Promise.race() must share one execution");
  assert.equal(await h.hb.pulse(), true);
  assert.deepEqual(builders.map(builder => builder.executions), [1, 1]);
  h.hb.stop();
});

test("a timed-out thenable request was still executed once, aborted once, and never replayed", async () => {
  const never = new Promise(() => {});
  const builders = [];
  const h = harness(undefined, { rpc: () => {
    const builder = builderDouble(() => never);
    builders.push(builder);
    return builder;
  } });
  [...h.timeouts.values()][0].fn();
  assert.equal(await h.hb.initialPulse, false);
  await settle();
  assert.equal(builders[0].executions, 1);
  assert.equal(builders[0].aborted, true);
  h.hb.stop();
});

test("a revoked thenable response is observed without a second execution", async () => {
  let builder;
  const h = harness(undefined, { rpc: () => {
    builder = builderDouble(() => ({ error: { code: "42501", message: "WORLD_SESSION_REVOKED" } }));
    return builder;
  } });
  assert.equal(await h.hb.initialPulse, false);
  await settle();
  assert.equal(builder.executions, 1);
  assert.equal(h.hb.status().revoked, true);
});


// ---- allowed-state grace contract ---------------------------------------------------------------
const GRACE = 60_000;
const graceTimer = h => [...h.timeouts.values()].find(timer => timer.ms === GRACE) ?? null;
// A real timer disappears once it fires; the fake scheduler keeps it, so remove it explicitly.
function fireGrace(h) {
  const entry = [...h.timeouts.entries()].find(([, timer]) => timer.ms === GRACE);
  assert.ok(entry, "a grace timer is pending");
  h.timeouts.delete(entry[0]);
  entry[1].fn();
}
function graceHarness(extra = {}) {
  const events = [];
  const h = harness(undefined, { auth:true, randomId:rotating(UUID_A,UUID_B), ...extra, start:{
    onUnverified:info => { events.push(["unverified", info.lastError]); },
    onVerified:() => { events.push(["verified"]); },
    ...(extra.start ?? {})
  } });
  return { h, events };
}

test("without grace callbacks the heartbeat arms no grace timer (existing contract unchanged)", async () => {
  const h = harness();
  await h.hb.initialPulse;
  assert.equal(graceTimer(h), null);
  assert.equal(h.hb.status().unverified, false);
  h.hb.stop();
});

test("a successful heartbeat keeps re-arming the grace window", async () => {
  const { h, events } = graceHarness();
  await h.hb.initialPulse;
  const first = graceTimer(h);
  assert.ok(first, "grace window is armed after the first proof");
  await h.hb.pulse();
  const second = graceTimer(h);
  assert.notEqual(second, first, "each proof replaces the previous window");
  assert.equal(h.timeouts.size, 1, "exactly one grace timer is pending");
  assert.deepEqual(events, []);
  h.hb.stop();
  assert.equal(h.timeouts.size, 0, "stop clears the grace timer");
});

test("no proof for the grace window fires onUnverified once; the next proof fires onVerified once", async () => {
  let fail = false;
  const { h, events } = graceHarness({ rpc:() => fail ? Promise.resolve({ error:{ message:"network down" } }) : Promise.resolve({ error:null }) });
  h.emitAuth("INITIAL_SESSION", "user-a");
  await h.hb.initialPulse;
  fail = true;
  await h.hb.pulse();
  await h.hb.pulse();
  fireGrace(h);
  assert.deepEqual(events, [["unverified", "network down"]]);
  assert.equal(h.hb.status().unverified, true);
  assert.equal(h.hb.status().stopped, false, "unverified is not terminal");
  await h.hb.pulse();
  if (graceTimer(h)) fireGrace(h);
  assert.equal(events.length, 1, "no repeated onUnverified while still unproven");
  fail = false;
  assert.equal(await h.hb.pulse(), true);
  assert.deepEqual(events, [["unverified", "network down"], ["verified"]]);
  assert.equal(h.hb.status().unverified, false);
  assert.ok(graceTimer(h), "a fresh window is armed after recovery");
  h.hb.stop();
});

test("recoverable timeouts still end in unverified once the grace window passes", async () => {
  const { h, events } = graceHarness({ rpc:() => new Promise(() => {}) });
  h.emitAuth("INITIAL_SESSION", "user-a");
  [...h.timeouts.values()].find(timer => timer.ms === 10_000).fn();
  assert.equal(await h.hb.initialPulse, false);
  assert.equal(h.hb.status().lastError, "WORLD_HEARTBEAT_TIMEOUT");
  fireGrace(h);
  assert.deepEqual(events, [["unverified", "WORLD_HEARTBEAT_TIMEOUT"]]);
  h.hb.stop();
});

test("a signed-out visitor is never held back by the grace window", async () => {
  const { h, events } = graceHarness({ rpc:() => Promise.resolve({ error:{ message:"network down" } }) });
  h.emitAuth("INITIAL_SESSION", null);
  await h.hb.initialPulse;
  fireGrace(h);
  assert.deepEqual(events, []);
  assert.ok(graceTimer(h), "the window is simply re-armed");
  h.hb.stop();
});

test("revocation after unverified is still terminal and never reports verified", async () => {
  let answer = { error:{ message:"network down" } };
  let revocations = 0;
  const { h, events } = graceHarness({ rpc:() => Promise.resolve(answer), onRevoked:() => { revocations++; } });
  h.emitAuth("INITIAL_SESSION", "user-a");
  await h.hb.initialPulse;
  fireGrace(h);
  answer = { error:{ message:"WORLD_SESSION_REVOKED" } };
  await h.hb.pulse();
  assert.equal(revocations, 1);
  assert.equal(h.hb.status().stopped, true);
  assert.equal(h.timeouts.size, 0, "grace timer cleared by the terminal stop");
  assert.deepEqual(events, [["unverified", "network down"]]);
});

test("a cached page gets a fresh grace window on restore; none while cached", async () => {
  const { h } = graceHarness();
  await h.hb.initialPulse;
  const armed = graceTimer(h);
  h.listeners.get("pagehide")({ persisted:true });
  assert.equal(graceTimer(h), null, "no window runs while the page is cached");
  h.listeners.get("pageshow")({ persisted:true });
  assert.ok(graceTimer(h));
  assert.ok(armed);
  h.hb.stop();
});

test("an account switch starts a new grace window for the new account", async () => {
  const { h } = graceHarness();
  h.emitAuth("INITIAL_SESSION", "user-a");
  await h.hb.initialPulse;
  const before = graceTimer(h);
  h.emitAuth("SIGNED_IN", "user-b");
  await settle();
  assert.equal(h.timeouts.size >= 1, true);
  assert.ok(graceTimer(h));
  assert.notEqual(graceTimer(h), before);
  h.hb.stop();
});
