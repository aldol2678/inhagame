import test from "node:test";
import assert from "node:assert/strict";
import { MINIMAP_PROFILE, MINIMAP_STATE } from "../src/minimap/minimap-model.js";
import { createMiniMapRenderer } from "../src/minimap/minimap-renderer.js";

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, value); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.textContent = "";
    this.style = new FakeStyle();
  }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw Error("child not found");
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
}

const fakeDocument = { createElementNS: (_ns, tag) => new FakeElement(tag) };
const rig = () => {
  const root = new FakeElement("aside");
  const geometryLayer = new FakeElement("g");
  const poiLayer = new FakeElement("g");
  const objectiveLayer = new FakeElement("g");
  objectiveLayer.appendChild(new FakeElement("circle"));
  objectiveLayer.appendChild(new FakeElement("text"));
  const socialLayer = new FakeElement("g");
  const playerLayer = new FakeElement("g");
  const compassLayer = new FakeElement("g");
  const renderer = createMiniMapRenderer({
    root, geometryLayer, poiLayer, objectiveLayer, socialLayer, playerLayer, compassLayer, documentLike: fakeDocument
  });
  return { root, geometryLayer, poiLayer, objectiveLayer, socialLayer, playerLayer, compassLayer, renderer };
};

const geometry = [
  { id: "bldg", kind: "BUILDING", rings: [[{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]] },
  { id: "five", kind: "BUILDING", rings: [
    [{ x: 20, z: 20 }, { x: 40, z: 20 }, { x: 40, z: 40 }, { x: 20, z: 40 }],
    [{ x: 25, z: 25 }, { x: 35, z: 25 }, { x: 35, z: 35 }, { x: 25, z: 35 }]
  ] }
];

test("room geometry receives explicit visible paint independent of stylesheet timing", () => {
  const r = rig();
  r.renderer.mountGeometry([
    { id:"room.floor", kind:"ROOM_FLOOR", rings:[[{x:-4,z:-3},{x:4,z:-3},{x:4,z:3},{x:-4,z:3}]] },
    { id:"room.table", kind:"ROOM_FURNITURE", rings:[[{x:-1,z:-.5},{x:1,z:-.5},{x:1,z:.5},{x:-1,z:.5}]] }
  ]);
  assert.equal(r.geometryLayer.children[0].getAttribute("fill"), "#9d7f5b");
  assert.equal(r.geometryLayer.children[0].getAttribute("opacity"), "1");
  assert.equal(r.geometryLayer.children[1].getAttribute("fill"), "#dce8ee");
  assert.equal(r.geometryLayer.children[1].getAttribute("opacity"), "1");
});

test("geometry mounts once per explicit call and preserves courtyard holes in one evenodd path", () => {
  const r = rig();
  assert.equal(r.renderer.mountGeometry(geometry), 2);
  assert.equal(r.geometryLayer.children.length, 2);
  const five = r.geometryLayer.children[1];
  assert.equal(five.getAttribute("fill-rule"), "evenodd");
  assert.equal((five.getAttribute("d").match(/M /g) ?? []).length, 2, "outer + hole are one path");
  assert.match(five.getAttribute("d"), /20 -20/);
  assert.equal(r.renderer.status().mountedGeometry, true);
  assert.equal(r.renderer.status().geometryNodeCount, 2);
});

test("frame transforms never recreate geometry nodes", () => {
  const r = rig();
  r.renderer.mountGeometry(geometry);
  const before = [...r.geometryLayer.children];
  for (let i = 0; i < 20; i += 1) {
    r.renderer.renderFrame({
      state: MINIMAP_STATE.ACTIVE,
      profile: MINIMAP_PROFILE.MOBILE,
      worldTransform: { centerX: 56, centerY: 56, translateX: -i, translateY: i * 2, rotationRad: i / 10, scale: 1 },
      compass: { northAngleRad: i / 10 },
      pois: []
    });
  }
  assert.deepEqual(r.geometryLayer.children, before);
  assert.equal(r.geometryLayer.children.length, 2);
});

test("world transform uses one parent SVG transform with north stored as negative y", () => {
  const r = rig();
  r.renderer.mountGeometry(geometry);
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    worldTransform: { centerX: 56, centerY: 56, translateX: -12, translateY: 34, rotationRad: Math.PI / 2, scale: 1.25 },
    compass: { northAngleRad: Math.PI / 2 },
    pois: []
  });
  assert.equal(r.geometryLayer.getAttribute("transform"),
    "translate(56 56) rotate(90) scale(1.25) translate(-12 34)");
  assert.equal(r.compassLayer.getAttribute("transform"), "rotate(90 56 56)");
});

