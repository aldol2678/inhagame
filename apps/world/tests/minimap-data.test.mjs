import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, SITE_FEATURES } from "../src/basic-campus.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { CAMPUS_PATH_WIDTHS, CAMPUS_ROADS } from "../src/campus-road-layout.js";
import { BACK_APPROACH_ROADS } from "../src/back-approach-layout.js";
import { INTERIOR_PATHS } from "../src/market-interior-plan.js";
import { GATE_DORM_ROADS, GATE_DORM_PATHS, GATE_DORM_CROSSINGS } from '../src/main-gate-road-layout.js';
import { LANDMARKS, WORLD_BOUNDS } from "../src/campus-layout.js";
import { SPAWN_ID, SPAWN_STATE, createSpawnRegistry } from "../src/lobby/spawn-registry.js";
import { MAP_GATE_STATE, MAP_POI_PRESENTATION } from "../src/minimap/minimap-poi-registry.js";
import {
  M0_MINIMAP_POI_DEFINITIONS,
  MINIMAP_GEOMETRY_KIND,
  createMiniMapDataSource
} from "../src/minimap/minimap-data.js";

const byId = list => new Map(list.map(item => [item.id ?? item.poiId, item]));
const centre = points => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  z: points.reduce((sum, p) => sum + p.z, 0) / points.length
});

test("M0 geometry is cached, finite and derived from existing world sources", () => {
  const data = createMiniMapDataSource();
  const a = data.geometry();
  const b = data.geometry();
  assert.strictEqual(a, b, "geometry is built once and reused");
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(data.bounds, WORLD_BOUNDS);
  assert.ok(a.length > 20);

  for (const item of a) {
    assert.ok(Object.values(MINIMAP_GEOMETRY_KIND).includes(item.kind), item.id);
    assert.ok(item.rings.length > 0, item.id);
    for (const ring of item.rings) {
      assert.ok(ring.length >= 3, item.id);
      for (const p of ring) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), item.id);
    }
  }
});

test("building footprints preserve meaningful holes instead of using collision parts", () => {
  const geometry = byId(createMiniMapDataSource().geometry());
  assert.ok(geometry.has("bldg_01"), "main hall from BUILDINGS");
  assert.ok(geometry.has("bldg_jungseok"), "library from BUILDINGS");
  const five = geometry.get("bldg_05");
  assert.equal(five.kind, MINIMAP_GEOMETRY_KIND.BUILDING);
  assert.equal(five.rings.length, 2, "5호관 courtyard hole survives into map geometry");
  assert.equal(five.source, "FACILITIES");
  assert.ok(!geometry.has("lmk_pond_gazebo"), "point decoration is not promoted to geometry");
});

test("M0 geometry includes runtime-aligned roads, authored paths, green and water", () => {
  const geometry = createMiniMapDataSource().geometry();
  const ids = new Set(geometry.map(item => item.id));
  assert.ok(geometry.some(item => item.kind === MINIMAP_GEOMETRY_KIND.GREEN));
  assert.ok(geometry.some(item => item.kind === MINIMAP_GEOMETRY_KIND.WATER));
  assert.ok(geometry.some(item => item.kind === MINIMAP_GEOMETRY_KIND.ROAD));
  assert.ok(geometry.some(item => item.kind === MINIMAP_GEOMETRY_KIND.PATH));
  assert.ok(ids.has("lmk_inkyung_pond"), "canonical pond polygon is present");

  const expectedRoadSegments = [...CAMPUS_ROADS,...BACK_APPROACH_ROADS,...INTERIOR_PATHS,...GATE_DORM_ROADS].reduce((sum, road) => sum + road.vertices.length - 1, 0);
  const expectedPathSegments = [...SITE_FEATURES.filter(feature => feature.kind === "path"),...GATE_DORM_PATHS,...GATE_DORM_CROSSINGS]
    .reduce((sum, feature) => sum + feature.vertices.length - 1, 0);
  assert.equal(geometry.filter(item => item.kind === MINIMAP_GEOMETRY_KIND.ROAD).length, expectedRoadSegments);
  assert.equal(geometry.filter(item => item.kind === MINIMAP_GEOMETRY_KIND.PATH).length, expectedPathSegments);
});

test("road and path strips are centred on the same runtime centerlines used by the 3D world", () => {
  const geometry = byId(createMiniMapDataSource().geometry());
  const road = CAMPUS_ROADS.find(item => item.vertices.length >= 2);
  const roadStrip = geometry.get(`maproad.${road.id}.0`);
  assert.equal(roadStrip.kind, MINIMAP_GEOMETRY_KIND.ROAD);
  assert.equal(roadStrip.source, "CAMPUS_ROADS");
  const [a, b] = road.vertices;
  const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const stripCenter = centre(roadStrip.rings[0]);
  assert.ok(Math.hypot(stripCenter.x - midpoint.x, stripCenter.z - midpoint.z) < 1e-9);

  const path = SITE_FEATURES.find(item => item.kind === "path" && item.vertices.length >= 2);
  const pathStrip = geometry.get(`mappath.${path.id}.0`);
  assert.equal(pathStrip.kind, MINIMAP_GEOMETRY_KIND.PATH);
  assert.equal(pathStrip.source, "SITE_FEATURES_PATH");
  const pathWidth = CAMPUS_PATH_WIDTHS[path.id] ?? 3.5;
  const [p0, , , p3] = pathStrip.rings[0];
  assert.ok(Math.abs(Math.hypot(p0.x - p3.x, p0.z - p3.z) - pathWidth) < 1e-9,
    "path strip uses the shared runtime path width contract");
});


