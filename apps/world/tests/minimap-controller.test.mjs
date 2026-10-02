import test from "node:test";
import assert from "node:assert/strict";
import { MINIMAP_STATE } from "../src/minimap/minimap-model.js";
import {
  MINIMAP_VIEWBOX,
  createMiniMapController,
  hasBlockingMiniMapOverlay
} from "../src/minimap/minimap-controller.js";

class FakeEvents {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ type }); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

function rig({
  x = 0,
  z = 0,
  yaw = 0,
  lobby = { active: false, transitioning: false },
  room = { insideRoom: false },
  overlay = {},
  objective = null,
  social = [],
  pois = [],
  geometry = [{ id: "g" }],
  width = 430,
  height = 900,
  coarsePointer = true,
  rendererThrows = false
} = {}) {
  const state = {
    position: { x, z },
    yaw,
    lobby: { ...lobby },
    room: { ...room },
    overlay: { ...overlay },
    objective: objective ? { ...objective } : null,
    social: social.map(marker => ({ ...marker })),
    ready: true
  };
  const documentLike = Object.assign(new FakeEvents(), { hidden: false });
  const windowTarget = Object.assign(new FakeEvents(), {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: coarsePointer })
  });
  const calls = { geometry: 0, refresh: 0, mount: 0, mountedGeometry: [], frames: [], states: [], modes: [], destroy: 0 };
  const dataSource = {
    geometry() { calls.geometry += 1; return geometry; },
    refreshState() { calls.refresh += 1; return pois; }
  };
  const renderer = {
    mountGeometry(value) {
      calls.mount += 1;
      calls.mountedGeometry.push(value);
      if (rendererThrows) throw Error("renderer mount failed");
      if (calls.mount === 1) assert.strictEqual(value, geometry);
    },
    renderFrame(frame) {
      if (rendererThrows) throw Error("renderer frame failed");
      calls.frames.push(frame);
    },
    setState(value) { calls.states.push(value); },
    setMapMode(value) { calls.modes.push(value); },
    destroy() { calls.destroy += 1; }
  };
  const player = { getLocalPosition: () => ({ ...state.position }) };
  const orbit = {};
  Object.defineProperty(orbit, "yaw", { get: () => state.yaw });
  const controller = createMiniMapController({
    player,
    orbit,
    getReady: () => state.ready,
    getLobbyState: () => state.lobby,
    getRoomState: () => state.room,
    getOverlayState: () => state.overlay,
    getObjectiveMarker: () => state.objective,
    getSocialMarkers: () => state.social,
    dataSource,
    renderer,
    documentLike,
    windowTarget
  });
  return { state, calls, documentLike, windowTarget, controller, dataSource, geometry };
}

test("blocking overlay policy ignores chat/emote but suspends real blocking panels", () => {
  assert.equal(hasBlockingMiniMapOverlay({ chat: true }), false);
  assert.equal(hasBlockingMiniMapOverlay({ emote: true }), false);
  assert.equal(hasBlockingMiniMapOverlay({ hudMenu: true }), true);
  assert.equal(hasBlockingMiniMapOverlay({ npcConversation: true }), true);
  assert.equal(hasBlockingMiniMapOverlay({ blocking: true }), true);
});

test("controller mounts static geometry and POI state once, not every gameplay frame", () => {
  const r = rig({ pois: [{ poiId: "poi.a", x: 5, z: 0, iconKey: "gate", presentation: "NORMAL", visible: true, priority: 10 }] });
  assert.equal(r.calls.geometry, 1);
  assert.equal(r.calls.mount, 1);
  assert.equal(r.calls.refresh, 1);
  r.controller.update({ force: true });
  r.state.position.x = 1;
  r.controller.update();
  r.state.position.x = 2;
  r.controller.update();
  assert.equal(r.calls.geometry, 1, "no geometry rebuild");
  assert.equal(r.calls.refresh, 1, "no per-frame gate/POI refresh");
});

