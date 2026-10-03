import { SITE_FEATURES } from './basic-campus.js';
import { METERS_PER_WORLD_UNIT, metersToWorld, worldToMeters } from './world-scale.js';
import { WORLD_SCHEMA_VERSION, DEFAULT_COORDINATE_SYSTEM } from './editor/world-schema.js';

// Same rendered lawn as the approved bench, 1.5 logical units to its east.
// This is a game-layout estimate, not a surveyed lamp location. The head points
// away from the bench; the two props neither overlap nor share collision.
const lawn = SITE_FEATURES.find(feature => feature.id === 'site_218215618');
const position = [
  lawn.vertices.reduce((sum, p) => sum + p.x, 0) / lawn.vertices.length + 1.5,
  .018,
  lawn.vertices.reduce((sum, p) => sum + p.z, 0) / lawn.vertices.length
].map(worldToMeters);

// Approved GLB Y-up metre bounds; origin is the pole's ground centre.
export const CAMPUS_STREETLAMP_BOUNDS_METERS = Object.freeze({
  min: Object.freeze([-.18000000715255737, 0, -.18000000715255737]),
  max: Object.freeze([.7000000476837158, 3.5, .18000000715255737])
});
export const CAMPUS_STREETLAMP_METERS_PER_UNIT = METERS_PER_WORLD_UNIT;
export const CAMPUS_STREETLAMP_WORLD = Object.freeze({
  schemaVersion: WORLD_SCHEMA_VERSION,
  worldId: 'world.campus-streetlamp-p2', name: 'Campus approved streetlamp',
  coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
  assets: [{ id: 'PROP_STREETLAMP_CAMPUS_001', type: 'model', uri: '/assets/prop_streetlamp_campus_001.glb', metadata: {} }],
  entities: [{
    id: 'prop.campus-streetlamp-001', name: 'PROP_STREETLAMP_CAMPUS_001', kind: 'prop', parentId: null, enabled: true,
    transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    tags: ['campus', 'streetlamp'],
    components: { 'core.renderable': { assetId: 'PROP_STREETLAMP_CAMPUS_001', castShadow: true, receiveShadow: true, visible: true } },
    metadata: {}
  }], metadata: {}
});

// Two minimal persistent logical-space prisms, not triangles or head-width walls.
// Base is wide only at ground level; the tall pole is narrow. Float bounds are
// rounded conservatively. These are owned by OBSTACLES, alongside CampusBase.
const transform = CAMPUS_STREETLAMP_WORLD.entities[0].transform;
export const CAMPUS_STREETLAMP_COLLIDERS = Object.freeze([
  { part: 'base', min: [-.18, 0, -.18], max: [.18, .12, .18] },
  { part: 'pole', min: [-.065, .06, -.065], max: [.065, 3.400001, .065] }
].map(({ part, min, max }) => {
  min = min.map((v, axis) => metersToWorld(transform.position[axis] + v * transform.scale[axis]));
  max = max.map((v, axis) => metersToWorld(transform.position[axis] + v * transform.scale[axis]));
  return Object.freeze({
    id: `prop.campus-streetlamp-001.${part}`,
    polygon: Object.freeze([{ x: min[0], z: min[2] }, { x: max[0], z: min[2] }, { x: max[0], z: max[2] }, { x: min[0], z: max[2] }].map(Object.freeze)),
    minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2]
  });
}));
