import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INVENTORY_RPC, INVENTORY_STATE, createInventoryClient, parseInventoryItem, parseInventorySnapshot
} from "../src/inventory/inventory-client.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = (itemId, extra = {}) => ({
  itemId, quantity: 1, acquiredAt: "2026-09-28T01:00:00+00:00", updatedAt: "2026-09-28T01:00:00+00:00",
  sourceType: "SHOP", sourceRef: "shop.student_center:offer", eventId: null, catalogStatus: "ACTIVE", ...extra
});
const inv = (...items) => ({ items });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function fakeClient() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      return next instanceof Promise ? next : Promise.resolve(next);
    }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("parse: empty, one and several items; server order kept; quantity as served", () => {
  assert.deepEqual(parseInventorySnapshot(inv()), { items: [] });
  const one = parseInventorySnapshot(inv(row("head.induck_cap")));
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].quantity, 1);
  const many = parseInventorySnapshot(inv(row("memorabilia.campus_mug", { quantity: 3 }), row("head.induck_cap"),
    row("badge.main_gate", { sourceType: "EVENT", eventId: "event.mcm_2026" })));
  assert.deepEqual(many.items.map((i) => i.itemId), ["memorabilia.campus_mug", "head.induck_cap", "badge.main_gate"],
    "most-recent-first order from the server is never re-sorted");
  assert.equal(many.items[0].quantity, 3);
  assert.equal(many.items[2].eventId, "event.mcm_2026");
  assert.ok(Object.isFrozen(many.items) && Object.isFrozen(many.items[0]));
});

test("parse: items the local catalog does not know and non-ACTIVE statuses are kept", () => {
  const snapshot = parseInventorySnapshot(inv(
    row("head.future_hat", { catalogStatus: "UNKNOWN_ITEM" }),
    row("badge.main_gate", { catalogStatus: "COMING_SOON" }),
    row("top.old_shirt", { catalogStatus: "DISABLED" }),
    row("back.secret_bag", { catalogStatus: "HIDDEN" }),
    row("head.locked_cap", { catalogStatus: "LOCKED" })
  ));
  assert.deepEqual(snapshot.items.map((i) => i.catalogStatus), ["UNKNOWN_ITEM", "COMING_SOON", "DISABLED", "HIDDEN", "LOCKED"]);
});

test("parse: malformed or duplicate rows reject the whole read (no partial / doubled ownership)", () => {
  for (const raw of [null, "x", {}, { items: {} }, inv(null), inv(row("Bad Id")), inv(row("head.cap", { quantity: 0 })),
    inv(row("head.cap", { quantity: 1.5 })), inv(row("head.cap", { quantity: "1" })), inv(row("head.cap", { acquiredAt: null })),
    inv(row("head.cap", { sourceType: "" })), inv(row("head.cap", { catalogStatus: null })),
    inv(row("head.cap"), row("head.cap"))]) {
    assert.equal(parseInventorySnapshot(raw), null, JSON.stringify(raw));
  }
  assert.equal(parseInventoryItem(row("head.cap", { updatedAt: undefined })).updatedAt, null);
});

test("member account: one no-argument read → READY", async () => {
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => client });
  client.respond({ data: inv(row("head.induck_cap")), error: null });
  assert.equal(await inventory.setAccount(A), true);
  assert.equal(inventory.state, INVENTORY_STATE.READY);
  assert.deepEqual(client.calls, [{ fn: INVENTORY_RPC, args: undefined }]);
});

test("signed-out and guest: zero inventory RPCs", async () => {
  const client = fakeClient();
  const signedOut = createInventoryClient({ getClient: () => client });
  assert.equal(await signedOut.refresh("open"), false);
  assert.equal(await signedOut.setAccount(null), false);
  const guest = createInventoryClient({ getClient: () => null });
  await guest.setAccount(A);
  await guest.refresh("purchase");
  await guest.refresh("reward");
  assert.equal(guest.state, INVENTORY_STATE.SIGNED_OUT);
  assert.equal(guest.snapshot, null);
  assert.equal(client.calls.length, 0);
});

test("RPC error, throw or malformed data → UNAVAILABLE", async () => {
  for (const response of [{ data: null, error: { message: "ACCOUNT_UNAVAILABLE" } }, { data: { items: "x" }, error: null },
    Promise.reject(new Error("network"))]) {
    const client = fakeClient();
    const inventory = createInventoryClient({ getClient: () => client });
    client.respond(response);
    assert.equal(await inventory.setAccount(A), false);
    assert.equal(inventory.state, INVENTORY_STATE.UNAVAILABLE);
    assert.equal(inventory.snapshot, null);
  }
});

