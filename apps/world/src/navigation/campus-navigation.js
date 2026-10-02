// INHA WORLD M3 Campus navigation adapter.
// The only navigation module that knows current Campus data owners. It derives the walkable
// graph from the same runtime road/walkway centerlines the 3D world and the maps already use,
// and resolves map destinations to reachable approach points. It owns no coordinates itself.

import { CAMPUS_ROADS } from "../campus-road-layout.js";
import { SITE_FEATURES, MAIN_ENTRANCE } from "../basic-campus.js";
import { BACK_ROADS } from "../back-gate-layout.js";
import { BACK_APPROACH_ROADS } from "../back-approach-layout.js";
import { INTERIOR_PATHS } from "../market-interior-plan.js";
import { SIDE_GATE_PATHS } from "../north-side-gate-layout.js";
import { FIVE_SOUTH_ENTRY_APPROACH, NORTH_LANES, ANNIVERSARY_BACK_GATE_LINKS } from "../north-campus-layout.js";
import { LIBRARY_ROUTE_LINES } from "../library-route-layout.js";
import { GARDEN_LIBRARY_PATHS } from "../library-garden-layout.js";
import { DORM_1_CAMPUS_RETURN } from "../dorm1-layout.js";
import { studentCenterFrontPoint } from "../student-center-front.js";
import { BIRYONG_APPROACH, BIRYONG_PLAZA_PATHS } from "../biryong/biryong-layout.js";
import { OBSTACLES, WORLD_BOUNDS } from "../campus-layout.js";
import { polygonOverlap } from "../polygon-collision.js";
import { NAV_EDGE_KIND, buildNavGraph, createNavGraph, largestNavComponent } from "./nav-graph.js";
import { createRouteSolver } from "./route-solver.js";
import { NAV_DESTINATION_SOURCE } from "./navigation-state.js";

export const CAMPUS_NAV_SPACE = "campus";

export const CAMPUS_NAV_TOLERANCE = Object.freeze({
  merge: 0.05,
  // Separately authored walkway layers (side gate, north lanes, library links) and the OSM
  // promenades that stop at open plazas end beside, not on, another walkway. A dangling end is
  // joined within 9 world units (≈18 m) only when the connector crosses no solid footprint.
  junction: 9
});

// Map-point destinations must sit near a walkway and outside solid footprints.
export const CAMPUS_MAP_POINT_MAX_SNAP = 14;

const frameLine = (id, frame, kind, source) => ({ id, kind, source, points: [frame.at(0), frame.at(frame.length)] });

export function campusNavPolylines() {
  const lines = [];
  for (const road of CAMPUS_ROADS) {
    lines.push({ id: road.id, kind: NAV_EDGE_KIND.ROAD, source: "CAMPUS_ROADS", points: road.vertices });
  }
  for (const feature of SITE_FEATURES.filter(f => f.kind === "path")) {
    lines.push({ id: feature.id, kind: NAV_EDGE_KIND.PATH, source: "SITE_FEATURES_PATH", points: feature.vertices });
  }
  for (const road of BACK_ROADS) {
    lines.push({ id: `back_gate_${road.osmWayId}`, kind: NAV_EDGE_KIND.ROAD, source: "BACK_ROADS", points: road.vertices });
  }
  for (const road of BACK_APPROACH_ROADS) {
    lines.push({ id: road.id, kind: NAV_EDGE_KIND.ROAD, source: "BACK_APPROACH_ROADS", points: road.vertices });
  }
  for (const path of INTERIOR_PATHS) {
    lines.push({ id: path.id, kind: NAV_EDGE_KIND.PATH, source: "INTERIOR_PATHS", points: path.vertices });
  }
  for (const path of SIDE_GATE_PATHS) lines.push(frameLine(path.id, path.frame, NAV_EDGE_KIND.PATH, "SIDE_GATE_PATHS"));
  for (const lane of NORTH_LANES) lines.push(frameLine(lane.id, lane.frame, NAV_EDGE_KIND.PATH, "NORTH_LANES"));
  for (const link of ANNIVERSARY_BACK_GATE_LINKS) lines.push(frameLine(link.id, link.frame, NAV_EDGE_KIND.ROAD, "ANNIVERSARY_BACK_GATE_LINKS"));
  // P0 graph is ground-level: the raised library walk (y > 0) needs a height-aware graph.
  for (const route of LIBRARY_ROUTE_LINES.filter(line => line.nodes.every(node => (node.y ?? 0) <= 0.5))) {
    lines.push({ id: route.id, kind: NAV_EDGE_KIND.PATH, source: "LIBRARY_ROUTE_LINES", points: route.nodes });
  }
  GARDEN_LIBRARY_PATHS.forEach((points, index) => {
    lines.push({ id: `garden_library_${index}`, kind: NAV_EDGE_KIND.PATH, source: "GARDEN_LIBRARY_PATHS", points });
  });
  for (const path of BIRYONG_PLAZA_PATHS) {
    lines.push({ id: path.id, kind: NAV_EDGE_KIND.PATH, source: "BIRYONG_PLAZA_PATHS", points: path.points });
  }
  return lines;
}

