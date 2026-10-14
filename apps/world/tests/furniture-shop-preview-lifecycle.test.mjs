import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createShopClient, SHOP_READ_RPC } from "../src/shop/shop-client.js";
import { createShopPanel } from "../src/shop/shop-panel.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const SOFA = "furniture.dorm_single_sofa";
const OFFER = Object.freeze({
  itemId: SOFA, listingId: "dorm.sofa", price: 480, requiredLevel: 1,
  purchasable: true, unavailableReason: null, currencyId: "currency.induck_coin",
  quantity: 1, purchaseLimit: null, startAt: null, endAt: null, status: "ACTIVE"
});
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const descendants = node => (node.children ?? []).flatMap(child => [child, ...descendants(child)]);
const result = (image, mode = "GLB") => ({ image, mode, status: { objects: [{ state: mode }] } });

// Only this suite needs canvas placement/removal and class selectors. Keep the shared
// fake DOM unchanged, and model real DOM reparenting so stale canvas leaks are visible.
function previewDocument() {
  const doc = createFakeDocument();
  const create = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const node = create(tag);
    node.ownerDocument = doc;
    node.remove = () => {
      if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
      node.parent = null;
    };
    node.append = (...children) => {
      for (const child of children) {
        child.remove();
        child.parent = node;
        node.children.push(child);
      }
    };
    node.replaceChildren = (...children) => {
      for (const child of [...node.children]) child.remove();
      node.append(...children);
    };
    node.querySelectorAll = selector => {
      assert.match(selector, /^\.[a-z-]+$/, "fixture only supports the class selectors used by this panel");
      return descendants(node).filter(child => child.className.split(/\s+/).includes(selector.slice(1)));
    };
    node.querySelector = selector => node.querySelectorAll(selector)[0] ?? null;
    if (node.tagName === "CANVAS") node.getContext = () => ({});
    return node;
  };
  doc.body = doc.createElement("body");
  doc.root = doc.body;
  return doc;
}

function engine({ capture = async () => result("fresh-glb"), show = true } = {}) {
  return {
    captures: [], shows: [], disposals: 0,
    capture(itemId) { this.captures.push(itemId); return capture(itemId, this.captures.length); },
    show(...args) { this.shows.push(args); return show; },
    dispose() { this.disposals++; }
  };
}

async function fixture(t, creations) {
  const doc = previewDocument();
  const panel = doc.createElement("section");
  doc.body.append(panel);
  const calls = [], canvases = [];
  const client = { rpc(name, args) {
    calls.push({ name, args });
    assert.equal(name, SHOP_READ_RPC, "preview lifecycle must not make purchases or other writes");
    return Promise.resolve({ data: {
      shopId: "shop.dorm_furniture", displayName: "Furniture", status: "ACTIVE",
      playerLevel: 3, offers: [OFFER]
    }, error: null });
  } };
  const shop = createShopClient({ getClient: () => client, shopId: "shop.dorm_furniture" });
  const ui = createShopPanel({ shop, panel, doc, createPreview(canvas) {
    const creation = creations[canvases.length];
    canvases.push(canvas);
    assert.notEqual(creation, undefined, "unexpected extra preview initialization");
    return typeof creation === "function" ? creation(canvas) : creation;
  } });
  t.after(() => {
    ui.setOpen(false);
    assert.ok(calls.every(call => call.name === SHOP_READ_RPC));
  });
  shop.setAccount(ACCOUNT_A);
  ui.setOpen(true);
  await flush();
  return { doc, panel, calls, canvases, shop, ui,
    thumbnail: () => panel.querySelector(".shop-showroom-thumbnail"),
    openDetail: () => panel.querySelector(".shop-showroom-view").click()
  };
}

for (const transition of ["close/reopen", "account A to B"]) {
  test(`late capture after ${transition} cannot paint or unlock the new capture batch`, async t => {
    const oldCapture = deferred(), newCapture = deferred();
    const previous = engine({ capture: () => oldCapture.promise });
    const current = engine({ capture: () => newCapture.promise });
    const h = await fixture(t, [previous, current]);
    assert.deepEqual(previous.captures, [SOFA]);
    if (transition === "close/reopen") {
      h.ui.setOpen(false);
      h.ui.setOpen(true);
    } else {
      h.shop.setAccount(ACCOUNT_B);
      await h.shop.refresh("test-account-switch");
    }
    await flush();
    assert.equal(previous.disposals, 1);
    assert.deepEqual(current.captures, [SOFA]);
    assert.equal(h.thumbnail().hidden, true);

    oldCapture.resolve(result("stale-account-or-opening"));
    await flush();
    assert.equal(h.thumbnail().hidden, true, "old capture must not touch the new account/opening DOM");
    assert.notEqual(h.thumbnail().src, "stale-account-or-opening");
    h.ui.render();
    await flush();
    assert.deepEqual(current.captures, [SOFA], "old finally must not clear the new batch's busy guard");

    newCapture.resolve(result("current-account-or-opening"));
    await flush();
    assert.equal(h.thumbnail().src, "current-account-or-opening");
    h.ui.render();
    await flush();
    assert.equal(h.thumbnail().src, "current-account-or-opening", "only the current result enters the cache");
    assert.deepEqual(current.captures, [SOFA]);
  });
}

