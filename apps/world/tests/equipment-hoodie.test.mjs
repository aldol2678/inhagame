// Equipment Asset Expansion P1a · TOP `top.induck_hoodie`: catalog / registry binding, GLB validity and
// fit in TOP-anchor space, local projection and multiplayer propagation through the existing pipeline.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_CATALOG, getItemDefinition, validateCatalog } from "../src/collection/item-catalog.js";
import { EQUIPMENT_MODEL_REGISTRY } from "../src/appearance/equipment-asset-loader.js";
import { SLOT_PROJECTION, createEquipmentProjection } from "../src/appearance/equipment-projection.js";
import { DEFAULT_EQUIPMENT_ANCHOR_LAYOUT, EQUIPMENT_SLOTS, createEquipmentAnchors } from "../src/appearance/equipment-anchors.js";
import { EQUIPMENT_GLBS, checkEquipmentGlb, inspectGlb } from "../assets/check_equipment.mjs";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { createRealtimeWorld, createWorldClient, remoteSessions, runWorld } from "./support/online-world-harness.mjs";

const HOODIE = "top.induck_hoodie";
const HOODIE_MODEL = "equipment.top.induck_hoodie.v1";
const HOODIE_URL = "/assets/induck-hoodie-v1.glb";
const SURVIVOR = "top.mcm_2026_survivor";
const SURVIVOR_MODEL = "equipment.top.mcm_2026_survivor.v1";
const SURVIVOR_URL = "/assets/mcm-survivor-top-v1.gltf";
const CAP = Object.freeze({ itemId: "head.induck_cap", catalogStatus: "COMING_SOON" });
const PACK = Object.freeze({ itemId: "back.induck_backpack", catalogStatus: "COMING_SOON" });
const HOOD = Object.freeze({ itemId: HOODIE, catalogStatus: "COMING_SOON" }); // server canon status
const assetsDir = new URL("../assets/", import.meta.url);
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const worn = (e) => ({ ...e, equippedAt: "2026-09-28T01:00:00+00:00" });

// ── Catalog / binding ────────────────────────────────────────────────────────────────────────────
test("1-4. hoodie binds a modelAssetId and keeps its canon definition", () => {
  const def = getItemDefinition(HOODIE);
  assert.equal(def.modelAssetId, HOODIE_MODEL);
  assert.deepEqual([def.displayName, def.category, def.equipSlot, def.rarity, def.status], ["인덕 기본 후드", "WEARABLE", "TOP", "COMMON", "COMING_SOON"]);
  assert.deepEqual(def.acquisition, [{ source: "SHOP" }]);
  assert.deepEqual([...def.tags], ["campus", "vs_economy"]);
  assert.deepEqual(validateCatalog(ITEM_CATALOG), []);
});

test("5-8. registry: hoodie + MCM survivor top resolve through the TOP asset pipeline", () => {
  assert.equal(EQUIPMENT_MODEL_REGISTRY[HOODIE_MODEL], HOODIE_URL);
  assert.equal(getItemDefinition(SURVIVOR).modelAssetId, SURVIVOR_MODEL);
  assert.equal(EQUIPMENT_MODEL_REGISTRY[SURVIVOR_MODEL], SURVIVOR_URL);
  assert.equal(EQUIPMENT_MODEL_REGISTRY["equipment.head.induck_cap.v1"], "/assets/induck-cap-v1.glb");
  assert.equal(EQUIPMENT_MODEL_REGISTRY["equipment.back.induck_backpack.v1"], "/assets/induck-backpack-v1.glb");
  assert.equal(Object.keys(EQUIPMENT_MODEL_REGISTRY).length, 4);
  const bound = ITEM_CATALOG.filter((d) => d.modelAssetId).map((d) => d.itemId).sort();
  assert.deepEqual(bound, ["back.induck_backpack", "head.induck_cap", HOODIE, SURVIVOR].sort());
  const otherTops = ITEM_CATALOG.filter((d) => d.equipSlot === "TOP" && ![HOODIE, SURVIVOR].includes(d.itemId));
  assert.ok(otherTops.length > 0 && otherTops.every((d) => d.modelAssetId === null), "unbound TOP items stay model-less");
});

// ── GLB ──────────────────────────────────────────────────────────────────────────────────────────
const spec = EQUIPMENT_GLBS.find((g) => g.file === "induck-hoodie-v1.glb");
const bytes = readFileSync(new URL(spec.file, assetsDir));
const survivorGltf = JSON.parse(readFileSync(new URL("mcm-survivor-top-v1.gltf", assetsDir), "utf8"));