test("projected room geometry writes screen-space paths with identity group transform", () => {
  const r = rig();
  r.renderer.mountGeometry([
    { id:"room.floor", kind:"ROOM_FLOOR", rings:[[{x:-4,z:-3},{x:4,z:-3},{x:4,z:3},{x:-4,z:3}]] },
    { id:"room.table", kind:"ROOM_FURNITURE", rings:[[{x:-1,z:-.5},{x:1,z:-.5},{x:1,z:.5},{x:-1,z:.5}]] }
  ]);
  const before=[...r.geometryLayer.children];
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    projectedGeometry: [
      { id:"room.floor", rings:[[{x:20,y:20},{x:92,y:20},{x:92,y:82},{x:20,y:82}]] },
      { id:"room.table", rings:[[{x:45,y:48},{x:67,y:48},{x:67,y:60},{x:45,y:60}]] }
    ],
    compass:{northAngleRad:0}
  });
  assert.deepEqual(r.geometryLayer.children,before,"projected room update reuses geometry nodes");
  assert.equal(r.geometryLayer.getAttribute("transform"),"matrix(1 0 0 1 0 0)");
  assert.equal(r.geometryLayer.children[0].getAttribute("d"),"M 20 20 L 92 20 L 92 82 L 20 82 Z");
  assert.equal(r.geometryLayer.children[1].getAttribute("d"),"M 45 48 L 67 48 L 67 60 L 45 60 Z");
});

test("room mode uses an explicit projection matrix for small interior geometry", () => {
  const r = rig();
  r.renderer.mountGeometry(geometry);
  r.renderer.setMapMode("room");
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    worldTransform: { centerX: 56, centerY: 56, translateX: 0, translateY: -1.8, rotationRad: 0, scale: 8 },
    compass: { northAngleRad: 0 },
    pois: []
  });
  assert.equal(r.root.getAttribute("data-map-mode"), "room");
  assert.equal(r.renderer.status().mapMode, "room");
  assert.equal(r.geometryLayer.getAttribute("transform"), "matrix(8 0 0 8 56 41.6)");
});

test("POI nodes are keyed and reused across frame movement", () => {
  const r = rig();
  const meta = [
    { poiId: "poi.a", iconKey: "gate", presentation: "NORMAL", screenX: 20, screenY: 30, visible: true },
    { poiId: "poi.b", iconKey: "water", presentation: "LOCKED", screenX: 40, screenY: 50, visible: true }
  ];
  r.renderer.renderFrame({ state: MINIMAP_STATE.ACTIVE, profile: MINIMAP_PROFILE.MOBILE, pois: meta });
  const before = [...r.poiLayer.children];
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    pois: meta.map(p => ({ ...p, screenX: p.screenX + 3, screenY: p.screenY - 2 }))
  });
  assert.deepEqual(r.poiLayer.children, before);
  assert.equal(r.poiLayer.children[0].getAttribute("transform"), "translate(23 28)");
  assert.equal(r.renderer.status().visiblePoiCount, 2);
});

test("social marker nodes are keyed, reused and friend/player styled", () => {
  const r = rig();
  const markers = [
    { markerId: "remote.a", kind: "friend", screenX: 30, screenY: 40, visible: true },
    { markerId: "remote.b", kind: "player", screenX: 50, screenY: 60, visible: true }
  ];
  r.renderer.renderFrame({ state: MINIMAP_STATE.ACTIVE, profile: MINIMAP_PROFILE.MOBILE, social: markers });
  const before = [...r.socialLayer.children];
  assert.equal(before.length, 2);
  assert.equal(before[0].getAttribute("data-social-kind"), "friend");
  assert.equal(before[1].getAttribute("data-social-kind"), "player");
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    social: markers.map((m, i) => ({ ...m, screenX: m.screenX + i + 1 }))
  });
  assert.deepEqual(r.socialLayer.children, before);
  assert.equal(r.renderer.status().visibleSocialCount, 2);
});

test("objective layer renders destination/NPC state and edge metadata without creating nodes", () => {
  const r = rig();
  const before = [...r.objectiveLayer.children];
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    objective: { screenX: 91, screenY: 56, edge: true, kind: "destination" }
  });
  assert.deepEqual(r.objectiveLayer.children, before);
  assert.equal(r.objectiveLayer.getAttribute("visibility"), "visible");
  assert.equal(r.objectiveLayer.getAttribute("transform"), "translate(91 56)");
  assert.equal(r.objectiveLayer.getAttribute("data-edge"), "true");
  assert.equal(r.objectiveLayer.children[1].textContent, "!");

  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    objective: { screenX: 60, screenY: 40, edge: false, kind: "quest-npc" }
  });
  assert.equal(r.objectiveLayer.getAttribute("data-objective-kind"), "quest-npc");
  assert.equal(r.objectiveLayer.children[1].textContent, "N");
  assert.equal(r.renderer.status().objectiveVisible, true);

  r.renderer.renderFrame({ state: MINIMAP_STATE.ACTIVE, profile: MINIMAP_PROFILE.MOBILE, objective: null });
  assert.equal(r.objectiveLayer.getAttribute("visibility"), "hidden");
  assert.equal(r.renderer.status().objectiveVisible, false);
});

