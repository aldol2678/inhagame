import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPEARANCE_SLOTS, LOADOUT_STATE, createLoadoutClient } from "../src/appearance/loadout-client.js";
import { EMPTY_SLOT_TEXT, createWardrobePanel, slotView, wardrobeCandidates, wardrobeMessage } from "../src/appearance/wardrobe-panel.js";
import { createInventoryClient } from "../src/inventory/inventory-client.js";
import { DEFAULT_ITEM_IDS, getItemDefinition } from "../src/collection/item-catalog.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T = "2026-09-28T07:00:00+00:00";
const own = (itemId, extra = {}) => ({ itemId, quantity: 1, acquiredAt: T, updatedAt: T, sourceType: "SHOP",
  sourceRef: "ref", eventId: null, catalogStatus: "ACTIVE", ...extra });
const worn = (itemId, catalogStatus = "ACTIVE") => ({ itemId, catalogStatus, equippedAt: T });
const slotsRead = (over = {}) => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map((s) => [s, over[s] ?? null])) });
const ok = (data) => ({ data, error: null });
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function walk(node, out = []) { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; }
const byClass = (root, name) => walk(root).filter((n) => (n.className ?? "").split(/\s+/).includes(name));
const text = (node) => walk(node).map((n) => n.textContent).join(" ");
const slotRow = (root, slot) => byClass(root, "wardrobe-slot").find((n) => n.dataset.slot === slot);
const card = (root, itemId) => byClass(root, "wardrobe-item").find((n) => n.dataset.itemId === itemId);
const action = (node) => byClass(node, "wardrobe-action")[0];

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
const INV = "get_my_world_inventory_v1";
const READ = "get_my_world_appearance_loadout_v1";
const EQUIP = "equip_my_world_item_v1";
const UNEQUIP = "unequip_my_world_item_v1";

function harness({ signedIn = true } = {}) {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const client = fakeClient();
  const getClient = () => (signedIn ? client : null);
  const inventory = createInventoryClient({ getClient });
  const loadout = createLoadoutClient({ getClient, createKey: () => `appearance:${client.calls.length}` });
  const statuses = [];
  const changes = [];
  const ui = createWardrobePanel({ panel, loadout, inventory, doc, onStatus: (m) => statuses.push(m), onChange: (r) => changes.push(r) });
  return { doc, panel, client, inventory, loadout, ui, statuses, changes };
}
async function openWith(h, { items = [], slots = {} } = {}) {
  // identity reads + the panel-open reads
  for (let i = 0; i < 2; i += 1) { h.client.respond(INV, ok({ items })); h.client.respond(READ, ok(slotsRead(slots))); }
  void h.inventory.setAccount(A);
  void h.loadout.setAccount(A);
  h.ui.setOpen(true);
  await flush();
}
const OWNED = [own("head.inha_cap"), own("head.induck_cap", { catalogStatus: "COMING_SOON" }), own("top.inha_basic"),
  own("back.freshman_bag"), own("badge.main_gate", { catalogStatus: "COMING_SOON" }), own("furniture.induck_chair"),
  own("memorabilia.campus_mug"), own("head.future_hat", { catalogStatus: "UNKNOWN_ITEM" })];

test("nine slots rendered from the server read; empty slots say so", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  assert.deepEqual(byClass(h.panel, "wardrobe-slot").map((r) => r.dataset.slot), APPEARANCE_SLOTS);
  assert.ok(APPEARANCE_SLOTS.every((slot) => text(slotRow(h.panel, slot)).includes(EMPTY_SLOT_TEXT)));
  assert.match(text(h.panel), /👕 옷장/);
  assert.match(text(h.panel), /머리 · HEAD/);
  assert.doesNotMatch(text(h.panel), /BADGE/, "BADGE is not an appearance slot");
  assert.equal(h.client.count(READ), 2, "identity read + panel open read");
  assert.equal(h.client.count(INV), 2);
});

