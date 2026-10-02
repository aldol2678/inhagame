import test from "node:test";
import assert from "node:assert/strict";
import { startWorldPopulationHeartbeat, WORLD_HEARTBEAT_MS, WORLD_VISITOR_STORAGE_KEY } from "../src/online/world-population-heartbeat.js";

function harness(snapshot = { placeZoneId:"AREA_MAIN_HALL", space:"campus" }, options = {}) {
  const calls = [];
  let interval = null;
  const client = { rpc(name,args) { calls.push([name,args]); return Promise.resolve({ data:null,error:null }); } };
  const scheduler = {
    setInterval(fn,ms) { interval={fn,ms}; return 7; },
    clearInterval(id) { assert.equal(id,7); interval=null; }
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
  return { hb,calls,scheduler,listeners,visitorStore,get interval(){return interval;} };
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
