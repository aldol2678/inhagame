import test from "node:test";
import assert from "node:assert/strict";

import { WORLD_REGION_ID, isWorldRegionId, normalizeWorldRegionId } from "../src/regions/world-region-registry.js";
import {
  BIRYONG_REALM_REGION_ID,
  BIRYONG_REALM_RESERVED_BOUNDS,
  BIRYONG_STATION_P0_BOUNDS,
  BIRYONG_STATION_RETURN_STOP,
  BIRYONG_STATION_SPAWN
} from "../src/biryong/biryong-realm-layout.js";
import { createBiryongRealmTransition, BIRYONG_REGION_TRANSITION_COOLDOWN_MS } from "../src/biryong/biryong-realm-transition.js";
import { createBiryongStationTransitInteraction } from "../src/biryong/biryong-station-transit-interaction.js";
import {
  BIRYONG_REALM_P0_BOUNDS,
  BIRYONG_REALM_P0_OBSTACLES,
  BIRYONG_REALM_PLACE_ZONES,
  BIRYONG_VILLAGE_ANCHORS,
  BIRYONG_VILLAGE_BUILDINGS,
  BIRYONG_VILLAGE_ROADS,
  getBiryongRealmPlaceZone
} from "../src/biryong/biryong-village-layout.js";
import { BIRYONG_REALM_MOVEMENT_SPACE } from "../src/biryong/biryong-realm-world-adapter.js";
import { createSpawnRegistry, SPAWN_ID, SPAWN_STATE } from "../src/lobby/spawn-registry.js";
import { validateResumeRecord, createWorldResumeStore, WORLD_RESUME_VERSION } from "../src/lobby/world-resume.js";

test("Biryong Realm has an explicit region id and station-local coordinate contract", () => {
  assert.equal(BIRYONG_REALM_REGION_ID, WORLD_REGION_ID.BIRYONG_REALM);
  assert.equal(isWorldRegionId(WORLD_REGION_ID.CAMPUS), true);
  assert.equal(isWorldRegionId(BIRYONG_REALM_REGION_ID), true);
  assert.equal(normalizeWorldRegionId("bad"), WORLD_REGION_ID.CAMPUS);
  assert.deepEqual(
    { x: BIRYONG_STATION_SPAWN.x, z: BIRYONG_STATION_SPAWN.z },
    { x: 0, z: 0 }
  );
  assert.equal(BIRYONG_STATION_SPAWN.regionId, WORLD_REGION_ID.BIRYONG_REALM);
  assert.ok(BIRYONG_STATION_P0_BOUNDS.minX > BIRYONG_REALM_RESERVED_BOUNDS.minX);
  assert.ok(BIRYONG_STATION_P0_BOUNDS.maxX < BIRYONG_REALM_RESERVED_BOUNDS.maxX);
});

test("Biryong Village P0 opens a continuous station-to-village movement envelope", () => {
  assert.ok(BIRYONG_REALM_P0_BOUNDS.minX <= BIRYONG_STATION_P0_BOUNDS.minX);
  assert.ok(BIRYONG_REALM_P0_BOUNDS.maxX >= BIRYONG_STATION_P0_BOUNDS.maxX);
  assert.ok(BIRYONG_REALM_P0_BOUNDS.minZ <= BIRYONG_STATION_P0_BOUNDS.minZ);
  assert.ok(BIRYONG_REALM_P0_BOUNDS.maxZ > BIRYONG_VILLAGE_ANCHORS.northFuture.z);
  assert.deepEqual(BIRYONG_REALM_MOVEMENT_SPACE.bounds, BIRYONG_REALM_P0_BOUNDS);
  assert.equal(BIRYONG_REALM_MOVEMENT_SPACE.obstacles, BIRYONG_REALM_P0_OBSTACLES);

  const approach = BIRYONG_VILLAGE_ROADS.find(road => road.id === "br_station_village_road");
  assert.ok(approach);
  assert.deepEqual(approach.points[0], BIRYONG_VILLAGE_ANCHORS.stationNorth);
  assert.deepEqual(approach.points.at(-1), BIRYONG_VILLAGE_ANCHORS.villageCenter);
  assert.ok(approach.width >= 5, "main approach remains comfortably walkable");
});

