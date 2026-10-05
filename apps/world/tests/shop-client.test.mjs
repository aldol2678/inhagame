import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOP_PURCHASE_RPC, SHOP_READ_RPC, SHOP_STATE, SHOP_STUDENT_CENTER,
  createShopClient, parseShopSnapshot, shopErrorCode
} from "../src/shop/shop-client.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// Offers exactly as get_world_shop_v1('shop.student_center') returns them for a Lv.1 account (P0-F2).
const offer = (listingId, itemId, price, requiredLevel, purchasable, unavailableReason = null) => ({
  listingId, itemId, currencyId: "currency.induck_coin", price, quantity: 1, requiredLevel,
  purchaseLimit: null, startAt: null, endAt: null, status: "ACTIVE", purchasable, unavailableReason
});
const MUG = offer("offer.student_center.campus_mug", "memorabilia.campus_mug", 120, null, true);
const CAP = offer("offer.student_center.induck_cap", "head.induck_cap", 180, 1, true);
const SNEAKERS = offer("offer.student_center.campus_sneakers", "shoes.campus_sneakers", 240, 2, false, "LEVEL_REQUIRED");
const shopAt = (playerLevel, offers) => ({ shopId: SHOP_STUDENT_CENTER, displayName: "학생회관 굿즈샵", status: "ACTIVE", playerLevel, offers });
const LV1 = shopAt(1, [MUG, CAP, SNEAKERS]);
const SUCCESS = (listingId) => ({ status: "SUCCESS", replayed: false, listingId, item: { itemId: "x" }, wallet: { balanceAfter: 80 } });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeClient() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      if (typeof next === "function") return next();
      return next instanceof Promise ? next : Promise.resolve(next);
    }
  };
}

function harness() {
  const client = fakeClient();
  let current = client;
  let keys = 0;
  const shop = createShopClient({ getClient: () => current, createKey: () => `shop:key-${++keys}` });
  const changes = [];
  shop.onChange((change) => changes.push(change));
  return { shop, client, changes, setClient: (next) => { current = next; } };
}
const reads = (client) => client.calls.filter((c) => c.fn === SHOP_READ_RPC);
const buys = (client) => client.calls.filter((c) => c.fn === SHOP_PURCHASE_RPC);

test("parser keeps the server contract; malformed offers are dropped, not repaired", () => {
  const parsed = parseShopSnapshot(LV1, SHOP_STUDENT_CENTER);
  assert.equal(parsed.playerLevel, 1);
  assert.deepEqual(parsed.offers.map((o) => o.listingId), [MUG.listingId, CAP.listingId, SNEAKERS.listingId]);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.offers[0]));
  assert.equal(parseShopSnapshot({ ...LV1, shopId: "shop.dorm_furniture" }, SHOP_STUDENT_CENTER), null, "only the requested shop");
  assert.equal(parseShopSnapshot({ ...LV1, playerLevel: undefined }, SHOP_STUDENT_CENTER), null);
  const mixed = parseShopSnapshot(shopAt(1, [MUG, { ...CAP, price: "180" }, { ...SNEAKERS, purchasable: "no" }]), SHOP_STUDENT_CENTER);
  assert.deepEqual(mixed.offers.map((o) => o.listingId), [MUG.listingId]);
});

test("error codes: only stable server codes pass through", () => {
  assert.equal(shopErrorCode({ message: "LEVEL_REQUIRED" }), "LEVEL_REQUIRED");
  assert.equal(shopErrorCode({ message: "INSUFFICIENT_FUNDS" }), "INSUFFICIENT_FUNDS");
  assert.equal(shopErrorCode({ message: "duplicate key value violates unique constraint \"x\"" }), "FAILED");
  assert.equal(shopErrorCode(new TypeError("Failed to fetch")), "FAILED");
  assert.equal(shopErrorCode(null), "FAILED");
});

