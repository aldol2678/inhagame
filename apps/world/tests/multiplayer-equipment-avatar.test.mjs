// Multiplayer Equipment Projection P0: the remote avatar reuses the existing Equipment Projection
// through a per-session in-memory source. Engine-free: fake entities with the PlayCanvas surface the
// anchors and projection use, the real catalog, the real registry ids and the real anchors.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRemoteEquipmentSource } from "../src/online/remote-equipment-source.js";
import { RemotePlayerView } from "../src/online/remote-player-view.js";
import { createEquipmentProjection } from "../src/appearance/equipment-projection.js";
import { createEquipmentAnchors } from "../src/appearance/equipment-anchors.js";
import { createEquipmentModelLoader } from "../src/appearance/equipment-asset-loader.js";

const CAP = Object.freeze({ itemId: "head.induck_cap", catalogStatus: "COMING_SOON" });
const PACK = Object.freeze({ itemId: "back.induck_backpack", catalogStatus: "COMING_SOON" });
const CAP_MODEL = "Equipment_Model_equipment.head.induck_cap.v1";
const PACK_MODEL = "Equipment_Model_equipment.back.induck_backpack.v1";
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

class FakeEntity {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.enabled = true; this.destroyed = false; }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
  setLocalPosition() {}
  setLocalEulerAngles() {}
  destroy() { this.destroyed = true; this.parent?.removeChild(this); for (const c of [...this.children]) c.destroy(); }
}

// A PlayCanvas-like asset registry: loadFromUrl reuses one asset per URL (the real 2.22 semantics),
// counting downloads; `hold` keeps loads pending until released.
function fakeApp({ fail = new Set() } = {}) {
  const assets = new Map();
  const downloads = [];
  const held = [];
  let hold = false;
  const app = {
    downloads, held,
    set hold(value) { hold = value; },
    release() { for (const fn of held.splice(0)) fn(); },
    assets: {
      loadFromUrl(url, type, callback) {
        let asset = assets.get(url);
        if (asset?.loaded) { callback(null, asset); return; }
        if (!asset) {
          asset = { url, loaded: false, waiters: [], resource: { instantiateRenderEntity: () => new FakeEntity("glb-instance") } };
          assets.set(url, asset);
          const finish = () => {
            if (fail.has(url)) { for (const w of asset.waiters.splice(0)) w(new Error("503"), asset); assets.delete(url); return; }
            downloads.push(url);
            asset.loaded = true;
            for (const w of asset.waiters.splice(0)) w(null, asset);
          };
          if (hold) held.push(finish); else queueMicrotask(finish);
        }
        asset.waiters.push(callback);
      }
    }
  };
  return app;
}

// The composition remote-avatar.js performs for one remote session.
function remoteAvatar(sample, loadModel) {
  const entity = new FakeEntity(`RemotePlayer_${sample.sessionId}`);
  entity.addChild(new FakeEntity("Induck_Visual"));
  const anchors = createEquipmentAnchors({ createEntity: (n) => new FakeEntity(n), parent: entity, height: 0.875 });
  const equipmentSource = createRemoteEquipmentSource({ sessionId: sample.sessionId });
  equipmentSource.set(sample.equipment);
  const equipment = createEquipmentProjection({ loadout: equipmentSource, getAnchor: (slot) => anchors.anchor(slot), loadModel });
  return {
    entity, anchors, updates: 0,
    update(s) { this.updates += 1; equipmentSource.set(s.equipment); },
    equipmentStatus: () => equipment.status(),
    destroy() { equipment.destroy(); equipmentSource.dispose(); entity.destroy(); }
  };
}
const models = (avatar, slot) => avatar.anchors.anchor(slot).children.map((c) => c.name);
const sampleOf = (sessionId, equipment = {}) => ({ sessionId, pose: { x: 0, y: 0, z: 0, yaw: 0 }, anim: "idle", equipment });

function scene(options) {
  const app = fakeApp(options);
  const loadModel = createEquipmentModelLoader({ app });
  const avatars = [];
  const view = new RemotePlayerView({
    localSessionId: "sess-local",
    createAvatar: (s) => { const a = remoteAvatar(s, loadModel); avatars.push(a); return a; }
  });
  return { app, view, avatars };
}

