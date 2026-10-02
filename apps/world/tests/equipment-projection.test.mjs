import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROJECTABLE_CATALOG_STATUSES, SLOT_PROJECTION, createEquipmentProjection, resolveSlotProjection
} from "../src/appearance/equipment-projection.js";
import { EQUIPMENT_SLOTS } from "../src/appearance/equipment-anchors.js";
import { EQUIPMENT_MODEL_REGISTRY, createEquipmentModelLoader } from "../src/appearance/equipment-asset-loader.js";
import { ITEM_CATALOG, getItemDefinition } from "../src/collection/item-catalog.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

class FakeEntity {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.destroyed = false; }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
  destroy() { this.destroyed = true; this.parent?.removeChild(this); }
}

// Loadout client double with the real client's public surface (state / snapshot / accountId / onChange).
function fakeLoadout() {
  const listeners = new Set();
  const loadout = {
    state: "SIGNED_OUT", snapshot: null, accountId: null,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get listenerCount() { return listeners.size; },
    emit(state, slots, accountId = loadout.accountId, reason = "refresh") {
      loadout.state = state;
      loadout.accountId = accountId;
      loadout.snapshot = slots ? { slots: Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, slots[s] ?? null])) } : null;
      for (const l of listeners) l({ state, snapshot: loadout.snapshot, accountId, reason, pending: new Set() });
    }
  };
  return loadout;
}
const entry = (itemId, catalogStatus = "ACTIVE") => ({ itemId, catalogStatus, equippedAt: "2026-09-28T01:00:00+00:00" });

// Test-only catalog view: real definitions plus fixture model bindings (the shipped catalog has none).
const FIXTURE_MODELS = { "head.inha_cap": "fixture.head_cap", "back.freshman_bag": "fixture.back_bag", "top.inha_basic": "fixture.top_basic", "head.inkyung_duck": "fixture.head_duck" };
const describeWithModels = (itemId) => {
  const def = getItemDefinition(itemId);
  return def && FIXTURE_MODELS[itemId] ? { ...def, modelAssetId: FIXTURE_MODELS[itemId] } : def;
};

function fakeLoader({ manual = false } = {}) {
  const calls = [];
  const pending = [];
  const created = [];
  const loadModel = (modelAssetId, context) => {
    calls.push({ modelAssetId, ...context });
    const make = () => { const e = new FakeEntity(`Model_${modelAssetId}`); created.push(e); return e; };
    if (!manual) return Promise.resolve(make());
    return new Promise((resolve, reject) => pending.push({ modelAssetId, resolve: () => resolve(make()), reject, resolveWith: resolve }));
  };
  return { loadModel, calls, pending, created };
}

function rig({ describe = describeWithModels, loader = fakeLoader(), loadout = fakeLoadout() } = {}) {
  const anchors = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, new FakeEntity(`Equipment_${slot}`)]));
  const projection = createEquipmentProjection({ loadout, getAnchor: (slot) => anchors[slot] ?? null, describe, loadModel: loader.loadModel });
  return { projection, loadout, anchors, loader };
}

