import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHOP_STATE, SHOP_STUDENT_CENTER, createShopClient } from "../src/shop/shop-client.js";
import { createShopPanel, offerView, purchaseMessage, walletLine } from "../src/shop/shop-panel.js";
import { WALLET_STATE, createWalletClient, parseWalletSnapshot } from "../src/wallet/wallet-client.js";
import { getItemDefinition } from "../src/collection/item-catalog.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const offer = (listingId, itemId, price, requiredLevel, purchasable, unavailableReason = null, extra = {}) => ({
  listingId, itemId, currencyId: "currency.induck_coin", price, quantity: 1, requiredLevel,
  purchaseLimit: null, startAt: null, endAt: null, status: "ACTIVE", purchasable, unavailableReason, ...extra
});
const MUG = offer("offer.student_center.campus_mug", "memorabilia.campus_mug", 120, null, true);
const CAP = offer("offer.student_center.induck_cap", "head.induck_cap", 180, 1, true);
const SNEAKERS = offer("offer.student_center.campus_sneakers", "shoes.campus_sneakers", 240, 2, false, "LEVEL_REQUIRED");
const BACKPACK = offer("offer.student_center.induck_backpack", "back.induck_backpack", 1420, 3, false, "LEVEL_REQUIRED");
const shopAt = (playerLevel, offers) => ({ shopId: SHOP_STUDENT_CENTER, displayName: "학생회관 굿즈샵", status: "ACTIVE", playerLevel, offers });
const LV1 = shopAt(1, [MUG, CAP, SNEAKERS, BACKPACK]);

// ---- tiny tree helpers over the fake DOM ----
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}
const byClass = (root, name) => walk(root).filter((n) => (n.className ?? "").split(/\s+/).includes(name));
const text = (node) => walk(node).map((n) => n.textContent).join(" ");
const card = (root, listingId) => byClass(root, "shop-offer").find((n) => n.dataset.listingId === listingId);
const buyButton = (root, listingId) => byClass(card(root, listingId), "shop-offer-buy")[0];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
function harness({ signedIn = true } = {}) {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const client = fakeClient();
  const shop = createShopClient({ getClient: () => (signedIn ? client : null), createKey: () => "shop:key" });
  const statuses = [];
  const opened = [];
  const ui = createShopPanel({ panel, shop, doc, onStatus: (m) => statuses.push(m), onOpenChange: (o) => opened.push(o) });
  return { doc, panel, client, shop, ui, statuses, opened };
}
async function openWith(h, snapshot) {
  h.client.respond({ data: snapshot, error: null });
  h.shop.setAccount(A);
  h.ui.setOpen(true);
  await flush(); await flush();
}

test("offerView: presentation from the catalog, gameplay fields from the server offer", () => {
  const view = offerView(MUG);
  assert.equal(view.name, getItemDefinition("memorabilia.campus_mug").displayName);
  assert.equal(view.description, getItemDefinition("memorabilia.campus_mug").description);
  assert.equal(view.priceText, "120 인덕코인", "price comes from the listing");
  assert.equal(view.levelText, null, "no Level gate on the mug");
  assert.deepEqual([view.state, view.statusText, view.buttonDisabled], ["available", "구매 가능", false]);
  assert.equal(offerView(BACKPACK).priceText, "1,420 인덕코인");
  assert.equal(offerView({ ...MUG, itemId: "memorabilia.not_in_catalog" }).name, "memorabilia.not_in_catalog", "unknown item falls back to its id");
});

test("offerView: LEVEL_REQUIRED is locked, 'Lv.2 필요', button disabled", () => {
  const view = offerView(SNEAKERS);
  assert.deepEqual([view.state, view.statusText, view.levelText, view.buttonDisabled], ["locked", "🔒 Lv.2 필요", "Lv.2 이상", true]);
  assert.deepEqual([offerView(CAP).state, offerView(CAP).levelText, offerView(CAP).buttonDisabled], ["available", "Lv.1 이상", false]);
});

