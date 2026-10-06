import { BUILDINGS } from '../basic-campus.js';
import { FACILITY_COLLIDERS } from '../campus-facilities.js';
import { ROAD_SEGMENTS, roadFrame } from '../campus-road-layout.js';
import {
  GATE_DORM_PATHS,
  GATE_DORM_ROADS,
  GATE_DORM_SEGMENTS
} from '../main-gate-road-layout.js';
import { MAIN_GATE_JUNCTIONS, MAIN_GATE_JUNCTION_LAMP_RADIUS } from '../main-gate-junctions.js';
import {
  CAMPUS_PATH_SEGMENTS,
  outsideRenderedCorridors,
  segmentWidth
} from '../road-pole-clearance.js';
import { polygonOverlap } from '../polygon-collision.js';

export const CAMPUS_NIGHT_LAMP_POLICY = Object.freeze({
  roadSpacing: 22,
  pathSpacing: 18,
  roadsideOffset: 0.72,
  pathOffset: 0.58,
  minGap: 10.5,
  height: 4.45,
  maxRoadLamps: 42,
  maxPathLamps: 22,
  // Authored Main Gate / Sosung-ro corridors are lit as major roads: ~22 m (11 WU) along each
  // side's staggered rhythm, with their own budget so the generic road cap cannot starve them.
  majorRoadSpacing: 11,
  maxMajorRoadLamps: 24,
  maxMajorPathLamps: 6,
  maxJunctionLamps: 8,
  // Re-anchor search: a blocked candidate slides outward from the source corridor (curb /
  // sidewalk band) before it is allowed to slide along it, and only then is it dropped.
  slideStep: 0.3,
  maxSlide: 2.4,
  shiftStep: 1.5,
  maxShift: 6,
  junctionRadius: MAIN_GATE_JUNCTION_LAMP_RADIUS
});

export const CAMPUS_NIGHT_LAMP_POLE_CLEARANCE = 0.18;

const obstacles = [
  ...FACILITY_COLLIDERS,
  ...BUILDINGS.map(building => ({ polygon: building.vertices }))
];

function frameAt(frame, u, v = 0) {
  const a = frame.at(0), b = frame.at(Math.min(1, frame.length));
  const yaw = -Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI;
  return Object.freeze({
    yaw,
    at(x, z = 0) {
      return frame.at(u + x, v + z);
    }
  });
}

function candidateUs(length, spacing, { start = 7, endMargin = 5 } = {}) {
  if (!(length > 4)) return [];
  if (length < 14) return [length / 2];
  const result = [];
  for (let u = start; u <= length - endMargin; u += spacing) result.push(u);
  if (!result.length) result.push(length / 2);
  return result;
}

export function isCampusLampPoleClear(point) {
  return outsideRenderedCorridors(point, CAMPUS_NIGHT_LAMP_POLE_CLEARANCE) &&
    obstacles.every(obstacle => !polygonOverlap(point.x, point.z, obstacle.polygon, 0.28));
}

function farEnough(point, lamps) {
  const min = CAMPUS_NIGHT_LAMP_POLICY.minGap;
  return lamps.every(lamp => Math.hypot(point.x - lamp.center.x, point.z - lamp.center.z) >= min);
}

function createStats() {
  return {
    candidates: 0,
    direct: 0,
    slid: 0,
    shifted: 0,
    swappedSide: 0,
    covered: 0,
    rejected: 0,
    anchorLamps: 0,
    unlitAnchors: []
  };
}

