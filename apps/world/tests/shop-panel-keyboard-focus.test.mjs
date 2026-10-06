import test from "node:test";
import assert from "node:assert/strict";
import { createShopClient, SHOP_STUDENT_CENTER, SHOP_READ_RPC, SHOP_PURCHASE_RPC } from "../src/shop/shop-client.js";
import { createShopPanel } from "../src/shop/shop-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const offer = (listingId, extra = {}) => ({ listingId, itemId: "memorabilia.campus_mug", currencyId: "currency.induck_coin",
  price: 120, quantity: 1, requiredLevel: null, purchaseLimit: null, startAt: null, endAt: null,
  status: "ACTIVE", purchasable: true, unavailableReason: null, ...extra });
// Two listings for the same item deliberately require listing identity, never name/item/index.
const FIRST = offer("offer.first"), SECOND = offer("offer.second"), THIRD = offer("offer.third");
const snapshot = (offers = [FIRST, SECOND, THIRD]) => ({ shopId: SHOP_STUDENT_CENTER, status: "ACTIVE", playerLevel: 1, offers });
const ok = data => ({ data, error: null });
const failed = { data: null, error: { message: "TEST_UNAVAILABLE" } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const byClass = (node, name) => walk(node).filter(el => el.className.split(/\s+/).includes(name));
const close = h => byClass(h.panel, "profile-close")[0];
const body = h => byClass(h.panel, "shop-panel-body")[0];
const retry = h => byClass(h.panel, "shop-retry")[0];
const card = (h, id) => byClass(h.panel, "shop-offer").find(el => el.dataset.listingId === id);
const buy = (h, id) => byClass(card(h, id), "shop-offer-buy")[0];
const focused = (h, node) => assert.equal(h.doc.activeElement === node, true, "focus matches the live semantic target");

// Realistic removal/disabled/hidden focus semantics; native Tab order remains browser-only QA.
function focusDocument() {
  const doc = createFakeDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const node = create(tag), replace = node.replaceChildren.bind(node);
    node.scrollTop = 0; node.scrollLeft = 0;
    Object.defineProperty(node, "isConnected", { get: () => doc.body?.contains(node) ?? false });
    node.closest = () => {
      for (let parent = node; parent; parent = parent.parent) if (parent.hidden || parent.inert) return parent;
      return null;
    };
    node.focus = options => {
      if (!node.isConnected || node.disabled || node.closest("[hidden], [inert]")) return;
      if (node.tagName !== "BUTTON" && node.tabIndex === undefined) return;
      doc.activeElement = node; node.focusOptions = options;
    };
    node.replaceChildren = (...nodes) => {
      if (node !== doc.activeElement && node.contains(doc.activeElement)) doc.activeElement = doc.body;
      for (const child of node.children) child.parent = null;
      replace(...nodes);
    };
    return node;
  };
  doc.body = doc.createElement("body"); doc.activeElement = doc.body;
  return doc;
}

function harness({ onOpenChange = () => {} } = {}) {
  const doc = focusDocument(), panel = doc.createElement("section"), opener = doc.createElement("button"), outside = doc.createElement("button");
  panel.hidden = true; doc.body.append(opener, panel, outside);
  const queue = new Map(), calls = [], opened = [], statuses = [], purchases = [];
  const client = { rpc(fn, args) {
    calls.push({ fn, args });
    assert.ok(queue.get(fn)?.length, `missing fixture for ${fn}`);
    return Promise.resolve(queue.get(fn).shift());
  } };
  const respond = (fn, value) => { if (!queue.has(fn)) queue.set(fn, []); queue.get(fn).push(value); };
  const shop = createShopClient({ getClient: () => client, createKey: () => `focus:${calls.length}` });
  const ui = createShopPanel({ panel, doc, shop, onStatus: value => statuses.push(value), onPurchase: value => purchases.push(value),
    onOpenChange(value) { opened.push(value); onOpenChange(value); } });
  const h = { doc, panel, opener, outside, shop, ui, respond, calls, opened, statuses, purchases };
  h.open = async () => {
    shop.setAccount(A); respond(SHOP_READ_RPC, ok(snapshot()));
    opener.focus(); ui.setOpen(true); await flush();
  };
  return h;
}