// ── Pure eligibility ─────────────────────────────────────────────────────────────────────────────
test("1. eligibility: empty slot → EMPTY", () => {
  assert.equal(resolveSlotProjection("HEAD", null, describeWithModels).kind, SLOT_PROJECTION.EMPTY);
});
test("2. eligibility: eligible WEARABLE with a bound model → load requested", () => {
  assert.deepEqual(resolveSlotProjection("HEAD", entry("head.inha_cap"), describeWithModels),
    { kind: SLOT_PROJECTION.PENDING, itemId: "head.inha_cap", modelAssetId: "fixture.head_cap" });
});
test("3. eligibility: ACTIVE, COMING_SOON and LOCKED project; DISABLED, HIDDEN, UNKNOWN_ITEM do not", () => {
  assert.deepEqual(PROJECTABLE_CATALOG_STATUSES, ["ACTIVE", "COMING_SOON", "LOCKED"]);
  for (const status of ["ACTIVE", "COMING_SOON", "LOCKED"]) assert.equal(resolveSlotProjection("HEAD", entry("head.inha_cap", status), describeWithModels).kind, SLOT_PROJECTION.PENDING, status);
  for (const status of ["DISABLED", "HIDDEN", "UNKNOWN_ITEM", "", undefined]) assert.equal(resolveSlotProjection("HEAD", { itemId: "head.inha_cap", catalogStatus: status }, describeWithModels).kind, SLOT_PROJECTION.HIDDEN, String(status));
});
test("4. eligibility: an item the local catalog does not know is hidden", () => {
  assert.equal(resolveSlotProjection("HEAD", entry("head.future_hat"), describeWithModels).kind, SLOT_PROJECTION.HIDDEN);
});
test("5. eligibility: non-WEARABLE categories never project (badge, emote, furniture…)", () => {
  const describe = (id) => ({ ...getItemDefinition(id), modelAssetId: "fixture.any" });
  for (const def of ITEM_CATALOG.filter((d) => d.category !== "WEARABLE")) {
    assert.equal(resolveSlotProjection("HEAD", entry(def.itemId), describe).kind, SLOT_PROJECTION.HIDDEN, def.itemId);
  }
});
test("6. eligibility: equipSlot must match the slot (a hat in BACK is hidden)", () => {
  assert.equal(resolveSlotProjection("BACK", entry("head.inha_cap"), describeWithModels).kind, SLOT_PROJECTION.HIDDEN);
});
test("7. eligibility: modelAssetId null → NO_ASSET (normal P0 state), not failed", () => {
  assert.equal(resolveSlotProjection("HEAD", entry("head.inha_cap")).kind, SLOT_PROJECTION.NO_ASSET);
  assert.equal(resolveSlotProjection("HEAD", entry("head.inha_cap"), (id) => ({ ...getItemDefinition(id), modelAssetId: "" })).kind, SLOT_PROJECTION.NO_ASSET);
});
test("8. shipped catalog: only the bound wearables resolve to a model; every other wearable is NO_ASSET", () => {
  const bound = { "head.induck_cap": "equipment.head.induck_cap.v1", "back.induck_backpack": "equipment.back.induck_backpack.v1",
    "top.induck_hoodie": "equipment.top.induck_hoodie.v1", "top.mcm_2026_survivor": "equipment.top.mcm_2026_survivor.v1" };
  for (const def of ITEM_CATALOG.filter((d) => d.category === "WEARABLE")) {
    assert.equal(def.modelAssetId, bound[def.itemId] ?? null, def.itemId);
    assert.equal(resolveSlotProjection(def.equipSlot, entry(def.itemId)).kind,
      bound[def.itemId] ? SLOT_PROJECTION.PENDING : SLOT_PROJECTION.NO_ASSET, def.itemId);
  }
});

