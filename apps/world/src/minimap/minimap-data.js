// INHA WORLD Mini-map M0 runtime data adapter.
// This is the only Mini-map module that knows current Campus data owners.
// It derives geometry/POIs from existing world registries and never owns unlock rules.

import { BUILDINGS, SITE_FEATURES } from "../basic-campus.js";
import { FACILITIES } from "../campus-facilities.js";
import { CAMPUS_PATH_WIDTHS, CAMPUS_ROADS } from "../campus-road-layout.js";
import { LANDMARKS, WORLD_BOUNDS } from "../campus-layout.js";
import { geoToWorld } from "../geo-coordinates.js";
import { getCanonicalLandmark, projectPolygon } from "../reality-adapter.js";
import { BACK_APPROACH_ROADS } from "../back-approach-layout.js";
import { CULTURE_BUILDINGS } from "../culture-street-layout.js";
import { MARKET_MAP_BUILDINGS } from "../back-market-layout.js";
import { INTERIOR_BUILDINGS } from "../market-interior-layout.js";
import { INTERIOR_PATHS, INTERIOR_COURTS } from "../market-interior-plan.js";
import { GATE_DORM_CORRIDORS } from "../main-gate-road-layout.js";
import { SPAWN_ID, SPAWN_STATE, createSpawnRegistry } from "../lobby/spawn-registry.js";
import { BIRYONG_PLACE_ID, BIRYONG_PLACE_ZONE_ID, ECHO_CENTER } from "../biryong/biryong-layout.js";
import {
  MAP_DISCOVERY_STATE,
  MAP_GATE_STATE,
  MAP_SURFACE,
  createMapPoiRegistry
} from "./minimap-poi-registry.js";

export const MINIMAP_GEOMETRY_KIND = Object.freeze({
  BUILDING: "BUILDING",
  GREEN: "GREEN",
  WATER: "WATER",
  GROUND: "GROUND",
  ROAD: "ROAD",
  PATH: "PATH"
});

export const MINIMAP_SOURCE_TYPE = Object.freeze({
  LANDMARK: "LANDMARK",
  WORLD_FEATURE: "WORLD_FEATURE",
  CANONICAL_LANDMARK: "CANONICAL_LANDMARK",
  SPAWN: "SPAWN",
  PLACE: "PLACE"
});

const point = p => Object.freeze({ x: p.x, z: p.z });
const ring = points => Object.freeze(points.map(point));
const rings = values => Object.freeze(values.map(ring));
const centre = points => Object.freeze({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  z: points.reduce((sum, p) => sum + p.z, 0) / points.length
});

function geometryRecord(id, kind, source, sourceRings, style = null) {
  if (!id || !Array.isArray(sourceRings) || !sourceRings.length) throw new TypeError(`Invalid minimap geometry: ${id}`);
  return Object.freeze({
    id,
    kind,
    source,
    style,
    rings: rings(sourceRings)
  });
}

// Convert the same runtime road/path centerlines used by the 3D world into narrow map strips.
// Each segment is its own SVG polygon so overlaps at bends never cancel under even-odd fill.
function segmentStrip(a, b, width, overlap = 0.14) {
  if (![a?.x, a?.z, b?.x, b?.z, width].every(Number.isFinite) || width <= 0) {
    throw new TypeError("Invalid minimap corridor segment");
  }
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-8) throw new TypeError("Mini-map corridor segment must have length");
  const tx = dx / length, tz = dz / length;
  const nx = -tz, nz = tx, half = width / 2;
  const ax = a.x - tx * overlap, az = a.z - tz * overlap;
  const bx = b.x + tx * overlap, bz = b.z + tz * overlap;
  return [
    { x: ax + nx * half, z: az + nz * half },
    { x: bx + nx * half, z: bz + nz * half },
    { x: bx - nx * half, z: bz - nz * half },
    { x: ax - nx * half, z: az - nz * half }
  ];
}

function addCorridorSegments(add, { id, vertices, width, kind, source, style }) {
  for (let i = 0; i < vertices.length - 1; i += 1) {
    add(geometryRecord(
      `${kind === MINIMAP_GEOMETRY_KIND.ROAD ? "maproad" : "mappath"}.${id}.${i}`,
      kind,
      source,
      [segmentStrip(vertices[i], vertices[i + 1], width)],
      style
    ));
  }
}

