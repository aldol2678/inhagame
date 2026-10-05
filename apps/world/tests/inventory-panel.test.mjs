import test from "node:test";
import assert from "node:assert/strict";
import { INVENTORY_STATE, createInventoryClient } from "../src/inventory/inventory-client.js";
import { UNKNOWN_ITEM_DESCRIPTION, createInventoryPanel, itemView, summaryText } from "../src/inventory/inventory-panel.js";
import { getItemDefinition } from "../src/collection/item-catalog.js";
import { SHOP_STUDENT_CENTER, createShopClient } from "../src/shop/shop-client.js";
import { createShopPanel } from "../src/shop/shop-panel.js";
import { createWalletClient } from "../src/wallet/wallet-client.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = (itemId, extra = {}) => ({
  itemId, quantity: 1, acquiredAt: "2026-09-28T01:00:00+00:00", updatedAt: "2026-09-28T01:00:00+00:00",
  sourceType: "SHOP", sourceRef: "shop.student_center:offer", eventId: null, catalogStatus: "ACTIVE", ...extra
});
const inv = (...items) => ({ items });
const CAP = "head.induck_cap";
const MUG = "memorabilia.campus_mug";

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}
const byClass = (root, name) => walk(root).filter((n) => (n.className ?? "").split(/\s+/).includes(name));
const text = (node) => walk(node).map((n) => n.textContent).join(" ");
const cards = (root) => byClass(root, "inventory-item");
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };

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
function harness({ signedIn = true } = {}) {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => (signedIn ? client : null) });
  const opened = [];
  const ui = createInventoryPanel({ panel, inventory, doc, onOpenChange: (o) => opened.push(o) });
  return { doc, panel, client, inventory, ui, opened };
}
async function openWith(h, reads) {
  for (const read of reads) h.client.respond("get_my_world_inventory_v1", read);
  void h.inventory.setAccount(A);
  h.ui.setOpen(true);
  await flush();
}

test("itemView: catalog presentation + server ownership fields", () => {
  const view = itemView(row(CAP, { quantity: 2 }));
  const def = getItemDefinition(CAP);
  assert.equal(view.name, def.displayName);
  assert.equal(view.description, def.description);
  assert.equal(view.metaText, "착용 아이템 · 일반");
  assert.equal(view.quantityText, "보유 2");
  assert.equal(view.sourceText, "획득 · 상점");
  assert.equal(view.statusText, null);
  assert.equal(view.muted, false);
  assert.equal(itemView(row(CAP, { sourceType: "EVENT" })).sourceText, "획득 · 이벤트");
  assert.equal(itemView(row(CAP, { sourceType: "SOMETHING_NEW" })).sourceText, "획득 · 기타");
  assert.doesNotMatch(JSON.stringify(view), /shop\.student_center:offer/, "sourceRef is never shown");
});

test("itemView: an owned item missing from the local catalog is still shown (itemId, UNKNOWN_ITEM)", () => {
  const view = itemView(row("head.future_hat", { catalogStatus: "ACTIVE", quantity: 1 }));
  assert.equal(view.known, false);
  assert.equal(view.name, "head.future_hat");
  assert.equal(view.description, UNKNOWN_ITEM_DESCRIPTION);
  assert.equal(view.status, "UNKNOWN_ITEM");
  assert.equal(view.statusText, "정보 없음");
  assert.equal(view.quantityText, "보유 1");
});

test("itemView: server catalogStatus is shown; non-ACTIVE ownership is muted, never hidden", () => {
  const expected = { UNKNOWN_ITEM: "정보 없음", LOCKED: "잠김", COMING_SOON: "준비 중", DISABLED: "사용 중지", HIDDEN: "숨김", WEIRD: "상태 확인 필요" };
  for (const [status, label] of Object.entries(expected)) {
    const view = itemView(row(CAP, { catalogStatus: status }));
    assert.equal(view.status, status);
    assert.equal(view.statusText, label, status);
    assert.equal(view.muted, true);
    assert.equal(view.name, getItemDefinition(CAP).displayName);
  }
});

test("summary counts distinct items, not the quantity sum", () => {
  assert.equal(summaryText({ items: [row(CAP, { quantity: 5 }), row(MUG, { quantity: 2 })] }), "보유 아이템 2종");
  assert.equal(summaryText({ items: [] }), "보유 아이템 0종");
});