test("yaw 0 centres the player and places +z POI above, +x POI right", () => {
  const r = rig({
    pois: [
      { poiId: "poi.north", x: 0, z: 10, iconKey: "gate", presentation: "NORMAL", visible: true, priority: 20 },
      { poiId: "poi.east", x: 10, z: 0, iconKey: "gate", presentation: "NORMAL", visible: true, priority: 10 }
    ]
  });
  r.controller.update({ force: true });
  const frame = r.calls.frames.at(-1);
  const north = frame.pois.find(p => p.poiId === "poi.north");
  const east = frame.pois.find(p => p.poiId === "poi.east");
  assert.equal(frame.worldTransform.translateX, 0);
  assert.equal(frame.worldTransform.translateY, 0);
  assert.equal(frame.worldTransform.rotationRad, 0);
  assert.ok(Math.abs(north.screenX - 56) < 1e-9);
  assert.ok(north.screenY < 56);
  assert.ok(east.screenX > 56);
  assert.ok(Math.abs(east.screenY - 56) < 1e-9);
});

test("yaw pi/2 keeps camera-forward -x target above and rotates north indicator", () => {
  const r = rig({
    yaw: Math.PI / 2,
    pois: [{ poiId: "poi.forward", x: -10, z: 0, iconKey: "gate", presentation: "NORMAL", visible: true, priority: 10 }]
  });
  r.controller.update({ force: true });
  const frame = r.calls.frames.at(-1);
  const poi = frame.pois[0];
  assert.ok(Math.abs(poi.screenX - MINIMAP_VIEWBOX.centerX) < 1e-9);
  assert.ok(poi.screenY < MINIMAP_VIEWBOX.centerY);
  assert.equal(frame.worldTransform.rotationRad, Math.PI / 2);
  assert.equal(frame.compass.northAngleRad, Math.PI / 2);
});

test("state sequence lobby → campus → menu → room → campus follows the locked runtime contract", () => {
  const r = rig({ lobby: { active: true, transitioning: false } });
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.HIDDEN);

  r.state.lobby.active = false;
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);

  r.state.overlay.hudMenu = true;
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.SUSPENDED);

  r.state.overlay.hudMenu = false;
  r.state.room.insideRoom = true;
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.HIDDEN);

  r.state.room.insideRoom = false;
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);
});

test("first-person/mount/chat do not suspend the M0 map", () => {
  const r = rig({ overlay: { chat: true, emote: true } });
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);
});

test("M2 room source keeps the Mini-map active indoors with room-local radius", () => {
  const r = rig({ room: { insideRoom: true } });
  r.controller.update({ force: true });
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.HIDDEN);

  const roomGeometry = [
    { id:"room-floor", kind:"ROOM_FLOOR", rings:[[{x:-4,z:-3},{x:4,z:-3},{x:4,z:3},{x:-4,z:3}]] },
    { id:"room-table", kind:"ROOM_FURNITURE", rings:[[{x:-1,z:-.5},{x:1,z:-.5},{x:1,z:.5},{x:-1,z:.5}]] }
  ];
  const roomSource = {
    geometry: () => roomGeometry,
    refreshState: () => [{ poiId:"room.exit", x:0, z:-2, iconKey:"exit", presentation:"NORMAL", visible:true, priority:100 }]
  };
  assert.equal(r.controller.setDataSource(roomSource, {
    id: "ROOM_CLUBHOUSE_01",
    indoor: true,
    radiusWorld: 5.2
  }), true);
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);
  assert.strictEqual(r.calls.mountedGeometry.at(-1), roomGeometry);
  assert.equal(r.calls.frames.at(-1).worldTransform, null);
  assert.equal(r.calls.frames.at(-1).projectedGeometry.length, 2);
  assert.ok(r.calls.frames.at(-1).projectedGeometry[1].rings[0].every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.equal(r.controller.status().mapSourceId, "ROOM_CLUBHOUSE_01");
  assert.equal(r.controller.status().indoorMapActive, true);
  assert.equal(r.calls.modes.at(-1), "room");
  assert.ok(Math.abs(r.controller.status().radiusMeters - 10.4) < 1e-9);

  r.state.room.insideRoom = false;
  r.controller.setDataSource(r.dataSource, { id:"campus", indoor:false });
  assert.equal(r.controller.status().mapSourceId, "campus");
  assert.equal(r.controller.status().indoorMapActive, false);
  assert.equal(r.calls.modes.at(-1), "campus");
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);
});