test("setPois removes stale markers instead of leaking SVG nodes", () => {
  const r = rig();
  r.renderer.setPois([
    { poiId: "poi.a", iconKey: "gate", presentation: "NORMAL" },
    { poiId: "poi.b", iconKey: "water", presentation: "NORMAL" }
  ]);
  assert.equal(r.poiLayer.children.length, 2);
  r.renderer.setPois([{ poiId: "poi.b", iconKey: "water", presentation: "NORMAL" }]);
  assert.equal(r.poiLayer.children.length, 1);
  assert.equal(r.poiLayer.children[0].getAttribute("data-poi-id"), "poi.b");
});

test("60 seconds of moving frames reuse geometry and bound POI DOM nodes", () => {
  const r = rig();
  r.renderer.mountGeometry(geometry);
  const before = [...r.geometryLayer.children];
  const ids = ["poi.a", "poi.b", "poi.c", "poi.d", "poi.e"];
  for (let frame = 0; frame < 60 * 60; frame += 1) {
    const pois = ids.slice(frame % 3, (frame % 3) + 3).map((poiId, index) => ({
      poiId, iconKey: "gate", presentation: "NORMAL",
      screenX: 20 + index + frame / 60, screenY: 30, visible: true
    }));
    r.renderer.renderFrame({
      state: MINIMAP_STATE.ACTIVE,
      profile: MINIMAP_PROFILE.MOBILE,
      worldTransform: { centerX: 56, centerY: 56, translateX: -frame / 60, translateY: 0, rotationRad: frame / 3600, scale: 1 },
      compass: { northAngleRad: frame / 3600 },
      pois
    });
    assert.deepEqual(r.geometryLayer.children, before, "geometry nodes remain identical");
    assert.equal(r.poiLayer.children.length, pois.length, "only current POI nodes remain");
    assert.equal(r.renderer.status().poiNodeCount, pois.length);
  }
  assert.equal(r.renderer.status().geometryNodeCount, before.length);
});

test("ACTIVE/HIDDEN/SUSPENDED/UNAVAILABLE states own shell visibility", () => {
  const r = rig();
  assert.equal(r.root.hidden, true);
  for (const state of [MINIMAP_STATE.ACTIVE, MINIMAP_STATE.HIDDEN, MINIMAP_STATE.SUSPENDED, MINIMAP_STATE.UNAVAILABLE]) {
    r.renderer.setState(state);
    assert.equal(r.root.getAttribute("data-minimap-state"), state);
    assert.equal(r.root.hidden, state !== MINIMAP_STATE.ACTIVE);
  }
});

test("responsive profile updates only the shell size contract", () => {
  const r = rig();
  r.renderer.setProfile(MINIMAP_PROFILE.COMPACT);
  assert.equal(r.root.getAttribute("data-minimap-profile"), "COMPACT");
  assert.equal(r.root.style.getPropertyValue("--minimap-size"), "96px");
  r.renderer.setProfile(MINIMAP_PROFILE.DESKTOP);
  assert.equal(r.root.style.getPropertyValue("--minimap-size"), "156px");
});

test("invalid geometry/frame data fails inside the renderer boundary", () => {
  const r = rig();
  assert.throws(() => r.renderer.mountGeometry([{ id: "bad", kind: "BUILDING", rings: [[{ x: NaN, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }]] }]), TypeError);
  assert.throws(() => r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    worldTransform: { translateX: 0, translateY: 0, rotationRad: 0, scale: 0 }
  }), TypeError);
  assert.throws(() => r.renderer.setPois([{ poiId: "same" }, { poiId: "same" }]), /Duplicate/);
});

test("destroy clears Mini-map SVG state without touching any external world object", () => {
  const r = rig();
  r.renderer.mountGeometry(geometry);
  r.renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    profile: MINIMAP_PROFILE.MOBILE,
    pois: [{ poiId: "poi.a", iconKey: "gate", presentation: "NORMAL", screenX: 20, screenY: 20, visible: true }]
  });
  assert.equal(r.renderer.destroy(), true);
  assert.equal(r.root.hidden, true);
  assert.equal(r.geometryLayer.children.length, 0);
  assert.equal(r.poiLayer.children.length, 0);
  assert.equal(r.renderer.status().state, MINIMAP_STATE.UNAVAILABLE);
  assert.equal(r.renderer.destroy(), false);
});
