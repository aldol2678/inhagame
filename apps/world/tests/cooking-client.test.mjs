import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARP_RECIPE, COOKING_AVAILABLE, createCookingClient, parseCookingReceipt, canUseCookingStation } from "../src/rooms/cooking-client.js";
import { getItemDefinition, validateCatalog, ITEM_CATALOG } from "../src/collection/item-catalog.js";
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ROOM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", MUTATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const station = { id: MUTATION, itemId: "furniture.cooking_station", surface: "floor", x: -6, z: 0, yaw: 0 };
const context = () => ({ accountId: ACCOUNT, roomId: ROOM, ownerUserId: ACCOUNT, role: "owner", space: "ROOM_PERSONAL_BASIC", ready: true, objects: [station] });
const result = () => ({ status: "SUCCESS", userId: ACCOUNT, roomId: ROOM, requestId: REQUEST, recipeId: CARP_RECIPE.recipeId,
  definitionVersion: 1, layoutRevision: 1, inventory: { status: "SUCCESS", mutationId: MUTATION, userId: ACCOUNT,
    mutationType: "COOK", sourceType: "CRAFTING", sourceRef: CARP_RECIPE.recipeId, idempotencyKey: `recipe:${ACCOUNT}:${REQUEST}`,
    entries: [{ direction: "CONSUME", itemId: "material.fish_carp", quantity: 1, quantityBefore: 2, quantityAfter: 1 },
      { direction: "GRANT", itemId: "consumable.grilled_carp", quantity: 1, quantityBefore: 0, quantityAfter: 1 }] } });
