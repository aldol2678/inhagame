import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_CATALOG, getItemDefinition, validateCatalog } from "../src/collection/item-catalog.js";
import { EQUIPMENT_MODEL_REGISTRY, createEquipmentModelLoader } from "../src/appearance/equipment-asset-loader.js";
import { SLOT_PROJECTION, createEquipmentProjection } from "../src/appearance/equipment-projection.js";
import { EQUIPMENT_SLOTS, createEquipmentAnchors } from "../src/appearance/equipment-anchors.js";
import { EQUIPMENT_GLBS, checkEquipmentGlb } from "../assets/check_equipment.mjs";

const CAP = "head.induck_cap";
const PACK = "back.induck_backpack";
const CAP_MODEL = "equipment.head.induck_cap.v1";
const PACK_MODEL = "equipment.back.induck_backpack.v1";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const assetsDir = new URL("../assets/", import.meta.url);
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const worn = (itemId, catalogStatus = "ACTIVE") => ({ itemId, catalogStatus, equippedAt: "2026-09-28T01:00:00+00:00" });

// ── Catalog / registry ───────────────────────────────────────────────────────────────────────────
test("1-3. cap and backpack carry modelAssetIds and keep their catalog definition", () => {
  const cap = getItemDefinition(CAP);
  const pack = getItemDefinition(PACK);
  assert.equal(cap.modelAssetId, CAP_MODEL);
  assert.equal(pack.modelAssetId, PACK_MODEL);
  assert.deepEqual([cap.displayName, cap.category, cap.equipSlot, cap.rarity, cap.status], ["인덕 캠퍼스 캡", "WEARABLE", "HEAD", "COMMON", "ACTIVE"]);
  assert.deepEqual([pack.displayName, pack.category, pack.equipSlot, pack.rarity, pack.status], ["인덕 백팩", "WEARABLE", "BACK", "UNCOMMON", "COMING_SOON"]);
  assert.deepEqual(cap.acquisition, [{ source: "SHOP" }]);
  assert.deepEqual(pack.acquisition, [{ source: "SHOP" }]);
  assert.deepEqual(validateCatalog(ITEM_CATALOG), []);
});

test("4. only the four bound wearables carry modelAssetIds", () => {
  const bound = ITEM_CATALOG.filter((d) => d.modelAssetId !== null).map((d) => d.itemId).sort();
  assert.deepEqual(bound, [PACK, CAP, "top.induck_hoodie", "top.mcm_2026_survivor"].sort());
  for (const d of ITEM_CATALOG) assert.equal(d.iconAssetId, null, d.itemId);
});

test("5-6. registry holds exactly the bound model ids and each URL is a committed asset", () => {
  assert.deepEqual(Object.keys(EQUIPMENT_MODEL_REGISTRY).sort(), [PACK_MODEL, CAP_MODEL, "equipment.top.induck_hoodie.v1", "equipment.top.mcm_2026_survivor.v1"].sort());
  assert.ok(Object.isFrozen(EQUIPMENT_MODEL_REGISTRY));
  for (const d of ITEM_CATALOG.filter((item) => item.modelAssetId)) {
    const url = EQUIPMENT_MODEL_REGISTRY[d.modelAssetId];
    assert.match(url, /^\/assets\/[a-z0-9-]+\.(?:glb|gltf)$/, d.itemId);
    assert.ok(existsSync(new URL(`..${url}`, import.meta.url)), `${url} exists`);
  }
  const urls = [...new Set(Object.values(EQUIPMENT_MODEL_REGISTRY))].sort();
  assert.deepEqual(urls, [...EQUIPMENT_GLBS.map((g) => `/assets/${g.file}`), "/assets/mcm-survivor-top-v1.gltf"].sort());
});

test("7. unknown modelAssetIds and item ids are still refused before the asset system", async () => {
  const urls = [];
  const load = createEquipmentModelLoader({ app: { assets: { loadFromUrl: (url) => urls.push(url) } } });
  await assert.rejects(load("equipment.head.unknown.v1"), /UNREGISTERED_MODEL_ASSET/);
  await assert.rejects(load(CAP), /UNREGISTERED_MODEL_ASSET/);
  assert.deepEqual(urls, []);
});