test("9, 11-12, 14. hoodie GLB: valid v2, expected root and meshes, no textures, compact", () => {
  const { gltf } = checkEquipmentGlb(spec, bytes);
  assert.equal(gltf.nodes[gltf.scenes[0].nodes[0]].name, "Equipment_InduckHoodie_v1");
  assert.ok(bytes.length < 64_000, `${bytes.length} bytes`);
  assert.ok(bytes.length < readFileSync(new URL("induck-v3.glb", assetsDir)).length, "smaller than the base character");
  assert.ok(!gltf.meshes.some((m) => /sleeve/i.test(m.name)), "no sleeves in P1a (wings flap)");
});

test("9b. survivor uses the compact independent QA asset with no external dependencies",()=>{
  assert.equal(survivorGltf.asset.version,'2.0');
  assert.equal(survivorGltf.nodes[survivorGltf.scenes[0].nodes[0]].name,'Public_QA_Top');
  assert.ok(survivorGltf.meshes.length>0);
  assert.ok(survivorGltf.meshes.every(m=>m.name.startsWith('qa_top')));
  assert.ok(!survivorGltf.images?.length&&!survivorGltf.textures?.length);
  for(const buffer of survivorGltf.buffers){
    assert.ok(buffer.uri.startsWith('data:application/octet-stream;base64,'));
    assert.equal(Buffer.from(buffer.uri.split(',')[1],'base64').length,buffer.byteLength);
  }
});
test("10. public equipment bytes match independently generated provenance",()=>{
  const provenance=JSON.parse(readFileSync(new URL('../../../ASSET_PROVENANCE.json',import.meta.url)));
  for(const {file} of EQUIPMENT_GLBS){
    const record=provenance.assets.find(a=>a.path==='apps/world/assets/'+file);
    assert.ok(record,file);
    assert.match(record.provenance,/Independent/);
    assert.equal(createHash('sha256').update(readFileSync(new URL(file,assetsDir))).digest('hex'),record.sha256);
  }
});
const H=.875;
test("13. QA top vertices stay finite and inside the documented anchor-space bounds",()=>{
  const {gltf,bounds}=checkEquipmentGlb(spec,bytes);
  const bin=20+bytes.readUInt32LE(12)+8;
  let count=0;
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){
    const acc=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[acc.bufferView];
    for(let i=0;i<acc.count;i++)for(let k=0;k<3;k++){
      const value=bytes.readFloatLE(bin+(view.byteOffset||0)+(acc.byteOffset||0)+i*(view.byteStride||12)+k*4);
      assert.ok(Number.isFinite(value));
      assert.ok(value>=bounds.min[k]-1e-6&&value<=bounds.max[k]+1e-6);count++;
    }
  }
  assert.ok(count>=24);
  assert.ok(bounds.max.every((v,k)=>v>bounds.min[k]));
});
test("13b. QA top and other equipment keep separate anchor-space bounding boxes",()=>{
  const boxOf=(file,slot)=>{
    const item=EQUIPMENT_GLBS.find(g=>g.file===file);
    const {bounds}=checkEquipmentGlb(item,readFileSync(new URL(file,assetsDir)));
    const shift=DEFAULT_EQUIPMENT_ANCHOR_LAYOUT[slot].map((v,k)=>(v-DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.TOP[k])*H);
    return {min:bounds.min.map((v,k)=>v+shift[k]),max:bounds.max.map((v,k)=>v+shift[k])};
  };
  const top=boxOf('induck-hoodie-v1.glb','TOP');
  for(const [file,slot] of [['induck-cap-v1.glb','HEAD'],['induck-backpack-v1.glb','BACK']]){
    const other=boxOf(file,slot);
    assert.ok([0,1,2].some(k=>top.max[k]<=other.min[k]||other.max[k]<=top.min[k]),slot+' clearance');
  }
});