test("shop focus: delayed initial load and consecutive renders keep the live close button", async () => {
  const h = harness(), read = deferred();
  h.shop.setAccount(A); h.respond(SHOP_READ_RPC, read.promise); h.opener.focus(); h.ui.setOpen(true);
  focused(h, close(h)); read.resolve(ok(snapshot())); await flush(); focused(h, close(h));
  h.ui.render(); focused(h, close(h));
});

test("shop focus: same listing survives reordered readback and retains both scroll axes", async () => {
  const h = harness(); await h.open();
  buy(h, SECOND.listingId).focus(); body(h).scrollTop = 240; body(h).scrollLeft = 12;
  h.respond(SHOP_READ_RPC, ok(snapshot([THIRD, FIRST, SECOND]))); await h.shop.refresh();
  focused(h, buy(h, SECOND.listingId));
  assert.deepEqual(h.doc.activeElement.focusOptions, { preventScroll: true });
  assert.equal(body(h).scrollTop, 240); assert.equal(body(h).scrollLeft, 12);
});

test("shop focus: pending purchase uses a non-action listing anchor then returns to buy", async () => {
  const h = harness(); await h.open(); const pending = deferred();
  h.respond(SHOP_PURCHASE_RPC, pending.promise); h.respond(SHOP_READ_RPC, ok(snapshot()));
  buy(h, SECOND.listingId).focus(); body(h).scrollTop = 210; buy(h, SECOND.listingId).click();
  assert.equal(buy(h, SECOND.listingId).disabled, true); focused(h, card(h, SECOND.listingId));
  assert.equal(card(h, SECOND.listingId).tabIndex, -1); assert.equal(body(h).scrollTop, 210);
  buy(h, SECOND.listingId).click();
  assert.equal(h.calls.filter(call => call.fn === SHOP_PURCHASE_RPC).length, 1, "focus support never enables a pending purchase");
  pending.resolve(ok({ status: "SUCCESS" })); await flush();
  focused(h, buy(h, SECOND.listingId)); assert.equal(body(h).scrollTop, 210);
  assert.equal(h.purchases.length, 1);
});

test("shop focus: failed purchase keeps the same retryable listing", async () => {
  const h = harness(); await h.open(); h.respond(SHOP_PURCHASE_RPC, failed);
  buy(h, SECOND.listingId).focus(); buy(h, SECOND.listingId).click(); await flush();
  focused(h, buy(h, SECOND.listingId)); assert.equal(h.doc.activeElement.disabled, false);
});

test("shop focus: server-disabled listing stays on its anchor; removed listing falls back to close", async () => {
  const h = harness(); await h.open();
  buy(h, SECOND.listingId).focus();
  h.respond(SHOP_READ_RPC, ok(snapshot([FIRST, { ...SECOND, purchasable: false, unavailableReason: "ITEM_UNAVAILABLE" }])));
  await h.shop.refresh(); focused(h, card(h, SECOND.listingId));
  assert.equal(buy(h, SECOND.listingId).disabled, true);
  h.respond(SHOP_READ_RPC, ok(snapshot([FIRST]))); await h.shop.refresh(); focused(h, close(h));
});

test("shop focus: retry retains focus on repeated failure, successful recovery falls back to close", async () => {
  const h = harness(); await h.open(); h.respond(SHOP_READ_RPC, failed); await h.shop.refresh();
  retry(h).focus(); h.respond(SHOP_READ_RPC, failed); retry(h).click(); await flush(); focused(h, retry(h));
  h.respond(SHOP_READ_RPC, ok(snapshot())); retry(h).click(); await flush(); focused(h, close(h));
});

test("shop focus: refresh retains scroll but never pulls focus back from outside", async () => {
  const h = harness(); await h.open(); body(h).scrollTop = 240; body(h).scrollLeft = 12;
  h.outside.focus(); h.ui.render(); focused(h, h.outside);
  assert.equal(body(h).scrollTop, 240); assert.equal(body(h).scrollLeft, 12);
});

for (const destination of ["outside", "another listing"]) {
  test(`shop focus: delayed purchase respects a newer focus choice ${destination}`, async () => {
    const h = harness(); await h.open(); const pending = deferred();
    h.respond(SHOP_PURCHASE_RPC, pending.promise); h.respond(SHOP_READ_RPC, ok(snapshot()));
    buy(h, FIRST.listingId).focus(); buy(h, FIRST.listingId).click();
    (destination === "outside" ? h.outside : buy(h, THIRD.listingId)).focus();
    pending.resolve(ok({ status: "SUCCESS" })); await flush();
    focused(h, destination === "outside" ? h.outside : buy(h, THIRD.listingId));
  });
}