test("normal read: one get_world_shop_v1('shop.student_center') call on the member client", async () => {
  const { shop, client, changes } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  assert.equal(await shop.refresh("open"), true);
  assert.deepEqual(client.calls, [{ fn: SHOP_READ_RPC, args: { p_shop_id: SHOP_STUDENT_CENTER } }]);
  assert.equal(shop.state, SHOP_STATE.READY);
  assert.deepEqual(changes.map((c) => c.state), [SHOP_STATE.LOADING, SHOP_STATE.READY]);
});

test("signed out and guest: no Shop RPC for reads or purchases", async () => {
  const { shop, client, setClient } = harness();
  assert.equal(await shop.refresh("open"), false);
  assert.deepEqual(await shop.purchase(MUG.listingId), { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", offer: null });
  setClient(null); // online.supabase is null for a guest session even when an id exists
  shop.setAccount(A);
  await shop.refresh("open");
  assert.equal(shop.state, SHOP_STATE.SIGNED_OUT);
  assert.equal((await shop.purchase(MUG.listingId)).outcome, "SIGNED_OUT");
  assert.equal(client.calls.length, 0);
});

test("read failures are UNAVAILABLE with no snapshot", async () => {
  for (const response of [{ data: null, error: { message: "SHOP_NOT_FOUND" } }, () => Promise.reject(new Error("offline")),
    { data: { shopId: SHOP_STUDENT_CENTER }, error: null }]) {
    const { shop, client } = harness();
    client.respond(response);
    shop.setAccount(A);
    await shop.refresh("open");
    assert.equal(shop.state, SHOP_STATE.UNAVAILABLE);
    assert.equal(shop.snapshot, null);
  }
});

test("purchase always asks the server — even for an offer the snapshot marks unpurchasable", async () => {
  const { shop, client } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  client.respond({ data: null, error: { message: "LEVEL_REQUIRED" } });
  client.respond({ data: LV1, error: null });
  const result = await shop.purchase(SNEAKERS.listingId);
  assert.deepEqual(buys(client).map((c) => c.args), [{ p_listing_id: SNEAKERS.listingId, p_idempotency_key: "shop:key-1" }],
    "the client does not pre-judge eligibility; the server re-validates");
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "LEVEL_REQUIRED");
});

test("purchase success: one purchase RPC with a fresh key, then the shop is re-read", async () => {
  const { shop, client } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  client.respond({ data: SUCCESS(MUG.listingId), error: null });
  const owned = shopAt(1, [{ ...MUG }, CAP, SNEAKERS]);
  client.respond({ data: owned, error: null });
  const result = await shop.purchase(MUG.listingId);
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.result.status, "SUCCESS");
  assert.equal(buys(client).length, 1);
  assert.equal(reads(client).length, 2, "success re-reads the shop");
  assert.equal(shop.isPending(MUG.listingId), false);
});

test("stale UI: the server answers LEVEL_REQUIRED for an offer shown as buyable → refresh to the server truth", async () => {
  const { shop, client } = harness();
  // The open snapshot (from an earlier read) still says the sneakers are purchasable.
  client.respond({ data: shopAt(2, [MUG, CAP, { ...SNEAKERS, purchasable: true, unavailableReason: null }]), error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  client.respond({ data: null, error: { message: "LEVEL_REQUIRED" } });
  client.respond({ data: LV1, error: null });
  const result = await shop.purchase(SNEAKERS.listingId);
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "LEVEL_REQUIRED"]);
  assert.equal(reads(client).length, 2, "the refusal re-reads the shop");
  const sneakers = shop.snapshot.offers.find((o) => o.listingId === SNEAKERS.listingId);
  assert.deepEqual([sneakers.purchasable, sneakers.unavailableReason], [false, "LEVEL_REQUIRED"]);
});