// Solid footprints (buildings, walls, tall props). Low curbs/planters stay walkable for guidance.
const SOLID_OBSTACLES = OBSTACLES.filter(o => Array.isArray(o.polygon) && o.polygon.length >= 3 && (o.maxY ?? 0) >= 1.2 && (o.minY ?? 0) <= 0.5);

export function isCampusPointBlocked(point) {
  if (point.x < WORLD_BOUNDS.minX || point.x > WORLD_BOUNDS.maxX || point.z < WORLD_BOUNDS.minZ || point.z > WORLD_BOUNDS.maxZ) return true;
  return SOLID_OBSTACLES.some(o => polygonOverlap(point.x, point.z, o.polygon, 0));
}

export function isCampusSegmentClear(a, b, step = 0.5) {
  const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
  for (let i = 0; i <= samples; i += 1) {
    if (isCampusPointBlocked({ x: a.x + (b.x - a.x) * i / samples, z: a.z + (b.z - a.z) * i / samples })) return false;
  }
  return true;
}

// P0 Road Network audit 2026-10-02: these automatic junctions were proven to be
// shortcuts rather than missing physical surfaces. Keep the generic 9 WU bridge rule for
// legitimate cross-authority joins, but veto these semantic false positives.
const BLOCKED_JUNCTION_PAIRS = new Set([
  ["inha_67_entrance", "inha_67_spur"].sort().join("|"),
  ["west_court_access", "west_court_bend"].sort().join("|"),
  ["culture_47_junction", "interior_upper-yard"].sort().join("|")
]);

export function canConnectCampusJunction(a, b, context = {}) {
  if (!isCampusSegmentClear(a, b)) return false;
  const { fromLineId = "", toLineId = "", distance = 0 } = context;
  const pair = [fromLineId, toLineId].sort().join("|");
  if (BLOCKED_JUNCTION_PAIRS.has(pair)) return false;
  // library_front_link still needs its 2.5 WU road-edge join; only the longer
  // 3.698 WU internal chord discovered as J08 is rejected.
  if ((fromLineId === "library_front_link" || toLineId === "library_front_link") && distance > 3) return false;
  return true;
}

let cachedData = null;
let cachedGraph = null;
// Serialized campus graph (the World Editor-facing form), pruned to the routable component.
export function campusNavGraphData() {
  cachedData ??= largestNavComponent(buildNavGraph({
    polylines: campusNavPolylines(),
    mergeTolerance: CAMPUS_NAV_TOLERANCE.merge,
    junctionTolerance: CAMPUS_NAV_TOLERANCE.junction,
    canConnect: canConnectCampusJunction
  }));
  return cachedData;
}
export function campusNavGraph() {
  cachedGraph ??= createNavGraph(campusNavGraphData());
  return cachedGraph;
}

