// Main Gate / Dormitory 1 junction anchors, derived only from the editor-authored corridors in
// main-gate-road-layout.js. Lamp coverage and the traffic signal layout share these anchors so the
// two systems cannot drift apart when the editor world is re-authored.
import { DORM_1_ENTRANCE } from './dorm1-layout.js';
import { roadFrame } from './campus-road-layout.js';
import {
  GATE_DORM_CROSSINGS,
  GATE_DORM_PATHS,
  MAIN_GATE_APPROACH_ROAD,
  SOSUNG_RO
} from './main-gate-road-layout.js';

export const SOSUNG_FRAME = roadFrame(SOSUNG_RO.vertices[0], SOSUNG_RO.vertices.at(-1));

function lineIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const denominator = r.x * s.z - r.z * s.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / denominator;
  return { x: a.x + r.x * t, z: a.z + r.z * t };
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const sosungA = SOSUNG_RO.vertices[0];
const sosungB = SOSUNG_RO.vertices.at(-1);

const approachCenter = lineIntersection(
  MAIN_GATE_APPROACH_ROAD.vertices[0],
  MAIN_GATE_APPROACH_ROAD.vertices.at(-1),
  sosungA,
  sosungB
) ?? mid(MAIN_GATE_APPROACH_ROAD.vertices[0], sosungA);

const dormEntry = GATE_DORM_PATHS.find(path => path.id === 'dorm1_entry_path');

// Distance (world units, 1 WU = 2 m) around each anchor that must keep at least one roadside lamp.
// Anchors sit on a road centreline, so the gate T-junction (14 WU wide mouth) gets a wider radius.
export const MAIN_GATE_JUNCTION_LAMP_RADIUS = 9;
export const MAIN_GATE_APPROACH_LAMP_RADIUS = 12;

export const MAIN_GATE_JUNCTIONS = Object.freeze([
  Object.freeze({
    id: 'main_gate_approach',
    kind: 'junction',
    radius: MAIN_GATE_APPROACH_LAMP_RADIUS,
    center: Object.freeze(approachCenter)
  }),
  ...GATE_DORM_CROSSINGS.map(crossing => Object.freeze({
    id: crossing.id,
    kind: 'crossing',
    radius: MAIN_GATE_JUNCTION_LAMP_RADIUS,
    center: Object.freeze(mid(crossing.vertices[0], crossing.vertices.at(-1)))
  })),
  Object.freeze({
    id: 'dorm1_entry',
    kind: 'entrance',
    radius: MAIN_GATE_JUNCTION_LAMP_RADIUS,
    center: Object.freeze({ x: DORM_1_ENTRANCE.position.x, z: DORM_1_ENTRANCE.position.z })
  }),
  Object.freeze({
    id: 'dorm1_entry_road_edge',
    kind: 'junction',
    radius: MAIN_GATE_JUNCTION_LAMP_RADIUS,
    center: Object.freeze({ x: dormEntry.vertices[0].x, z: dormEntry.vertices[0].z })
  })
]);