test("shop focus: account switches and sign-out discard old listing and scroll context", async () => {
  const h = harness(); await h.open(); buy(h, SECOND.listingId).focus(); body(h).scrollTop = 320; body(h).scrollLeft = 12;
  h.shop.setAccount(B); focused(h, close(h));
  assert.equal(body(h).scrollTop, 0); assert.equal(body(h).scrollLeft, 0); assert.equal(card(h, SECOND.listingId), undefined);
  h.respond(SHOP_READ_RPC, ok(snapshot())); await h.shop.refresh(); focused(h, close(h));
  h.shop.setAccount(null); focused(h, close(h)); assert.equal(card(h, SECOND.listingId), undefined);
});

test("shop focus: old-account purchase readback cannot restore listing focus or publish a hint", async () => {
  const h = harness(); await h.open(); const readback = deferred();
  h.respond(SHOP_PURCHASE_RPC, ok({ status: "SUCCESS" })); h.respond(SHOP_READ_RPC, readback.promise);
  buy(h, SECOND.listingId).focus(); buy(h, SECOND.listingId).click(); await flush();
  h.shop.setAccount(B); h.respond(SHOP_READ_RPC, ok(snapshot())); await h.shop.refresh();
  readback.resolve(ok(snapshot())); await flush();
  focused(h, close(h)); assert.equal(h.ui.status().hint, ""); assert.deepEqual(h.statuses, []); assert.deepEqual(h.purchases, []);
});

test("shop focus: Escape and close restore the current opener; repeated opens remain idempotent", async () => {
  const h = harness(); await h.open(); h.ui.setOpen(true); h.doc.dispatch("keydown", { code: "Escape" });
  focused(h, h.opener); assert.equal(h.panel.hidden, true);
  h.respond(SHOP_READ_RPC, ok(snapshot())); h.outside.focus(); h.ui.setOpen(true); await flush();
  close(h).click(); focused(h, h.outside); assert.deepEqual(h.opened, [true, false, true, false]);
});

test("shop focus: closing with outside focus and close callback handoffs never restore the old opener", async () => {
  const h = harness(); await h.open(); h.outside.focus(); h.ui.setOpen(false); focused(h, h.outside);
  const other = harness({ onOpenChange(open) { if (!open) other.outside.focus(); } });
  await other.open(); other.ui.setOpen(false); focused(other, other.outside);
});

for (const invalid of ["detached", "disabled", "hidden", "inert"]) {
  test(`shop focus: ${invalid} opener is never restored`, async () => {
    const h = harness(); await h.open();
    if (invalid === "detached") h.doc.body.replaceChildren(h.panel, h.outside);
    else h.opener[invalid] = true;
    close(h).focus(); h.ui.setOpen(false); focused(h, h.doc.body);
  });
}

test("shop focus: closing during a delayed read keeps the trigger focused after resolution", async () => {
  const h = harness(); await h.open(); const pending = deferred(); h.respond(SHOP_READ_RPC, pending.promise);
  const read = h.shop.refresh(); close(h).click(); focused(h, h.opener);
  pending.resolve(ok(snapshot())); await read; focused(h, h.opener); assert.equal(h.panel.children.length, 0);
});

test("shop focus: a purchase from a closed opening cannot add its hint to a later opening", async () => {
  const h = harness(); await h.open(); const pending = deferred(); h.respond(SHOP_PURCHASE_RPC, pending.promise);
  buy(h, SECOND.listingId).focus(); buy(h, SECOND.listingId).click(); h.ui.setOpen(false);
  h.respond(SHOP_READ_RPC, ok(snapshot())); h.outside.focus(); h.ui.setOpen(true); await flush();
  h.respond(SHOP_READ_RPC, ok(snapshot())); pending.resolve(ok({ status: "SUCCESS" })); await flush();
  focused(h, close(h)); assert.equal(h.ui.status().hint, ""); assert.deepEqual(h.statuses, []);
  assert.equal(h.purchases.length, 1, "the owning read-model still receives the completed purchase");
});

test("shop focus: native Tab and Shift+Tab remain unhandled", async () => {
  const h = harness(); await h.open(); let prevented = 0;
  for (const shiftKey of [false, true]) h.doc.dispatch("keydown", { code: "Tab", key: "Tab", shiftKey, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0); assert.equal(h.ui.open, true);
});