test("closing a blocking overlay repaints ACTIVE even when player and yaw never moved", () => {
  const r = rig();
  r.controller.update({ force: true });
  const activeFrame = r.calls.frames.length;
  r.state.overlay.hudMenu = true;
  r.controller.update();
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.SUSPENDED);
  r.state.overlay.hudMenu = false;
  assert.equal(r.controller.update(), true);
  assert.equal(r.calls.frames.length, activeFrame + 2);
  assert.equal(r.calls.frames.at(-1).state, MINIMAP_STATE.ACTIVE);
});

test("objective inside radius uses its real relative position and outside radius clamps to the edge", () => {
  const r = rig({ objective: { objectiveId: "tour.gate", x: 0, z: 10, kind: "destination", label: "정문 통과" } });
  r.controller.update({ force: true });
  let objective = r.calls.frames.at(-1).objective;
  assert.equal(objective.edge, false);
  assert.ok(Math.abs(objective.screenX - MINIMAP_VIEWBOX.centerX) < 1e-9);
  assert.ok(objective.screenY < MINIMAP_VIEWBOX.centerY);

  r.state.objective = { objectiveId: "tour.far", x: 0, z: 100, kind: "destination", label: "먼 목표" };
  r.controller.update();
  objective = r.calls.frames.at(-1).objective;
  assert.equal(objective.edge, true);
  const edgeDistance = Math.hypot(
    objective.screenX - MINIMAP_VIEWBOX.centerX,
    objective.screenY - MINIMAP_VIEWBOX.centerY
  );
  assert.ok(Math.abs(edgeDistance - MINIMAP_VIEWBOX.objectiveEdgeRadius) < 1e-9);
});

test("social markers stay in radius, cap at three and prioritize friends", () => {
  const r = rig({
    social: [
      { markerId: "remote.player-near", x: 2, z: 0, kind: "player" },
      { markerId: "remote.friend-far", x: 20, z: 0, kind: "friend" },
      { markerId: "remote.player-2", x: 3, z: 0, kind: "player" },
      { markerId: "remote.friend-2", x: 4, z: 0, kind: "friend" },
      { markerId: "remote.outside", x: 100, z: 0, kind: "friend" }
    ]
  });
  r.controller.update({ force: true });
  const social = r.calls.frames.at(-1).social;
  assert.equal(social.length, 3);
  assert.equal(social[0].kind, "friend");
  assert.equal(social[1].kind, "friend");
  assert.ok(!social.some(marker => marker.markerId === "remote.outside"));
  assert.equal(r.controller.status().visibleSocialCount, 3);
});

test("remote-only movement repaints the minimap without local player movement", () => {
  const r = rig({ social: [{ markerId: "remote.a", x: 5, z: 0, kind: "player" }] });
  r.controller.update({ force: true });
  const before = r.calls.frames.length;
  r.state.social[0].x = 6;
  assert.equal(r.controller.update(), true);
  assert.equal(r.calls.frames.length, before + 1);
  assert.ok(r.calls.frames.at(-1).social[0].screenX > r.calls.frames.at(-2).social[0].screenX);
});