test("an equipped slot shows the item and 해제; the server loadout is the only equipped authority", async () => {
  const h = harness();
  await openWith(h, { items: OWNED, slots: { HEAD: worn("head.induck_cap", "COMING_SOON") } });
  const head = slotRow(h.panel, "HEAD");
  assert.match(text(head), new RegExp(getItemDefinition("head.induck_cap").displayName));
  assert.match(text(head), /준비 중/);
  assert.equal(action(head).textContent, "해제");
  assert.equal(card(h.panel, "head.induck_cap").dataset.equipped, "true");
  assert.equal(action(card(h.panel, "head.induck_cap")).textContent, "해제", "already worn → 해제");
  assert.equal(action(card(h.panel, "head.inha_cap")).textContent, "장착", "another HEAD item → 장착 (replace)");
  // Owned DEFAULT items are not worn unless the server loadout says so.
  for (const id of DEFAULT_ITEM_IDS.filter((i) => i !== "head.induck_cap")) {
    if (card(h.panel, id)) assert.equal(card(h.panel, id).dataset.equipped, "false", `${id} is not auto-equipped`);
  }
  assert.equal(text(slotRow(h.panel, "TOP")).includes(EMPTY_SLOT_TEXT), true, "owning top.inha_basic does not fill TOP");
});

test("candidates: owned WEARABLE rows only, catalog presentation, badge / furniture / memorabilia excluded", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  const ids = byClass(h.panel, "wardrobe-item").map((c) => c.dataset.itemId);
  assert.deepEqual(ids, ["head.inha_cap", "head.induck_cap", "top.inha_basic", "back.freshman_bag"], "server order, wearables only");
  const hat = card(h.panel, "head.inha_cap");
  assert.equal(hat.dataset.slot, "HEAD");
  assert.match(text(hat), new RegExp(getItemDefinition("head.inha_cap").description));
  assert.match(text(hat), /머리 · 일반/);
  // A wearable the catalog knows but the account does not own is never offered.
  assert.equal(card(h.panel, "top.induck_hoodie"), undefined);
});

test("an owned item the catalog does not know keeps its ownership, but no slot is guessed", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  const unknown = byClass(h.panel, "wardrobe-unknown-item");
  assert.deepEqual(unknown.map((n) => n.dataset.itemId), ["head.future_hat"]);
  assert.match(text(h.panel), /장착 정보 확인 불가/);
  assert.equal(card(h.panel, "head.future_hat"), undefined, "not a candidate: the prefix is not a slot authority");
  const { unknown: pure } = wardrobeCandidates([own("zzz.not_known")], {});
  assert.equal(pure[0].itemId, "zzz.not_known");
});

test("an unknown item in the server loadout is shown by itemId, not hidden", () => {
  const view = slotView("HEAD", worn("head.retired_hat", "UNKNOWN_ITEM"));
  assert.deepEqual([view.name, view.statusText, view.empty], ["head.retired_hat", "정보 없음", false]);
  assert.equal(slotView("TOP", null).name, EMPTY_SLOT_TEXT);
});

test("catalog status: ACTIVE / COMING_SOON / LOCKED equippable; DISABLED / HIDDEN / UNKNOWN_ITEM disabled; worn items can be taken off", async () => {
  const items = ["ACTIVE", "COMING_SOON", "LOCKED", "DISABLED", "HIDDEN", "UNKNOWN_ITEM"]
    .map((status, i) => ({ status, id: ["head.inha_cap", "head.induck_cap", "top.inha_basic", "back.freshman_bag", "top.induck_hoodie", "shoes.campus_sneakers"][i] }));
  const h = harness();
  await openWith(h, { items: items.map(({ id, status }) => own(id, { catalogStatus: status })),
    slots: { BACK: worn("back.freshman_bag", "DISABLED") } });
  for (const { id, status } of items) {
    const btn = action(card(h.panel, id));
    if (id === "back.freshman_bag") {
      assert.deepEqual([btn.textContent, btn.disabled], ["해제", false], "a worn DISABLED item can be taken off");
    } else {
      assert.equal(btn.disabled, ["DISABLED", "HIDDEN", "UNKNOWN_ITEM"].includes(status), `${status}`);
    }
  }
  assert.match(text(slotRow(h.panel, "BACK")), /사용 중지/, "the worn DISABLED item stays shown");
  assert.equal(action(slotRow(h.panel, "BACK")).disabled, false);
});