test("offerView: the server's purchasable / unavailableReason is final, never recomputed from Levels", () => {
  // Contradiction 1: server says purchasable although requiredLevel is 5 → shown as buyable.
  const serverSaysYes = offerView(offer("offer.x.a", "head.induck_cap", 10, 5, true));
  assert.deepEqual([serverSaysYes.state, serverSaysYes.buttonDisabled], ["available", false]);
  // Contradiction 2: server says LEVEL_REQUIRED although no Level is shown → still locked.
  const serverSaysNo = offerView(offer("offer.x.b", "head.induck_cap", 10, null, false, "LEVEL_REQUIRED"));
  assert.deepEqual([serverSaysNo.state, serverSaysNo.statusText, serverSaysNo.buttonDisabled], ["locked", "🔒 레벨 필요", true]);
  // Other refusal reasons are not Level locks.
  assert.deepEqual([offerView(offer("offer.x.c", "head.induck_cap", 10, 2, false, "LISTING_EXPIRED")).state,
    offerView(offer("offer.x.c", "head.induck_cap", 10, 2, false, "LISTING_EXPIRED")).statusText], ["unavailable", "판매 종료"]);
});

test("purchaseMessage: stable codes → short text; unknown codes never leak", () => {
  assert.equal(purchaseMessage("LEVEL_REQUIRED", SNEAKERS), "Lv.2이 필요해요");
  assert.equal(purchaseMessage("LEVEL_REQUIRED", null), "레벨이 부족해요");
  assert.equal(purchaseMessage("INSUFFICIENT_FUNDS"), "인덕코인이 부족해요");
  assert.equal(purchaseMessage("ITEM_ALREADY_OWNED"), "이미 보유한 아이템이에요");
  assert.equal(purchaseMessage("PURCHASE_LIMIT_REACHED"), "구매 한도에 도달했어요");
  assert.equal(purchaseMessage("LISTING_INACTIVE"), "지금은 구매할 수 없어요");
  assert.equal(purchaseMessage("PERMANENT_ACCOUNT_REQUIRED"), "로그인한 계정만 구매할 수 있어요");
  assert.equal(purchaseMessage("ACCOUNT_UNAVAILABLE"), "현재 이 계정으로는 상점을 이용할 수 없어요");
  assert.equal(purchaseMessage("FAILED"), "구매하지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.equal(purchaseMessage("relation \"private.x\" does not exist"), "구매하지 못했어요. 잠시 후 다시 시도해 주세요.");
});

test("panel: signed-out / guest shows the unavailable state and calls no RPC", async () => {
  const h = harness({ signedIn: false });
  h.ui.setOpen(true);
  await flush();
  assert.equal(h.panel.hidden, false);
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만 상점을 이용할 수 있어요/);
  assert.equal(byClass(h.panel, "shop-offer").length, 0);
  h.shop.setAccount(A); // an id without a member client (guest) still makes no call
  await h.shop.refresh("open");
  assert.equal(h.client.calls.length, 0);
});

test("panel: Lv.1 read shows the server playerLevel, buyable Lv.1 offer and locked Lv.2 offer", async () => {
  const h = harness();
  await openWith(h, LV1);
  assert.deepEqual(h.opened, [true]);
  assert.match(text(h.panel), /학생회관 상점/);
  assert.match(text(h.panel), /내 레벨 Lv\.1/);
  assert.equal(card(h.panel, CAP.listingId).dataset.state, "available");
  assert.equal(buyButton(h.panel, CAP.listingId).disabled, false);
  const locked = card(h.panel, SNEAKERS.listingId);
  assert.equal(locked.dataset.state, "locked");
  assert.match(text(locked), /🔒 Lv\.2 필요/);
  assert.equal(buyButton(h.panel, SNEAKERS.listingId).disabled, true);
});

test("panel: a contradictory playerLevel does not flip any lock (server offer fields win)", async () => {
  const h = harness();
  // playerLevel 9 but the server still says the Lv.2 sneakers are LEVEL_REQUIRED; Lv.1 cap refused too.
  await openWith(h, shopAt(9, [{ ...CAP, purchasable: false, unavailableReason: "LEVEL_REQUIRED" }, SNEAKERS]));
  assert.match(text(h.panel), /내 레벨 Lv\.9/, "playerLevel is displayed as served");
  assert.equal(buyButton(h.panel, SNEAKERS.listingId).disabled, true);
  assert.equal(buyButton(h.panel, CAP.listingId).disabled, true);
  assert.equal(card(h.panel, CAP.listingId).dataset.state, "locked");
});

