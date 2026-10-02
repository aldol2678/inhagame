import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_EQUIPMENT_ANCHOR_LAYOUT, EQUIPMENT_FRAME_NAME, EQUIPMENT_ROOT_NAME, EQUIPMENT_SLOTS, createEquipmentAnchors, equipmentAnchorName
} from "../src/appearance/equipment-anchors.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Minimal scene-graph fake with the PlayCanvas Entity surface the anchors use.
class FakeEntity {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.enabled = true; this.pos = [0, 0, 0]; this.euler = [0, 0, 0]; this.destroyed = false; this.posWrites = 0; }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
  setLocalPosition(x, y, z) { this.pos = [x, y, z]; this.posWrites += 1; }
  setLocalEulerAngles(x, y, z) { this.euler = [x, y, z]; }
  destroy() { this.destroyed = true; this.parent?.removeChild(this); for (const c of [...this.children]) c.destroy(); }
  get enabledInHierarchy() { return this.enabled && (this.parent ? this.parent.enabledInHierarchy : true); }
}
const create = (name) => new FakeEntity(name);
const H = 1.7;

test("anchors: one stable root under the player and one anchor per equipment slot (BADGE excluded)", () => {
  const player = new FakeEntity("Player");
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  assert.deepEqual(EQUIPMENT_SLOTS, ["BODY", "FACE", "HAIR", "HEAD", "TOP", "BOTTOM", "SHOES", "BACK", "ACCESSORY"]);
  assert.equal(anchors.root.name, EQUIPMENT_ROOT_NAME);
  assert.equal(anchors.root.parent, player);
  for (const slot of EQUIPMENT_SLOTS) {
    const anchor = anchors.anchor(slot);
    assert.equal(anchor.name, equipmentAnchorName(slot));
    assert.equal(anchor.parent.name, EQUIPMENT_FRAME_NAME);
    assert.equal(anchor.parent.parent, anchors.root);
    assert.deepEqual(anchor.pos, DEFAULT_EQUIPMENT_ANCHOR_LAYOUT[slot].map((v) => v * H));
  }
  assert.equal(anchors.anchor("BADGE"), null);
  assert.equal(anchors.anchor("head.inha_cap"), null, "anchors know slots, never items");
  assert.equal(anchors.root.children.length, 1);
  assert.equal(anchors.root.children[0].children.length, EQUIPMENT_SLOTS.length);
});

test("anchors: placement is generic body layout (HEAD above FACE above TOP above SHOES; BACK behind)", () => {
  const y = (slot) => DEFAULT_EQUIPMENT_ANCHOR_LAYOUT[slot][1];
  assert.ok(y("HEAD") > y("FACE") && y("FACE") > y("TOP") && y("TOP") > y("BOTTOM") && y("BOTTOM") > y("SHOES"));
  assert.ok(DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.BACK[2] < 0 && DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.FACE[2] > 0);
  assert.ok(Object.isFrozen(DEFAULT_EQUIPMENT_ANCHOR_LAYOUT) && Object.isFrozen(DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.HEAD));
  assert.throws(() => createEquipmentAnchors({ createEntity: create, parent: new FakeEntity("P"), height: H, layout: { HEAD: [0, 1, 0] } }), /layout missing/);
  assert.throws(() => createEquipmentAnchors({ createEntity: create, parent: null, height: H }));
});

test("anchors: follow copies the body pose (feet height, depth, rotation) and skips identical frames", () => {
  const player = new FakeEntity("Player");
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  anchors.follow({ feetY: -0.85, z: 0, euler: [0, 0, 0] });
  assert.deepEqual(anchors.root.pos, [0, -0.85, 0]);
  const writes = anchors.root.posWrites;
  anchors.follow({ feetY: -0.85, z: 0, euler: [0, 0, 0] });
  assert.equal(anchors.root.posWrites, writes, "an unchanged pose writes nothing");
  anchors.follow({ feetY: -0.83, z: -0.07, euler: [17, 0, 0] }); // e.g. bike rider pose
  assert.deepEqual(anchors.root.pos, [0, -0.83, -0.07]);
  assert.deepEqual(anchors.root.euler, [17, 0, 0]);
});