test("equip → server re-read shows it; replace; unequip; ownership untouched", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  h.client.respond(EQUIP, ok({ status: "SUCCESS" }));
  h.client.respond(READ, ok(slotsRead({ HEAD: worn("head.inha_cap") })));
  action(card(h.panel, "head.inha_cap")).click();
  assert.equal(action(card(h.panel, "head.inha_cap")).textContent, "처리 중…");
  await flush();
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "head.inha_cap");
  assert.deepEqual(h.statuses, [`장착 완료 · ${getItemDefinition("head.inha_cap").displayName}`]);
  const equipCall = h.client.calls.find((c) => c.fn === EQUIP);
  assert.deepEqual([equipCall.args.p_slot, equipCall.args.p_item_id], ["HEAD", "head.inha_cap"], "slot from the catalog, not guessed");
  h.client.respond(EQUIP, ok({ status: "SUCCESS" }));
  h.client.respond(READ, ok(slotsRead({ HEAD: worn("head.induck_cap", "COMING_SOON") })));
  action(card(h.panel, "head.induck_cap")).click();
  await flush();
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "head.induck_cap", "replaced");
  h.client.respond(UNEQUIP, ok({ status: "SUCCESS" }));
  h.client.respond(READ, ok(slotsRead()));
  action(slotRow(h.panel, "HEAD")).click();
  await flush();
  assert.match(text(slotRow(h.panel, "HEAD")), new RegExp(EMPTY_SLOT_TEXT));
  assert.equal(h.inventory.snapshot.items.length, OWNED.length, "ownership unchanged by wardrobe writes");
  assert.equal(h.client.count(INV), 2, "a successful write does not rewrite ownership");
});

test("a click is never trusted as state: the success response alone does not mark a slot", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  h.client.respond(EQUIP, ok({ status: "SUCCESS" }));
  h.client.respond(READ, ok(slotsRead()));  // the server read still says empty
  action(card(h.panel, "top.inha_basic")).click();
  await flush();
  assert.match(text(slotRow(h.panel, "TOP")), new RegExp(EMPTY_SLOT_TEXT), "the panel shows the server read, not the click");
});

test("server refusals map to short text; raw messages never shown; refusals report upward", async () => {
  const expected = {
    ITEM_NOT_OWNED: "보유한 아이템만 장착할 수 있어요", ITEM_NOT_EQUIPPABLE: "착용할 수 없는 아이템이에요",
    SLOT_MISMATCH: "이 슬롯에는 장착할 수 없어요", ITEM_UNAVAILABLE: "현재 장착할 수 없는 아이템이에요",
    UNKNOWN_ITEM: "아이템 정보를 확인할 수 없어요", PERMANENT_ACCOUNT_REQUIRED: "로그인한 계정만 옷장을 이용할 수 있어요",
    ACCOUNT_UNAVAILABLE: "현재 이 계정으로는 옷장을 이용할 수 없어요"
  };
  for (const [code, message] of Object.entries(expected)) assert.equal(wardrobeMessage(code), message);
  assert.match(wardrobeMessage("IDEMPOTENCY_CONFLICT"), /다시 시도/);
  assert.match(wardrobeMessage("INVALID_APPEARANCE_SLOT"), /변경하지 못했어요/);
  const h = harness();
  await openWith(h, { items: OWNED });
  h.client.respond(EQUIP, { data: null, error: { message: "ITEM_NOT_OWNED" } });
  h.client.respond(READ, ok(slotsRead()));
  action(card(h.panel, "top.inha_basic")).click();
  await flush();
  assert.match(text(h.panel), /보유한 아이템만 장착할 수 있어요/);
  assert.equal(h.changes.at(-1).outcome, "REFUSED", "the owner is told so it can re-read ownership");
  h.client.respond(EQUIP, { data: null, error: { message: "internal: relation private.world_player_items" } });
  action(card(h.panel, "top.inha_basic")).click();
  await flush();
  assert.doesNotMatch(text(h.panel), /private|relation|internal/);
  assert.deepEqual(h.statuses, []);
});