test("panel: purchase success → toast 'you bought', re-read, card follows the new server state", async () => {
  const h = harness();
  await openWith(h, LV1);
  h.client.respond({ data: { status: "SUCCESS", replayed: false }, error: null });
  h.client.respond({ data: shopAt(1, [MUG, { ...CAP, purchasable: false, unavailableReason: "ITEM_UNAVAILABLE" }, SNEAKERS]), error: null });
  buyButton(h.panel, CAP.listingId).click();
  assert.equal(buyButton(h.panel, CAP.listingId).textContent, "구매 중…");
  assert.equal(buyButton(h.panel, CAP.listingId).disabled, true);
  await flush(); await flush(); await flush();
  const name = getItemDefinition("head.induck_cap").displayName;
  assert.deepEqual(h.statuses, [`구매 완료 · ${name}`]);
  assert.match(text(h.panel), new RegExp(`구매 완료 · ${name}`));
  assert.equal(h.client.calls.filter((c) => c.fn === "get_world_shop_v1").length, 2);
  assert.equal(buyButton(h.panel, CAP.listingId).disabled, true, "the refreshed server state is shown");
});

test("panel: stale UI → server LEVEL_REQUIRED → 'Lv.2이 필요해요' and the refreshed lock", async () => {
  const h = harness();
  await openWith(h, shopAt(2, [{ ...SNEAKERS, purchasable: true, unavailableReason: null }]));
  assert.equal(buyButton(h.panel, SNEAKERS.listingId).disabled, false);
  h.client.respond({ data: null, error: { message: "LEVEL_REQUIRED" } });
  h.client.respond({ data: shopAt(1, [SNEAKERS]), error: null });
  buyButton(h.panel, SNEAKERS.listingId).click();
  await flush(); await flush(); await flush();
  assert.match(text(h.panel), /Lv\.2이 필요해요/);
  assert.equal(buyButton(h.panel, SNEAKERS.listingId).disabled, true);
  assert.equal(card(h.panel, SNEAKERS.listingId).dataset.state, "locked");
  assert.deepEqual(h.statuses, [], "no success toast on a refusal");
});

test("panel: INSUFFICIENT_FUNDS / ITEM_ALREADY_OWNED / PURCHASE_LIMIT_REACHED messages", async () => {
  for (const [code, message] of [["INSUFFICIENT_FUNDS", "인덕코인이 부족해요"], ["ITEM_ALREADY_OWNED", "이미 보유한 아이템이에요"],
    ["PURCHASE_LIMIT_REACHED", "구매 한도에 도달했어요"]]) {
    const h = harness();
    await openWith(h, LV1);
    h.client.respond({ data: null, error: { message: code } });
    h.client.respond({ data: LV1, error: null });
    buyButton(h.panel, MUG.listingId).click();
    await flush(); await flush(); await flush();
    assert.match(text(h.panel), new RegExp(message), code);
    assert.deepEqual(h.statuses, []);
  }
});

test("panel: account switch clears the old account's list and message", async () => {
  const h = harness();
  await openWith(h, LV1);
  h.client.respond({ data: null, error: { message: "INSUFFICIENT_FUNDS" } });
  buyButton(h.panel, MUG.listingId).click();
  await flush(); await flush();
  assert.match(text(h.panel), /인덕코인이 부족해요/);
  h.shop.setAccount(B);
  assert.equal(byClass(h.panel, "shop-offer").length, 0);
  assert.doesNotMatch(text(h.panel), /인덕코인이 부족해요/);
  assert.match(text(h.panel), /상점을 불러오는 중/);
  h.shop.setAccount(null);
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만/);
});

test("panel: a purchase that lands after an account switch shows nothing", async () => {
  const h = harness();
  await openWith(h, LV1);
  let resolve;
  h.client.respond(new Promise((r) => { resolve = r; }));
  buyButton(h.panel, MUG.listingId).click();
  h.shop.setAccount(B);
  resolve({ data: { status: "SUCCESS" }, error: null });
  await flush(); await flush();
  assert.deepEqual(h.statuses, [], "no 'purchase complete' for the previous account");
  assert.doesNotMatch(text(h.panel), /구매 완료/);
});

test("panel: open/close, Escape, onOpenChange", async () => {
  const h = harness();
  await openWith(h, LV1);
  h.doc.dispatch("keydown", { code: "Escape" });
  assert.equal(h.ui.open, false);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.panel.children.length, 0);
  assert.deepEqual(h.opened, [true, false]);
  assert.equal(h.ui.setOpen(false), false, "closing twice is a no-op");
  assert.deepEqual(h.opened, [true, false]);
});

test("panel requires its panel and shop client", () => {
  assert.throws(() => createShopPanel({}), /panel and shop client/);
});