test("initialization finishing after close is disposed without removing the reopened canvas", async t => {
  const initialization = deferred();
  const previous = engine(), current = engine();
  const h = await fixture(t, [initialization.promise, current]);
  assert.equal(h.canvases.length, 1);
  const oldCanvas = h.canvases[0];
  h.ui.setOpen(false);
  assert.equal(oldCanvas.parent, null);
  h.ui.setOpen(true);
  await flush();
  assert.equal(h.canvases.length, 2);
  const newCanvas = h.canvases[1];
  assert.equal(newCanvas.parent, h.doc.body);

  initialization.resolve(previous);
  await flush();
  assert.equal(previous.disposals, 1);
  assert.deepEqual(previous.captures, []);
  assert.equal(current.disposals, 0);
  assert.equal(newCanvas.parent, h.doc.body);
  assert.equal(h.thumbnail().src, "fresh-glb");
  assert.equal(descendants(h.doc.body).filter(node => node.tagName === "CANVAS").length, 1);
});

test("failed preview initialization is retried on the next opening", async t => {
  const current = engine();
  const h = await fixture(t, [() => { throw Error("device temporarily unavailable"); }, current]);
  h.openDetail();
  await flush();
  const fallback = h.panel.querySelector(".shop-showroom-preview-fallback");
  assert.ok(fallback);
  assert.equal(fallback.hidden, false);
  assert.match(fallback.textContent, /사용할 수 없어요/);
  assert.equal(descendants(h.doc.body).filter(node => node.tagName === "CANVAS").length, 0);
  h.ui.setOpen(false);
  h.ui.setOpen(true);
  await flush();
  assert.equal(h.canvases.length, 2);
  assert.deepEqual(current.captures, [SOFA]);
  assert.equal(h.thumbnail().src, "fresh-glb");
});

test("a refused detail render keeps its error fallback visible", async t => {
  const preview = engine({ show: false });
  const h = await fixture(t, [preview]);
  h.openDetail();
  await flush();
  const fallback = h.panel.querySelector(".shop-showroom-preview-fallback");
  assert.ok(fallback);
  assert.equal(fallback.hidden, false);
  assert.match(fallback.textContent, /표시할 수 없어요/);
  assert.deepEqual(preview.shows.map(args => args[0]), [SOFA]);
  assert.equal(h.panel.querySelector(".shop-showroom-stage").children.length, 1);
});

test("detail controls defer renderer changes until the fixed-angle thumbnail finishes", async t => {
  const thumbnail = deferred();
  const preview = engine({ capture: () => thumbnail.promise });
  const h = await fixture(t, [preview]);
  assert.deepEqual(preview.captures, [SOFA]);
  h.openDetail();
  const controls = h.panel.querySelectorAll(".shop-showroom-rotate");
  controls[0].click(); // 35 degrees -> 350 degrees
  controls[2].click(); // zoom 1 -> 1.15
  await flush();
  assert.deepEqual(preview.shows, [], "detail controls must not change the renderer during a thumbnail capture");

  thumbnail.resolve(result("fixed-angle-thumbnail"));
  await flush();
  assert.deepEqual(preview.shows, [[SOFA, 350, 1.15]], "the selected detail receives the latest controls after capture");
  h.panel.querySelector(".shop-showroom-back").click();
  await flush();
  assert.equal(h.thumbnail().src, "fixed-angle-thumbnail");
  assert.deepEqual(preview.captures, [SOFA], "the untouched fixed-angle result remains the cached thumbnail");
});

test("a GLB fallback thumbnail is recaptured after recovery and cached only when final", async t => {
  const recovery = deferred();
  const preview = engine({ capture: (_id, count) => count === 1
    ? Promise.resolve(result("temporary-fallback", "FALLBACK")) : recovery.promise });
  const reopened = engine({ capture: async () => result("reopened-glb") });
  const h = await fixture(t, [preview, reopened]);
  assert.equal(h.thumbnail().src, "temporary-fallback", "a safe rendered fallback remains visible");
  h.ui.render();
  await flush();
  assert.deepEqual(preview.captures, [SOFA, SOFA], "loading/error fallback must not become a permanent cache hit");
  recovery.resolve(result("recovered-glb"));
  await flush();
  assert.equal(h.thumbnail().src, "recovered-glb");
  h.ui.render();
  await flush();
  assert.equal(h.thumbnail().src, "recovered-glb");
  assert.equal(preview.captures.length, 2);

  h.ui.setOpen(false);
  h.ui.setOpen(true);
  await flush();
  assert.deepEqual(reopened.captures, [SOFA], "a new preview epoch must not reuse the disposed renderer's thumbnail");
  assert.equal(h.thumbnail().src, "reopened-glb");
});