test("guest / signed-out: login message, zero loadout and write RPCs", async () => {
  const h = harness({ signedIn: false });
  void h.inventory.setAccount(A);
  void h.loadout.setAccount(A);
  h.ui.setOpen(true);
  await flush();
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만 옷장을 이용할 수 있어요/);
  assert.equal(h.client.calls.length, 0);
});

test("account switch while open: the previous account's slots and items vanish at once", async () => {
  const h = harness();
  await openWith(h, { items: OWNED, slots: { HEAD: worn("head.inha_cap") } });
  let resolveInv; let resolveRead;
  h.client.respond(INV, new Promise((r) => { resolveInv = r; }));
  h.client.respond(READ, new Promise((r) => { resolveRead = r; }));
  void h.inventory.setAccount(B);
  void h.loadout.setAccount(B);
  assert.equal(byClass(h.panel, "wardrobe-item").length, 0);
  assert.equal(byClass(h.panel, "wardrobe-slot").length, 0);
  assert.match(text(h.panel), /옷장을 불러오는 중/);
  resolveInv(ok({ items: [own("top.inha_basic")] }));
  resolveRead(ok(slotsRead()));
  await flush();
  assert.deepEqual(byClass(h.panel, "wardrobe-item").map((c) => c.dataset.itemId), ["top.inha_basic"]);
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "");
});

test("inventory failure keeps the loadout (authority unchanged); loadout failure does not block the inventory", async () => {
  const h = harness();
  h.client.respond(INV, { data: null, error: { message: "boom" } });
  h.client.respond(INV, { data: null, error: { message: "boom" } });
  h.client.respond(READ, ok(slotsRead({ HEAD: worn("head.inha_cap") })));
  h.client.respond(READ, ok(slotsRead({ HEAD: worn("head.inha_cap") })));
  void h.inventory.setAccount(A);
  void h.loadout.setAccount(A);
  h.ui.setOpen(true);
  await flush();
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "head.inha_cap", "worn state still from the server loadout");
  assert.match(text(h.panel), /보유 아이템을 불러오지 못했어요/);
  const h2 = harness();
  h2.client.respond(INV, ok({ items: OWNED }));
  h2.client.respond(READ, { data: null, error: { message: "boom" } });
  await h2.inventory.setAccount(A);
  await h2.loadout.setAccount(A);
  assert.equal(h2.loadout.state, LOADOUT_STATE.UNAVAILABLE);
  assert.equal(h2.inventory.snapshot.items.length, OWNED.length, "inventory unaffected by a loadout failure");
});

test("open / × / Escape; panel requires its clients", async () => {
  const h = harness();
  await openWith(h, { items: OWNED });
  byClass(h.panel, "profile-close")[0].click();
  assert.equal(h.ui.open, false);
  h.ui.setOpen(true);
  h.doc.dispatch("keydown", { code: "Escape" });
  assert.equal(h.ui.open, false);
  assert.throws(() => createWardrobePanel({}), /panel, loadout and inventory/);
});