test("M0 POI set includes the first dormitory housing entrance", () => {
  assert.deepEqual(M0_MINIMAP_POI_DEFINITIONS.map(p => p.poiId), [
    "poi.main-gate",
    "poi.main-hall",
    "poi.inkyung-pond",
    "poi.student-center",
    "poi.jungseok",
    "poi.dorm-1",
    "poi.building-5",
    "poi.back-gate",
    "poi.biryong-tower",
    "poi.biryong-echo-stone"
  ]);
  assert.ok(M0_MINIMAP_POI_DEFINITIONS.every(p => !("x" in p) && !("z" in p)),
    "definitions do not duplicate world coordinates");
});

test("main gate and main hall POIs follow LANDMARKS authority exactly", () => {
  const pois = byId(createMiniMapDataSource().refreshState());
  assert.deepEqual({ x: pois.get("poi.main-gate").x, z: pois.get("poi.main-gate").z },
    { x: LANDMARKS.gate.x, z: LANDMARKS.gate.z });
  assert.deepEqual({ x: pois.get("poi.main-hall").x, z: pois.get("poi.main-hall").z },
    { x: LANDMARKS.mainHall.x, z: LANDMARKS.mainHall.z });
});

test("student center and Jungseok POIs resolve from current runtime footprints", () => {
  const pois = byId(createMiniMapDataSource().refreshState());
  const student = FACILITIES.find(f => f.id === "bldg_07");
  const jungseok = BUILDINGS.find(f => f.id === "bldg_jungseok");
  assert.deepEqual({ x: pois.get("poi.student-center").x, z: pois.get("poi.student-center").z },
    { x: student.footprintCenter.x, z: student.footprintCenter.z });
  const expected = centre(jungseok.vertices);
  assert.deepEqual({ x: pois.get("poi.jungseok").x, z: pois.get("poi.jungseok").z }, expected);
});

test("Building 5 is a routable map POI sourced from the existing facility", () => {
  const data = createMiniMapDataSource();
  const five = data.poiRegistry().get("poi.building-5");
  const source = FACILITIES.find(f => f.id === "bldg_05");
  assert.equal(five.title, "5호관");
  assert.equal(five.placeZoneId, "AREA_BUILDING_5_WEST");
  assert.deepEqual({ x: five.x, z: five.z }, { x: source.footprintCenter.x, z: source.footprintCenter.z });
  assert.ok(Math.hypot(five.x-source.center.x,five.z-source.center.z)>10,
    "5호관 POI uses geometry centroid instead of the legacy gameplay anchor");
  assert.equal(five.presentation, MAP_POI_PRESENTATION.NORMAL);
});

test("Back Gate can resolve quest-complete context without replacing its registry", () => {
  const data = createMiniMapDataSource({
    getContext: () => ({ completedQuestIds: ["campus_first_walk_v1"] })
  });
  const back = data.poiRegistry().get("poi.back-gate");
  assert.equal(back.gateState, MAP_GATE_STATE.AVAILABLE);
  assert.equal(back.presentation, MAP_POI_PRESENTATION.NORMAL);
});

test("Back Gate uses the Spawn Registry anchor even while locked", () => {
  const data = createMiniMapDataSource();
  const back = data.poiRegistry().get("poi.back-gate");
  const spawn = createSpawnRegistry().get(SPAWN_ID.BACK_GATE);
  assert.deepEqual({ x: back.x, z: back.z }, { x: spawn.spawnAnchor.x, z: spawn.spawnAnchor.z });
  assert.equal(back.gateState, MAP_GATE_STATE.LOCKED_PROGRESS);
  assert.equal(back.presentation, MAP_POI_PRESENTATION.LOCKED);
});

test("Back Gate becomes normal when its owner resolves AVAILABLE without changing map data", () => {
  const spawnRegistry = createSpawnRegistry({
    stateResolver: definition => definition.spawnId === SPAWN_ID.BACK_GATE
      ? SPAWN_STATE.AVAILABLE
      : definition.state
  });
  const data = createMiniMapDataSource({ spawnRegistry });
  const back = data.poiRegistry().get("poi.back-gate");
  assert.equal(back.gateState, MAP_GATE_STATE.AVAILABLE);
  assert.equal(back.presentation, MAP_POI_PRESENTATION.NORMAL);
  assert.equal(data.poiRegistry().size, 10);
});

test("future reserved Spawn IDs are not guessed into the M0 map", () => {
  const ids = new Set(M0_MINIMAP_POI_DEFINITIONS.map(p => p.sourceRef?.id));
  for (const future of [SPAWN_ID.STUDENT_CENTER, SPAWN_ID.BUILDING_5, SPAWN_ID.DORM, SPAWN_ID.CLUB_ROOM, SPAWN_ID.HOME]) {
    assert.equal(ids.has(future), false, future);
  }
});

test("data source status remains read-only and contains no network persistence contract", () => {
  const data = createMiniMapDataSource();
  const status = data.status();
  assert.equal(status.geometryCount, data.geometry().length);
  // 울림돌 is Full Map only; 비룡탑 joins the Mini-map set.
  assert.equal(status.poiCount, 9);
  assert.deepEqual(status.errors, []);
});