test("shop code: no Level comparison, only the two P0-F2 RPCs, no new Supabase client, no P0-F3a dependency", () => {
  const client = readFileSync(new URL("../src/shop/shop-client.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/shop/shop-panel.js", import.meta.url), "utf8");
  for (const [name, source] of [["shop-client", client], ["shop-panel", panel]]) {
    assert.doesNotMatch(source, /playerLevel\s*[<>]=?|requiredLevel\s*[<>]=?|[<>]=?\s*(snapshot\.)?playerLevel/, `${name} never compares Levels`);
    assert.doesNotMatch(source, /createClient\(|import[^;]*progression/i, `${name} makes no client and does not import P0-F3a`);
  }
  const rpcs = [...client.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(rpcs, ["get_world_shop_v1", "purchase_world_shop_listing_v1"]);
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /createShopClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/);
});

// ---- wallet balance line (read-model from get_my_world_wallet_v1, shown as served) ----
const coins = (balance) => ({ currencies: [{ id: "currency.induck_coin", balance }] });
function walletHarness({ signedIn = true } = {}) {
  const h = harness({ signedIn });
  const walletClient = fakeClient();
  const wallet = createWalletClient({ getClient: () => (signedIn ? walletClient : null) });
  const panel = h.doc.createElement("section");
  panel.hidden = true;
  const statuses = [];
  const ui = createShopPanel({ panel, shop: h.shop, wallet, doc: h.doc, onStatus: (m) => statuses.push(m) });
  return { ...h, panel, ui, statuses, wallet, walletClient };
}
async function openWithWallet(h, snapshot, walletRead) {
  h.client.respond({ data: snapshot, error: null });
  for (const read of walletRead) h.walletClient.respond(read);
  h.shop.setAccount(A);
  void h.wallet.setAccount(A);
  h.ui.setOpen(true);
  await flush(); await flush(); await flush();
}
const walletText = (root) => byClass(root, "shop-panel-wallet")[0];
const walletCalls = (h) => h.walletClient.calls.filter((c) => c.fn === "get_my_world_wallet_v1").length;

test("walletLine: served balance with separators, loading, unavailable, signed out", () => {
  assert.equal(walletLine(WALLET_STATE.READY, parseWalletSnapshot(coins(0))), "🪙 인덕코인 0");
  assert.equal(walletLine(WALLET_STATE.READY, parseWalletSnapshot(coins(120))), "🪙 인덕코인 120");
  assert.equal(walletLine(WALLET_STATE.READY, parseWalletSnapshot(coins(1234))), "🪙 인덕코인 1,234");
  assert.equal(walletLine(WALLET_STATE.LOADING, null), "🪙 인덕코인 …");
  assert.equal(walletLine(WALLET_STATE.UNAVAILABLE, null), "잔액을 불러오지 못했어요");
  assert.equal(walletLine(WALLET_STATE.READY, parseWalletSnapshot({ currencies: [{ id: "currency.other", balance: 5 }] })),
    "잔액을 불러오지 못했어요", "only 인덕코인 is shown; another currency is never displayed as coins");
  assert.equal(walletLine(WALLET_STATE.SIGNED_OUT, null), null);
});

test("panel wallet: header shows the server balance; opening re-reads it", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(1234), error: null }, { data: coins(1234), error: null }]);
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 1,234");
  assert.equal(walletText(h.panel).hidden, false);
  assert.equal(walletCalls(h), 2, "identity read + panel open read");
});

test("panel wallet: fresh account shows 0", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(0), error: null }, { data: coins(0), error: null }]);
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 0");
});

test("panel wallet: purchase success re-reads shop and wallet; never shows old - price", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(500), error: null }, { data: coins(500), error: null }]);
  let resolveWallet;
  h.client.respond({ data: { status: "SUCCESS" }, error: null });
  h.client.respond({ data: LV1, error: null });
  h.walletClient.respond(new Promise((r) => { resolveWallet = r; }));
  buyButton(h.panel, MUG.listingId).click();
  await flush(); await flush(); await flush();
  assert.equal(h.client.calls.filter((c) => c.fn === "get_world_shop_v1").length, 2, "shop re-read");
  assert.equal(walletCalls(h), 3, "wallet re-read after the purchase");
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 500", "no client-side 500 - 120 while the read runs");
  assert.doesNotMatch(text(h.panel), /인덕코인 380/);
  // The server says 377 (e.g. a concurrent change) — the panel shows exactly that, not 380.
  resolveWallet({ data: coins(377), error: null });
  await flush(); await flush();
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 377");
});

