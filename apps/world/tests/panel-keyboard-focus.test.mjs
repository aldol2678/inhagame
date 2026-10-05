import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryClient, INVENTORY_RPC } from "../src/inventory/inventory-client.js";
import { createInventoryPanel } from "../src/inventory/inventory-panel.js";
import { createLoadoutClient, APPEARANCE_SLOTS, LOADOUT_READ_RPC, LOADOUT_EQUIP_RPC, LOADOUT_UNEQUIP_RPC } from "../src/appearance/loadout-client.js";
import { createWardrobePanel } from "../src/appearance/wardrobe-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CAP = "head.inha_cap", OTHER = "head.induck_cap", TOP = "top.inha_basic";
const TIME = "2026-09-28T07:00:00+00:00";
const own = (itemId, catalogStatus = "ACTIVE") => ({ itemId, catalogStatus, quantity: 1,
  acquiredAt: TIME, updatedAt: TIME, sourceType: "SHOP", sourceRef: "fixture", eventId: null });
const worn = (itemId) => ({ itemId, catalogStatus: "ACTIVE", equippedAt: TIME });
const slots = (entries = {}) => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map(slot => [slot, entries[slot] ?? null])) });
const ok = data => ({ data, error: null });
const failed = { data: null, error: { message: "TEST_UNAVAILABLE" } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const byClass = (node, name) => walk(node).filter(el => el.className.split(/\s+/).includes(name));
const same = (actual, expected, message = "focus matches the live target") => assert.equal(actual === expected, true, message);
const close = h => byClass(h.panel, "profile-close")[0];
const body = h => byClass(h.panel, "shop-panel-body")[0];
const retry = h => byClass(h.panel, "shop-retry")[0];
const card = (h, id) => byClass(h.panel, "wardrobe-item").find(el => el.dataset.itemId === id);
const action = node => byClass(node, "wardrobe-action")[0];
const slotRow = (h, slot) => byClass(h.panel, "wardrobe-slot").find(el => el.dataset.slot === slot);

// Focus-aware mock DOM. Unlike the shared minimal fake, removing a focused subtree blurs it,
// disabled/detached controls cannot take focus, and every replacement resets the new body's scroll.
// Tab assertions check event passthrough only, not native traversal; this is not real-browser QA.
function focusDocument() {
  const doc = createFakeDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const node = create(tag), replace = node.replaceChildren.bind(node);
    node.scrollTop = 0;
    node.scrollLeft = 0;
    node.querySelector = selector => byClass(node, selector.slice(1))[0] ?? null;
    Object.defineProperty(node, "isConnected", { get: () => doc.body?.contains(node) ?? false });
    node.focus = options => {
      if (!node.isConnected || node.disabled) return;
      doc.activeElement = node;
      node.focusOptions = options;
    };
    node.replaceChildren = (...nodes) => {
      if (node !== doc.activeElement && node.contains(doc.activeElement)) doc.activeElement = doc.body;
      for (const child of node.children) child.parent = null;
      replace(...nodes);
    };
    return node;
  };
  doc.body = doc.createElement("body");
  doc.activeElement = doc.body;
  return doc;
}

function harness(kind, { onOpenChange = () => {} } = {}) {
  const doc = focusDocument(), panel = doc.createElement("section"), opener = doc.createElement("button"), outside = doc.createElement("button");
  panel.hidden = true;
  doc.body.append(opener, panel, outside);
  const queue = new Map(), calls = [];
  const client = { rpc(fn, args) {
    calls.push({ fn, args });
    assert.ok(queue.get(fn)?.length, `missing fixture for ${fn}`);
    return Promise.resolve(queue.get(fn).shift());
  } };
  const respond = (fn, value) => { if (!queue.has(fn)) queue.set(fn, []); queue.get(fn).push(value); };
  const inventory = createInventoryClient({ getClient: () => client });
  const loadout = createLoadoutClient({ getClient: () => client, createKey: () => `focus:${calls.length}` });
  const opened = [];
  const ui = (kind === "inventory" ? createInventoryPanel : createWardrobePanel)({ panel, doc, inventory, loadout,
    onOpenChange(value) { opened.push(value); onOpenChange(value); } });
  const h = { kind, doc, panel, opener, outside, inventory, loadout, ui, respond, calls, opened };
  h.open = async (items = [own(CAP), own(OTHER), own(TOP)], entries = {}) => {
    respond(INVENTORY_RPC, ok({ items }));
    await inventory.setAccount(A);
    if (kind === "wardrobe") { respond(LOADOUT_READ_RPC, ok(slots(entries))); await loadout.setAccount(A); }
    respond(INVENTORY_RPC, ok({ items }));
    if (kind === "wardrobe") respond(LOADOUT_READ_RPC, ok(slots(entries)));
    opener.focus(); ui.setOpen(true); await flush();
  };
  return h;
}

