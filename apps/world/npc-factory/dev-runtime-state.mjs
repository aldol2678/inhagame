// Development-only mapping from the frozen NPC contract to the current campus frame.
// These positions are inspection anchors, not new canonical location coordinates.
import { getCanonicalLandmark, projectPolygon } from '../src/reality-adapter.js';
import { edgeFrame } from '../src/roadview-layout.js';
import { INKYUNG_PHOTO_ANCHOR_SPEC } from '../src/photo/inkyung-photo-point.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { FACILITIES, FACILITY_COLLIDERS } from '../src/campus-facilities.js';
import { LANDMARKS, OBSTACLES } from '../src/campus-layout.js';
import { LIBRARY_FRONT } from '../src/basic-campus.js';
import { MARKET_PREVIEWS } from '../src/back-market-layout.js';
import { BACK_GATE } from '../src/back-gate-layout.js';
import { campusNavGraph } from '../src/navigation/campus-navigation.js';
import { PERIODS, ACTIVITIES, SOCIAL_MODES, FORBIDDEN_CAPABILITIES } from './vocabulary.mjs';
import { runtimePresence } from './npc-presence.mjs';

export { PERIODS };
export const PULSE_PERIODS = Object.freeze([...PERIODS, 'night']);
export const PERIOD_SECONDS = 900;
export const CYCLE_SECONDS = PERIOD_SECONDS * PULSE_PERIODS.length;

const pondRing = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
const anchorSpecs = Object.freeze({
  inkyung_spawn: [3, .5, 4],
  inkyung_bench_east: [1, .3, 4],
  inkyung_bench_west: [7, .5, 4],
  inkyung_walkway: [1, .7, 4],
  inkyung_waterfront: [0, .5, 4],
  inkyung_photo_point: INKYUNG_PHOTO_ANCHOR_SPEC,
  transit_to_main_hall: [4, .5, 10],
  transit_to_student_center: [11, .5, 10],
  transit_to_building: [2, .5, 10]
});

const facilityById = new Map(FACILITIES.map(facility => [facility.id, facility]));
const campusGraph = campusNavGraph();
const snapCampus = point => {
  const snapped = campusGraph.nearestEdgePoint(point, { maxDistance: 80 });
  return snapped ? { x: snapped.x, z: snapped.z } : { x: point.x, z: point.z };
};
const facilityApproach = id => {
  const facility = facilityById.get(id);
  if (!facility) throw new Error(`Missing campus facility for NPC anchor: ${id}`);
  return snapCampus(facility.center);
};
const closestOnSegment = (point, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 1e-9 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
  return { t, x: a.x + dx * t, z: a.z + dz * t,
    distance: Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)) };
};
const facilityExteriorFrame = id => {
  const facility = facilityById.get(id), ring = facility?.rings?.[0];
  if (!facility || !ring?.length) throw new Error(`Missing facility footprint for NPC remote anchor: ${id}`);
  const toward = campusGraph.nearestEdgePoint(facility.center);
  if (!toward) throw new Error(`Missing campus graph for NPC remote anchor: ${id}`);
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], hit = closestOnSegment(toward, a, b);
    if (!best || hit.distance < best.hit.distance) best = { a, b, hit };
  }
  const dx = best.b.x - best.a.x, dz = best.b.z - best.a.z, length = Math.hypot(dx, dz);
  const tx = dx / length, tz = dz / length;
  const mid = { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 };
  const left = { x: -tz, z: tx };
  const sign = (mid.x - facility.center.x) * left.x + (mid.z - facility.center.z) * left.z >= 0 ? 1 : -1;
  const nx = left.x * sign, nz = left.z * sign;
  return Object.freeze({
    at(index = 4) {
      // Residence populations can exceed the old nine-point ring. Use facade rows instead of
      // modulo-wrapping so the 10th+ NPC never reuses another resident's exact destination.
      const slotsPerRow = 4;
      const column = ((index % slotsPerRow) + slotsPerRow) % slotsPerRow;
      const row = Math.floor(Math.max(0, index) / slotsPerRow);
      const margin = Math.min(1.5, length * .12);
      const usable = Math.max(1, length - margin * 2);
      const u = margin + usable * ((column + 1) / (slotsPerRow + 1));
      const outward = 1.5 + row * 2;
      return { x: best.a.x + tx * u + nx * outward, z: best.a.z + tz * u + nz * outward };
    }
  });
};
const remoteAnchorFrames = Object.freeze({ life_dorm_2: facilityExteriorFrame('bldg_dorm2') });
const localExteriorAnchorFrames = Object.freeze({ life_dorm_1: facilityExteriorFrame('bldg_dorm1') });
const campusAnchorPoints = Object.freeze({
  class_building_2: facilityApproach('bldg_02_south'),
  class_building_4: facilityApproach('bldg_04'),
  class_building_5: facilityApproach('bldg_05'),
  class_building_6: facilityApproach('bldg_06'),
  class_building_9: facilityApproach('bldg_09'),
  class_hitech: facilityApproach('bldg_hitech'),
  class_seoho: facilityApproach('bldg_seoho'),
  class_lawschool: facilityApproach('bldg_lawschool'),
  class_60th: facilityApproach('bldg_60th'),
  study_jungseok: snapCampus(LIBRARY_FRONT.at(0, 3.5)),
  life_student_center: facilityApproach('bldg_07'),
  life_back_market_67: snapCampus(MARKET_PREVIEWS['market-67']),
  life_back_market_91: snapCampus(MARKET_PREVIEWS['market-91']),
  life_back_market_west: snapCampus(MARKET_PREVIEWS['market-west']),
  life_back_market_north: snapCampus(MARKET_PREVIEWS['market-north']),
  life_back_gate: snapCampus(BACK_GATE),
  life_dorm_1: facilityApproach('bldg_dorm1'),
  life_dorm_2: remoteAnchorFrames.life_dorm_2.at(4)
});