test("account switch drops the previous account's items immediately", async () => {
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => client });
  const changes = [];
  inventory.onChange((c) => changes.push([c.state, c.accountId, c.snapshot?.items.length ?? null]));
  client.respond({ data: inv(row("head.induck_cap"), row("memorabilia.campus_mug")), error: null });
  await inventory.setAccount(A);
  const pending = deferred();
  client.respond(pending.promise);
  const switching = inventory.setAccount(B);
  assert.equal(inventory.state, INVENTORY_STATE.LOADING);
  assert.equal(inventory.snapshot, null, "A's items are gone before B's read returns");
  pending.resolve({ data: inv(), error: null });
  await switching;
  assert.deepEqual(changes, [["LOADING", A, null], ["READY", A, 2], ["LOADING", B, null], ["READY", B, 0]]);
});

test("stale response: A's late read after switching to B or signing out is discarded", async () => {
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => client });
  const lateA = deferred();
  client.respond(lateA.promise);
  void inventory.setAccount(A);
  client.respond({ data: inv(row("badge.main_gate")), error: null });
  await inventory.setAccount(B);
  lateA.resolve({ data: inv(row("head.induck_cap"), row("memorabilia.campus_mug")), error: null });
  await flush(); await flush();
  assert.deepEqual(inventory.snapshot.items.map((i) => i.itemId), ["badge.main_gate"]);

  const lateB = deferred();
  client.respond(lateB.promise);
  void inventory.refresh("purchase");
  await inventory.setAccount(null);
  lateB.resolve({ data: inv(row("head.induck_cap")), error: null });
  await flush(); await flush();
  assert.equal(inventory.state, INVENTORY_STATE.SIGNED_OUT);
  assert.equal(inventory.snapshot, null);
});

test("refreshes coalesce to one in flight plus one follow-up; the newest server answer wins", async () => {
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => client });
  client.respond({ data: inv(), error: null });
  await inventory.setAccount(A);
  const first = deferred();
  client.respond(first.promise);
  client.respond({ data: inv(row("head.induck_cap"), row("memorabilia.campus_mug")), error: null });
  const runs = [inventory.refresh("purchase"), inventory.refresh("reward"), inventory.refresh("open")];
  first.resolve({ data: inv(row("head.induck_cap")), error: null });
  await Promise.all(runs);
  assert.equal(client.calls.length, 3);
  assert.equal(inventory.snapshot.items.length, 2);
});

test("inventory code: one read RPC, no client creation, no storage, no write path", () => {
  const client = source("../src/inventory/inventory-client.js");
  const panel = source("../src/inventory/inventory-panel.js");
  assert.deepEqual([...client.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]), ["get_my_world_inventory_v1"]);
  for (const [name, text] of [["client", client], ["panel", panel]]) {
    assert.doesNotMatch(text, /createClient\(|localStorage|sessionStorage|indexedDB|grant_item|world_inventory_grant/, name);
  }
  assert.doesNotMatch(panel, /\.rpc\(/, "the panel makes no RPC");
});

test("main.js wiring: member client, identity, open, shop purchase, MCM reward, resume; no polling", () => {
  const main = source("../src/main.js");
  assert.match(main, /createInventoryClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/);
  assert.match(main, /void inventory\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  assert.match(main, /onPurchase: \(\) => \{\s*const inventoryRead = inventory\.refresh\("purchase"\);/, "shop purchase success re-reads the inventory");
  assert.match(main, /void progression\.refresh\("reward"\);\s*void wallet\.refresh\("reward"\);\s*void inventory\.refresh\("reward"\);/,
    "MCM reward keeps progression + wallet and adds inventory");
  assert.match(main, /addEventListener\("pageshow"[\s\S]*?void inventory\.refresh\("resume"\)/);
  assert.match(main, /ownerId: "inventory".*policy: INPUT_FOCUS_POLICY\.BLOCKING_UI/s,
    "an open inventory suspends world actions through InputFocusManager");
  assert.doesNotMatch(main, /setInterval\([^)]*inventory/);
  // The reward result is not read for ownership anywhere in the inventory wiring.
  assert.doesNotMatch(main, /inventory\.[a-zA-Z]+\([^)]*result/);
});
