import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMPUS_NAV_SPACE,
  campusNavGraphData,
  campusNavPolylines,
  createCampusNavigation,
  isCampusPointBlocked,
  isCampusSegmentClear
} from "../src/navigation/campus-navigation.js";
import { createNavigationState, NAV_STATUS } from "../src/navigation/navigation-state.js";
import { ROUTE_MODE } from "../src/navigation/route-solver.js";
import { createMiniMapDataSource } from "../src/minimap/minimap-data.js";
import { MAIN_GATE_SPAWN, BACK_GATE_SPAWN } from "../src/campus-spawn.js";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { FIVE, FIVE_SOUTH_ENTRY_APPROACH } from "../src/north-campus-layout.js";

const nav = createCampusNavigation();
const pois = createMiniMapDataSource().poiRegistry().list({ surface: "FULL_MAP" });

test("M3C campus graph derives from runtime walkway authorities into one routable network", () => {
  const sources = new Set(campusNavPolylines().map(line => line.source));
  for (const source of ["CAMPUS_ROADS", "SITE_FEATURES_PATH", "BACK_ROADS", "BACK_APPROACH_ROADS", "INTERIOR_PATHS", "SIDE_GATE_PATHS", "NORTH_LANES", "LIBRARY_ROUTE_LINES"]) {
    assert.ok(sources.has(source), `graph includes ${source}`);
  }
  assert.equal(nav.graph.components().length, 1, "campus and back-gate streets form one network");
  assert.ok(nav.graph.nodeCount > 120 && nav.graph.edgeCount > 120);
  assert.deepEqual(campusNavGraphData().dropped.lineIds, [], "no authored walkway fragment is left detached");
});

test("M3C no walkway edge or junction connector cuts through a solid footprint", () => {
  for (const edge of nav.graph.edges()) {
    assert.ok(isCampusSegmentClear(nav.graph.node(edge.a), nav.graph.node(edge.b)), `${edge.lineId} (${edge.source}) is clear`);
  }
  const connectors = nav.graph.edges().filter(edge => edge.kind === "CONNECTOR");
  assert.ok(connectors.length > 0);
  assert.ok(connectors.every(edge => edge.length <= 9), "junction connectors stay within the tolerance");
});

test("M3C every selectable campus POI is routable along walkways from both gates", () => {
  const selectable = pois.filter(poi => poi.presentation === "NORMAL" && poi.visible !== false);
  assert.ok(selectable.length >= 5);
  for (const start of [MAIN_GATE_SPAWN, BACK_GATE_SPAWN]) {
    for (const poi of selectable) {
      const target = nav.poiTarget(poi);
      assert.equal(isCampusPointBlocked(target.approach), false, `${poi.poiId} approach is walkable`);
      const route = nav.solver.solve(start, target.approach);
      const straight = Math.hypot(target.approach.x - start.x, target.approach.z - start.z);
      if (straight > 10) assert.equal(route.mode, ROUTE_MODE.NETWORK, `${poi.poiId} from (${start.x.toFixed(0)},${start.z.toFixed(0)})`);
      assert.ok(route.distance >= straight - 1e-6);
      assert.ok(route.distance < straight * 2.2 + 1, `${poi.poiId} route is not an absurd detour`);
    }
  }
});

test("M3C main gate to Main Hall follows the promenade, not the western ring road", () => {
  const route = nav.solver.solve({ x: 0, z: -80 }, MAIN_ENTRANCE);
  assert.equal(route.mode, ROUTE_MODE.NETWORK);
  assert.ok(route.distance < 110, `promenade route length ${route.distance.toFixed(1)}`);
  assert.ok(route.points.every(point => point.x > -5), "does not swing west around the library");
});