test("29-31. remote HEAD cap, BACK backpack, both at once attach through the existing projection", async () => {
  const { view, avatars } = scene();
  view.sync([sampleOf("sess-a", { HEAD: CAP })], 0.016);
  await flush();
  assert.deepEqual(models(avatars[0], "HEAD"), [CAP_MODEL]);
  view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: PACK })], 0.016);
  await flush();
  assert.deepEqual([models(avatars[0], "HEAD"), models(avatars[0], "BACK")], [[CAP_MODEL], [PACK_MODEL]]);
  assert.deepEqual(avatars[0].equipmentStatus().active, ["HEAD", "BACK"]);
  assert.equal(avatars.length, 1, "equipment changes never recreate the avatar");
});

test("32-33. remote unequip removes one; a null-model replacement clears the old model", async () => {
  const { view, avatars } = scene();
  view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: PACK })], 0.016);
  await flush();
  const cap = avatars[0].anchors.anchor("HEAD").children[0];
  view.sync([sampleOf("sess-a", { BACK: PACK })], 0.016);
  assert.ok(cap.destroyed);
  assert.deepEqual([models(avatars[0], "HEAD"), models(avatars[0], "BACK")], [[], [PACK_MODEL]]);
  view.sync([sampleOf("sess-a", { HEAD: { itemId: "head.inha_cap", catalogStatus: "ACTIVE" }, BACK: { itemId: "back.freshman_bag", catalogStatus: "ACTIVE" } })], 0.016);
  await flush();
  assert.deepEqual([models(avatars[0], "HEAD"), models(avatars[0], "BACK")], [[], []]);
  assert.deepEqual(avatars[0].equipmentStatus().noAsset, ["HEAD", "BACK"]);
  assert.equal(avatars.length, 1);
});

test("34-35. same status rules as the local projection: DISABLED hides, COMING_SOON renders", async () => {
  const { view, avatars } = scene();
  view.sync([sampleOf("sess-a", { HEAD: { ...CAP, catalogStatus: "DISABLED" }, BACK: { ...PACK, catalogStatus: "HIDDEN" } })], 0.016);
  await flush();
  assert.deepEqual(avatars[0].equipmentStatus().hidden, ["HEAD", "BACK"]);
  view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: { ...PACK, catalogStatus: "LOCKED" } })], 0.016);
  await flush();
  assert.deepEqual(avatars[0].equipmentStatus().active, ["HEAD", "BACK"]);
  view.sync([sampleOf("sess-a", { HEAD: { ...CAP, catalogStatus: "UNKNOWN_ITEM" } })], 0.016);
  assert.deepEqual(models(avatars[0], "HEAD"), []);
});

test("36. remote leave destroys the projection, its entities and the avatar", async () => {
  const { view, avatars } = scene();
  view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: PACK })], 0.016);
  await flush();
  const attached = [avatars[0].anchors.anchor("HEAD").children[0], avatars[0].anchors.anchor("BACK").children[0]];
  view.sync([], 0.016);
  assert.ok(attached.every((e) => e.destroyed));
  assert.ok(avatars[0].entity.destroyed);
  assert.equal(avatars[0].equipmentStatus().destroyed, true);
});

test("37-38. a load pending at leave or session replacement is discarded, never attached", async () => {
  const { app, view, avatars } = scene();
  app.hold = true;
  view.sync([sampleOf("sess-a", { HEAD: CAP })], 0.016);
  // A reload: the old session is superseded by a new one of the same user (a new avatar).
  view.sync([sampleOf("sess-a2", { HEAD: CAP })], 0.016);
  assert.equal(avatars.length, 2);
  assert.ok(avatars[0].entity.destroyed);
  app.hold = false;
  app.release();
  await flush();
  assert.deepEqual(models(avatars[1], "HEAD"), [CAP_MODEL]);
  assert.equal(avatars[0].anchors.anchor("HEAD").children.length, 0, "old session's late model never re-attached");
  // Leave while pending.
  app.hold = true;
  view.sync([sampleOf("sess-b", { BACK: PACK })], 0.016);
  view.sync([], 0.016);
  app.hold = false;
  app.release();
  await flush();
  assert.equal(avatars[2].anchors.anchor("BACK").children.length, 0);
});