// Building POIs are footprint centres; guidance ends at the doorway/forecourt players use.
// Every anchor below is read from an existing runtime authority, never re-authored here.
const libraryFront = LIBRARY_ROUTE_LINES.find(line => line.id === "library_front_link")?.nodes?.[0] ?? null;
const studentCenterFront = studentCenterFrontPoint();
const POI_APPROACH = Object.freeze({
  "poi.main-hall": Object.freeze({ x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z, arrivalRadius: 6 }),
  "poi.building-5": Object.freeze({
    x: FIVE_SOUTH_ENTRY_APPROACH.x, z: FIVE_SOUTH_ENTRY_APPROACH.z,
    arrivalRadius: 5, markerAtApproach: true
  }),
  "poi.dorm-1": Object.freeze({ x: DORM_1_CAMPUS_RETURN.position.x, z: DORM_1_CAMPUS_RETURN.position.z, arrivalRadius: 5 }),
  "poi.student-center": Object.freeze({ x: studentCenterFront.x, z: studentCenterFront.z, arrivalRadius: 5 }),
  "poi.biryong-tower": BIRYONG_APPROACH.tower,
  "poi.biryong-echo-stone": BIRYONG_APPROACH.echo,
  ...(libraryFront ? { "poi.jungseok": Object.freeze({ x: libraryFront.x, z: libraryFront.z, arrivalRadius: 6 }) } : {})
});

export function createCampusNavigation({ graph = campusNavGraph(), solverOptions = {} } = {}) {
  const solver = createRouteSolver(graph, solverOptions);

  // Default approach: the walkway point nearest the POI, arriving within the footprint reach.
  function approachFor(poi) {
    const authored = POI_APPROACH[poi.poiId];
    if (authored) return authored;
    const snap = graph.nearestEdgePoint(poi, { maxDistance: 60 });
    if (!snap) return { x: poi.x, z: poi.z, arrivalRadius: 6 };
    return { x: snap.x, z: snap.z, arrivalRadius: 6 };
  }

  function poiTarget(poi, mapSourceId = CAMPUS_NAV_SPACE) {
    if (!poi?.poiId || !Number.isFinite(poi.x) || !Number.isFinite(poi.z)) return null;
    const approach = approachFor(poi);
    const marker = approach.markerAtApproach === true ? approach : poi;
    return Object.freeze({
      id: `poi:${poi.poiId}`,
      poiId: poi.poiId,
      title: poi.title ?? "목적지",
      source: NAV_DESTINATION_SOURCE.POI,
      mapSourceId,
      x: marker.x,
      z: marker.z,
      approach: Object.freeze({ x: approach.x, z: approach.z }),
      arrivalRadius: approach.arrivalRadius
    });
  }

  // A tapped Full Map location is supported only on/near the walk network and outside solids.
  function mapPointTarget(point, mapSourceId = CAMPUS_NAV_SPACE) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      return Object.freeze({ supported: false, reason: "INVALID" });
    }
    if (mapSourceId !== CAMPUS_NAV_SPACE) return Object.freeze({ supported: false, reason: "INDOOR" });
    if (isCampusPointBlocked(point)) return Object.freeze({ supported: false, reason: "BLOCKED" });
    const snap = graph.nearestEdgePoint(point, { maxDistance: CAMPUS_MAP_POINT_MAX_SNAP });
    if (!snap) return Object.freeze({ supported: false, reason: "OFF_NETWORK" });
    return Object.freeze({
      supported: true,
      reason: null,
      walkwayDistance: snap.distance,
      target: Object.freeze({
        id: `point:${point.x.toFixed(1)},${point.z.toFixed(1)}`,
        poiId: null,
        title: "지도에서 고른 위치",
        source: NAV_DESTINATION_SOURCE.MAP_POINT,
        mapSourceId,
        x: point.x,
        z: point.z,
        approach: Object.freeze({ x: point.x, z: point.z }),
        arrivalRadius: 3.5
      })
    });
  }

  return Object.freeze({ graph, solver, poiTarget, mapPointTarget, spaceId: CAMPUS_NAV_SPACE });
}