test("panel code: no RPC, no storage, no avatar or Realtime change", () => {
  const panel = source("../src/appearance/wardrobe-panel.js");
  assert.doesNotMatch(panel, /\.rpc\(|createClient\(|localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /character\.|avatar\.set|broadcast|setAppearance|online\./);
  assert.doesNotMatch(panel, /split\(['"]\.['"]\)/, "never derives a slot from the item id");
});

test("main.js wiring: member client, identity, open, purchase + reward refresh both, resume, modal gate", () => {
  const main = source("../src/main.js");
  assert.match(main, /createLoadoutClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/);
  assert.match(main, /void loadout\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  assert.match(main, /onPurchase: \(\) => \{\s*void inventory\.refresh\("purchase"\);\s*void loadout\.refresh\("purchase"\);\s*\}/);
  assert.match(main, /void inventory\.refresh\("reward"\);\s*void loadout\.refresh\("reward"\);/);
  assert.match(main, /addEventListener\("pageshow"[\s\S]*?void loadout\.refresh\("resume"\)/);
  assert.match(main, /ownerId: "wardrobe".*policy: INPUT_FOCUS_POLICY\.BLOCKING_UI/s,
    "an open wardrobe suspends world actions through InputFocusManager");
  assert.equal((main.match(/createWardrobePanel\(/g) ?? []).length, 1);
  assert.doesNotMatch(main, /setInterval\([^)]*loadout/);
  // The wardrobe never changes the avatar or the network payload in P0.
  assert.doesNotMatch(main, /loadout\.[a-zA-Z]+\([^)]*\)[^;\n]*(character|avatar|network|broadcast)/);
});

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const ownedRetry = (h) => byClass(h.panel, "wardrobe-owned").flatMap((section) => byClass(section, "shop-retry"))[0];
const body = (h) => byClass(h.panel, "shop-panel-body")[0];
const fail = { data: null, error: { message: "internal: private.inventory unavailable" } };
async function openInventoryFailure(h) {
  for (let i = 0; i < 2; i += 1) {
    h.client.respond(INV, fail);
    h.client.respond(READ, ok(slotsRead({ HEAD: worn("head.inha_cap") })));
  }
  void h.inventory.setAccount(A);
  void h.loadout.setAccount(A);
  h.ui.setOpen(true);
  await flush();
  assert.ok(ownedRetry(h), "owned inventory errors need an inline retry control");
}

test("owned retry reads only inventory, keeps current loadout and prevents repeated clicks", async () => {
  const h = harness();
  await openInventoryFailure(h);
  const previousLoadout = h.loadout.snapshot;
  const pending = deferred();
  h.client.respond(INV, pending.promise);
  const retry = ownedRetry(h);
  assert.equal(retry.tagName, "BUTTON", "native keyboard activation");
  assert.equal(retry.type, "button");
  assert.equal(retry.getAttribute("aria-label"), "보유 아이템 다시 불러오기");
  retry.focus();
  body(h).scrollTop = 137;
  body(h).scrollLeft = 9;
  retry.click();
  retry.click();
  ownedRetry(h).click();
  assert.equal(ownedRetry(h).disabled, true);
  assert.match(text(h.panel), /보유 아이템을 불러오는 중/);
  assert.equal(h.client.count(INV), 3, "one retry read despite repeated clicks");
  assert.equal(h.loadout.snapshot, previousLoadout);
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "head.inha_cap");
  assert.equal(h.doc.activeElement, byClass(h.panel, "wardrobe-owned")[0], "pending focus has a live non-action anchor");
  assert.equal(h.doc.activeElement.tabIndex, -1);
  assert.equal(body(h).scrollTop, 137);
  assert.equal(body(h).scrollLeft, 9);
  pending.resolve(ok({ items: OWNED }));
  await flush();
  assert.ok(card(h.panel, "head.inha_cap"));
  assert.equal(ownedRetry(h), undefined);
  assert.equal(h.doc.activeElement, byClass(h.panel, "profile-close")[0], "successful recovery follows existing close-focus fallback");
  assert.equal(body(h).scrollTop, 137);
  assert.equal(h.loadout.snapshot, previousLoadout);
  assert.deepEqual([h.client.count(READ), h.client.count(EQUIP), h.client.count(UNEQUIP)], [2, 0, 0]);
  assert.deepEqual(h.changes, []);
  assert.deepEqual(h.statuses, []);
});

test("owned retry failure restores a keyboard-reachable action without exposing the raw error", async () => {
  const h = harness();
  await openInventoryFailure(h);
  h.client.respond(INV, fail);
  ownedRetry(h).focus();
  ownedRetry(h).click();
  await flush();
  assert.equal(ownedRetry(h).disabled, false);
  assert.equal(h.doc.activeElement, ownedRetry(h));
  assert.match(text(h.panel), /보유 아이템을 불러오지 못했어요/);
  assert.doesNotMatch(text(h.panel), /internal|private\.inventory/);
  h.client.respond(INV, ok({ items: [] }));
  ownedRetry(h).click();
  await flush();
  assert.match(text(h.panel), /보유한 착용 아이템이 없어요/);
  assert.equal(ownedRetry(h), undefined);
  assert.equal(h.client.count(INV), 4);
});

test("owned retry joins an existing read and keeps disabled through its one coalesced rerun", async () => {
  const h = harness();
  await openInventoryFailure(h);
  const first = deferred(); const second = deferred();
  h.client.respond(INV, first.promise);
  h.client.respond(INV, second.promise);
  const refresh = h.inventory.refresh("reward");
  ownedRetry(h).click();
  ownedRetry(h).click();
  assert.equal(h.client.count(INV), 3, "retry never starts a parallel RPC");
  first.resolve(fail);
  await flush();
  assert.equal(h.client.count(INV), 4, "existing client coalesces refresh requests into one follow-on read");
  assert.equal(ownedRetry(h).disabled, true);
  ownedRetry(h).click();
  second.resolve(ok({ items: OWNED }));
  await refresh;
  await flush();
  assert.equal(h.client.count(INV), 4, "disabled clicks do not queue more reads");
  assert.ok(card(h.panel, "head.inha_cap"));
});

test("closing during an owned retry leaves the panel hidden and returns focus to the opener", async () => {
  const h = harness();
  const opener = h.doc.createElement("button");
  opener.focus();
  await openInventoryFailure(h);
  const pending = deferred();
  h.client.respond(INV, pending.promise);
  ownedRetry(h).focus();
  const detachedRetry = ownedRetry(h);
  detachedRetry.click();
  h.doc.dispatch("keydown", { code: "Escape" });
  assert.equal(h.doc.activeElement, opener);
  detachedRetry.click();
  pending.resolve(ok({ items: OWNED }));
  await flush();
  assert.equal(h.ui.open, false);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.panel.children.length, 0);
  assert.equal(h.doc.activeElement, opener);
  assert.equal(h.client.count(INV), 3);
});

test("an old account's late retry cannot reveal items or unlock the new account's pending retry", async () => {
  const h = harness();
  await openInventoryFailure(h);
  const oldRead = deferred();
  h.client.respond(INV, oldRead.promise);
  ownedRetry(h).focus();
  const oldButton = ownedRetry(h);
  oldButton.click();
  body(h).scrollTop = 180;
  h.client.respond(INV, fail);
  h.client.respond(READ, ok(slotsRead({ TOP: worn("top.inha_basic") })));
  void h.inventory.setAccount(B);
  void h.loadout.setAccount(B);
  await flush();
  assert.equal(ownedRetry(h).disabled, false, "the new account has its own retry state");
  assert.equal(body(h).scrollTop, 0, "account boundary resets scroll");
  assert.equal(h.doc.activeElement, byClass(h.panel, "profile-close")[0]);
  assert.equal(slotRow(h.panel, "HEAD").dataset.itemId, "");
  const before = h.client.count(INV);
  oldButton.click();
  assert.equal(h.client.count(INV), before, "detached old-account controls cannot act for the new account");
  const currentRead = deferred();
  h.client.respond(INV, currentRead.promise);
  ownedRetry(h).click();
  oldRead.resolve(ok({ items: [own("head.inha_cap")] }));
  await flush();
  assert.equal(ownedRetry(h).disabled, true);
  assert.equal(card(h.panel, "head.inha_cap"), undefined);
  currentRead.resolve(ok({ items: [own("top.inha_basic")] }));
  await flush();
  assert.deepEqual(byClass(h.panel, "wardrobe-item").map((row) => row.dataset.itemId), ["top.inha_basic"]);
  assert.equal(slotRow(h.panel, "TOP").dataset.itemId, "top.inha_basic");
});

test("signing out during owned retry ignores its response and leaves no retry control", async () => {
  const h = harness();
  await openInventoryFailure(h);
  const pending = deferred();
  h.client.respond(INV, pending.promise);
  const retry = ownedRetry(h);
  retry.click();
  void h.loadout.setAccount(null);
  void h.inventory.setAccount(null);
  retry.click();
  pending.resolve(ok({ items: OWNED }));
  await flush();
  assert.equal(ownedRetry(h), undefined);
  assert.equal(byClass(h.panel, "wardrobe-slot").length, 0);
  assert.equal(byClass(h.panel, "wardrobe-item").length, 0);
  assert.match(text(h.panel), /로그인한 INHAGAME 계정만/);
  assert.equal(h.client.count(INV), 3);
});