test("objective-only stage change repaints even when player and camera are unchanged", () => {
  const r = rig({ objective: { objectiveId: "quest.1", x: 5, z: 5, kind: "destination", label: "본관 앞 방문" } });
  r.controller.update({ force: true });
  const before = r.calls.frames.length;
  r.state.objective = { objectiveId: "quest.2", x: 20, z: 30, kind: "destination", label: "인경호 방문" };
  assert.equal(r.controller.update(), true);
  assert.equal(r.calls.frames.length, before + 1);
  assert.equal(r.calls.frames.at(-1).objective.objectiveId, "quest.2");
  assert.equal(r.controller.status().objectiveActive, true);

  r.state.objective = null;
  assert.equal(r.controller.update(), true);
  assert.equal(r.calls.frames.at(-1).objective, null);
  assert.equal(r.controller.status().objectiveActive, false);
});

test("POIs outside 90 m are omitted and at most five markers survive density filtering", () => {
  const pois = Array.from({ length: 8 }, (_, i) => ({
    poiId: `poi.${i}`,
    x: i < 7 ? i + 1 : 100,
    z: 0,
    iconKey: "landmark",
    presentation: "NORMAL",
    visible: true,
    priority: 100 - i
  }));
  const r = rig({ pois });
  r.controller.update({ force: true });
  const frame = r.calls.frames.at(-1);
  assert.equal(frame.pois.length, 5);
  assert.ok(!frame.pois.some(p => p.poiId === "poi.7"), "far marker is outside the 45 WU radius");
});

test("unchanged player/yaw fast-path skips redundant frame writes", () => {
  const r = rig();
  r.controller.update({ force: true });
  const before = r.calls.frames.length;
  assert.equal(r.controller.update(), false);
  assert.equal(r.calls.frames.length, before);
  r.state.yaw = 0.1;
  assert.equal(r.controller.update(), true);
  assert.equal(r.calls.frames.length, before + 1);
});

test("hidden browser tab pauses render work; becoming visible forces one fresh sync", () => {
  const r = rig();
  r.controller.update({ force: true });
  const before = r.calls.frames.length;
  r.documentLike.hidden = true;
  r.state.position.x = 20;
  assert.equal(r.controller.update(), false);
  assert.equal(r.calls.frames.length, before);
  r.documentLike.hidden = false;
  r.documentLike.dispatch("visibilitychange");
  assert.equal(r.calls.frames.length, before + 1);
  assert.equal(r.calls.frames.at(-1).worldTransform.translateX, -20);
});

test("resize switches profile without rebuilding geometry", () => {
  const r = rig({ width: 430, height: 900, coarsePointer: true });
  r.controller.update({ force: true });
  assert.equal(r.controller.status().profile, "MOBILE");
  const mounts = r.calls.mount;
  r.windowTarget.innerWidth = 1280;
  r.windowTarget.innerHeight = 800;
  r.windowTarget.matchMedia = () => ({ matches: false });
  r.windowTarget.dispatch("resize");
  assert.equal(r.controller.status().profile, "DESKTOP");
  assert.equal(r.calls.mount, mounts);
});

test("renderer failure is isolated as UNAVAILABLE and never escapes into the world update loop", () => {
  const r = rig({ rendererThrows: true });
  assert.equal(r.controller.status().state, MINIMAP_STATE.UNAVAILABLE);
  assert.equal(r.controller.status().available, false);
  assert.ok(r.controller.status().errors.some(error => error.where === "mount"));
  assert.doesNotThrow(() => r.controller.update());
});

test("destroy removes lifecycle listeners and tears down only the renderer facade", () => {
  const r = rig();
  assert.equal(r.documentLike.count("visibilitychange"), 1);
  assert.equal(r.windowTarget.count("resize"), 1);
  assert.equal(r.windowTarget.count("orientationchange"), 1);
  assert.equal(r.controller.destroy(), true);
  assert.equal(r.controller.destroy(), false);
  assert.equal(r.documentLike.count("visibilitychange"), 0);
  assert.equal(r.windowTarget.count("resize"), 0);
  assert.equal(r.windowTarget.count("orientationchange"), 0);
  assert.equal(r.calls.destroy, 1);
});