// GENERATE -> VALIDATE -> RE-ANCHOR / SLIDE -> VALIDATE -> ACCEPT. The ordered candidate list
// starts at the nominal roadside anchor, slides outward across the curb/sidewalk band, then walks
// along the source corridor (away from crossings and junction mouths), and only then flips to the
// opposite side. A spot already lit by a neighbouring lamp ends the search ("covered"): re-anchoring
// exists to recover lamps blocked by other geometry, not to pack extra lamps together.
function reanchorCandidates(segment, u, preferredSide, offset) {
  const policy = CAMPUS_NIGHT_LAMP_POLICY;
  const base = segmentWidth(segment) / 2 + offset;
  const slides = Math.round(policy.maxSlide / policy.slideStep);
  const shifts = Math.round(policy.maxShift / policy.shiftStep);
  const length = segment.frame.length;
  const result = [];
  for (let shift = 0; shift <= shifts; shift++) {
    for (const direction of shift ? [1, -1] : [0]) {
      const shiftedU = u + direction * shift * policy.shiftStep;
      if (shiftedU < 1 || shiftedU > length - 1) continue;
      for (const flip of [1, -1]) {
        for (let k = 0; k <= slides; k++) {
          result.push({
            u: shiftedU,
            shift: direction * shift * policy.shiftStep,
            side: preferredSide * flip,
            flipped: flip < 0,
            slide: k * policy.slideStep,
            lateral: base + k * policy.slideStep,
            cost: k * policy.slideStep + shift * policy.shiftStep * 0.6 + (flip < 0 ? 3 : 0)
          });
        }
      }
    }
  }
  return result.sort((a, b) => a.cost - b.cost);
}

function resolveAnchor(segment, u, preferredSide, offset, lamps, stats) {
  for (const candidate of reanchorCandidates(segment, u, preferredSide, offset)) {
    const point = segment.frame.at(candidate.u, candidate.side * candidate.lateral);
    if (!isCampusLampPoleClear(point)) continue;
    if (!farEnough(point, lamps)) {
      stats.covered++;
      return null;
    }
    return candidate;
  }
  stats.rejected++;
  return null;
}

function createLamp({ id, sourceKind, localFrame, side, corridorHalfWidth, poleLateralOffset, placement, slide = 0, shift = 0 }) {
  const center = localFrame.at(0);
  const head = localFrame.at(0, -side * 0.88);
  return Object.freeze({
    id,
    kind: 'lamp',
    source: 'campus',
    sourceKind,
    frame: localFrame,
    center: Object.freeze({ x: center.x, z: center.z }),
    head: Object.freeze({
      x: head.x,
      y: CAMPUS_NIGHT_LAMP_POLICY.height + 0.055,
      z: head.z
    }),
    side,
    // Half width of the paved band (road plus any slide across its curb/sidewalk) this lamp serves.
    corridorHalfWidth,
    poleLateralOffset,
    headLateralOffset: Math.max(0, poleLateralOffset - 0.88),
    placement,
    slide,
    shift,
    height: CAMPUS_NIGHT_LAMP_POLICY.height
  });
}

function sampleSegments(segments, {
  spacing,
  offset,
  max,
  sourceKind,
  start,
  endMargin
}, lamps, stats) {
  let accepted = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length && accepted < max; segmentIndex++) {
    const segment = segments[segmentIndex];
    const width = segmentWidth(segment);
    const samples = candidateUs(segment.frame.length, spacing, { start, endMargin });
    for (let sampleIndex = 0; sampleIndex < samples.length && accepted < max; sampleIndex++) {
      const preferredSide = (segmentIndex + sampleIndex) % 2 === 0 ? -1 : 1;
      stats.candidates++;
      const anchor = resolveAnchor(segment, samples[sampleIndex], preferredSide, offset, lamps, stats);
      if (!anchor) continue;
      const placement = anchor.flipped ? 'swapped-side'
        : anchor.shift ? 'shifted'
          : anchor.slide ? 'slid' : 'direct';
      if (anchor.flipped) stats.swappedSide++;
      else if (anchor.shift) stats.shifted++;
      else if (anchor.slide) stats.slid++;
      else stats.direct++;
      lamps.push(createLamp({
        id: `campus_night_${sourceKind}_${segment.id}_${sampleIndex}`,
        sourceKind,
        localFrame: frameAt(segment.frame, anchor.u, anchor.side * anchor.lateral),
        side: anchor.side,
        corridorHalfWidth: width / 2 + anchor.slide,
        poleLateralOffset: anchor.lateral,
        placement,
        slide: anchor.slide,
        shift: anchor.shift
      }));
      accepted++;
    }
  }
}