// ── Local projection (real anchors, fake entities, real catalog + registry ids) ──────────────────
class FakeEntity {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.enabled = true; this.destroyed = false; this.pos = [0, 0, 0]; }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
  setLocalPosition(x, y, z) { this.pos = [x, y, z]; }
  setLocalEulerAngles() {}
  destroy() { this.destroyed = true; this.parent?.removeChild(this); for (const c of [...this.children]) c.destroy(); }
  get visible() { return this.enabled && (this.parent ? this.parent.visible : true); }
}
function fakeLoadout() {
  const listeners = new Set();
  const loadout = { state: "SIGNED_OUT", snapshot: null, accountId: null,
    onChange(l) { listeners.add(l); return () => listeners.delete(l); },
    emit(state, slots, accountId = "user-a") {
      Object.assign(loadout, { state, accountId, snapshot: slots ? { slots: Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, slots[s] ?? null])) } : null });
      for (const l of listeners) l({ state, snapshot: loadout.snapshot, accountId, reason: "refresh", pending: new Set() });
    } };
  return loadout;
}
function rig({ fail = new Set() } = {}) {
  const player = new FakeEntity("Player");
  player.addChild(new FakeEntity("Induck_Visual"));
  const anchors = createEquipmentAnchors({ createEntity: (n) => new FakeEntity(n), parent: player, height: H });
  const loadout = fakeLoadout();
  const requests = [];
  const loadModel = (id) => { requests.push(id); return fail.has(id) ? Promise.reject(new Error("503")) : Promise.resolve(new FakeEntity(`Equipment_Model_${id}`)); };
  const projection = createEquipmentProjection({ loadout, getAnchor: (s) => anchors.anchor(s), loadModel });
  const model = (slot) => anchors.anchor(slot).children.map((c) => c.name);
  return { player, anchors, loadout, projection, requests, model };
}

test("15-17. TOP hoodie attaches, unequips, and a model-less TOP replacement clears it", async () => {
  const r = rig();
  r.loadout.emit("READY", { TOP: worn(HOOD) });
  await flush();
  assert.deepEqual(r.model("TOP"), [`Equipment_Model_${HOODIE_MODEL}`]);
  r.loadout.emit("READY", {});
  assert.deepEqual(r.model("TOP"), []);
  r.loadout.emit("READY", { TOP: worn(HOOD) });
  await flush();
  r.loadout.emit("READY", { TOP: worn({ itemId: "top.inha_basic", catalogStatus: "ACTIVE" }) });
  await flush();
  assert.deepEqual(r.model("TOP"), []);
  assert.equal(r.projection.slotState("TOP"), SLOT_PROJECTION.NO_ASSET);
  assert.equal(r.loadout.snapshot.slots.TOP.itemId, "top.inha_basic", "the server loadout keeps the new item");
});

test("18-20. hoodie with cap, with backpack, and all three at once, each on its own anchor", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), TOP: worn(HOOD) });
  await flush();
  assert.deepEqual(r.projection.status().active, ["HEAD", "TOP"]);
  r.loadout.emit("READY", { TOP: worn(HOOD), BACK: worn(PACK) });
  await flush();
  assert.deepEqual(r.projection.status().active, ["TOP", "BACK"]);
  r.loadout.emit("READY", { HEAD: worn(CAP), TOP: worn(HOOD), BACK: worn(PACK) });
  await flush();
  assert.deepEqual(r.projection.status().active, ["HEAD", "TOP", "BACK"]);
  assert.deepEqual([r.model("HEAD").length, r.model("TOP").length, r.model("BACK").length], [1, 1, 1]);
});

test("21. first person hides the hoodie with cap and backpack; third person restores all", async () => {
  const r = rig();
  r.loadout.emit("READY", { HEAD: worn(CAP), TOP: worn(HOOD), BACK: worn(PACK) });
  await flush();
  const models = ["HEAD", "TOP", "BACK"].map((s) => r.anchors.anchor(s).children[0]);
  r.anchors.setVisible(false);
  assert.ok(models.every((m) => !m.visible));
  r.anchors.setVisible(true);
  assert.ok(models.every((m) => m.visible));
});

test("22-25. sit pitch, emote, movement and mounts only move the root: hoodie stays attached", async () => {
  const r = rig();
  r.loadout.emit("READY", { TOP: worn(HOOD) });
  await flush();
  const hoodie = r.anchors.anchor("TOP").children[0];
  const frame = r.anchors.root.children[0];
  // Sit: pitch about the visual's pivot (0.365 above the feet), anchors stay feet-relative.
  r.anchors.follow({ feetY: -1.15, pivotY: -1.15 + 0.365, z: 0, euler: [-6, 0, 0] });
  assert.ok(Math.abs(frame.pos[1] + 0.365) < 1e-9);
  r.anchors.follow({ feetY: -1.13, pivotY: -0.765, z: 0, euler: [0, 12, 4] }); // emote / walk bob
  r.anchors.follow({ feetY: 0.55, pivotY: 0.915, z: -0.22, euler: [0, 0, 0] }); // dragon
  r.anchors.follow({ feetY: 0.31 - 1.15, pivotY: -0.475, z: -0.07, euler: [17, 0, 0] }); // bike
  assert.equal(r.anchors.anchor("TOP").children[0], hoodie);
  assert.equal(hoodie.destroyed, false);
  assert.deepEqual(r.anchors.anchor("TOP").pos, DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.TOP.map((v) => v * H));
  assert.equal(r.requests.length, 1);
});