test("village buildings leave the main approach corridor clear and own collision", () => {
  const approach = BIRYONG_VILLAGE_ROADS.find(road => road.id === "br_station_village_road");
  const minZ = Math.min(...approach.points.map(point => point.z));
  const maxZ = Math.max(...approach.points.map(point => point.z));
  const halfRoad = approach.width / 2;
  for (const item of BIRYONG_VILLAGE_BUILDINGS) {
    const overlapsApproachZ = item.z + item.depth / 2 > minZ && item.z - item.depth / 2 < maxZ;
    if (overlapsApproachZ) {
      assert.ok(item.x + item.width / 2 < -halfRoad || item.x - item.width / 2 > halfRoad,
        `${item.id} blocks the station-to-village road`);
    }
    const collider = BIRYONG_REALM_P0_OBSTACLES.find(obstacle => obstacle.id === item.id);
    assert.ok(collider, `${item.id} has a movement collider`);
    assert.equal(collider.maxY, item.height);
  }
});

test("first Biryong runtime Place Zones resolve the P0 social/economic hubs without inventing outer zones", () => {
  assert.deepEqual(BIRYONG_REALM_PLACE_ZONES.map(zone => zone.id), [
    "BR_STATION", "BR_INN", "BR_WORKSHOP", "BR_MARKET", "BR_COUNCIL", "BR_RESIDENTIAL"
  ]);
  const cases = [
    [BIRYONG_STATION_SPAWN, "BR_STATION"],
    [BIRYONG_VILLAGE_ANCHORS.inn, "BR_INN"],
    [BIRYONG_VILLAGE_ANCHORS.workshop, "BR_WORKSHOP"],
    [BIRYONG_VILLAGE_ANCHORS.villageCenter, "BR_MARKET"],
    [BIRYONG_VILLAGE_ANCHORS.council, "BR_COUNCIL"],
    [BIRYONG_VILLAGE_ANCHORS.residential, "BR_RESIDENTIAL"]
  ];
  for (const [point, expected] of cases) assert.equal(getBiryongRealmPlaceZone(point)?.id, expected);
  assert.equal(getBiryongRealmPlaceZone({ x: 0, z: 51 }), null, "approach road stays a neutral transition strip");
  assert.equal(getBiryongRealmPlaceZone({ x: 0, z: 136 }), null, "unimplemented northern realm is not mislabeled");
});

test("Biryong Station spawn is registered but hidden from the lobby before discovery persistence exists", () => {
  const registry = createSpawnRegistry();
  const station = registry.get(SPAWN_ID.BIRYONG_STATION);
  assert.ok(station);
  assert.equal(station.regionId, WORLD_REGION_ID.BIRYONG_REALM);
  assert.equal(station.state, SPAWN_STATE.HIDDEN);
  assert.equal(station.visible, false);
  assert.equal(station.canStart, false);
  assert.deepEqual(station.spawnAnchor, {
    x: BIRYONG_STATION_SPAWN.x,
    y: BIRYONG_STATION_SPAWN.y,
    z: BIRYONG_STATION_SPAWN.z,
    yaw: BIRYONG_STATION_SPAWN.yaw
  });
  assert.equal(registry.list().some(item => item.spawnId === SPAWN_ID.BIRYONG_STATION), false);
  assert.equal(registry.list({ includeHidden: true }).some(item => item.spawnId === SPAWN_ID.BIRYONG_STATION), true);
});