// ── Projection lifecycle ─────────────────────────────────────────────────────────────────────────
test("9. production catalog: an equipped READY loadout never calls the loader and adds no entity", async () => {
  const loader = fakeLoader();
  const { projection, loadout, anchors } = rig({ describe: getItemDefinition, loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap"), TOP: entry("top.inha_basic"), BACK: entry("back.freshman_bag") }, A, "account");
  await flush();
  assert.equal(loader.calls.length, 0);
  assert.ok(Object.values(anchors).every((a) => a.children.length === 0));
  assert.deepEqual(projection.status().noAsset, ["HEAD", "TOP", "BACK"]);
  assert.deepEqual(projection.status().failed, []);
});
test("10. null asset: no warning spam", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const { loadout } = rig({ describe: getItemDefinition });
    for (let i = 0; i < 5; i += 1) loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
    await flush();
  } finally { console.warn = original; }
  assert.equal(warnings.length, 0);
});
test("11. equip attaches the model to the slot anchor (HEAD, BACK)", async () => {
  const { projection, loadout, anchors, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap"), BACK: entry("back.freshman_bag") }, A, "account");
  assert.deepEqual(projection.status().pending, ["HEAD", "BACK"]);
  await flush();
  assert.deepEqual(loader.calls.map((c) => [c.slot, c.modelAssetId, c.itemId]), [["HEAD", "fixture.head_cap", "head.inha_cap"], ["BACK", "fixture.back_bag", "back.freshman_bag"]]);
  assert.equal(anchors.HEAD.children[0].name, "Model_fixture.head_cap");
  assert.equal(anchors.BACK.children[0].name, "Model_fixture.back_bag");
  assert.deepEqual(projection.status().active, ["HEAD", "BACK"]);
});
test("12. unchanged loadout re-publishes do not reload or rebuild", async () => {
  const { loadout, anchors, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  const model = anchors.HEAD.children[0];
  for (const reason of ["refresh", "resume", "purchase", "reward", "open"]) loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A, reason);
  await flush();
  assert.equal(loader.calls.length, 1);
  assert.equal(anchors.HEAD.children[0], model);
  assert.equal(model.destroyed, false);
});
test("13. unequip destroys the slot entity", async () => {
  const { projection, loadout, anchors } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap"), BACK: entry("back.freshman_bag") }, A);
  await flush();
  const hat = anchors.HEAD.children[0];
  loadout.emit("READY", { BACK: entry("back.freshman_bag") }, A, "unequip");
  assert.equal(hat.destroyed, true);
  assert.equal(anchors.HEAD.children.length, 0);
  assert.equal(anchors.BACK.children.length, 1, "other slots are untouched");
  assert.deepEqual(projection.status().active, ["BACK"]);
});
test("14. replace: the old entity stays until the new model is ready, then is destroyed", async () => {
  const loader = fakeLoader({ manual: true });
  const { loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  loader.pending.shift().resolve();
  await flush();
  const oldHat = anchors.HEAD.children[0];
  loadout.emit("READY", { HEAD: entry("head.inkyung_duck") }, A, "equip");
  assert.equal(anchors.HEAD.children[0], oldHat, "no empty flicker while the replacement loads");
  loader.pending.shift().resolve();
  await flush();
  assert.equal(oldHat.destroyed, true);
  assert.deepEqual(anchors.HEAD.children.map((c) => c.name), ["Model_fixture.head_duck"]);
});
test("15. stale load: A → B → A-resolves-late is discarded; only the newest desire attaches", async () => {
  const loader = fakeLoader({ manual: true });
  const { loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  loadout.emit("READY", { HEAD: entry("head.inkyung_duck") }, A, "equip");
  const [first, second] = loader.pending;
  second.resolve();
  await flush();
  first.resolve();
  await flush();
  assert.deepEqual(anchors.HEAD.children.map((c) => c.name), ["Model_fixture.head_duck"]);
  assert.equal(loader.created.find((e) => e.name === "Model_fixture.head_cap").destroyed, true, "the stale model is destroyed, not leaked");
});
test("16. stale load after unequip is discarded", async () => {
  const loader = fakeLoader({ manual: true });
  const { projection, loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  loadout.emit("READY", {}, A, "unequip");
  loader.pending.shift().resolve();
  await flush();
  assert.equal(anchors.HEAD.children.length, 0);
  assert.equal(projection.slotState("HEAD"), SLOT_PROJECTION.EMPTY);
});
test("17. re-equip of the same item after unequip loads again (new token)", async () => {
  const { loadout, anchors, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  loadout.emit("READY", {}, A, "unequip");
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A, "equip");
  await flush();
  assert.equal(loader.calls.length, 2);
  assert.equal(anchors.HEAD.children.length, 1);
});
test("18. account switch clears every entity and pending load before B's loadout arrives", async () => {
  const loader = fakeLoader({ manual: true });
  const { projection, loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  loader.pending.shift().resolve();
  loadout.emit("READY", { HEAD: entry("head.inha_cap"), BACK: entry("back.freshman_bag") }, A);
  await flush();
  const hat = anchors.HEAD.children[0];
  assert.equal(projection.status().pending.length, 1);
  loadout.emit("LOADING", null, B, "account");
  assert.equal(hat.destroyed, true);
  assert.deepEqual(projection.status().active, []);
  assert.deepEqual(projection.status().pending, []);
  loader.pending.shift().resolve(); // A's BACK finishes late
  await flush();
  assert.equal(anchors.BACK.children.length, 0, "A's late load never appears on B");
});
test("19. same item on a different account is reloaded (account is part of the desire)", async () => {
  const { loadout, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, B, "account");
  await flush();
  assert.equal(loader.calls.length, 2);
});
test("20. logout / guest: SIGNED_OUT clears all and loads nothing", async () => {
  const { projection, loadout, anchors, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  loadout.emit("SIGNED_OUT", null, null, "account");
  assert.ok(Object.values(anchors).every((a) => a.children.length === 0));
  const guest = rig();
  guest.loadout.emit("SIGNED_OUT", null, null, "account");
  await flush();
  assert.equal(guest.loader.calls.length, 0);
  assert.deepEqual(guest.projection.status().active, []);
  assert.equal(loader.calls.length, 1);
  assert.deepEqual(projection.status().active, []);
});
test("21. UNAVAILABLE loadout fails closed (nothing shown from a stale snapshot)", async () => {
  const { loadout, anchors } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  loadout.emit("UNAVAILABLE", null, A);
  assert.equal(anchors.HEAD.children.length, 0);
});
test("22. DISABLED / HIDDEN / UNKNOWN_ITEM: loadout kept, only the entity hidden", async () => {
  const { projection, loadout, anchors, loader } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  loadout.emit("READY", { HEAD: entry("head.inha_cap", "DISABLED"), BACK: entry("back.freshman_bag", "HIDDEN"), TOP: entry("top.future", "UNKNOWN_ITEM") }, A);
  assert.equal(anchors.HEAD.children.length, 0);
  assert.deepEqual(projection.status().hidden, ["HEAD", "TOP", "BACK"]);
  assert.equal(loadout.snapshot.slots.HEAD.itemId, "head.inha_cap", "the projection never edits the loadout");
  assert.equal(loader.calls.length, 1);
  loadout.emit("READY", { HEAD: entry("head.inha_cap", "ACTIVE") }, A);
  await flush();
  assert.equal(anchors.HEAD.children.length, 1, "re-enabled status projects again");
});
test("23. COMING_SOON and LOCKED equipped items still render", async () => {
  const { projection, loadout } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap", "COMING_SOON"), BACK: entry("back.freshman_bag", "LOCKED") }, A);
  await flush();
  assert.deepEqual(projection.status().active, ["HEAD", "BACK"]);
});
test("24. load failure: FAILED, no entity, other slots unaffected", async () => {
  const loader = fakeLoader({ manual: true });
  const { projection, loadout, anchors } = rig({ loader });
  const warn = console.warn; console.warn = () => {};
  try {
    loadout.emit("READY", { HEAD: entry("head.inha_cap"), BACK: entry("back.freshman_bag") }, A);
    loader.pending[0].reject(new Error("404"));
    loader.pending[1].resolve();
    await flush();
  } finally { console.warn = warn; }
  assert.deepEqual(projection.status().failed, ["HEAD"]);
  assert.deepEqual(projection.status().active, ["BACK"]);
  assert.equal(anchors.HEAD.children.length, 0);
});
test("25. replace whose new load fails removes the old entity (no mismatched item shown)", async () => {
  const loader = fakeLoader({ manual: true });
  const { projection, loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  loader.pending.shift().resolve();
  await flush();
  const warn = console.warn; console.warn = () => {};
  try {
    loadout.emit("READY", { HEAD: entry("head.inkyung_duck") }, A, "equip");
    loader.pending.shift().reject(new Error("broken"));
    await flush();
  } finally { console.warn = warn; }
  assert.equal(anchors.HEAD.children.length, 0);
  assert.equal(projection.slotState("HEAD"), SLOT_PROJECTION.FAILED);
});
test("26. a loader that throws synchronously or resolves empty is FAILED, not a crash", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const throwing = rig({ loader: { loadModel: () => { throw new Error("sync"); } } });
    throwing.loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
    const empty = rig({ loader: { loadModel: () => Promise.resolve(null) } });
    empty.loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
    await flush();
    assert.equal(throwing.projection.slotState("HEAD"), SLOT_PROJECTION.FAILED);
    assert.equal(empty.projection.slotState("HEAD"), SLOT_PROJECTION.FAILED);
  } finally { console.warn = warn; }
});
test("27. no loader or no anchor: bound assets are FAILED without throwing", () => {
  const loadout = fakeLoadout();
  const projection = createEquipmentProjection({ loadout, getAnchor: () => null, describe: describeWithModels, loadModel: null });
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  assert.equal(projection.slotState("HEAD"), SLOT_PROJECTION.FAILED);
});
test("28. BADGE is never projected even if a snapshot carried it", async () => {
  const { projection, loadout, loader } = rig();
  loadout.state = "READY"; loadout.accountId = A;
  loadout.snapshot = { slots: { BADGE: entry("badge.main_gate") } };
  loadout.emit("READY", { BADGE: entry("badge.main_gate") }, A);
  await flush();
  assert.equal(loader.calls.length, 0);
  assert.equal(projection.slotState("BADGE"), null);
});
test("29. initial sync: a projection created on an already READY loadout projects immediately", async () => {
  const loadout = fakeLoadout();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  const { projection } = rig({ loadout });
  await flush();
  assert.deepEqual(projection.status().active, ["HEAD"]);
});
test("30. destroy: removes every entity, discards pending loads, unsubscribes", async () => {
  const loader = fakeLoader({ manual: true });
  const { projection, loadout, anchors } = rig({ loader });
  loadout.emit("READY", { HEAD: entry("head.inha_cap"), BACK: entry("back.freshman_bag") }, A);
  loader.pending.shift().resolve();
  await flush();
  const hat = anchors.HEAD.children[0];
  projection.destroy();
  assert.equal(hat.destroyed, true);
  assert.equal(loadout.listenerCount, 0);
  loader.pending.shift().resolve();
  await flush();
  assert.equal(anchors.BACK.children.length, 0);
  loadout.emit("READY", { TOP: entry("top.inha_basic") }, A);
  await flush();
  assert.equal(loader.calls.length, 2, "no loads after destroy");
  assert.equal(projection.status().destroyed, true);
  projection.destroy(); // idempotent
});
test("31. status exposes slot names and counts only, never entities", async () => {
  const { projection, loadout } = rig();
  loadout.emit("READY", { HEAD: entry("head.inha_cap") }, A);
  await flush();
  const status = projection.status();
  assert.deepEqual(Object.keys(status).sort(), ["active", "destroyed", "failed", "hidden", "loads", "noAsset", "pending"]);
  assert.ok(JSON.stringify(status).length < 400);
  assert.ok(!Object.values(status).some((v) => v && typeof v === "object" && !Array.isArray(v)));
  assert.ok(Object.isFrozen(projection));
});

// ── Loader & wiring contracts ────────────────────────────────────────────────────────────────────
test("32. asset loader: unregistered ids reject without touching the asset system", async () => {
  assert.ok(Object.isFrozen(EQUIPMENT_MODEL_REGISTRY));
  let touched = 0;
  const load = createEquipmentModelLoader({ app: { assets: { loadFromUrl: () => { touched += 1; } } } });
  await assert.rejects(load("fixture.head_cap"), /UNREGISTERED_MODEL_ASSET/);
  await assert.rejects(load("__proto__"), /UNREGISTERED_MODEL_ASSET/);
  await assert.rejects(load("head.induck_cap"), /UNREGISTERED_MODEL_ASSET/, "an itemId is not a modelAssetId");
  assert.equal(touched, 0);
  const text = source("../src/appearance/equipment-asset-loader.js");
  assert.doesNotMatch(text, /https?:\/\//, "same-origin asset URLs only");
});
test("33. projection code: no Supabase, RPC, Wardrobe, Inventory, Realtime or Skin coupling", () => {
  const text = source("../src/appearance/equipment-projection.js");
  const code = text.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
  assert.deepEqual([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]), ["../collection/item-catalog.js", "./equipment-anchors.js"]);
  assert.doesNotMatch(code, /\.rpc\(|supabase|createClient|realtime|wardrobe|inventory|localStorage|setInterval|requestAnimationFrame|skin/i);
  assert.doesNotMatch(text, /head\.|back\.|top\.inha|Induck/, "no item-specific or base-model-specific code");
});
test("34. main.js wiring: loadout-driven projection, character anchors, status exposure, cleanup", () => {
  const main = source("../src/main.js");
  assert.match(main, /createEquipmentProjection\(\{\s*loadout,\s*getAnchor: \(slot\) => character\.getEquipmentAnchor\(slot\),\s*loadModel: createEquipmentModelLoader\(\{ app \}\)\s*\}\)/);
  assert.match(main, /equipmentProjection: Object\.freeze\(\{ status: \(\) => equipmentProjection\.status\(\) \}\)/);
  assert.match(main, /equipment: equipmentProjection\.status\(\)/);
  assert.match(main, /pagehide[^\n]*equipmentProjection\.destroy\(\)/);
  assert.doesNotMatch(main, /wardrobePanel[^\n]*equipmentProjection|equipmentProjection[^\n]*wardrobePanel|inventory[^\n]*equipmentProjection/i,
    "Wardrobe and Inventory never talk to the projection directly");
});
test("35. wardrobe panel and renderer boot stay independent of the projection (#310 kept)", () => {
  const wardrobe = source("../src/appearance/wardrobe-panel.js");
  assert.doesNotMatch(wardrobe, /equipment-projection|equipmentProjection|getEquipmentAnchor/);
  const main = source("../src/main.js");
  assert.match(main, /const rendererName = device\.isWebGPU \? "WebGPU" : "WebGL2";/);
  assert.match(main, /createWorldGraphicsDevice/);
});