test("panel: empty inventory → empty state", async () => {
  const h = harness();
  await openWith(h, [{ data: inv(), error: null }, { data: inv(), error: null }]);
  assert.match(text(h.panel), /아직 보유한 아이템이 없어요/);
  assert.match(text(h.panel), /보유 아이템 0종/);
  assert.equal(cards(h.panel).length, 0);
});

test("panel: one item and several items in server order, unknown and non-ACTIVE included", async () => {
  const h = harness();
  const read = inv(row(MUG, { quantity: 3 }), row("head.future_hat", { catalogStatus: "UNKNOWN_ITEM" }),
    row("badge.main_gate", { catalogStatus: "COMING_SOON", sourceType: "EVENT" }), row(CAP));
  await openWith(h, [{ data: inv(row(CAP)), error: null }, { data: read, error: null }]);
  assert.deepEqual(cards(h.panel).map((c) => c.dataset.itemId), [MUG, "head.future_hat", "badge.main_gate", CAP]);
  assert.match(text(h.panel), /보유 아이템 4종/);
  assert.match(text(h.panel), /보유 3/);
  const unknown = cards(h.panel)[1];
  assert.equal(unknown.dataset.status, "UNKNOWN_ITEM");
  assert.match(text(unknown), /head\.future_hat/);
  assert.match(text(unknown), new RegExp(UNKNOWN_ITEM_DESCRIPTION));
  assert.match(cards(h.panel)[2].className, /inventory-item-muted/);
  assert.match(text(cards(h.panel)[2]), /준비 중/);
});

test("panel: signed-out / guest → login message, zero RPCs", async () => {
  const h = harness({ signedIn: false });
  void h.inventory.setAccount(A);
  h.ui.setOpen(true);
  await flush();
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만 인벤토리를 볼 수 있어요/);
  assert.equal(h.client.calls.length, 0);
});

test("panel: loading, unavailable (no raw message) and retry", async () => {
  const h = harness();
  let resolve;
  h.client.respond("get_my_world_inventory_v1", new Promise((r) => { resolve = r; }));
  void h.inventory.setAccount(A);
  h.ui.setOpen(true);
  assert.match(text(h.panel), /인벤토리를 불러오는 중/);
  h.client.respond("get_my_world_inventory_v1", { data: null, error: { message: "internal: private.world_player_items" } });
  resolve({ data: null, error: { message: "internal: private.world_player_items" } });
  await flush();
  assert.equal(h.inventory.state, INVENTORY_STATE.UNAVAILABLE);
  assert.match(text(h.panel), /인벤토리를 불러오지 못했어요/);
  assert.doesNotMatch(text(h.panel), /private|internal/);
  h.client.respond("get_my_world_inventory_v1", { data: inv(row(CAP)), error: null });
  byClass(h.panel, "shop-retry")[0].click();
  await flush();
  assert.equal(cards(h.panel).length, 1);
});

test("panel: account switch while open never shows the previous account's items", async () => {
  const h = harness();
  await openWith(h, [{ data: inv(row(CAP), row(MUG)), error: null }, { data: inv(row(CAP), row(MUG)), error: null }]);
  assert.equal(cards(h.panel).length, 2);
  let resolveB;
  h.client.respond("get_my_world_inventory_v1", new Promise((r) => { resolveB = r; }));
  void h.inventory.setAccount(B);
  assert.equal(cards(h.panel).length, 0, "A's items are removed at the switch");
  assert.match(text(h.panel), /불러오는 중/);
  resolveB({ data: inv(row("badge.main_gate")), error: null });
  await flush();
  assert.deepEqual(cards(h.panel).map((c) => c.dataset.itemId), ["badge.main_gate"]);
  void h.inventory.setAccount(null);
  assert.equal(cards(h.panel).length, 0);
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만/);
});

test("panel: open re-reads; × and Escape close; onOpenChange", async () => {
  const h = harness();
  await openWith(h, [{ data: inv(), error: null }, { data: inv(row(CAP)), error: null }]);
  assert.equal(h.client.count("get_my_world_inventory_v1"), 2, "identity read + open read");
  assert.equal(cards(h.panel).length, 1);
  byClass(h.panel, "profile-close")[0].click();
  assert.equal(h.ui.open, false);
  assert.equal(h.panel.hidden, true);
  h.ui.setOpen(true);
  h.doc.dispatch("keydown", { code: "Escape" });
  assert.equal(h.ui.open, false);
  assert.deepEqual(h.opened, [true, false, true, false]);
  assert.throws(() => createInventoryPanel({}), /panel and inventory client/);
});