test("loader: resolves the registry URL through the PlayCanvas asset registry and names the entity", async () => {
  const calls = [];
  const app = { assets: { loadFromUrl(url, type, callback) {
    calls.push([url, type]);
    callback(null, { resource: { instantiateRenderEntity: (options) => ({ name: "", options }) } });
  } } };
  const load = createEquipmentModelLoader({ app });
  const cap = await load(CAP_MODEL);
  const pack = await load(PACK_MODEL);
  assert.deepEqual(calls, [["/assets/induck-cap-v1.glb", "container"], ["/assets/induck-backpack-v1.glb", "container"]]);
  assert.equal(cap.name, `Equipment_Model_${CAP_MODEL}`);
  assert.equal(pack.name, `Equipment_Model_${PACK_MODEL}`);
  const failing = createEquipmentModelLoader({ app: { assets: { loadFromUrl: (url, type, cb) => cb(new Error("404")) } } });
  await assert.rejects(failing(CAP_MODEL), /404/);
});

// ── Asset validation ─────────────────────────────────────────────────────────────────────────────
test("8-10, 12. both GLBs are valid, compact, flat-color, with the expected root and meshes", () => {
  for (const spec of EQUIPMENT_GLBS) {
    const bytes = readFileSync(new URL(spec.file, assetsDir));
    const { gltf } = checkEquipmentGlb(spec, bytes);
    assert.ok(bytes.length < 64_000 && bytes.length < readFileSync(new URL("induck-v3.glb", assetsDir)).length, spec.file);
    assert.ok(gltf.meshes.length >= 5 && gltf.meshes.length <= 12, spec.file);
  }
});

test("anchor-space authoring: the cap sits on the HEAD anchor facing +Z, the pack hangs behind the BACK anchor", () => {
  const bounds = (file) => checkEquipmentGlb(EQUIPMENT_GLBS.find((g) => g.file === file), readFileSync(new URL(file, assetsDir))).bounds;
  const cap = bounds("induck-cap-v1.glb");
  assert.ok(cap.max[2] > 0.12 && cap.min[2] > -0.1, "brim points forward (+Z, the character's facing)");
  assert.ok(cap.min[1] > -0.07 && cap.max[1] < 0.07, "cap stays around the head anchor");
  assert.ok(Math.abs(cap.min[0] + cap.max[0]) < 1e-6, "cap is centred");
  const pack = bounds("induck-backpack-v1.glb");
  assert.ok(pack.max[2] < -0.03 && pack.min[2] > -0.25, "backpack is behind the body (-Z)");
  assert.ok(pack.max[1] <= 0 && pack.min[1] > -0.32, "backpack hangs below the shoulder anchor");
  assert.ok(Math.abs(pack.min[0] + pack.max[0]) < 1e-6, "backpack is centred");
});

test("independent QA assets match their reviewed provenance digests", async () => {
 const {createHash}=await import('node:crypto');
 const provenance=JSON.parse(readFileSync(new URL('../../../ASSET_PROVENANCE.json',import.meta.url),'utf8'));
 for(const {file} of EQUIPMENT_GLBS){
  const row=provenance.assets.find(a=>a.path===`apps/world/assets/${file}`);
  assert.equal(createHash('sha256').update(readFileSync(new URL(file,assetsDir))).digest('hex'),row.sha256);
 }
});