test("region transition owns Campus -> Biryong -> Campus handoff and cooldown", () => {
  let now = 1000;
  const calls = [];
  const world = {
    leaveCampus: () => calls.push("leaveCampus"),
    showBiryong: () => calls.push("showBiryong"),
    showCampus: () => calls.push("showCampus"),
    placePlayer: (position, yaw) => calls.push(["place", position.regionId ?? WORLD_REGION_ID.CAMPUS, position.x, position.z, yaw]),
    resumeCampus: () => calls.push("resumeCampus")
  };
  const campusReturnAnchor = { x: 11, y: 1.15, z: 22, yaw: 90 };
  const busy = [];
  const transition = createBiryongRealmTransition({
    world,
    campusReturnAnchor,
    clock: { now: () => now },
    onBusyChange: value => busy.push(value)
  });

  assert.equal(transition.regionId, WORLD_REGION_ID.CAMPUS);
  assert.equal(transition.enter(), true);
  assert.equal(transition.regionId, WORLD_REGION_ID.BIRYONG_REALM);
  assert.deepEqual(calls.slice(0, 3), ["leaveCampus", "showBiryong",
    ["place", WORLD_REGION_ID.BIRYONG_REALM, 0, 0, 0]]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(transition.returnToCampus(), false, "arrival cooldown prevents immediate bounce");

  now += BIRYONG_REGION_TRANSITION_COOLDOWN_MS;
  assert.equal(transition.returnToCampus(), true);
  assert.equal(transition.regionId, WORLD_REGION_ID.CAMPUS);
  assert.deepEqual(calls.slice(-3), [
    "showCampus",
    ["place", WORLD_REGION_ID.CAMPUS, campusReturnAnchor.x, campusReturnAnchor.z, campusReturnAnchor.yaw],
    "resumeCampus"
  ]);
  assert.deepEqual(transition.status().stats, { enters: 1, exits: 1 });
});

test("Biryong Station F1 return action rechecks player state at trigger time", () => {
  let position = { x: BIRYONG_STATION_RETURN_STOP.x, y: BIRYONG_STATION_SPAWN.y, z: BIRYONG_STATION_RETURN_STOP.z };
  let state = { grounded: true, blocked: false };
  let returns = 0;
  const interaction = createBiryongStationTransitInteraction({
    getPosition: () => position,
    getState: () => state,
    returnToCampus: () => { returns += 1; return true; }
  });

  const action = interaction.observe(position, state);
  assert.ok(action);
  assert.equal(action.label, "F1 · 인하대후문행 탑승");
  assert.equal(action.trigger(), true);
  assert.equal(returns, 1);

  state = { grounded: true, blocked: true };
  assert.equal(action.trigger(), false);
  assert.equal(returns, 1);

  state = { grounded: true, blocked: false };
  position = { ...position, x: position.x + 20 };
  assert.equal(action.trigger(), false);
  assert.equal(returns, 1);
});

test("legacy Campus resume migrates to v2 while Biryong-local coordinates cannot validate as Campus", () => {
  const options = {
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    groundHeight: () => 0,
    canOccupyPosition: () => true,
    getZone: () => ({ id: "AREA_TEST", displayName: "테스트" })
  };
  const legacy = validateResumeRecord({
    version: 1, x: 0, y: 1.15, z: 0, yawDeg: 0, cameraYaw: 0, savedAt: 10
  }, options);
  assert.equal(legacy.state, "VALID");
  assert.equal(legacy.record.version, WORLD_RESUME_VERSION);
  assert.equal(legacy.record.regionId, WORLD_REGION_ID.CAMPUS);

  const wrongRegion = validateResumeRecord({
    version: WORLD_RESUME_VERSION,
    regionId: WORLD_REGION_ID.BIRYONG_REALM,
    x: 0, y: 1.15, z: 0, yawDeg: 0, cameraYaw: 0, savedAt: 10
  }, options);
  assert.equal(wrongRegion.state, "INVALID");
});

test("resume store refuses Biryong writes until a region-specific resume validator exists", () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
  const store = createWorldResumeStore({ storage, clock: { now: () => 10_000 }, saveIntervalMs: 0 });
  assert.equal(store.maybeSave({
    regionId: WORLD_REGION_ID.BIRYONG_REALM,
    position: { x: 0, y: BIRYONG_STATION_SPAWN.y, z: 0 },
    place: { id: "BR_STATION", displayName: "비룡역" },
    grounded: true
  }), false);
  assert.equal(data.has("inhagame-world-resume-v1"), false);
});