function rig({ available = true } = {}) {
  const h = { account: ACCOUNT, room: context(), calls: [], receipts: [], queue: [] };
  h.client = createCookingClient({ getClient: () => ({ rpc: async (name, args) => {
    h.calls.push({ name, args }); return h.queue.length ? h.queue.shift() : { data: result() };
  } }), getUserId: () => h.account, getRoomState: () => h.room, isAvailable: () => available,
    requestId: () => REQUEST, onReceipt: receipt => { h.receipts.push(receipt); return true; } });
  return h;
}
test("B2 content is closed and food does not pretend to have a combat consumer", () => {
  assert.equal(COOKING_AVAILABLE, false); assert.equal(CARP_RECIPE.foodUseAvailable, false);
  assert.deepEqual(validateCatalog(ITEM_CATALOG), []);
  for (const id of ["furniture.cooking_station", "consumable.grilled_carp"]) assert.equal(getItemDefinition(id).status, "COMING_SOON");
  const meal = getItemDefinition("consumable.grilled_carp");
  assert.equal(meal.category, "CONSUMABLE"); assert.equal(meal.maxStack, 20); assert.equal(meal.cosmeticOnly, false);
});
test("candidate is disabled without explicit availability injection", async () => {
  const h = rig({ available: false }); assert.equal(await h.client.cook(), false); assert.equal(h.calls.length, 0);
  const client = createCookingClient({ getClient: () => { throw Error("must not call"); }, getUserId: () => ACCOUNT, getRoomState: context });
  assert.equal(client.available(), false); assert.equal(await client.cook(), false);
});
test("cook sends only the recipe identity and stable request identity; receipt causes Inventory refresh", async () => {
  const h = rig(); assert.equal(await h.client.cook(), true);
  assert.deepEqual(h.calls, [{ name: "cook_my_world_recipe_v1", args: { p_recipe_id: "recipe.carp_grill", p_request_id: REQUEST } }]);
  assert.equal(h.receipts.length, 1); assert.equal(h.client.state().retryId, null);
  const copy = h.client.state(); copy.receipt.inventory.entries[0].quantityAfter = 99;
  assert.equal(h.client.state().receipt.inventory.entries[0].quantityAfter, 1);
});
test("lost reply retries the same operation, not a second meal", async () => {
  const h = rig(); h.queue.push({ error: { message: "offline" } });
  assert.equal(await h.client.cook(), false); assert.equal(h.client.state().retryId, REQUEST);
  assert.equal(await h.client.cook(), true); assert.deepEqual(h.calls[0], h.calls[1]);
});
test("double click is suppressed while response is unresolved", async () => {
  const h = rig(); let finish; h.queue.push(new Promise(resolve => { finish = resolve; }));
  const first = h.client.cook(); assert.equal(h.client.state().pending, true);
  assert.equal(await h.client.cook(), false); assert.equal(h.calls.length, 1);
  finish({ data: result() }); assert.equal(await first, true);
});
for (const [name, change] of [
  ["visitor", state => { state.role = "visitor"; }], ["another owner", state => { state.ownerUserId = ROOM; }],
  ["no saved station", state => { state.objects = []; }], ["unsaved preview", state => { state.editing = true; }],
  ["layout pending", state => { state.ready = false; }], ["transition", state => { state.busy = true; }],
  ["campus", state => { state.space = "CAMPUS"; }], ["wrong account", state => { state.accountId = ROOM; }]
]) test(`${name} cannot submit a recipe`, async () => {
  const h = rig(); change(h.room); assert.equal(canUseCookingStation(h.room, h.account), false);
  assert.equal(await h.client.cook(), false); assert.equal(h.calls.length, 0);
});
for (const kind of ["account", "room"]) test(`late response after ${kind} change cannot publish old receipt`, async () => {
  const h = rig(); let finish; h.queue.push(new Promise(resolve => { finish = resolve; })); const pending = h.client.cook();
  if (kind === "account") h.account = ROOM; else h.room = { ...h.room, roomId: MUTATION };
  finish({ data: result() }); assert.equal(await pending, false); assert.equal(h.receipts.length, 0);
  assert.equal(h.client.state().pending, false); assert.equal(h.client.state().receipt, null);
});
test("wrong account, room, request, recipe and fabricated quantities cannot become success", () => {
  const expected = { accountId: ACCOUNT, roomId: ROOM, requestId: REQUEST, recipeId: CARP_RECIPE.recipeId };
  assert.ok(parseCookingReceipt(result(), expected));
  for (const field of ["userId", "roomId", "requestId", "recipeId"]) {
    const raw = result(); raw[field] = "forged"; assert.equal(parseCookingReceipt(raw, expected), null);
  }
  for (const patch of [{ quantity: 2 }, { quantityAfter: 50 }, { itemId: "material.campus_leaf" }, { quantityBefore: -1 }]) {
    const raw = result(); Object.assign(raw.inventory.entries[0], patch); assert.equal(parseCookingReceipt(raw, expected), null);
  }
});
test("SQL guard freezes receipts before consulting a changed definition and serializes with Inventory", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261010102000_world_cooking_b2_candidate.sql", import.meta.url), "utf8");
  assert.match(sql, /world_room_caller_v1\(\)/); assert.match(sql, /world_inventory_account_ok_v1\(v_user\)/);
  assert.match(sql, /world_inventory_mutate_v1\(v_user,'COOK','CRAFTING'/);
  assert.ok(sql.indexOf("return v_previous.receipt") < sql.indexOf("select * into v_recipe"));
  assert.ok(sql.indexOf("pg_advisory_xact_lock") < sql.indexOf("select * into v_room"));
  assert.match(sql, /owner_user_id=v_user/); assert.match(sql, /i.user_id=v_user/);
  assert.doesNotMatch(sql, /grant execute on function private.world_inventory_mutate/);
  assert.doesNotMatch(sql, /insert into private.world_shop_listings|world_life_skill_xp_apply_v1|world_combat_start_v1/);
});
test("role change while pending releases busy state and retains same-actor retry identity", async () => {
  const h = rig(); let finish; h.queue.push(new Promise(resolve => { finish = resolve; })); const pending = h.client.cook();
  h.room.role = "visitor"; finish({ data: result() }); assert.equal(await pending, false);
  assert.equal(h.client.state().pending, false); assert.equal(h.client.state().retryId, REQUEST); assert.equal(h.receipts.length, 0);
  h.room.role = "owner"; assert.equal(await h.client.cook(), true); assert.deepEqual(h.calls[0], h.calls[1]);
});
test("inventory refresh failure does not turn a committed cook into a second operation", async () => {
  const client = createCookingClient({ getClient: () => ({ rpc: async () => ({ data: result() }) }), getUserId: () => ACCOUNT,
    getRoomState: context, isAvailable: () => true, requestId: () => REQUEST, onReceipt: () => { throw Error("refresh offline"); } });
  assert.equal(await client.cook(), true); assert.equal(client.state().receipt.status, "SUCCESS"); assert.equal(client.state().error, null);
});
for (const failedRead of [false, undefined, 'throw']) test(`confirmed receipt plus ${String(failedRead)} Inventory read locks new cooking`, async () => {
  let ids = 0, cooks = 0, reads = 0, recovered = false;
  const client = createCookingClient({ getClient: () => ({ rpc: async () => { cooks++; return { data: result() }; } }),
    getUserId: () => ACCOUNT, getRoomState: context, isAvailable: () => true, requestId: () => { ids++; return REQUEST; },
    onReceipt: async () => { reads++; if (recovered) return true; if (failedRead === 'throw') throw Error('offline'); return failedRead; } });
  assert.equal(await client.cook(), true, 'cooking itself is confirmed');
  assert.equal(client.state().receipt.status, 'SUCCESS'); assert.equal(client.state().error, null);
  assert.equal(client.state().inventoryStatus, 'UNAVAILABLE'); assert.equal(client.state().retryId, null);
  assert.equal(await client.cook(), false); assert.equal(ids, 1); assert.equal(cooks, 1);
  assert.equal(await client.retryInventory(), false); assert.equal(reads, 2); assert.equal(cooks, 1); assert.equal(ids, 1);
  recovered = true; assert.equal(await client.retryInventory(), true);
  assert.equal(client.state().inventoryStatus, 'READY'); assert.equal(cooks, 1); assert.equal(ids, 1);
  assert.equal(await client.cook(), true); assert.equal(cooks, 2); assert.equal(ids, 2, 'new user action allowed only after readback');
});
test('Inventory-only retry suppresses repeated clicks and never submits a recipe automatically', async () => {
  let finish, reads = 0, calls = 0;
  const client = createCookingClient({ getClient: () => ({ rpc: async () => { calls++; return { data: result() }; } }),
    getUserId: () => ACCOUNT, getRoomState: context, isAvailable: () => true, requestId: () => REQUEST,
    onReceipt: async () => ++reads === 1 ? false : new Promise(resolve => { finish = resolve; }) });
  await client.cook(); const reading = client.retryInventory();
  assert.equal(client.state().inventoryStatus, 'CHECKING'); assert.equal(client.state().receipt.status, 'SUCCESS');
  assert.equal(await client.retryInventory(), false); assert.equal(await client.cook(), false); assert.equal(reads, 2);
  finish(true); assert.equal(await reading, true); assert.equal(calls, 1);
});
test('old account Inventory-only retry cannot confirm a new actor scope', async () => {
  let account = ACCOUNT, room = context(), finish, reads = 0;
  const client = createCookingClient({ getClient: () => ({ rpc: async () => ({ data: result() }) }), getUserId: () => account,
    getRoomState: () => room, isAvailable: () => true, requestId: () => REQUEST,
    onReceipt: async () => ++reads === 1 ? false : new Promise(resolve => { finish = resolve; }) });
  await client.cook(); const reading = client.retryInventory(); account = ROOM; room = { ...room, accountId: ROOM, ownerUserId: ROOM };
  finish(true); assert.equal(await reading, false); assert.equal(client.state().receipt, null);
  assert.equal(client.state().inventoryStatus, 'IDLE'); assert.equal(client.state().inventoryReading, false);
});
