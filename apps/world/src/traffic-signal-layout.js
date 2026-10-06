// Vehicle + pedestrian signal poles for the Main Gate / Dormitory 1 junction (Sosung-ro frontage,
// the two zebra crossings and the gate approach). Positions derive from the editor-authored
// corridors, never from screenshots: the editor world stays the coordinate authority.
//
// Pole rule: every pole stands outside every rendered road/path/crossing/forecourt surface
// (same clearance as the night lamps). A pole that would land on a surface slides outward across
// the curb/sidewalk band and then along the corridor before it is dropped.
import { BUILDINGS } from './basic-campus.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { roadFrame } from './campus-road-layout.js';
import { MAIN_GATE_APPROACH_ROAD, GATE_DORM_CROSSINGS, GATE_DORM_PATHS, SOSUNG_RO } from './main-gate-road-layout.js';
import { MAIN_GATE_JUNCTIONS, SOSUNG_FRAME } from './main-gate-junctions.js';
import { polygonOverlap } from './polygon-collision.js';
import { ROAD_POLE_CLEARANCE, outsideRenderedCorridors } from './road-pole-clearance.js';

export const TRAFFIC_SIGNAL_DIMENSIONS = Object.freeze({
  poleHeight: 2.8,
  poleSize: 0.12,
  vehicleHeadY: 1.95,
  vehicleHeadSize: Object.freeze({ depth: 0.34, width: 0.5, height: 1.35 }),
  vehicleArmReach: 1.1,
  pedestrianHeadY: 1.3,
  pedestrianHeadSize: Object.freeze({ depth: 0.3, width: 0.46, height: 0.9 }),
  pedestrianReach: 0.28,
  lensSize: 0.3,
  searchSlide: 1.5,
  searchSlideStep: 0.3,
  searchShift: 1,
  searchShiftStep: 0.5
});

const obstacles = [
  ...FACILITY_COLLIDERS,
  ...BUILDINGS.map(building => ({ polygon: building.vertices }))
];

const sidewalkWidth = GATE_DORM_PATHS.find(path => path.id === 'sosung_south_sidewalk')?.width ?? 2;

function poleIsClear(point) {
  return outsideRenderedCorridors(point, ROAD_POLE_CLEARANCE) &&
    obstacles.every(obstacle => !polygonOverlap(point.x, point.z, obstacle.polygon, 0.28));
}

function candidatePoles(frame, u, side, baseLateral, { maxShift, maxSlide }) {
  const d = TRAFFIC_SIGNAL_DIMENSIONS;
  const list = [];
  for (let shift = 0; shift <= maxShift + 1e-9; shift += d.searchShiftStep) {
    for (const direction of shift ? [1, -1] : [0]) {
      const shiftedU = u + direction * shift;
      if (shiftedU < 0.5 || shiftedU > frame.length - 0.5) continue;
      for (let slide = 0; slide <= maxSlide + 1e-9; slide += d.searchSlideStep) {
        list.push({ u: shiftedU, lateral: baseLateral + slide, cost: slide + shift * 0.6 });
      }
    }
  }
  return list.sort((a, b) => a.cost - b.cost).map(item => ({
    ...item,
    point: frame.at(item.u, side * item.lateral)
  }));
}

function findPole(frame, u, side, baseLateral, limits = {}) {
  const d = TRAFFIC_SIGNAL_DIMENSIONS;
  const search = { maxShift: limits.maxShift ?? d.searchShift, maxSlide: limits.maxSlide ?? d.searchSlide };
  const accept = limits.accept ?? (() => true);
  return candidatePoles(frame, u, side, baseLateral, search)
    .find(item => poleIsClear(item.point) && accept(item.point)) ?? null;
}

const unit = (dx, dz) => {
  const length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
};
export const signalYawDegrees = facing => -Math.atan2(facing.z, facing.x) * 180 / Math.PI;

function frameVectors(frame) {
  const a = frame.at(0, 0);
  const b = frame.at(1, 0);
  const c = frame.at(0, 1);
  return { tangent: unit(b.x - a.x, b.z - a.z), left: unit(c.x - a.x, c.z - a.z) };
}

function headAt(pole, direction, reach, y, facing) {
  return Object.freeze({
    position: Object.freeze({ x: pole.x + direction.x * reach, y, z: pole.z + direction.z * reach }),
    facing: Object.freeze({ x: facing.x, z: facing.z }),
    yaw: signalYawDegrees(facing)
  });
}