test("anchors: rotation pivots at the visual's origin (pivotY), anchors stay feet-relative", () => {
  const player = new FakeEntity("Player");
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  const frame = anchors.root.children[0];
  // Sitting: the visual pitches about its origin 0.365 above the feet.
  anchors.follow({ feetY: -1.15, pivotY: -1.15 + 0.365, z: 0, euler: [-6, 0, 0] });
  assert.deepEqual(anchors.root.pos, [0, -1.15 + 0.365, 0], "root carries the rotation at the pivot");
  assert.deepEqual(anchors.root.euler, [-6, 0, 0]);
  assert.ok(Math.abs(frame.pos[1] + 0.365) < 1e-12 && frame.pos[0] === 0 && frame.pos[2] === 0, "frame returns to the feet");
  assert.deepEqual(anchors.anchor("HEAD").pos, DEFAULT_EQUIPMENT_ANCHOR_LAYOUT.HEAD.map((v) => v * H), "anchor layout untouched");
  // Upright: pivot at the feet reproduces the plain feet frame.
  anchors.follow({ feetY: -1.15, z: 0, euler: [0, 0, 0] });
  assert.deepEqual([anchors.root.pos, frame.pos], [[0, -1.15, 0], [0, 0, 0]]);
});

test("anchors: survive the fallback → GLB visual swap (root is not a child of the visual)", () => {
  const player = new FakeEntity("Player");
  const fallback = new FakeEntity("Induck_Visual");
  player.addChild(fallback);
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  const hat = new FakeEntity("FakeHat");
  anchors.anchor("HEAD").addChild(hat);
  // Swap: the GLB is added, the fallback disabled (character-model.js keeps the fallback entity).
  const glb = new FakeEntity("Induck_GLB_Visual");
  player.addChild(glb);
  fallback.enabled = false;
  assert.equal(anchors.root.parent, player);
  assert.equal(hat.parent, anchors.anchor("HEAD"));
  assert.equal(hat.enabledInHierarchy, true, "equipment stays visible after the swap");
  // Even destroying the fallback cannot take equipment down with it.
  fallback.destroy();
  assert.equal(hat.destroyed, false);
});

test("anchors: visibility follows the character (first person hides the whole root)", () => {
  const player = new FakeEntity("Player");
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  const bag = new FakeEntity("FakeBag");
  anchors.anchor("BACK").addChild(bag);
  anchors.setVisible(false);
  assert.equal(anchors.visible, false);
  assert.equal(bag.enabledInHierarchy, false, "no equipment floats alone in first person");
  anchors.setVisible(true);
  assert.equal(bag.enabledInHierarchy, true);
});

test("anchors: destroy removes the root and every anchor", () => {
  const player = new FakeEntity("Player");
  const anchors = createEquipmentAnchors({ createEntity: create, parent: player, height: H });
  const head = anchors.anchor("HEAD");
  anchors.destroy();
  assert.equal(anchors.root.destroyed, true);
  assert.equal(head.destroyed, true);
  assert.equal(player.children.length, 0);
  assert.equal(anchors.anchor("HEAD"), null);
});

test("character-model: minimal anchor contract (player-parented root, pose follow, first-person visibility)", () => {
  const character = source("../src/character-model.js");
  assert.match(character, /createEquipmentAnchors\(\{ createEntity: name => new pc\.Entity\(name\), parent: player, height: HUMAN_HEIGHT \}\)/);
  assert.match(character, /equipment\.follow\(\{\s*feetY: pose\.feetY, pivotY: pose\.y,/, "equipment rotates about the visual's pivot");
  assert.match(character, /setFirstPerson\(value\) \{[\s\S]*?equipment\.setVisible\(!value\);/);
  assert.match(character, /getEquipmentAnchor: slot => equipment\.anchor\(slot\)/);
  assert.doesNotMatch(character, /equipment-projection|loadout|getItemDefinition|modelAssetId/, "the character knows anchors, not items");
});

test("anchors module: renderer-agnostic, no item or network knowledge", () => {
  const text = source("../src/appearance/equipment-anchors.js");
  assert.doesNotMatch(text, /from "playcanvas"|WebGPU\b.*device|isWebGPU|\.rpc\(|supabase|modelAssetId|Induck/);
});
