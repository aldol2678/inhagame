import { geoToWorld } from "./geo-coordinates.js";
export { geoToWorld, GEO_ORIGIN } from "./geo-coordinates.js";
import { BUILDINGS, MAIN_ENTRANCE, LIBRARY_ROOF_PARTS } from "./basic-campus.js";
import { mainGateProductionStructure } from './editor/main-gate-production.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { ROADVIEW_OBSTACLES } from './roadview-layout.js';
import { BACK_GATE_COLLIDERS } from './back-gate-layout.js';
import { BACK_STREET_COLLIDERS } from './back-street-layout.js';
import { BACK_ALLEY_COLLIDERS } from './back-alley-layout.js';
import { BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { GARDEN_COLLIDERS } from './library-garden-layout.js';
import { SPORTS_COLLIDERS } from './stadium-stands-layout.js';
import { LIBRARY_ROUTE_GUARDS } from './library-route-layout.js';
import { SIDE_GATE_COLLIDERS } from './north-side-gate-layout.js';
import { BACK_FURNITURE_COLLIDERS, BACK_WALL_COLLIDERS } from './back-furniture-layout.js';
import { BACK_ROADSIDE_COLLIDERS } from './back-roadside-layout.js';
import { BACK_GATE_511_COLLIDER } from './back-transit-stop-layout.js';
import { AIRCRAFT_COLLIDERS } from './landmark-detail-layout.js';
import { BIRYONG_COLLIDERS } from './biryong/biryong-layout.js';
import { MAIN_GATE_GUESTBOOK_COLLIDER } from './guestbook/guestbook-world.js';
import { MAIN_GATE_CAMPUS_BIKE_COLLIDER } from './mounts/campus-bike-world.js';
import { CULTURE_COLLIDERS } from './culture-street-layout.js';
import { MARKET_COLLIDERS } from './back-market-layout.js';
import { INTERIOR_COLLIDERS } from './market-interior-layout.js';
import { EXTERIOR_WORLD_BOUNDS } from './world-exterior-bounds.js';
import { DORM_1_FENCES } from './gate-dorm-exterior-layout.js';

export const LANDMARKS = Object.freeze({
  gate: Object.freeze({ ...geoToWorld(37.44770, 126.65319), lat: 37.44770, lon: 126.65319 }),
  mainHall: Object.freeze({ ...geoToWorld(37.44941, 126.65443), lat: 37.44941, lon: 126.65443 })
});

// Logical-space footprint and box colliders stay loaded across streaming transitions.
// Decorative tiles, pathways, windows and foliage intentionally have no collider.
const MAIN_GATE_WALL_COLLIDERS=['gate_wall_-1','gate_wall_1'].map(id=>{
  const wall=mainGateProductionStructure(id);
  return Object.freeze({id,polygon:wall.footprint,minY:0,maxY:wall.collisionMaxY});
});

export const OBSTACLES = Object.freeze([
  MAIN_GATE_GUESTBOOK_COLLIDER,
  MAIN_GATE_CAMPUS_BIKE_COLLIDER,
  ...ROADVIEW_OBSTACLES,
  ...DORM_1_FENCES,
  ...AIRCRAFT_COLLIDERS,
  ...BIRYONG_COLLIDERS,
  ...BACK_GATE_COLLIDERS,
  ...BACK_STREET_COLLIDERS,
  ...BACK_ALLEY_COLLIDERS,
  ...CULTURE_COLLIDERS,
  ...MARKET_COLLIDERS,
  ...INTERIOR_COLLIDERS,
  ...BACK_WEST_COLLIDERS,
  ...GARDEN_COLLIDERS,
  ...SPORTS_COLLIDERS,
  ...LIBRARY_ROUTE_GUARDS,
  ...SIDE_GATE_COLLIDERS,
  ...BACK_FURNITURE_COLLIDERS,
  ...BACK_WALL_COLLIDERS,
  ...BACK_ROADSIDE_COLLIDERS,
  BACK_GATE_511_COLLIDER,
  ...FACILITY_COLLIDERS,
  ...BUILDINGS.map(b => ({ id:b.id, polygon:b.vertices, minY:0, maxY:b.height })),
  ...LIBRARY_ROOF_PARTS.map(b => ({ id:b.id, polygon:b.vertices, minY:b.y-b.height/2, maxY:b.y+b.height/2 })),
  ...MAIN_GATE_WALL_COLLIDERS
]);

export const WORLD_BOUNDS = EXTERIOR_WORLD_BOUNDS;
export const TOUR_STOPS = Object.freeze([
  // zone is a deprecated compatibility field for old QA/callers; live tour uses placeZoneId.
  { id: "gate", label: "정문 통과", placeZoneId:'AREA_MAIN_GATE', zone: "C01_GATE", x: 0, z: -76, radius: 7 },
  { id: "main", label: "본관 앞", placeZoneId:'AREA_MAIN_HALL', zone: "C02_MAIN_HALL", x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z, radius: 9 }
]);

