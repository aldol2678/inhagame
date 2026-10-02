import test from "node:test";
import assert from "node:assert/strict";
import {
  MINIMAP_PROFILE,
  MINIMAP_STATE,
  profileForViewport,
  projectHeadingUp,
  resolveMiniMapState,
  worldToMapUv
} from "../src/minimap/minimap-model.js";

const EPS = 1e-9;
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < EPS, `${label}: ${actual} != ${expected}`);

test("M0 profiles share a 90 m radius derived from the canonical world scale", () => {
  assert.deepEqual(
    Object.values(MINIMAP_PROFILE).map(({ id, sizePx, radiusMeters, radiusWorld }) => ({ id, sizePx, radiusMeters, radiusWorld })),
    [
      { id: "COMPACT", sizePx: 96, radiusMeters: 90, radiusWorld: 45 },
      { id: "MOBILE", sizePx: 112, radiusMeters: 90, radiusWorld: 45 },
      { id: "DESKTOP", sizePx: 156, radiusMeters: 90, radiusWorld: 45 }
    ]
  );
});

test("worldToMapUv maps east to right and north to top", () => {
  const bounds = { minX: -100, maxX: 100, minZ: -200, maxZ: 200 };
  assert.deepEqual(worldToMapUv({ x: -100, z: -200 }, bounds), { u: 0, v: 1 });
  assert.deepEqual(worldToMapUv({ x: 100, z: 200 }, bounds), { u: 1, v: 0 });
  assert.deepEqual(worldToMapUv({ x: 0, z: 0 }, bounds), { u: 0.5, v: 0.5 });
});

test("heading-up projection: yaw 0 puts +z above and +x to the right", () => {
  const player = { x: 10, z: 20 };
  const north = projectHeadingUp({ x: 10, z: 30 }, player, 0, 2);
  near(north.x, 0, "north x");
  near(north.y, -20, "north y");
  near(north.forward, 10, "north forward");

  const east = projectHeadingUp({ x: 15, z: 20 }, player, 0, 2);
  near(east.x, 10, "east x");
  near(east.y, 0, "east y");
  near(east.right, 5, "east right");
});

test("heading-up projection follows the camera direction at yaw pi/2", () => {
  // OrbitCameraController faces -x at +pi/2, so a target west of the player is straight ahead.
  const ahead = projectHeadingUp({ x: -10, z: 0 }, { x: 0, z: 0 }, Math.PI / 2, 1);
  near(ahead.x, 0, "ahead x");
  near(ahead.y, -10, "ahead y");
  near(ahead.forward, 10, "ahead forward");
});

test("POI projection matches the SVG geometry transform at rotated player positions", () => {
  const player = { x: 17, z: -23 };
  const target = { x: 31, z: 12 };
  const scale = 46 / 45;
  for (const yaw of [0, Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    // SVG geometry stores (x, -z), then applies translate(-player.x, +player.z),
    // scale, rotate(yaw), and finally the fixed player-centred translate(56, 56).
    const dx = target.x - player.x;
    const svgY = -target.z + player.z;
    const geometryX = scale * (dx * Math.cos(yaw) - svgY * Math.sin(yaw));
    const geometryY = scale * (dx * Math.sin(yaw) + svgY * Math.cos(yaw));
    const poi = projectHeadingUp(target, player, yaw, scale);
    near(poi.x, geometryX, `x at yaw ${yaw}`);
    near(poi.y, geometryY, `y at yaw ${yaw}`);
  }
});

test("same world point stays at the mini-map centre and distance is world-space", () => {
  const p = projectHeadingUp({ x: 3, z: 4 }, { x: 3, z: 4 }, 1.234, 1.5);
  near(p.x, 0, "centre x");
  near(p.y, 0, "centre y");
  near(p.distanceWorld, 0, "centre distance");

  const edge = projectHeadingUp({ x: 45, z: 0 }, { x: 0, z: 0 }, 0, 1);
  near(edge.distanceWorld, MINIMAP_PROFILE.MOBILE.radiusWorld, "90 m boundary");
});

test("state precedence keeps lobby/room hidden and blocking overlays suspended", () => {
  assert.equal(resolveMiniMapState({ ready: true, minimapAvailable: false }), MINIMAP_STATE.UNAVAILABLE);
  assert.equal(resolveMiniMapState({ ready: false }), MINIMAP_STATE.HIDDEN);
  assert.equal(resolveMiniMapState({ ready: true, lobbyActive: true, blockingOverlayOpen: true }), MINIMAP_STATE.HIDDEN);
  assert.equal(resolveMiniMapState({ ready: true, lobbyTransitionActive: true }), MINIMAP_STATE.HIDDEN);
  assert.equal(resolveMiniMapState({ ready: true, insideRoom: true }), MINIMAP_STATE.HIDDEN);
  assert.equal(resolveMiniMapState({ ready: true, blockingOverlayOpen: true }), MINIMAP_STATE.SUSPENDED);
  assert.equal(resolveMiniMapState({ ready: true }), MINIMAP_STATE.ACTIVE);
});

test("mounted and first-person flags do not change M0 visibility", () => {
  assert.equal(resolveMiniMapState({ ready: true, mounted: true, firstPerson: false }), MINIMAP_STATE.ACTIVE);
  assert.equal(resolveMiniMapState({ ready: true, mounted: true, firstPerson: true }), MINIMAP_STATE.ACTIVE);
});

test("viewport profile chooses compact, mobile and desktop deterministically", () => {
  assert.strictEqual(profileForViewport({ width: 360, height: 800, coarsePointer: true }), MINIMAP_PROFILE.COMPACT);
  assert.strictEqual(profileForViewport({ width: 430, height: 900, coarsePointer: true }), MINIMAP_PROFILE.MOBILE);
  assert.strictEqual(profileForViewport({ width: 1280, height: 800, coarsePointer: false }), MINIMAP_PROFILE.DESKTOP);
  assert.strictEqual(profileForViewport({ width: 900, height: 600, coarsePointer: false }), MINIMAP_PROFILE.COMPACT);
});

test("invalid numeric inputs fail loudly instead of placing markers at nonsense coordinates", () => {
  assert.throws(() => worldToMapUv({ x: NaN, z: 0 }, { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }), TypeError);
  assert.throws(() => worldToMapUv({ x: 0, z: 0 }, { minX: 1, maxX: 1, minZ: 0, maxZ: 1 }), TypeError);
  assert.throws(() => projectHeadingUp({ x: 0, z: 0 }, { x: 0, z: 0 }, Infinity, 1), TypeError);
  assert.throws(() => projectHeadingUp({ x: 0, z: 0 }, { x: 0, z: 0 }, 0, 0), TypeError);
  assert.throws(() => profileForViewport({ width: 0, height: 800 }), TypeError);
});