// Corner fallback: a junction / entrance with no lamp inside its radius gets one on the nearest
// valid pole position around it (curb corners), head overhanging toward the anchor.
function ensureJunctionCoverage(lamps, stats) {
  const policy = CAMPUS_NIGHT_LAMP_POLICY;
  let accepted = 0;
  for (const junction of MAIN_GATE_JUNCTIONS) {
    const { center, radius: junctionRadius } = junction;
    if (lamps.some(lamp => Math.hypot(lamp.center.x - center.x, lamp.center.z - center.z) <= junctionRadius)) continue;
    if (accepted >= policy.maxJunctionLamps) {
      stats.unlitAnchors.push(junction.id);
      continue;
    }
    let best = null;
    for (let radius = 4.5; radius <= junctionRadius - 0.5; radius += 0.75) {
      for (let angle = 0; angle < 360; angle += 15) {
        const a = angle * Math.PI / 180;
        const point = { x: center.x + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius };
        if (!isCampusLampPoleClear(point) || !farEnough(point, lamps)) continue;
        const cost = Math.abs(radius - 6) + angle * 1e-4;
        if (!best || cost < best.cost) best = { cost, point, radius };
      }
    }
    if (!best) {
      stats.unlitAnchors.push(junction.id);
      continue;
    }
    const dx = (center.x - best.point.x) / best.radius;
    const dz = (center.z - best.point.z) / best.radius;
    const localFrame = frameAt(roadFrame(best.point, { x: best.point.x + dz, z: best.point.z - dx }), 0, 0);
    lamps.push(createLamp({
      id: `campus_night_junction_${junction.id}`,
      sourceKind: 'junction',
      localFrame,
      side: -1,
      corridorHalfWidth: best.radius - policy.roadsideOffset,
      poleLateralOffset: best.radius,
      placement: 'corner'
    }));
    stats.anchorLamps++;
    accepted++;
  }
}

const MAJOR_ROAD_SEGMENTS = Object.freeze(
  GATE_DORM_SEGMENTS.filter(segment => GATE_DORM_ROADS.includes(segment.road))
);
const MAJOR_PATH_SEGMENTS = Object.freeze(
  GATE_DORM_SEGMENTS.filter(segment =>
    GATE_DORM_PATHS.includes(segment.road) && !/sidewalk/.test(segment.road.id))
);

export function analyzeCampusNightLampLayout() {
  const lamps = [];
  const stats = createStats();
  const policy = CAMPUS_NIGHT_LAMP_POLICY;
  // Authored Main Gate corridors first: they have no generic-cap competition and own the
  // Sosung-ro frontage that fronts Dormitory 1.
  sampleSegments(MAJOR_ROAD_SEGMENTS, {
    spacing: policy.majorRoadSpacing,
    offset: policy.roadsideOffset,
    max: policy.maxMajorRoadLamps,
    sourceKind: 'gate-road',
    start: 5.5,
    endMargin: 4
  }, lamps, stats);
  sampleSegments(MAJOR_PATH_SEGMENTS, {
    spacing: policy.pathSpacing,
    offset: policy.pathOffset,
    max: policy.maxMajorPathLamps,
    sourceKind: 'gate-path'
  }, lamps, stats);
  sampleSegments(ROAD_SEGMENTS, {
    spacing: policy.roadSpacing,
    offset: policy.roadsideOffset,
    max: policy.maxRoadLamps,
    sourceKind: 'road'
  }, lamps, stats);
  sampleSegments(CAMPUS_PATH_SEGMENTS, {
    spacing: policy.pathSpacing,
    offset: policy.pathOffset,
    max: policy.maxPathLamps,
    sourceKind: 'path'
  }, lamps, stats);
  ensureJunctionCoverage(lamps, stats);
  return Object.freeze({ lamps: Object.freeze(lamps), stats: Object.freeze(stats) });
}

export function buildCampusNightLampLayout() {
  return analyzeCampusNightLampLayout().lamps;
}

const generated = analyzeCampusNightLampLayout();
export const CAMPUS_NIGHT_LAMPS = generated.lamps;
export const CAMPUS_NIGHT_LAMP_STATS = generated.stats;
