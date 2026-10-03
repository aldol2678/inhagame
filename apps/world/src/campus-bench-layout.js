import { SITE_FEATURES } from './basic-campus.js';
import { METERS_PER_WORLD_UNIT, metersToWorld, worldToMeters } from './world-scale.js';
import { WORLD_SCHEMA_VERSION, DEFAULT_COORDINATE_SYSTEM } from './editor/world-schema.js';

// One authored placement, on the existing rendered lawn by Jungseok/Woonam park.
// This is a game-layout estimate, not a surveyed furniture location. Keep it out
// of road, entrance, tour and NPC corridors. CampusBase inherits the existing Z reflection.
const lawn = SITE_FEATURES.find(feature => feature.id === 'site_218215618');
const position = [
  lawn.vertices.reduce((sum, point) => sum + point.x, 0) / lawn.vertices.length,
  .018, // Existing buildCampusGrounds lawn surface; logical walk ground stays unchanged.
  lawn.vertices.reduce((sum, point) => sum + point.z, 0) / lawn.vertices.length
].map(worldToMeters);

// The approved GLB is Y-up, ground-origin, metre-authored, with asymmetric Z
// bounds. No recentering, re-export, extra axis flip or independent placement.
export const CAMPUS_BENCH_BOUNDS_METERS = Object.freeze({
  min: Object.freeze([-.9, 0, -.33]), max: Object.freeze([.9, .8, .24])
});
export const CAMPUS_BENCH_METERS_PER_UNIT = METERS_PER_WORLD_UNIT;
export const CAMPUS_BENCH_WORLD = Object.freeze({
  schemaVersion: WORLD_SCHEMA_VERSION,
  worldId: 'world.campus-bench-p1',
  name: 'Campus approved bench',
  coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
  assets: [{ id: 'PROP_BENCH_CAMPUS_001', type: 'model', uri: '/assets/prop_bench_campus_001.glb', metadata: {} }],
  entities: [{
    id: 'prop.campus-bench-001', name: 'PROP_BENCH_CAMPUS_001', kind: 'prop',
    parentId: null, enabled: true,
    transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    tags: ['campus', 'bench'],
    components: { 'core.renderable': { assetId: 'PROP_BENCH_CAMPUS_001', castShadow: true, receiveShadow: true, visible: true } },
    metadata: {}
  }],
  metadata: {}
});

// Current authority is persistent logical-space OBSTACLES, not engine physics.
// One conservative rectangular prism intentionally fills the slat/leg gaps. This is
// not the historical Godot seat/backrest wrapper and never uses visual triangles.
const transform = CAMPUS_BENCH_WORLD.entities[0].transform;
const min = CAMPUS_BENCH_BOUNDS_METERS.min.map((value, axis) => metersToWorld(transform.position[axis] + value * transform.scale[axis]));
const max = CAMPUS_BENCH_BOUNDS_METERS.max.map((value, axis) => metersToWorld(transform.position[axis] + value * transform.scale[axis]));
export const CAMPUS_BENCH_COLLIDER = Object.freeze({
  id: 'prop.campus-bench-001',
  polygon: Object.freeze([
    { x: min[0], z: min[2] }, { x: max[0], z: min[2] },
    { x: max[0], z: max[2] }, { x: min[0], z: max[2] }
  ].map(Object.freeze)),
  minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2]
});