function buildGeometry() {
  const records = [];
  const ids = new Set();
  const add = record => {
    if (ids.has(record.id)) throw new Error(`Duplicate minimap geometry id: ${record.id}`);
    ids.add(record.id);
    records.push(record);
  };

  // Roads and authored walkways use the exact runtime centerlines and widths.
  for(const corridor of GATE_DORM_CORRIDORS)addCorridorSegments(add,{
    id:corridor.id,vertices:corridor.vertices,width:corridor.width,
    kind:MINIMAP_GEOMETRY_KIND[corridor.kind],source:'GATE_DORM_CORRIDORS',
    style:corridor.kind==='ROAD'?'road':'path'
  });
  // They are presentation geometry only; no pathfinding or navigation semantics are inferred.
  for (const road of CAMPUS_ROADS) {
    addCorridorSegments(add, {
      id: road.id,
      vertices: road.vertices,
      width: road.width,
      kind: MINIMAP_GEOMETRY_KIND.ROAD,
      source: "CAMPUS_ROADS",
      style: "road"
    });
  }
  for (const feature of SITE_FEATURES.filter(feature => feature.kind === "path")) {
    addCorridorSegments(add, {
      id: feature.id,
      vertices: feature.vertices,
      width: CAMPUS_PATH_WIDTHS[feature.id] ?? 3.5,
      kind: MINIMAP_GEOMETRY_KIND.PATH,
      source: "SITE_FEATURES_PATH",
      style: "path"
    });
  }

  for (const road of [...BACK_APPROACH_ROADS,...INTERIOR_PATHS]) {
    addCorridorSegments(add, {id:road.id,vertices:road.vertices,width:road.width,
      kind:MINIMAP_GEOMETRY_KIND.ROAD,source:road.estimated?"INTERIOR_PATHS":"BACK_APPROACH_ROADS",style:"road"});
  }
  for (const building of CULTURE_BUILDINGS) {
    add(geometryRecord(building.id,MINIMAP_GEOMETRY_KIND.BUILDING,"CULTURE_BUILDINGS",[building.polygon],building.style));
  }
  for (const court of INTERIOR_COURTS)add(geometryRecord(court.id,MINIMAP_GEOMETRY_KIND.GROUND,"INTERIOR_COURTS",[court.polygon],'courtyard'));
  for (const building of INTERIOR_BUILDINGS)add(geometryRecord(building.id,MINIMAP_GEOMETRY_KIND.BUILDING,"INTERIOR_BUILDINGS",[building.polygon],building.kind));
  for (const building of MARKET_MAP_BUILDINGS) {
    add(geometryRecord(building.id,MINIMAP_GEOMETRY_KIND.BUILDING,"MARKET_MAP_BUILDINGS",[building.polygon],building.style||'shop'));
  }

  for (const building of BUILDINGS) {
    add(geometryRecord(
      building.id,
      MINIMAP_GEOMETRY_KIND.BUILDING,
      "BUILDINGS",
      [building.vertices]
    ));
  }

  for (const facility of FACILITIES) {
    if (!facility.rings?.length) continue;
    if (facility.kind === "building") {
      add(geometryRecord(
        facility.id,
        MINIMAP_GEOMETRY_KIND.BUILDING,
        "FACILITIES",
        facility.rings,
        facility.style ?? null
      ));
      continue;
    }
    if (facility.kind === "ground") {
      const kind = facility.style === "park"
        ? MINIMAP_GEOMETRY_KIND.GREEN
        : MINIMAP_GEOMETRY_KIND.GROUND;
      add(geometryRecord(
        facility.id,
        kind,
        "FACILITIES",
        facility.rings,
        facility.style ?? null
      ));
    }
  }

  for (const feature of SITE_FEATURES) {
    if (!feature.vertices?.length) continue;
    if (feature.kind === "lawn") {
      add(geometryRecord(
        feature.id,
        MINIMAP_GEOMETRY_KIND.GREEN,
        "SITE_FEATURES",
        [feature.vertices],
        "lawn"
      ));
    } else if (feature.kind === "reflecting_pool") {
      add(geometryRecord(
        feature.id,
        MINIMAP_GEOMETRY_KIND.WATER,
        "SITE_FEATURES",
        [feature.vertices],
        "reflecting_pool"
      ));
    }
    // Path centerlines are promoted above through the shared runtime width contract.
  }

  const pond = getCanonicalLandmark("lmk_inkyung_pond");
  add(geometryRecord(
    pond.id,
    MINIMAP_GEOMETRY_KIND.WATER,
    "CANONICAL_LANDMARK",
    [projectPolygon(pond.polygon)],
    "pond"
  ));

  const layerRank = Object.freeze({
    [MINIMAP_GEOMETRY_KIND.GROUND]: 0,
    [MINIMAP_GEOMETRY_KIND.GREEN]: 1,
    [MINIMAP_GEOMETRY_KIND.ROAD]: 2,
    [MINIMAP_GEOMETRY_KIND.PATH]: 3,
    [MINIMAP_GEOMETRY_KIND.WATER]: 4,
    [MINIMAP_GEOMETRY_KIND.BUILDING]: 5
  });
  return Object.freeze(records.slice().sort((a, b) =>
    layerRank[a.kind] - layerRank[b.kind] || a.id.localeCompare(b.id)
  ));
}

