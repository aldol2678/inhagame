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
import { DORM_1_CAMPUS_RETURN } from "../src/dorm1-layout.js";
import { LIBRARY_ROUTE_LINES } from "../src/library-route-layout.js";
import { overPondWater } from "../src/landmark-detail-layout.js";
import { studentCenterFrontPoint } from "../src/student-center-front.js";

const nav = createCampusNavigation();
const pois = createMiniMapDataSource().poiRegistry().list({ surface: "FULL_MAP" });

test("M3C campus graph derives from runtime walkway authorities into one routable network", () => {
  const sources = new Set(campusNavPolylines().map(line => line.source));
  for (const source of ["CAMPUS_ROADS", "SITE_FEATURES_PATH", "BACK_ROADS", "BACK_APPROACH_ROADS", "INTERIOR_PATHS", "SIDE_GATE_PATHS", "NORTH_LANES", "ANNIVERSARY_BACK_GATE_LINKS", "LIBRARY_ROUTE_LINES"]) {
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
  assert.equal(connectors.some(edge => edge.lineId === "junction.inha_67_spur"), false,
    "J02 dead-end spur does not reconnect to its parent street");
  assert.equal(connectors.some(edge => edge.lineId === "junction.west_court_bend"), false,
    "J06 west-court footway does not fold back through a shortcut");
  assert.equal(connectors.some(edge => edge.lineId === "junction.library_front_link" && edge.length > 3), false,
    "J08 library front route keeps its road-edge join but removes the long internal chord");
  assert.equal(connectors.some(edge => edge.lineId === "junction.garden_library_2"), false,
    "J05 is a physical garden-to-road walkway instead of a virtual connector");
  assert.equal(connectors.some(edge => edge.lineId === "junction.garden_library_spur"), false,
    "J10 is a physical north-library walkway instead of a virtual connector");
  assert.ok(nav.graph.edges().some(edge => edge.lineId === "garden_library_north_link"),
    "J10 physical walkway participates in the routable graph");
  assert.equal(connectors.some(edge => edge.lineId === "junction.interior_upper-yard"), false,
    "J04 estimated upper-yard does not invent an extra exit to Inha-ro 47");
  assert.equal(connectors.some(edge => edge.lineId === "junction.back_gate_216916383"), false,
    "J15/J18 back-gate corner uses explicit physical links");
  assert.equal(connectors.some(edge => edge.lineId === "junction.anniversary_east_lane" && edge.length > 2.5), false,
    "J12 north end is physical; only the short south surface join may remain");
  for (const id of ["anniversary_back_gate_link","anniversary_perimeter_join"]) {
    assert.ok(nav.graph.edges().some(edge => edge.lineId === id), `${id} participates in the routable graph`);
  }
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

  const studentPoi = pois.find(poi => poi.poiId === "poi.student-center");
  const student = nav.poiTarget(studentPoi);
  const studentFront = studentCenterFrontPoint();
  assert.deepEqual(student.approach, { x: studentFront.x, z: studentFront.z },
    "Student Center navigation ends at the shared terrace/shop front anchor");
  assert.deepEqual({ x: student.x, z: student.z }, { x: studentPoi.x, z: studentPoi.z },
    "Student Center map marker stays on the footprint centroid");
  assert.equal(isCampusPointBlocked(student.approach), false, "Student Center front anchor is walkable");
  assert.ok(Math.hypot(student.x-student.approach.x,student.z-student.approach.z)>1,
    "Student Center display marker and navigation anchor stay separated");

  const dormPoi = pois.find(poi => poi.poiId === "poi.dorm-1");
  const dorm = nav.poiTarget(dormPoi);
  assert.deepEqual(dorm.approach, {
    x: DORM_1_CAMPUS_RETURN.position.x,
    z: DORM_1_CAMPUS_RETURN.position.z
  }, "Dorm guidance ends at the campus return/entrance forecourt");
  assert.deepEqual({ x: dorm.x, z: dorm.z }, { x: dormPoi.x, z: dormPoi.z },
    "Dorm map marker stays on its footprint centroid");
  assert.equal(isCampusPointBlocked(dorm.approach), false, "Dorm approach is walkable");

  const libraryPoi = pois.find(poi => poi.poiId === "poi.jungseok");
  const library = nav.poiTarget(libraryPoi);
  const libraryFront = LIBRARY_ROUTE_LINES.find(line => line.id === "library_front_link").nodes[0];
  assert.deepEqual(library.approach, { x: libraryFront.x, z: libraryFront.z },
    "Jungseok guidance ends at the authored front route");
  assert.deepEqual({ x: library.x, z: library.z }, { x: libraryPoi.x, z: libraryPoi.z },
    "Jungseok map marker stays on its building centroid");
  assert.equal(isCampusPointBlocked(library.approach), false, "Jungseok front route is walkable");

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


test("landmark POIs use existing walkway approaches without adding a pond-crossing segment", () => {
  for (const id of ["poi.woonam-aircraft", "poi.pond-gazebo"]) {
    const poi = pois.find(value => value.poiId === id);
    assert.ok(poi, id);
    const target = nav.poiTarget(poi);
    const snap = nav.graph.nearestEdgePoint(poi, { maxDistance: 60 });
    assert.deepEqual(target.approach, { x: snap.x, z: snap.z }, "existing approach contract is reused");
    assert.equal(overPondWater(target.approach.x, target.approach.z), false);
    for (const start of [MAIN_GATE_SPAWN, BACK_GATE_SPAWN]) {
      const route = nav.solver.solve(start, target.approach);
      assert.equal(route.mode, ROUTE_MODE.NETWORK);
      assert.deepEqual(route.points.at(-1), target.approach, "guidance ends at the walkway, not a direct landmark jump");
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.z-a.z) / .2));
        for (let j = 0; j <= count; j++) assert.equal(overPondWater(a.x+(b.x-a.x)*j/count, a.z+(b.z-a.z)*j/count), false, id);
      }
    }
  }
});