test("39. a failing model load never destroys the remote avatar or other slots", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const { view, avatars } = scene({ fail: new Set(["/assets/induck-cap-v1.glb"]) });
    view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: PACK })], 0.016);
    await flush();
    assert.deepEqual(avatars[0].equipmentStatus().failed, ["HEAD"]);
    assert.deepEqual(models(avatars[0], "BACK"), [PACK_MODEL]);
    assert.equal(avatars[0].entity.destroyed, false);
    view.sync([sampleOf("sess-a", { HEAD: CAP, BACK: PACK })], 0.016);
    assert.equal(view.size, 1);
  } finally { console.warn = warn; }
});

test("40. many remote avatars wearing the same items share one download per GLB, one instance each", async () => {
  const { app, view, avatars } = scene();
  const everyone = ["sess-a", "sess-b", "sess-c", "sess-d"].map((id) => sampleOf(id, { HEAD: CAP, BACK: PACK }));
  view.sync(everyone, 0.016);
  await flush();
  assert.deepEqual(app.downloads.sort(), ["/assets/induck-backpack-v1.glb", "/assets/induck-cap-v1.glb"]);
  const caps = avatars.map((a) => a.anchors.anchor("HEAD").children[0]);
  assert.equal(new Set(caps).size, 4, "each avatar owns its render instance");
});

test("41. remote changes never touch the local player's projection", async () => {
  const local = new FakeEntity("Player");
  const localAnchors = createEquipmentAnchors({ createEntity: (n) => new FakeEntity(n), parent: local, height: 0.875 });
  const { view } = scene();
  view.sync([sampleOf("sess-a", { HEAD: CAP })], 0.016);
  await flush();
  view.sync([], 0.016);
  assert.equal(localAnchors.anchor("HEAD").children.length, 0);
  assert.equal(local.children.length, 1);
});

test("remote source: READY per session, session-scoped identity, changes only on real differences", () => {
  const src = createRemoteEquipmentSource({ sessionId: "sess-a" });
  const changes = [];
  src.onChange((c) => changes.push(c));
  assert.equal(src.state, "SIGNED_OUT");
  assert.equal(src.accountId, "remote:sess-a");
  assert.equal(src.set({ HEAD: CAP }), true);
  assert.equal(src.set({ HEAD: { ...CAP } }), false, "identical value: no change event");
  assert.equal(src.set({ HEAD: CAP, JUNK: 1 }), false);
  assert.equal(src.state, "READY");
  assert.deepEqual(src.snapshot.slots.HEAD, CAP);
  assert.equal(src.snapshot.slots.BACK, null);
  assert.equal(src.set(undefined), true, "missing equipment = none");
  assert.equal(changes.length, 2);
  assert.ok(Object.isFrozen(src.snapshot) && Object.isFrozen(src.snapshot.slots));
});

test("wiring: remote-avatar reuses createEquipmentProjection on the character anchors; one shared loader", () => {
  const text = source("../src/online/remote-avatar.js");
  assert.match(text, /createEquipmentProjection\(\{\s*loadout: equipmentSource,\s*getAnchor: \(slot\) => character\.getEquipmentAnchor\(slot\),\s*loadModel: loadEquipmentModel\s*\}\)/);
  assert.match(text, /loadEquipmentModel = createEquipmentModelLoader\(\{ app \}\)/, "one loader per factory, shared by every remote avatar");
  assert.match(text, /equipmentSource\.set\(sample\.equipment\)/);
  assert.match(text, /destroy\(\) \{[\s\S]*?equipment\.destroy\(\);[\s\S]*?entity\.destroy\(\);/, "projection destroyed before the entity");
  // No copy of the projection rules in the online layer.
  for (const file of ["../src/online/remote-avatar.js", "../src/online/remote-equipment-source.js"]) {
    const code = source(file).split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /PROJECTABLE|modelAssetId|getItemDefinition|EQUIPMENT_MODEL_REGISTRY|induck_cap/, file);
  }
});