const geometryCache = buildGeometry();

const featureById = new Map([
  ...BUILDINGS.map(building => [building.id, Object.freeze({
    id: building.id,
    center: centre(building.vertices)
  })]),
  ...FACILITIES.map(facility => [facility.id, Object.freeze({
    ...facility,
    mapCenter: facility.footprintCenter ?? facility.center
  })])
]);

const pond = getCanonicalLandmark("lmk_inkyung_pond");
const canonicalLandmarkPosition = new Map([
  [pond.id, Object.freeze(geoToWorld(pond.lat, pond.lon))],
  // lmk_echo_stone has no surveyed coordinate; the Biryong plaza layout owns its estimate.
  ["lmk_echo_stone", Object.freeze({ x: ECHO_CENTER.x, z: ECHO_CENTER.z })]
]);

export const M0_MINIMAP_POI_DEFINITIONS = Object.freeze([
  Object.freeze({
    poiId: "poi.main-gate",
    title: "정문",
    kind: "GATE",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.LANDMARK, id: "gate" }),
    placeZoneId: "AREA_MAIN_GATE",
    iconKey: "gate",
    priority: 100,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.main-hall",
    title: "본관",
    kind: "BUILDING",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.LANDMARK, id: "mainHall" }),
    placeZoneId: "AREA_MAIN_HALL",
    iconKey: "main-hall",
    priority: 95,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.inkyung-pond",
    title: "인경호",
    kind: "WATER",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.CANONICAL_LANDMARK, id: "lmk_inkyung_pond" }),
    placeZoneId: "AREA_INKYUNG_STUDENT_CENTER",
    iconKey: "water",
    priority: 85,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.student-center",
    title: "학생회관",
    kind: "BUILDING",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.WORLD_FEATURE, id: "bldg_07" }),
    placeZoneId: "AREA_INKYUNG_STUDENT_CENTER",
    iconKey: "student-center",
    priority: 80,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.jungseok",
    title: "정석학술정보관",
    kind: "BUILDING",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.WORLD_FEATURE, id: "bldg_jungseok" }),
    placeZoneId: "AREA_JUNGSEOK_WOONAM",
    iconKey: "library",
    priority: 80,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.dorm-1",
    title: "제1생활관",
    kind: "HOUSING",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.WORLD_FEATURE, id: "bldg_dorm1" }),
    placeZoneId: "AREA_DORM_SOUTH",
    iconKey: "housing",
    priority: 80,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.building-5",
    title: "5호관",
    kind: "BUILDING",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.WORLD_FEATURE, id: "bldg_05" }),
    placeZoneId: "AREA_BUILDING_5_WEST",
    iconKey: "building-5",
    priority: 82,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.back-gate",
    title: "후문",
    kind: "GATE",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.SPAWN, id: SPAWN_ID.BACK_GATE }),
    gateRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.SPAWN, id: SPAWN_ID.BACK_GATE }),
    placeZoneId: "AREA_BACK_GATE",
    iconKey: "gate",
    priority: 90,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  // 비룡탑 and 울림돌 stay 미발견 on both maps until the player first reaches the tower.
  Object.freeze({
    poiId: "poi.biryong-tower",
    title: "비룡탑",
    kind: "LANDMARK",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.WORLD_FEATURE, id: "lmk_biryong_tower" }),
    discoveryRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.PLACE, id: BIRYONG_PLACE_ID }),
    placeZoneId: BIRYONG_PLACE_ZONE_ID,
    iconKey: "dragon",
    priority: 88,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  }),
  Object.freeze({
    poiId: "poi.biryong-echo-stone",
    title: "울림돌",
    kind: "LANDMARK",
    sourceRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.CANONICAL_LANDMARK, id: "lmk_echo_stone" }),
    discoveryRef: Object.freeze({ type: MINIMAP_SOURCE_TYPE.PLACE, id: BIRYONG_PLACE_ID }),
    placeZoneId: BIRYONG_PLACE_ZONE_ID,
    iconKey: "echo",
    priority: 60,
    labelMode: "NONE",
    surfaces: Object.freeze([MAP_SURFACE.FULL_MAP])
  })
]);