function buildPole({ id, kind, point, towardRoad, vehicle, pedestrian }) {
  const d = TRAFFIC_SIGNAL_DIMENSIONS;
  const pole = Object.freeze({ x: point.x, z: point.z });
  return Object.freeze({
    id,
    kind,
    pole,
    height: d.poleHeight,
    vehicle: vehicle
      ? Object.freeze({
        group: vehicle.group,
        direction: vehicle.direction,
        arm: headAt(pole, towardRoad, d.vehicleArmReach, d.vehicleHeadY, vehicle.facing)
      })
      : null,
    pedestrian: pedestrian
      ? Object.freeze({
        crossingId: pedestrian.crossingId,
        head: headAt(pole, towardRoad, d.pedestrianReach, d.pedestrianHeadY, pedestrian.facing)
      })
      : null
  });
}

function buildSosungPoles() {
  const half = SOSUNG_RO.width / 2;
  const baseLateral = half + sidewalkWidth + 0.35;
  const { tangent, left } = frameVectors(SOSUNG_FRAME);
  const poles = [];
  for (const crossing of GATE_DORM_CROSSINGS) {
    const a = crossing.vertices[0];
    const b = crossing.vertices.at(-1);
    const center = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const a0 = SOSUNG_FRAME.at(0, 0);
    const crossingU = (center.x - a0.x) * tangent.x + (center.z - a0.z) * tangent.z;
    const off = crossing.width / 2 + 0.9;
    // side -1: south (right-hand side of +u traffic); side +1: north (right-hand side of -u traffic).
    for (const approach of [
      { side: -1, direction: 'forward', group: 'A', label: 'south', facing: { x: -tangent.x, z: -tangent.z }, us: [crossingU - off, crossingU + off] },
      { side: 1, direction: 'backward', group: 'A', label: 'north', facing: tangent, us: [crossingU + off, crossingU - off] }
    ]) {
      let found = null;
      for (const u of approach.us) {
        found = findPole(SOSUNG_FRAME, u, approach.side, baseLateral);
        if (found) break;
      }
      if (!found) continue;
      const towardRoad = { x: -approach.side * left.x, z: -approach.side * left.z };
      poles.push(buildPole({
        id: `${crossing.id}_${approach.label}`,
        kind: 'sosung-crossing',
        point: found.point,
        towardRoad,
        vehicle: { group: approach.group, direction: approach.direction, facing: approach.facing },
        // The pedestrian head faces the people waiting on the opposite landing.
        pedestrian: { crossingId: crossing.id, facing: towardRoad }
      }));
    }
  }
  return poles;
}

// Minimum spacing between signal poles so two assemblies never read as one cluttered post.
const POLE_SEPARATION = 3.5;

function buildApproachPole(existing) {
  const approach = MAIN_GATE_APPROACH_ROAD;
  const frame = roadFrame(approach.vertices[0], approach.vertices.at(-1));
  const { tangent, left } = frameVectors(frame);
  // Traffic leaves the gate heading toward Sosung-ro (-tangent); the head faces back up the approach.
  const baseLateral = approach.width / 2 + 0.35;
  const origin = frame.at(0, 0);
  const junction = MAIN_GATE_JUNCTIONS.find(item => item.id === 'main_gate_approach').center;
  const junctionU = (junction.x - origin.x) * tangent.x + (junction.z - origin.z) * tangent.z;
  // Stop line sits just beyond Sosung-ro's north curb and sidewalk (half width + sidewalk), on the
  // approach's right-hand side for southbound traffic (+left), then the far side as a fallback.
  const stopU = junctionU + SOSUNG_RO.width / 2 + sidewalkWidth + 1;
  const accept = point => existing.every(pole => Math.hypot(pole.pole.x - point.x, pole.pole.z - point.z) >= POLE_SEPARATION);
  for (const side of [1, -1]) {
    const found = findPole(frame, stopU, side, baseLateral, { maxShift: 9, maxSlide: 2.4, accept });
    if (!found) continue;
    return [buildPole({
      id: 'main_gate_approach_exit',
      kind: 'gate-approach',
      point: found.point,
      towardRoad: { x: -side * left.x, z: -side * left.z },
      vehicle: { group: 'B', direction: 'toward-sosung', facing: tangent }
    })];
  }
  return [];
}

const sosungPoles = buildSosungPoles();

export const TRAFFIC_SIGNAL_INTERSECTION = Object.freeze({
  id: 'main_gate_sosung',
  poles: Object.freeze([...sosungPoles, ...buildApproachPole(sosungPoles)])
});