// ── Projection with the production catalog + registry ids ────────────────────────────────────────
class FakeEntity {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.enabled = true; this.destroyed = false; this.pos = [0, 0, 0]; this.euler = [0, 0, 0]; }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
  setLocalPosition(x, y, z) { this.pos = [x, y, z]; }
  setLocalEulerAngles(x, y, z) { this.euler = [x, y, z]; }
  destroy() { this.destroyed = true; this.parent?.removeChild(this); for (const c of [...this.children]) c.destroy(); }
  get visible() { return this.enabled && (this.parent ? this.parent.visible : true); }
}
function fakeLoadout() {
  const listeners = new Set();
  const loadout = {
    state: "SIGNED_OUT", snapshot: null, accountId: null,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(state, slots, accountId = loadout.accountId) {
      Object.assign(loadout, { state, accountId, snapshot: slots ? { slots: Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, slots[s] ?? null])) } : null });
      for (const l of listeners) l({ state, snapshot: loadout.snapshot, accountId, reason: "refresh", pending: new Set() });
    }
  };
  return loadout;
}
// A character-like rig: a player entity with a fallback visual, the real anchors and the real projection.
function rig({ manual = false, fail = new Set() } = {}) {
  const player = new FakeEntity("Player");
  player.addChild(new FakeEntity("Induck_Visual"));
  const anchors = createEquipmentAnchors({ createEntity: (name) => new FakeEntity(name), parent: player, height: 0.875 });
  const loadout = fakeLoadout();
  const requests = [];
  const created = [];
  const loadModel = (modelAssetId) => new Promise((resolve, reject) => {
    const settle = () => {
      if (fail.has(modelAssetId)) { reject(new Error("MODEL_ASSET_UNAVAILABLE")); return; }
      const e = new FakeEntity(`Equipment_Model_${modelAssetId}`);
      created.push(e);
      resolve(e);
    };
    requests.push({ modelAssetId, settle });
    if (!manual) settle();
  });
  const projection = createEquipmentProjection({ loadout, getAnchor: (slot) => anchors.anchor(slot), loadModel });
  const model = (slot) => anchors.anchor(slot).children.map((c) => c.name);
  return { player, anchors, loadout, projection, requests, created, model };
}

test("13-15. HEAD cap, BACK backpack, and both at once attach through catalog → registry id", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP) }, A);
  await flush();
  assert.deepEqual(r.model("HEAD"), [`Equipment_Model_${CAP_MODEL}`]);
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  assert.deepEqual(r.model("BACK"), [`Equipment_Model_${PACK_MODEL}`]);
  assert.deepEqual(r.projection.status().active, ["HEAD", "BACK"]);
  assert.deepEqual(r.requests.map((q) => q.modelAssetId), [CAP_MODEL, PACK_MODEL], "each model loaded once");
  for (const slot of EQUIPMENT_SLOTS.filter((s) => s !== "HEAD" && s !== "BACK")) assert.deepEqual(r.model(slot), [], slot);
});

test("canon catalog statuses (COMING_SOON / LOCKED / ACTIVE) render; DISABLED / HIDDEN do not", async () => {
  const r = rig();
  for (const status of ["COMING_SOON", "LOCKED", "ACTIVE"]) {
    r.loadout.emit("READY", { HEAD: worn(CAP, status) }, A);
    await flush();
    assert.equal(r.model("HEAD").length, 1, status);
  }
  r.loadout.emit("READY", { HEAD: worn(CAP, "DISABLED"), BACK: worn(PACK, "HIDDEN") }, A);
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], []]);
});

test("16-17. unequipping one slot removes only that model", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  const [cap] = r.anchors.anchor("HEAD").children;
  r.loadout.emit("READY", { BACK: worn(PACK) }, A);
  assert.ok(cap.destroyed);
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], [`Equipment_Model_${PACK_MODEL}`]]);
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  const [pack] = r.anchors.anchor("BACK").children;
  r.loadout.emit("READY", { HEAD: worn(CAP) }, A);
  assert.ok(pack.destroyed);
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[`Equipment_Model_${CAP_MODEL}`], []]);
});

test("18-19. replacing a modelled item with a null-model item removes the old model", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  r.loadout.emit("READY", { HEAD: worn("head.inha_cap"), BACK: worn("back.freshman_bag") }, A);
  await flush();
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], []]);
  assert.deepEqual(r.projection.status().noAsset, ["HEAD", "BACK"]);
  assert.equal(r.requests.length, 2, "null-model items never reach the loader");
  assert.ok(r.created.every((e) => e.destroyed));
});