test("panel wallet: INSUFFICIENT_FUNDS re-reads the wallet and shows the refusal", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(900), error: null }, { data: coins(900), error: null }]);
  h.client.respond({ data: null, error: { message: "INSUFFICIENT_FUNDS" } });
  h.walletClient.respond({ data: coins(20), error: null });
  buyButton(h.panel, CAP.listingId).click();
  await flush(); await flush(); await flush();
  assert.match(text(h.panel), /인덕코인이 부족해요/);
  assert.equal(walletCalls(h), 3);
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 20");
});

test("panel wallet: a refused purchase that moves no money does not re-read the wallet", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(900), error: null }, { data: coins(900), error: null }]);
  h.client.respond({ data: null, error: { message: "ITEM_ALREADY_OWNED" } });
  h.client.respond({ data: LV1, error: null });
  buyButton(h.panel, MUG.listingId).click();
  await flush(); await flush(); await flush();
  assert.equal(walletCalls(h), 2);
});

test("panel wallet: a wallet failure never blocks the shop list or buying", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: null, error: { message: "internal: relation private.world_wallets" } },
    { data: null, error: { message: "internal: relation private.world_wallets" } }]);
  assert.equal(walletText(h.panel).textContent, "잔액을 불러오지 못했어요");
  assert.equal(walletText(h.panel).dataset.state, "UNAVAILABLE");
  assert.doesNotMatch(text(h.panel), /private\.world_wallets|internal/, "the raw server message is never shown");
  assert.equal(byClass(h.panel, "shop-offer").length, 4, "the shop is still READY and listed");
  assert.equal(buyButton(h.panel, MUG.listingId).disabled, false, "buying still works; the server decides funds");
  h.client.respond({ data: { status: "SUCCESS" }, error: null });
  h.client.respond({ data: LV1, error: null });
  h.walletClient.respond({ data: coins(30), error: null });
  buyButton(h.panel, MUG.listingId).click();
  await flush(); await flush(); await flush();
  assert.equal(h.statuses.length, 1);
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 30", "the next successful read recovers");
});

test("panel wallet: loading line, then a wallet change updates only the header (list untouched)", async () => {
  const h = walletHarness();
  let resolveWallet;
  h.client.respond({ data: LV1, error: null });
  h.walletClient.respond(new Promise((r) => { resolveWallet = r; }));
  h.shop.setAccount(A);
  void h.wallet.setAccount(A);
  h.ui.setOpen(true);
  await flush(); await flush();
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 …");
  const list = byClass(h.panel, "shop-offers")[0];
  h.walletClient.respond({ data: coins(120), error: null }); // the coalesced open re-read
  resolveWallet({ data: coins(120), error: null });
  await flush(); await flush(); await flush();
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 120");
  assert.equal(byClass(h.panel, "shop-offers")[0], list, "offer list not rebuilt by a balance read");
});

test("panel wallet: signed-out / guest → no wallet line, zero wallet RPCs", async () => {
  const h = walletHarness({ signedIn: false });
  h.shop.setAccount(A);
  void h.wallet.setAccount(A);
  h.ui.setOpen(true);
  await flush(); await flush();
  assert.equal(walletCalls(h), 0);
  assert.equal(h.client.calls.length, 0);
  assert.equal(walletText(h.panel).hidden, true);
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만/);
});

test("panel wallet: account switch drops A's balance; A's late read never shows under B", async () => {
  const h = walletHarness();
  await openWithWallet(h, LV1, [{ data: coins(700), error: null }, { data: coins(700), error: null }]);
  let resolveLateA;
  h.walletClient.respond(new Promise((r) => { resolveLateA = r; }));
  void h.wallet.refresh("reward");
  let resolveB;
  h.walletClient.respond(new Promise((r) => { resolveB = r; }));
  void h.wallet.setAccount(B);
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 …", "A's 700 is gone at the switch");
  resolveLateA({ data: coins(700), error: null });
  await flush(); await flush();
  assert.doesNotMatch(walletText(h.panel).textContent, /700/);
  resolveB({ data: coins(15), error: null });
  await flush(); await flush();
  assert.equal(walletText(h.panel).textContent, "🪙 인덕코인 15");
});

test("panel wallet: without a wallet the P0-F3b panel is unchanged (no line)", async () => {
  const h = harness();
  await openWith(h, LV1);
  assert.equal(walletText(h.panel).hidden, true);
  assert.equal(byClass(h.panel, "shop-offer").length, 4);
});

test("shop panel: no balance arithmetic on prices", () => {
  const panel = readFileSync(new URL("../src/shop/shop-panel.js", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /balance\s*[-+]|[-+]\s*[a-z]+\.price|[a-z]+\.price\s*[-+]|localStorage/);
});