test("refusals: INSUFFICIENT_FUNDS (no refresh), ITEM_ALREADY_OWNED and PURCHASE_LIMIT_REACHED (refresh)", async () => {
  for (const [code, refreshes] of [["INSUFFICIENT_FUNDS", false], ["ITEM_ALREADY_OWNED", true], ["PURCHASE_LIMIT_REACHED", true]]) {
    const { shop, client } = harness();
    client.respond({ data: LV1, error: null });
    shop.setAccount(A);
    await shop.refresh("open");
    client.respond({ data: null, error: { message: code } });
    client.respond({ data: LV1, error: null });
    const result = await shop.purchase(CAP.listingId);
    assert.deepEqual([result.outcome, result.code], ["REFUSED", code]);
    assert.equal(reads(client).length, refreshes ? 2 : 1, code);
  }
});

test("idempotency: a refusal retires the key; an unknown failure reuses it so a retry replays", async () => {
  const { shop, client } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  client.respond(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal((await shop.purchase(MUG.listingId)).outcome, "FAILED");
  client.respond({ data: SUCCESS(MUG.listingId), error: null });
  client.respond({ data: LV1, error: null });
  assert.equal((await shop.purchase(MUG.listingId)).outcome, "SUCCESS");
  client.respond({ data: null, error: { message: "ITEM_ALREADY_OWNED" } });
  client.respond({ data: LV1, error: null });
  await shop.purchase(MUG.listingId);
  assert.deepEqual(buys(client).map((c) => c.args.p_idempotency_key), ["shop:key-1", "shop:key-1", "shop:key-2"],
    "the unknown outcome retried with the same key; the next attempt got a new one");
});

test("double-click: one purchase in flight per listing", async () => {
  const { shop, client } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  const hold = deferred();
  client.respond(hold.promise);
  const first = shop.purchase(MUG.listingId);
  assert.equal(shop.isPending(MUG.listingId), true);
  assert.deepEqual(await shop.purchase(MUG.listingId), { outcome: "FAILED", code: "BUSY", offer: MUG });
  client.respond({ data: LV1, error: null });
  hold.resolve({ data: SUCCESS(MUG.listingId), error: null });
  assert.equal((await first).outcome, "SUCCESS");
  assert.equal(buys(client).length, 1);
});

test("account switch drops the old snapshot and discards the old account's late read", async () => {
  const { shop, client, changes } = harness();
  const slowA = deferred();
  client.respond(slowA.promise);
  shop.setAccount(A);
  const readA = shop.refresh("open");
  shop.setAccount(B);
  assert.equal(shop.snapshot, null);
  client.respond({ data: LV1, error: null });
  await shop.refresh("open");
  slowA.resolve({ data: shopAt(9, [{ ...SNEAKERS, purchasable: true, unavailableReason: null }]), error: null });
  await readA;
  assert.equal(shop.accountId, B);
  assert.equal(shop.snapshot.playerLevel, 1, "B keeps its own snapshot");
  assert.ok(!changes.some((c) => c.accountId === B && c.snapshot?.playerLevel === 9), "A's late read never reached B");
});

test("account switch during a purchase: the old result is STALE and triggers nothing", async () => {
  const { shop, client } = harness();
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  await shop.refresh("open");
  const hold = deferred();
  client.respond(hold.promise);
  const pending = shop.purchase(MUG.listingId);
  shop.setAccount(B);
  hold.resolve({ data: SUCCESS(MUG.listingId), error: null });
  assert.equal((await pending).outcome, "STALE");
  assert.equal(reads(client).length, 1, "no refresh on behalf of the previous account");
  assert.equal(shop.isPending(MUG.listingId), false);
  assert.equal(shop.state, SHOP_STATE.LOADING, "B starts clean");
});

test("refreshes coalesce", async () => {
  const { shop, client } = harness();
  const hold = deferred();
  client.respond(hold.promise);
  client.respond({ data: LV1, error: null });
  shop.setAccount(A);
  const r = [shop.refresh("open"), shop.refresh("open"), shop.refresh("retry")];
  assert.equal(reads(client).length, 1);
  hold.resolve({ data: LV1, error: null });
  await Promise.all(r);
  assert.equal(reads(client).length, 2, "one follow-up at most");
});