test("20-21. account switch and logout clear both models", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  r.loadout.emit("LOADING", null, B);
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], []]);
  r.loadout.emit("READY", { BACK: worn(PACK) }, B);
  await flush();
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], [`Equipment_Model_${PACK_MODEL}`]]);
  r.loadout.emit("SIGNED_OUT", null, null);
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], []]);
  assert.ok(r.created.every((e) => e.destroyed));
});

test("22. stale async loads (unequip / account switch while loading) never leak", async () => {
  const r = rig({ manual: true });
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  r.loadout.emit("READY", { BACK: worn(PACK) }, A);
  r.loadout.emit("LOADING", null, B);
  for (const q of r.requests) q.settle();
  await flush();
  assert.deepEqual([r.model("HEAD"), r.model("BACK")], [[], []]);
  assert.equal(r.created.length, 2);
  assert.ok(r.created.every((e) => e.destroyed), "late models are destroyed, not parented");
});

test("23. a model that fails to load is isolated: other slot attaches, character entity untouched", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const r = rig({ fail: new Set([CAP_MODEL]) });
    r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
    await flush();
    assert.deepEqual(r.projection.status().failed, ["HEAD"]);
    assert.deepEqual(r.model("BACK"), [`Equipment_Model_${PACK_MODEL}`]);
    assert.deepEqual(r.player.children.map((c) => c.name), ["Induck_Visual", "Equipment_Root"]);
  } finally { console.warn = warn; }
});

test("24. first person hides both models with the character; third person restores them", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  const models = [...r.anchors.anchor("HEAD").children, ...r.anchors.anchor("BACK").children];
  r.anchors.setVisible(false);
  assert.ok(models.every((m) => !m.visible));
  r.anchors.setVisible(true);
  assert.ok(models.every((m) => m.visible));
  assert.equal(r.requests.length, 2, "visibility never reloads");
});

test("25. mount / dismount only moves the root: same model entities, nothing created or destroyed", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  const before = [...r.anchors.anchor("HEAD").children, ...r.anchors.anchor("BACK").children];
  r.anchors.follow({ feetY: 0.55, z: -0.22, euler: [0, 0, 0] }); // dragon rider pose
  r.anchors.follow({ feetY: 0.31 - 1.15, z: -0.07, euler: [17, 0, 0] }); // bike rider pose
  r.anchors.follow({ feetY: -1.15, z: 0, euler: [0, 0, 0] }); // dismounted
  const after = [...r.anchors.anchor("HEAD").children, ...r.anchors.anchor("BACK").children];
  assert.deepEqual(after, before);
  assert.ok(after.every((m) => !m.destroyed));
  assert.equal(r.created.length, 2);
});

test("26. fallback character: anchors hang off the player, so models attach with or without the GLB visual", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), BACK: worn(PACK) }, A);
  await flush();
  const glb = new FakeEntity("Induck_GLB_Visual");
  r.player.addChild(glb);
  r.player.children[0].enabled = false; // fallback → GLB swap
  assert.equal(r.anchors.root.parent, r.player);
  assert.ok([...r.anchors.anchor("HEAD").children, ...r.anchors.anchor("BACK").children].every((m) => m.visible));
});

test("no projection-core or character item knowledge: binding lives only in catalog + registry", () => {
  for (const file of ["../src/appearance/equipment-projection.js", "../src/appearance/equipment-anchors.js", "../src/character-model.js", "../src/main.js"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /induck_cap|induck_backpack|induck_hoodie|induck-cap|induck-backpack|induck-hoodie/, file);
  }
  const wardrobe = readFileSync(new URL("../src/appearance/wardrobe-panel.js", import.meta.url), "utf8");
  assert.match(wardrobe, /3D 모델이 지원되는 장비는 캐릭터에 바로 반영돼요\./);
  assert.doesNotMatch(wardrobe, /다음 업데이트에서 지원/);
  assert.equal(SLOT_PROJECTION.ATTACHED, "ATTACHED");
});