export function periodAt(seconds) {
  if (!Number.isFinite(seconds)) throw new Error('Invalid test clock');
  return PULSE_PERIODS[Math.floor(((seconds % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS / PERIOD_SECONDS)];
}

export function validateDevCandidate(batch) {
  const base20 = batch?.batch_id === 'INKYUNG-20-A' && batch?.schema_version === '0.1' &&
    batch?.zone === 'C04_INKYUNG' && batch?.npc_count === 20 && batch?.npcs?.length === 20;
  const campus48 = batch?.batch_id === 'INKYUNG-48-P2A' && batch?.schema_version === '0.2' &&
    batch?.zone === 'CAMPUS' && batch?.npc_count === 48 && batch?.npcs?.length === 48;
  if (!base20 && !campus48) {
    throw new Error('NPC runtime candidate identity/count mismatch');
  }
  const ids = new Set();
  for (const npc of batch.npcs) {
    if (!npc?.npc_id || ids.has(npc.npc_id) || !npc.identity?.name) throw new Error('Invalid NPC identity');
    ids.add(npc.npc_id);
    if (FORBIDDEN_CAPABILITIES.some(key => npc.constraints?.[key] !== false) ||
        Object.keys(npc.constraints ?? {}).length !== FORBIDDEN_CAPABILITIES.length) throw new Error('Forbidden NPC capability');
    for (const period of PERIODS) {
      const slot = npc.schedule?.[period], hooks = npc.dialogue_hooks?.[period];
      if (!slot || !(slot.location in anchorSpecs || slot.location in campusAnchorPoints || slot.location === 'off_zone') ||
          !ACTIVITIES.includes(slot.activity) || !SOCIAL_MODES.includes(slot.social_mode) ||
          !Array.isArray(hooks) || hooks.length < 2 || hooks.length > 4 ||
          hooks.some(hook => typeof hook !== 'string' || !hook.trim())) {
        throw new Error(`Invalid ${npc.npc_id}/${period} test state`);
      }
    }
  }
  return batch;
}

const campusSlots = new Map();
const DWELL_CLEARANCE = .65;
const dwellObstacles = OBSTACLES.filter(box => box.minY < 2.5 && box.maxY > 0).map(box => box.polygon
  ? { box, minX: Math.min(...box.polygon.map(p => p.x)), maxX: Math.max(...box.polygon.map(p => p.x)),
    minZ: Math.min(...box.polygon.map(p => p.z)), maxZ: Math.max(...box.polygon.map(p => p.z)) }
  : { box });
const withinClearance = (point, { minX, maxX, minZ, maxZ }) => point.x >= minX - DWELL_CLEARANCE &&
  point.x <= maxX + DWELL_CLEARANCE && point.z >= minZ - DWELL_CLEARANCE && point.z <= maxZ + DWELL_CLEARANCE;
// polygonOverlap() is true only inside the ring or within the clearance of an edge, both of which lie
// inside the ring's bounds grown by that clearance, so the bounds test rejects far obstacles exactly.
export function safeDwell(point) {
  if (polygonOverlap(point.x, point.z, pondRing, DWELL_CLEARANCE)) return false;
  return !dwellObstacles.some(entry => entry.box.polygon
    ? withinClearance(point, entry) && polygonOverlap(point.x, point.z, entry.box.polygon, DWELL_CLEARANCE)
    : withinClearance(point, entry.box));
}
export function positionAt(location, slotIndex) {
  if (location === 'off_zone') return null;
  if (location === 'main_gate') return { x: LANDMARKS.gate.x + 3, z: LANDMARKS.gate.z };
  const remoteFrame = remoteAnchorFrames[location];
  if (remoteFrame) return remoteFrame.at(slotIndex);
  const localExteriorFrame = localExteriorAnchorFrames[location];
  if (localExteriorFrame) return localExteriorFrame.at(slotIndex);
  const campusAnchor = campusAnchorPoints[location];
  if (campusAnchor) {
    // Reserve deterministic, separated dwell spots beside the path. Snapping every
    // occupant onto a road centerline produced parade-like rows at teaching buildings.
    if (!Number.isInteger(slotIndex) || slotIndex < 0) throw new Error('Invalid NPC slot');
    const slots = campusSlots.get(location) ?? [];
    campusSlots.set(location, slots);
    for (let radius = 0; slots.length <= slotIndex && radius <= 100; radius += 1.8) {
      for (let angle = 0; angle < 32 && slots.length <= slotIndex; angle++) {
        const theta = angle * Math.PI * (3 - Math.sqrt(5));
        const point = { x: campusAnchor.x + Math.cos(theta) * radius,
          z: campusAnchor.z + Math.sin(theta) * radius };
        const nearPath = campusGraph.nearestEdgePoint(point, { maxDistance: 1 });
        // Do not place people beyond the rendered end cap of a walkway.
        const pastEnd = nearPath && (nearPath.t <= .001 || nearPath.t >= .999) && nearPath.distance > .05;
        if (nearPath && !pastEnd && safeDwell(point) &&
            slots.every(other => Math.hypot(other.x-point.x,other.z-point.z) >= 1.6)) slots.push(point);
      }
    }
    if (!slots[slotIndex]) throw new Error(`No separated NPC slot: ${location}/${slotIndex}`);
    return { ...slots[slotIndex] };
  }
  const spec = anchorSpecs[location];
  if (!spec) throw new Error(`Unknown NPC runtime location: ${location}`);
  const [edge, fraction, distance] = spec;
  const frame = edgeFrame(pondRing, edge);
  const column = slotIndex % 3 - 1;
  const row = Math.floor(slotIndex / 3);
  const along = Math.max(.35, Math.min(frame.length - .35, frame.length * fraction + column * 1.25));
  return frame.at(along, distance + row * 1.4);
}

export function inspectionPointFor(actor) {
  if (!actor.position) return null;
  const offsets = [[2, -3], [-2, -3], [3, 0], [-3, 0], [2, 3], [-2, 3], [0, -3]];
  for (const [dx, dz] of offsets) {
    const point = { x: actor.position.x + dx, z: actor.position.z + dz };
    if (!polygonOverlap(point.x, point.z, pondRing, .6) &&
        !FACILITY_COLLIDERS.some(collider => polygonOverlap(point.x, point.z, collider.polygon, .6))) return point;
  }
  throw new Error(`No safe local inspection point for ${actor.id}`);
}

export function snapshotForPeriod(batch, period) {
  validateDevCandidate(batch);
  if (!PULSE_PERIODS.includes(period)) throw new Error(`Unknown period: ${period}`);
  const counts = new Map();
  const actors = batch.npcs.map(npc => {
    const { slot, dialogue } = runtimePresence(npc, period);
    const index = counts.get(slot.location) ?? 0;
    counts.set(slot.location, index + 1);
    return {
      id: npc.npc_id, name: npc.identity.name, archetype: npc.archetype,
      location: slot.location, activity: slot.activity, social_mode: slot.social_mode,
      dialogue, position: positionAt(slot.location, index)
    };
  });
  const local = actors.filter(actor => actor.position);
  const largestCrowd = Math.max(0, ...[...counts.entries()].filter(([place]) => place !== 'off_zone').map(([, count]) => count));
  const crowdLimit = [...counts.keys()].some(location => location in campusAnchorPoints) ? 24 : 6;
  if (largestCrowd > crowdLimit) throw new Error('Crowd exceeds NPC runtime contract');
  return { period, actors, localCount: local.length, offZoneCount: actors.length - local.length, largestCrowd };
}
