import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPEARANCE_SLOTS, LOADOUT_EQUIP_RPC, LOADOUT_READ_RPC, LOADOUT_STATE, LOADOUT_UNEQUIP_RPC,
  createLoadoutClient, loadoutErrorCode, parseLoadoutSnapshot
} from "../src/appearance/loadout-client.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T = "2026-09-28T07:00:00+00:00";
const worn = (itemId, catalogStatus = "ACTIVE") => ({ itemId, catalogStatus, equippedAt: T });
const read = (over = {}) => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map((slot) => [slot, over[slot] ?? null])) });
const ok = (data) => ({ data, error: null });
const success = (slot, itemId, extra = {}) => ok({ status: "SUCCESS", replayed: false, transactionId: "t", slot, itemId, ...extra });
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function fakeClient() {
  const calls = [];
  const queue = new Map();
  return {
    calls,
    respond(fn, value) { if (!queue.has(fn)) queue.set(fn, []); queue.get(fn).push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.get(fn)?.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      return next instanceof Promise ? next : Promise.resolve(next);
    },
    count: (fn) => calls.filter((c) => c.fn === fn).length
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
let keyCounter = 0;
async function ready(over = {}) {
  const client = fakeClient();
  const loadout = createLoadoutClient({ getClient: () => client, createKey: () => `appearance:k${++keyCounter}` });
  client.respond(LOADOUT_READ_RPC, ok(read(over)));
  await loadout.setAccount(A);
  return { client, loadout };
}

test("parse: the nine appearance slots, empty or worn; anything else rejects the read", () => {
  const fresh = parseLoadoutSnapshot(read());
  assert.deepEqual(Object.keys(fresh.slots), APPEARANCE_SLOTS);
  assert.ok(APPEARANCE_SLOTS.every((slot) => fresh.slots[slot] === null));
  assert.ok(!APPEARANCE_SLOTS.includes("BADGE"));
  const worn2 = parseLoadoutSnapshot(read({ HEAD: worn("head.induck_cap", "COMING_SOON"), TOP: worn("top.inha_basic") }));
  assert.deepEqual(worn2.slots.HEAD, { itemId: "head.induck_cap", catalogStatus: "COMING_SOON", equippedAt: T });
  assert.equal(worn2.slots.TOP.itemId, "top.inha_basic");
  assert.ok(Object.isFrozen(worn2.slots) && Object.isFrozen(worn2.slots.HEAD));
  const missing = read(); delete missing.slots.ACCESSORY;
  const extra = read(); extra.slots.BADGE = null;
  for (const raw of [null, {}, { slots: [] }, missing, extra, read({ HEAD: { itemId: "HEAD", catalogStatus: "ACTIVE" } }),
    read({ HEAD: { itemId: "head.cap" } }), read({ HEAD: "head.cap" }), read({ HEAD: { itemId: "head.cap", catalogStatus: "ACTIVE", equippedAt: 5 } })]) {
    assert.equal(parseLoadoutSnapshot(raw), null, JSON.stringify(raw));
  }
});

test("fresh read → 9 empty slots; HEAD / several slots read as served", async () => {
  const { client, loadout } = await ready();
  assert.equal(loadout.state, LOADOUT_STATE.READY);
  assert.ok(APPEARANCE_SLOTS.every((slot) => loadout.snapshot.slots[slot] === null));
  assert.deepEqual(client.calls, [{ fn: LOADOUT_READ_RPC, args: undefined }]);
  const many = await ready({ HEAD: worn("head.inha_cap"), TOP: worn("top.inha_basic"), BACK: worn("back.freshman_bag") });
  assert.equal(many.loadout.snapshot.slots.HEAD.itemId, "head.inha_cap");
  assert.equal(many.loadout.status().equipped, 3);
});

test("signed-out and guest: zero loadout RPCs, writes refused locally", async () => {
  const client = fakeClient();
  const signedOut = createLoadoutClient({ getClient: () => client });
  assert.equal(await signedOut.refresh("open"), false);
  assert.equal((await signedOut.equip("HEAD", "head.inha_cap")).outcome, "SIGNED_OUT");
  const guest = createLoadoutClient({ getClient: () => null });
  await guest.setAccount(A);
  assert.equal(guest.state, LOADOUT_STATE.SIGNED_OUT);
  assert.equal((await guest.equip("HEAD", "head.inha_cap")).outcome, "SIGNED_OUT");
  assert.equal((await guest.unequip("HEAD")).outcome, "SIGNED_OUT");
  await guest.refresh("purchase");
  assert.equal(client.calls.length, 0);
});

test("RPC error, throw or malformed read → UNAVAILABLE", async () => {
  for (const response of [{ data: null, error: { message: "ACCOUNT_UNAVAILABLE" } }, ok({ slots: {} }), Promise.reject(new Error("net"))]) {
    const client = fakeClient();
    const loadout = createLoadoutClient({ getClient: () => client });
    client.respond(LOADOUT_READ_RPC, response);
    assert.equal(await loadout.setAccount(A), false);
    assert.equal(loadout.state, LOADOUT_STATE.UNAVAILABLE);
    assert.equal(loadout.snapshot, null);
  }
});

test("account switch drops the snapshot at once; a late read of the old account is discarded", async () => {
  const client = fakeClient();
  const loadout = createLoadoutClient({ getClient: () => client });
  const lateA = deferred();
  client.respond(LOADOUT_READ_RPC, lateA.promise);
  void loadout.setAccount(A);
  const bRead = deferred();
  client.respond(LOADOUT_READ_RPC, bRead.promise);
  const switching = loadout.setAccount(B);
  assert.equal(loadout.state, LOADOUT_STATE.LOADING);
  assert.equal(loadout.snapshot, null);
  bRead.resolve(ok(read()));
  await switching;
  lateA.resolve(ok(read({ HEAD: worn("head.inha_cap") })));
  await flush();
  assert.equal(loadout.snapshot.slots.HEAD, null, "A's HEAD never shows under B");
  const lateB = deferred();
  client.respond(LOADOUT_READ_RPC, lateB.promise);
  void loadout.refresh("open");
  await loadout.setAccount(null);
  lateB.resolve(ok(read({ TOP: worn("top.inha_basic") })));
  await flush();
  assert.equal(loadout.state, LOADOUT_STATE.SIGNED_OUT);
  assert.equal(loadout.snapshot, null);
});

test("equip success sends slot + item + key, then re-reads the server loadout (the response is not the state)", async () => {
  const { client, loadout } = await ready();
  client.respond(LOADOUT_EQUIP_RPC, success("HEAD", "head.inha_cap", { loadout: read({ HEAD: worn("head.WRONG") }) }));
  client.respond(LOADOUT_READ_RPC, ok(read({ HEAD: worn("head.inha_cap") })));
  const result = await loadout.equip("HEAD", "head.inha_cap");
  assert.equal(result.outcome, "SUCCESS");
  const call = client.calls.find((c) => c.fn === LOADOUT_EQUIP_RPC);
  assert.equal(call.args.p_slot, "HEAD");
  assert.equal(call.args.p_item_id, "head.inha_cap");
  assert.match(call.args.p_idempotency_key, /^appearance:/);
  assert.equal(client.count(LOADOUT_READ_RPC), 2, "re-read after the write");
  assert.equal(loadout.snapshot.slots.HEAD.itemId, "head.inha_cap", "state comes from the re-read");
});

test("unequip success empties the slot from the re-read", async () => {
  const { client, loadout } = await ready({ HEAD: worn("head.inha_cap") });
  client.respond(LOADOUT_UNEQUIP_RPC, success("HEAD", null));
  client.respond(LOADOUT_READ_RPC, ok(read()));
  assert.equal((await loadout.unequip("HEAD")).outcome, "SUCCESS");
  const call = client.calls.find((c) => c.fn === LOADOUT_UNEQUIP_RPC);
  assert.deepEqual(Object.keys(call.args).sort(), ["p_idempotency_key", "p_slot"]);
  assert.equal(loadout.snapshot.slots.HEAD, null);
});

test("unknown outcome keeps the key for the same intent; a server answer retires it", async () => {
  const { client, loadout } = await ready();
  client.respond(LOADOUT_EQUIP_RPC, Promise.reject(new TypeError("Failed to fetch")));
  const lost = await loadout.equip("HEAD", "head.inha_cap");
  assert.equal(lost.outcome, "FAILED");
  assert.equal(client.count(LOADOUT_READ_RPC), 1, "no re-read after an unknown outcome");
  client.respond(LOADOUT_EQUIP_RPC, success("HEAD", "head.inha_cap", { replayed: true }));
  client.respond(LOADOUT_READ_RPC, ok(read({ HEAD: worn("head.inha_cap") })));
  await loadout.equip("HEAD", "head.inha_cap");
  const keys = client.calls.filter((c) => c.fn === LOADOUT_EQUIP_RPC).map((c) => c.args.p_idempotency_key);
  assert.equal(keys[0], keys[1], "the retry replays with the same key");
  client.respond(LOADOUT_EQUIP_RPC, success("HEAD", "head.inha_cap"));
  client.respond(LOADOUT_READ_RPC, ok(read({ HEAD: worn("head.inha_cap") })));
  await loadout.equip("HEAD", "head.inha_cap");
  const third = client.calls.filter((c) => c.fn === LOADOUT_EQUIP_RPC)[2].args.p_idempotency_key;
  assert.notEqual(third, keys[0], "a new intent after a success gets a new key");
  // A different item in the same slot is a different intent, so it never reuses a key.
  client.respond(LOADOUT_EQUIP_RPC, Promise.reject(new TypeError("Failed to fetch")));
  await loadout.equip("HEAD", "head.induck_cap");
  client.respond(LOADOUT_EQUIP_RPC, success("HEAD", "head.inha_cap"));
  client.respond(LOADOUT_READ_RPC, ok(read()));
  await loadout.equip("HEAD", "head.inha_cap");
  const all = client.calls.filter((c) => c.fn === LOADOUT_EQUIP_RPC).map((c) => c.args.p_idempotency_key);
  assert.notEqual(all[4], all[3]);
});

test("explicit refusal retires the key, maps a stable code and re-reads", async () => {
  const { client, loadout } = await ready();
  client.respond(LOADOUT_EQUIP_RPC, { data: null, error: { message: "ITEM_NOT_OWNED" } });
  client.respond(LOADOUT_READ_RPC, ok(read()));
  const refused = await loadout.equip("TOP", "top.induck_hoodie");
  assert.deepEqual([refused.outcome, refused.code], ["REFUSED", "ITEM_NOT_OWNED"]);
  assert.equal(client.count(LOADOUT_READ_RPC), 2);
  client.respond(LOADOUT_EQUIP_RPC, { data: null, error: { message: "ITEM_NOT_OWNED" } });
  client.respond(LOADOUT_READ_RPC, ok(read()));
  await loadout.equip("TOP", "top.induck_hoodie");
  const keys = client.calls.filter((c) => c.fn === LOADOUT_EQUIP_RPC).map((c) => c.args.p_idempotency_key);
  assert.notEqual(keys[0], keys[1], "a refused key is never replayed");
  assert.equal(loadoutErrorCode({ message: "relation private.world_player_appearance_loadout does not exist" }), "FAILED");
  assert.equal(loadoutErrorCode({ message: "IDEMPOTENCY_CONFLICT" }), "IDEMPOTENCY_CONFLICT");
});

test("one write per slot in flight: a double click sends one request; other slots are independent", async () => {
  const { client, loadout } = await ready();
  const gate = deferred();
  client.respond(LOADOUT_EQUIP_RPC, gate.promise);
  const first = loadout.equip("HEAD", "head.inha_cap");
  assert.equal(loadout.isPending("HEAD"), true);
  const second = await loadout.equip("HEAD", "head.induck_cap");
  assert.deepEqual([second.outcome, second.code], ["FAILED", "BUSY"]);
  assert.equal((await loadout.unequip("HEAD")).code, "BUSY");
  client.respond(LOADOUT_EQUIP_RPC, success("TOP", "top.inha_basic"));
  client.respond(LOADOUT_READ_RPC, ok(read({ TOP: worn("top.inha_basic") })));
  const other = loadout.equip("TOP", "top.inha_basic");
  client.respond(LOADOUT_READ_RPC, ok(read({ HEAD: worn("head.inha_cap"), TOP: worn("top.inha_basic") })));
  gate.resolve(success("HEAD", "head.inha_cap"));
  await Promise.all([first, other]);
  assert.equal(client.count(LOADOUT_EQUIP_RPC), 2, "HEAD once, TOP once");
  assert.equal(loadout.isPending("HEAD"), false);
});

test("a write that lands after an account switch is STALE and never touches the new account's view", async () => {
  const { client, loadout } = await ready();
  const gate = deferred();
  client.respond(LOADOUT_EQUIP_RPC, gate.promise);
  const pending = loadout.equip("HEAD", "head.inha_cap");
  client.respond(LOADOUT_READ_RPC, ok(read()));
  await loadout.setAccount(B);
  gate.resolve(success("HEAD", "head.inha_cap"));
  const result = await pending;
  assert.equal(result.outcome, "STALE");
  assert.equal(loadout.snapshot.slots.HEAD, null, "B's view is untouched");
  assert.equal(loadout.isPending("HEAD"), false, "the switch cleared A's in-flight guard");
});

test("loadout code: three loadout RPCs only, no client creation, no storage, no local equip authority", () => {
  const text = source("../src/appearance/loadout-client.js");
  assert.deepEqual([...text.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]).sort(),
    ["equip_my_world_item_v1", "get_my_world_appearance_loadout_v1", "unequip_my_world_item_v1"]);
  assert.doesNotMatch(text, /createClient\(|localStorage|sessionStorage|indexedDB|get_my_world_inventory/);
  assert.doesNotMatch(text, /snapshot\s*=\s*[^;]*result/, "a write response never becomes the snapshot");
});