test("M3A POI destinations resolve to doorway/forecourt approach anchors", () => {
  const hall = nav.poiTarget(pois.find(poi => poi.poiId === "poi.main-hall"));
  assert.equal(hall.approach.x, MAIN_ENTRANCE.x);
  assert.equal(hall.source, "POI");
  assert.equal(hall.mapSourceId, CAMPUS_NAV_SPACE);
  const five = nav.poiTarget(pois.find(poi => poi.poiId === "poi.building-5"));
  assert.deepEqual(
    { x: five.x, z: five.z, approach: five.approach },
    { x: FIVE_SOUTH_ENTRY_APPROACH.x, z: FIVE_SOUTH_ENTRY_APPROACH.z,
      approach: { x: FIVE_SOUTH_ENTRY_APPROACH.x, z: FIVE_SOUTH_ENTRY_APPROACH.z } },
    "Building 5 destination marker and route terminate at the authored south entrance"
  );
  assert.equal(isCampusPointBlocked(five.approach), false, "Building 5 entrance is walkable");
  assert.ok(Math.hypot(five.x - FIVE.center.x, five.z - FIVE.center.z) > 1,
    "Building 5 destination is not its blocked footprint centre");
  const pond = nav.poiTarget(pois.find(poi => poi.poiId === "poi.inkyung-pond"));
  assert.ok(nav.graph.nearestEdgePoint(pond.approach, { maxDistance: 0.01 }), "pond guidance ends on the nearest walkway");
});

test("M3A map-point destinations are supported only near walkways and outside buildings", () => {
  const onPath = nav.mapPointTarget({ x: 18.1, z: -45.1 });
  assert.equal(onPath.supported, true);
  assert.equal(onPath.target.source, "MAP_POINT");
  assert.equal(onPath.target.title, "지도에서 고른 위치");
  const hall = pois.find(poi => poi.poiId === "poi.main-hall");
  assert.deepEqual({ ...nav.mapPointTarget(hall) }, { supported: false, reason: "BLOCKED" });
  assert.equal(nav.mapPointTarget({ x: -170, z: 220 }).reason, "OFF_NETWORK");
  assert.equal(nav.mapPointTarget({ x: 0, z: 0 }, "ROOM_CLUBHOUSE_01").reason, "INDOOR");
  assert.equal(nav.mapPointTarget({ x: 9999, z: 0 }).supported, false);
});

test("M3 campus walk from the main gate to the library arrives through live guidance", () => {
  const clock = { t: 0, now() { return this.t; } };
  const state = createNavigationState({ solver: nav.solver, clock });
  const library = nav.poiTarget(pois.find(poi => poi.poiId === "poi.jungseok"));
  state.setDestination(library, { position: MAIN_GATE_SPAWN, spaceId: CAMPUS_NAV_SPACE });
  const route = state.getSnapshot().routePoints.map(p => ({ ...p }));
  let last = Infinity;
  // Walk the published route in 1-unit steps.
  let status = null;
  for (let i = 1; i < route.length && status !== NAV_STATUS.ARRIVED; i += 1) {
    const a = route[i - 1], b = route[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
    for (let s = 1; s <= steps; s += 1) {
      clock.t += 100;
      const snapshot = state.update({ position: { x: a.x + (b.x - a.x) * s / steps, z: a.z + (b.z - a.z) * s / steps }, yaw: 0, spaceId: CAMPUS_NAV_SPACE });
      status = snapshot.status;
      if (status === NAV_STATUS.ARRIVED) break;
      assert.ok(snapshot.remainingDistance <= last + 1e-6, "remaining distance never grows while following the route");
      assert.equal(snapshot.rerouteCount, 0, "following the route never triggers a reroute");
      last = snapshot.remainingDistance;
    }
  }
  assert.equal(status, NAV_STATUS.ARRIVED);
});

test("M3 navigation modules stay transport-free and separated from quest objective state", () => {
  const sources = ["nav-graph", "route-solver", "navigation-state", "navigation-hud", "campus-navigation"]
    .map(name => readFileSync(new URL(`../src/navigation/${name}.js`, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.doesNotMatch(sources.join("\n"), /supabase|realtime|heartbeat|\bfetch\s*\(|\.rpc\s*\(|localStorage/i);
  for (const pure of sources.slice(0, 3)) assert.doesNotMatch(pure, /document\.|playcanvas|from "\.\.\/(campus|basic|back|library|north|market)/);
  assert.doesNotMatch(sources.join("\n"), /npcTest|getMapObjective|tour\./, "navigation never reads quest/tour objectives");
});