function mapSpawnState(state) {
  return Object.values(MAP_GATE_STATE).includes(state) ? state : MAP_GATE_STATE.UNKNOWN;
}

export function createMiniMapDataSource({
  spawnRegistry = createSpawnRegistry(),
  getContext = () => null,
  // Discovery owner (e.g. the Biryong place). Without one, every POI is treated as discovered.
  isPlaceDiscovered = null
} = {}) {
  if (!spawnRegistry?.get) throw new TypeError("spawnRegistry.get is required");
  if (isPlaceDiscovered !== null && typeof isPlaceDiscovered !== "function") {
    throw new TypeError("isPlaceDiscovered must be a function");
  }

  function resolvePosition(sourceRef, _definition, context) {
    switch (sourceRef?.type) {
      case MINIMAP_SOURCE_TYPE.LANDMARK: {
        const value = LANDMARKS[sourceRef.id];
        if (!value) throw new Error(`Unknown LANDMARKS source: ${sourceRef.id}`);
        return { x: value.x, z: value.z };
      }
      case MINIMAP_SOURCE_TYPE.WORLD_FEATURE: {
        const value = featureById.get(sourceRef.id);
        const anchor = value?.mapCenter ?? value?.center;
        if (!anchor) throw new Error(`Unknown world feature source: ${sourceRef.id}`);
        return { x: anchor.x, z: anchor.z };
      }
      case MINIMAP_SOURCE_TYPE.CANONICAL_LANDMARK: {
        const value = canonicalLandmarkPosition.get(sourceRef.id);
        if (!value) throw new Error(`Unknown canonical landmark source: ${sourceRef.id}`);
        return { x: value.x, z: value.z };
      }
      case MINIMAP_SOURCE_TYPE.SPAWN: {
        const value = spawnRegistry.get(sourceRef.id, context ?? getContext?.() ?? null);
        const anchor = value?.spawnAnchor;
        if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) {
          throw new Error(`Spawn has no resolved anchor: ${sourceRef.id}`);
        }
        return { x: anchor.x, z: anchor.z };
      }
      default:
        throw new Error(`Unsupported minimap source type: ${sourceRef?.type}`);
    }
  }

  function resolveGateState(gateRef, _definition, context) {
    if (!gateRef) return MAP_GATE_STATE.AVAILABLE;
    if (gateRef.type !== MINIMAP_SOURCE_TYPE.SPAWN) return MAP_GATE_STATE.UNKNOWN;
    const spawn = spawnRegistry.get(gateRef.id, context ?? getContext?.() ?? null);
    return mapSpawnState(spawn?.state ?? SPAWN_STATE.UNKNOWN);
  }

  function resolveDiscoveryState(discoveryRef) {
    if (!discoveryRef || !isPlaceDiscovered) return MAP_DISCOVERY_STATE.DISCOVERED;
    if (discoveryRef.type !== MINIMAP_SOURCE_TYPE.PLACE) return MAP_DISCOVERY_STATE.UNKNOWN;
    return isPlaceDiscovered(discoveryRef.id) === true
      ? MAP_DISCOVERY_STATE.DISCOVERED
      : MAP_DISCOVERY_STATE.UNDISCOVERED;
  }

  const poiRegistry = createMapPoiRegistry({
    definitions: M0_MINIMAP_POI_DEFINITIONS,
    resolvePosition,
    resolveGateState,
    resolveDiscoveryState
  });

  return Object.freeze({
    bounds: WORLD_BOUNDS,
    geometry: () => geometryCache,
    poiRegistry: () => poiRegistry,
    refreshState: (context = null) => poiRegistry.list({ surface: MAP_SURFACE.MINIMAP, context }),
    status: (context = null) => Object.freeze({
      geometryCount: geometryCache.length,
      poiCount: poiRegistry.list({ surface: MAP_SURFACE.MINIMAP, context }).length,
      errors: poiRegistry.errors
    })
  });
}

