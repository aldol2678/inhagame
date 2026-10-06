import test from "node:test";
import assert from "node:assert/strict";
import { startWorldPopulationHeartbeat, WORLD_HEARTBEAT_MS, WORLD_VISITOR_STORAGE_KEY } from "../src/online/world-population-heartbeat.js";

function harness(snapshot = { placeZoneId:"AREA_MAIN_HALL", space:"campus" }, options = {}) {
  const calls = [];
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimer = 0;
  const client = { rpc(name,args) {
    calls.push([name,args]);
    return options.rpc?.(name,args) ?? Promise.resolve({ data:null,error:null });
  } };
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
    visitorStorage, scheduler, windowTarget
  });
  return { hb,calls,scheduler,listeners,visitorStore,intervals,timeouts,get interval(){return [...intervals.values()][0] ?? null;} };
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


test("a never-settling pre-cache request fails closed after 10s without a replacement write", async () => {
  const pending=deferred();
  let signal;
  const h=harness(undefined,{ rpc:()=>({
    abortSignal(value) { signal=value; return this; },
    then(resolve,reject) { return pending.promise.then(resolve,reject); }
  }) });
  await settle();
  assert.equal(h.timeouts.size,1);
  const deadline=[...h.timeouts.values()][0];
  assert.equal(deadline.ms,10_000);
  assert.equal(signal.aborted,false);
  h.listeners.get("pagehide")({ persisted:true });
  const onShow=h.listeners.get("pageshow");
  onShow({ persisted:true });
  h.interval.fn();
  deadline.fn();
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(signal.aborted,true);
  assert.equal(h.hb.status().stopped,true);
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(h.hb.status().lastSentAt,null);
  assert.equal(h.timeouts.size,0);
  assert.equal(h.intervals.size,0);
  assert.equal(h.listeners.size,0);
  onShow({ persisted:true });
  assert.equal(await h.hb.pulse(),false);
  pending.reject(new Error("late network abort"));
  await settle();
  assert.equal(h.calls.length,1,"server cancellation is uncertain: never start a replacement write");
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT");
});

test("a pending request without abortSignal still has a terminal deadline", async () => {
  const h=harness(undefined,{ rpc:()=>new Promise(()=>{}) });
  assert.equal(h.timeouts.size,1);
  [...h.timeouts.values()][0].fn();
  assert.equal(await h.hb.initialPulse,false);
  assert.equal(h.hb.status().stopped,true);
  assert.equal(h.hb.status().lastError,"WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(h.calls.length,1);
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