test("26-27. primitive fallback still attaches; a failing hoodie load leaves cap and backpack", async () => {
  const fallback = rig();
  fallback.loadout.emit("READY", { TOP: worn(HOOD) });
  await flush();
  fallback.player.children[0].enabled = false;
  fallback.player.addChild(new FakeEntity("Induck_GLB_Visual"));
  assert.equal(fallback.anchors.anchor("TOP").children[0].visible, true);
  const warn = console.warn; console.warn = () => {};
  try {
    const r = rig({ fail: new Set([HOODIE_MODEL]) });
    r.loadout.emit("READY", { HEAD: worn(CAP), TOP: worn(HOOD), BACK: worn(PACK) });
    await flush();
    assert.deepEqual(r.projection.status().failed, ["TOP"]);
    assert.deepEqual(r.projection.status().active, ["HEAD", "BACK"]);
  } finally { console.warn = warn; }
});

// ── Multiplayer (existing Presence equipment, real world-online + Supabase transport) ────────────
const HALL = { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z };
const AGORA = FACILITIES.find((f) => f.id === "fac_agora_courtyard").center;
const sid = (c) => c.online.status().sessionId;
const seenBy = (viewer, subject) => viewer.avatars.live.get(sid(subject))?.last?.equipment ?? null;
const equip = (c, equipment) => c.online.setLocalEquipment(`user-${c.label.toLowerCase()}`, equipment);
async function pair() {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: HALL });
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  return { world, a, b };
}

test("28-32. A↔B hoodie and the full outfit reach the other side; TOP unequip keeps the same avatar", async () => {
  const { world, a, b } = await pair();
  equip(a, { TOP: HOOD });
  equip(b, { TOP: HOOD });
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { TOP: HOOD });
  assert.deepEqual(seenBy(a, b), { TOP: HOOD });
  const avatar = b.avatars.live.get(sid(a));
  equip(a, { HEAD: CAP, TOP: HOOD, BACK: PACK });
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, TOP: HOOD, BACK: PACK });
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
  equip(a, { HEAD: CAP, TOP: HOOD, BACK: PACK });
  await runWorld(world, 300);
  assert.equal(b.avatars.live.get(sid(a)), avatar, "same remote avatar for every change");
  assert.deepEqual(b.avatars.created.filter((s) => s === sid(a)).length, 1);
  const presence = world.server.wire.filter((w) => w.kind === "presence" && w.payload.sessionId === sid(a)).at(-1).payload;
  assert.deepEqual(presence.equipment.TOP, HOOD, "the existing wire shape: itemId + catalogStatus only");
  assert.ok(!JSON.stringify(world.server.wire).includes("induck-hoodie"), "no model URL on the wire");
});

test("33-36. late join, zone rejoin, room and reconnect all carry the hoodie", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: HALL });
  await runWorld(world, 400);
  equip(a, { TOP: HOOD, BACK: PACK });
  await runWorld(world, 300);
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  assert.deepEqual(seenBy(b, a), { TOP: HOOD, BACK: PACK }, "late join via the Presence sync");
  a.local.teleportTo(AGORA);
  await runWorld(world, 1000);
  assert.deepEqual(remoteSessions(b), []);
  a.local.teleportTo(HALL);
  await runWorld(world, 1000);
  assert.deepEqual(seenBy(b, a), { TOP: HOOD, BACK: PACK }, "zone rejoin");
  a.online.pauseCampus({ label: "동아리방" });
  await runWorld(world, 600);
  assert.deepEqual(remoteSessions(b), []);
  a.online.resumeCampus();
  await runWorld(world, 800);
  assert.deepEqual(seenBy(b, a), { TOP: HOOD, BACK: PACK }, "room exit");
  const client = a.online.transport.client;
  world.server.dropClient(client);
  await runWorld(world, 300);
  world.server.restoreClient(client);
  await runWorld(world, 3000);
  assert.deepEqual(seenBy(b, a), { TOP: HOOD, BACK: PACK }, "reconnect");
});

test("37. many remote hoodies share one loader URL (the registry maps them all to one GLB)", () => {
  const urls = new Set(Array.from({ length: 5 }, () => EQUIPMENT_MODEL_REGISTRY[getItemDefinition(HOODIE).modelAssetId]));
  assert.deepEqual([...urls], [HOODIE_URL]);
});