for (const kind of ["inventory", "wardrobe"]) {
  test(`${kind}: close retains focus through delayed initial load and consecutive refreshes`, async () => {
    const h = harness(kind), first = deferred(), second = deferred();
    h.respond(INVENTORY_RPC, first.promise);
    void h.inventory.setAccount(A);
    if (kind === "wardrobe") { h.respond(LOADOUT_READ_RPC, second.promise); void h.loadout.setAccount(A); }
    h.respond(INVENTORY_RPC, ok({ items: [own(CAP)] }));
    if (kind === "wardrobe") h.respond(LOADOUT_READ_RPC, ok(slots()));
    h.opener.focus(); h.ui.setOpen(true);
    same(h.doc.activeElement, close(h));
    first.resolve(ok({ items: [own(CAP)] })); second.resolve(ok(slots()));
    await flush();
    same(h.doc.activeElement, close(h), "focus must remain on the live replacement close button");
    h.ui.render();
    same(h.doc.activeElement, close(h));
  });

  test(`${kind}: read errors retain retry focus, recovery falls back to close`, async () => {
    const h = harness(kind); await h.open();
    const owner = kind === "inventory" ? h.inventory : h.loadout;
    const rpc = kind === "inventory" ? INVENTORY_RPC : LOADOUT_READ_RPC;
    h.respond(rpc, failed); await owner.refresh();
    retry(h).focus();
    h.respond(rpc, failed); retry(h).click(); await flush();
    same(h.doc.activeElement, retry(h));
    h.respond(rpc, kind === "inventory" ? ok({ items: [] }) : ok(slots()));
    retry(h).click(); await flush();
    same(h.doc.activeElement, close(h), "removed retry has a live safe fallback");
  });

  test(`${kind}: refresh preserves scroll without stealing focus outside the panel`, async () => {
    const h = harness(kind); await h.open();
    body(h).scrollTop = 240; body(h).scrollLeft = 12;
    h.outside.focus(); h.ui.render();
    same(h.doc.activeElement, h.outside);
    assert.equal(body(h).scrollTop, 240);
    assert.equal(body(h).scrollLeft, 12);
  });

  test(`${kind}: Escape and close restore this opening's trigger, repeat opens remain idempotent`, async () => {
    const h = harness(kind); await h.open();
    h.ui.setOpen(true);
    h.doc.dispatch("keydown", { code: "Escape" });
    same(h.doc.activeElement, h.opener);
    assert.equal(h.panel.hidden, true);
    h.respond(INVENTORY_RPC, ok({ items: [] }));
    if (kind === "wardrobe") h.respond(LOADOUT_READ_RPC, ok(slots()));
    h.outside.focus(); h.ui.setOpen(true); await flush();
    close(h).click();
    same(h.doc.activeElement, h.outside);
    assert.deepEqual(h.opened, [true, false, true, false]);
  });

  test(`${kind}: closing after focus leaves does not return to the opener`, async () => {
    const h = harness(kind); await h.open();
    h.outside.focus(); h.ui.setOpen(false);
    same(h.doc.activeElement, h.outside);
    h.ui.render();
    assert.equal(h.panel.children.length, 0);
  });

  test(`${kind}: callback-selected focus is not overwritten on close`, async () => {
    const h = harness(kind, { onOpenChange(open) { if (!open) h.outside.focus(); } });
    await h.open();
    h.ui.setOpen(false);
    same(h.doc.activeElement, h.outside);
  });

  test(`${kind}: native Tab / Shift+Tab remain unhandled and Escape still closes`, async () => {
    const h = harness(kind); await h.open();
    let prevented = 0;
    h.doc.dispatch("keydown", { code: "Tab", key: "Tab", preventDefault() { prevented += 1; } });
    h.doc.dispatch("keydown", { code: "Tab", key: "Tab", shiftKey: true, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 0);
    assert.equal(h.ui.open, true);
    h.doc.dispatch("keydown", { code: "Escape", key: "Escape" });
    assert.equal(h.ui.open, false);
  });
}

test("wardrobe: logical owned-item focus survives server reordering and unrelated updates", async () => {
  const h = harness("wardrobe"); await h.open();
  action(card(h, OTHER)).focus(); body(h).scrollTop = 180;
  h.respond(INVENTORY_RPC, ok({ items: [own(TOP), own(OTHER), own(CAP)] }));
  await h.inventory.refresh();
  same(h.doc.activeElement, action(card(h, OTHER)));
  assert.equal(body(h).scrollTop, 180);
  assert.deepEqual(h.doc.activeElement.focusOptions, { preventScroll: true });
});

test("wardrobe: equip and unequip keep context through disabled pending controls", async () => {
  const h = harness("wardrobe"); await h.open();
  for (const [rpc, entries, nextLabel] of [[LOADOUT_EQUIP_RPC, { HEAD: worn(CAP) }, "해제"], [LOADOUT_UNEQUIP_RPC, {}, "장착"]]) {
    const pending = deferred(); h.respond(rpc, pending.promise); h.respond(LOADOUT_READ_RPC, ok(slots(entries)));
    action(card(h, CAP)).focus(); action(card(h, CAP)).click();
    assert.equal(action(card(h, CAP)).disabled, true);
    same(h.doc.activeElement, card(h, CAP), "pending uses the same item as a programmatic focus anchor");
    assert.equal(card(h, CAP).tabIndex, -1, "anchor does not add a sequential tab stop");
    pending.resolve(ok({ status: "SUCCESS" })); await flush();
    same(h.doc.activeElement, action(card(h, CAP)));
    assert.equal(h.doc.activeElement.textContent, nextLabel);
  }
});

test("wardrobe: slot unequip moves to the same owned item rather than another slot's action", async () => {
  const h = harness("wardrobe"); await h.open(undefined, { HEAD: worn(CAP), TOP: worn(TOP) });
  h.respond(LOADOUT_UNEQUIP_RPC, ok({ status: "SUCCESS" })); h.respond(LOADOUT_READ_RPC, ok(slots({ TOP: worn(TOP) })));
  action(slotRow(h, "HEAD")).focus(); action(slotRow(h, "HEAD")).click(); await flush();
  same(h.doc.activeElement, action(card(h, CAP)));
});

test("wardrobe: failed mutation preserves the same retryable item action", async () => {
  const h = harness("wardrobe"); await h.open();
  h.respond(LOADOUT_EQUIP_RPC, failed);
  action(card(h, CAP)).focus(); action(card(h, CAP)).click(); await flush();
  same(h.doc.activeElement, action(card(h, CAP)));
  assert.equal(h.doc.activeElement.disabled, false);
});

test("wardrobe: removed item falls back to close; disabled item stays on its non-action anchor", async () => {
  const h = harness("wardrobe"); await h.open();
  action(card(h, CAP)).focus();
  h.respond(INVENTORY_RPC, ok({ items: [own(CAP, "DISABLED"), own(OTHER)] })); await h.inventory.refresh();
  same(h.doc.activeElement, card(h, CAP));
  h.respond(INVENTORY_RPC, ok({ items: [own(OTHER)] })); await h.inventory.refresh();
  same(h.doc.activeElement, close(h));
});

test("wardrobe: leaving the panel during equip prevents later focus restoration", async () => {
  const h = harness("wardrobe"); await h.open();
  const pending = deferred(); h.respond(LOADOUT_EQUIP_RPC, pending.promise); h.respond(LOADOUT_READ_RPC, ok(slots({ HEAD: worn(CAP) })));
  action(card(h, CAP)).focus(); action(card(h, CAP)).click(); h.outside.focus();
  pending.resolve(ok({ status: "SUCCESS" })); await flush();
  same(h.doc.activeElement, h.outside);
});

for (const kind of ["inventory", "wardrobe"]) {
  test(`${kind}: account changes discard old focus context, scroll and items`, async () => {
    const h = harness(kind); await h.open();
    if (kind === "wardrobe") action(card(h, CAP)).focus();
    body(h).scrollTop = 320;
    const pending = deferred(); h.respond(INVENTORY_RPC, pending.promise);
    void h.inventory.setAccount(B);
    if (kind === "wardrobe") { h.respond(LOADOUT_READ_RPC, ok(slots())); void h.loadout.setAccount(B); }
    same(h.doc.activeElement, close(h));
    assert.equal(body(h).scrollTop, 0);
    assert.equal(byClass(h.panel, "inventory-item").length, 0);
    pending.resolve(ok({ items: [own(CAP)] })); await flush();
    same(h.doc.activeElement, close(h), "same item ID in the new account does not revive the old action");
    void h.inventory.setAccount(null);
    if (kind === "wardrobe") void h.loadout.setAccount(null);
    assert.equal(byClass(h.panel, "inventory-item").length, 0);
    same(h.doc.activeElement, close(h));
  });
}

test("wardrobe: the first account-boundary notification also clears old slot names and success hints", async () => {
  const h = harness("wardrobe"); await h.open();
  h.respond(LOADOUT_EQUIP_RPC, ok({ status: "SUCCESS" })); h.respond(LOADOUT_READ_RPC, ok(slots({ HEAD: worn(CAP) })));
  action(card(h, CAP)).focus(); action(card(h, CAP)).click(); await flush();
  assert.match(byClass(h.panel, "shop-hint")[0].textContent, /장착 완료/);
  const pending = deferred(); h.respond(INVENTORY_RPC, pending.promise);
  void h.inventory.setAccount(B);
  assert.equal(byClass(h.panel, "wardrobe-slot").length, 0, "do not show A's loadout while the two owners cross the boundary");
  assert.equal(byClass(h.panel, "shop-hint")[0].textContent, "", "old item names must not survive in status text");
  same(h.doc.activeElement, close(h));
  pending.resolve(ok({ items: [] })); await flush();
});

for (const kind of ["inventory", "wardrobe"]) {
  test(`${kind}: closing during a delayed read leaves the trigger focused after the response`, async () => {
    const h = harness(kind); await h.open();
    const owner = kind === "inventory" ? h.inventory : h.loadout;
    const rpc = kind === "inventory" ? INVENTORY_RPC : LOADOUT_READ_RPC;
    const pending = deferred(); h.respond(rpc, pending.promise); const reading = owner.refresh();
    close(h).focus(); close(h).click();
    same(h.doc.activeElement, h.opener);
    pending.resolve(kind === "inventory" ? ok({ items: [] }) : ok(slots())); await reading;
    same(h.doc.activeElement, h.opener);
    assert.equal(h.panel.children.length, 0);
  });
}

test("wardrobe: a mutation finishing its old-account refresh cannot publish an old item hint", async () => {
  const h = harness("wardrobe"); await h.open();
  const oldRead = deferred();
  h.respond(LOADOUT_EQUIP_RPC, ok({ status: "SUCCESS" })); h.respond(LOADOUT_READ_RPC, oldRead.promise);
  action(card(h, CAP)).focus(); action(card(h, CAP)).click(); await flush();
  // The write succeeded, but its follow-up read has not returned. Change both owners before it does.
  h.respond(INVENTORY_RPC, ok({ items: [own(TOP)] })); h.respond(LOADOUT_READ_RPC, ok(slots()));
  void h.inventory.setAccount(B); void h.loadout.setAccount(B); await flush();
  oldRead.resolve(ok(slots({ HEAD: worn(CAP) }))); await flush();
  assert.equal(byClass(h.panel, "shop-hint")[0].textContent, "");
  assert.equal(card(h, CAP), undefined);
  same(h.doc.activeElement, close(h));
});


test("wardrobe: changing focus to another item during a mutation keeps the newer choice", async () => {
  const h = harness("wardrobe"); await h.open();
  const pending = deferred(); h.respond(LOADOUT_EQUIP_RPC, pending.promise); h.respond(LOADOUT_READ_RPC, ok(slots({ HEAD: worn(CAP) })));
  action(card(h, CAP)).focus(); action(card(h, CAP)).click();
  action(card(h, TOP)).focus();
  pending.resolve(ok({ status: "SUCCESS" })); await flush();
  same(h.doc.activeElement, action(card(h, TOP)));
});

test("wardrobe: a slot replacement never transfers focus to a different item's unequip action", async () => {
  const h = harness("wardrobe"); await h.open(undefined, { HEAD: worn(CAP) });
  action(slotRow(h, "HEAD")).focus();
  h.respond(LOADOUT_READ_RPC, ok(slots({ HEAD: worn(OTHER) }))); await h.loadout.refresh();
  same(h.doc.activeElement, action(card(h, CAP)));
});

test("wardrobe: switching away and back while closed invalidates an earlier item's status result", async () => {
  const h = harness("wardrobe"); await h.open();
  const oldRead = deferred();
  h.respond(LOADOUT_EQUIP_RPC, ok({ status: "SUCCESS" })); h.respond(LOADOUT_READ_RPC, oldRead.promise);
  action(card(h, CAP)).focus(); action(card(h, CAP)).click(); await flush(); h.ui.setOpen(false);
  for (const account of [B, A]) {
    h.respond(INVENTORY_RPC, ok({ items: [own(TOP)] })); h.respond(LOADOUT_READ_RPC, ok(slots()));
    await h.inventory.setAccount(account); await h.loadout.setAccount(account);
  }
  h.respond(INVENTORY_RPC, ok({ items: [own(TOP)] })); h.respond(LOADOUT_READ_RPC, ok(slots()));
  h.opener.focus(); h.ui.setOpen(true); await flush();
  oldRead.resolve(ok(slots({ HEAD: worn(CAP) }))); await flush();
  assert.equal(byClass(h.panel, "shop-hint")[0].textContent, "");
  same(h.doc.activeElement, close(h));
});