// ---- Shop purchase → inventory re-read (the purchase response is never ownership) ----
const offer = { listingId: "offer.student_center.induck_cap", itemId: CAP, currencyId: "currency.induck_coin", price: 180,
  quantity: 1, requiredLevel: 1, purchaseLimit: null, startAt: null, endAt: null, status: "ACTIVE", purchasable: true, unavailableReason: null };
const shopRead = { shopId: SHOP_STUDENT_CENTER, displayName: "학생회관", status: "ACTIVE", playerLevel: 1, offers: [offer] };

function shopHarness({ inventoryFails = false } = {}) {
  const h = harness();
  const shop = createShopClient({ getClient: () => h.client, createKey: () => "shop:key" });
  const wallet = createWalletClient({ getClient: () => h.client });
  const shopPanelEl = h.doc.createElement("section");
  const statuses = [];
  const shopUi = createShopPanel({ panel: shopPanelEl, shop, wallet, doc: h.doc, onStatus: (m) => statuses.push(m),
    onPurchase: () => void h.inventory.refresh("purchase") });
  const coins = (n) => ({ data: { currencies: [{ id: "currency.induck_coin", balance: n }] }, error: null });
  h.client.respond("get_world_shop_v1", { data: shopRead, error: null });
  h.client.respond("get_world_shop_v1", { data: shopRead, error: null });
  h.client.respond("get_my_world_wallet_v1", coins(500));
  h.client.respond("get_my_world_wallet_v1", coins(500));
  const invRead = inventoryFails ? { data: null, error: { message: "boom" } } : { data: inv(), error: null };
  h.client.respond("get_my_world_inventory_v1", invRead);
  shop.setAccount(A);
  void wallet.setAccount(A);
  void h.inventory.setAccount(A);
  shopUi.setOpen(true);
  return { ...h, shop, wallet, shopUi, shopPanelEl, statuses, coins };
}
const buy = (el) => byClass(el, "shop-offer-buy")[0].click();

test("shop purchase success re-reads the inventory; nothing is added before the server answers", async () => {
  const h = shopHarness();
  await flush();
  assert.equal(h.inventory.snapshot.items.length, 0);
  h.client.respond("purchase_world_shop_listing_v1", { data: { status: "SUCCESS", itemId: CAP, quantity: 1 }, error: null });
  h.client.respond("get_world_shop_v1", { data: shopRead, error: null });
  h.client.respond("get_my_world_wallet_v1", h.coins(320));
  let resolveInventory;
  h.client.respond("get_my_world_inventory_v1", new Promise((r) => { resolveInventory = r; }));
  buy(h.shopPanelEl);
  await flush();
  assert.equal(h.client.count("get_my_world_inventory_v1"), 2, "one re-read after the purchase");
  assert.equal(h.inventory.snapshot.items.length, 0, "no optimistic item from the purchase response");
  resolveInventory({ data: inv(row(CAP)), error: null });
  await flush();
  assert.deepEqual(h.inventory.snapshot.items.map((i) => i.itemId), [CAP]);
  assert.equal(h.statuses.length, 1, "shop success message unchanged");
  assert.equal(h.client.count("get_my_world_wallet_v1"), 3, "wallet refresh still happens");
});

test("a refused purchase does not re-read the inventory", async () => {
  const h = shopHarness();
  await flush();
  h.client.respond("purchase_world_shop_listing_v1", { data: null, error: { message: "INSUFFICIENT_FUNDS" } });
  h.client.respond("get_my_world_wallet_v1", h.coins(10));
  buy(h.shopPanelEl);
  await flush();
  assert.equal(h.client.count("get_my_world_inventory_v1"), 1);
});

test("an inventory failure never blocks the shop, the purchase or the wallet", async () => {
  const h = shopHarness({ inventoryFails: true });
  await flush();
  assert.equal(h.inventory.state, INVENTORY_STATE.UNAVAILABLE);
  assert.equal(byClass(h.shopPanelEl, "shop-offer").length, 1);
  h.client.respond("purchase_world_shop_listing_v1", { data: { status: "SUCCESS" }, error: null });
  h.client.respond("get_world_shop_v1", { data: shopRead, error: null });
  h.client.respond("get_my_world_wallet_v1", h.coins(320));
  h.client.respond("get_my_world_inventory_v1", { data: null, error: { message: "boom" } });
  buy(h.shopPanelEl);
  await flush();
  assert.equal(h.statuses.length, 1, "purchase completes");
  assert.equal(byClass(h.shopPanelEl, "shop-panel-wallet")[0].textContent, "🪙 인덕코인 320");
});
