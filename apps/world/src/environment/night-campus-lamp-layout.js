import { BUILDINGS, SITE_FEATURES } from '../basic-campus.js';
import { FACILITY_COLLIDERS } from '../campus-facilities.js';
import {
  CAMPUS_PATH_WIDTHS,
  ROAD_SEGMENTS,
  roadFrame
} from '../campus-road-layout.js';
import { polygonOverlap } from '../polygon-collision.js';

export const CAMPUS_NIGHT_LAMP_POLICY = Object.freeze({
  roadSpacing: 22,
  pathSpacing: 18,
  roadsideOffset: 0.72,
  pathOffset: 0.58,
  minGap: 10.5,
  height: 4.45,
  maxRoadLamps: 42,
  maxPathLamps: 22
});

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

function pathSegments() {
  return SITE_FEATURES
    .filter(feature => feature.kind === 'path')
    .flatMap(feature => feature.vertices.slice(1).map((point, index) => ({
      id: `${feature.id}_${index}`,
      frame: roadFrame(feature.vertices[index], point),
      width: CAMPUS_PATH_WIDTHS[feature.id] || 3.5,
      kind: 'path'
    })));
}

function candidateUs(length, spacing) {
  if (!(length > 4)) return [];
  if (length < 14) return [length / 2];
  const result = [];
  for (let u = 7; u <= length - 5; u += spacing) result.push(u);
  if (!result.length) result.push(length / 2);
  return result;
}

function isClear(point) {
  return obstacles.every(obstacle => !polygonOverlap(point.x, point.z, obstacle.polygon, 0.28));
}

function farEnough(point, lamps) {
  const min = CAMPUS_NIGHT_LAMP_POLICY.minGap;
  return lamps.every(lamp => Math.hypot(point.x - lamp.center.x, point.z - lamp.center.z) >= min);
}

function sampleSegments(segments, {
  spacing,
  offset,
  max,
  sourceKind
}, lamps) {
  let accepted = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length && accepted < max; segmentIndex++) {
    const segment = segments[segmentIndex];
    const width = Number(segment.road?.width ?? segment.width ?? 3.5);
    const sideOffset = width / 2 + offset;
    const samples = candidateUs(segment.frame.length, spacing);
    for (let sampleIndex = 0; sampleIndex < samples.length && accepted < max; sampleIndex++) {
      const side = (segmentIndex + sampleIndex) % 2 === 0 ? -1 : 1;
      const localFrame = frameAt(segment.frame, samples[sampleIndex], side * sideOffset);
      const center = localFrame.at(0);
      if (!isClear(center) || !farEnough(center, lamps)) continue;
      const head = localFrame.at(0, -side * 0.88);
      const id = `campus_night_${sourceKind}_${segment.id}_${sampleIndex}`;
      lamps.push(Object.freeze({
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
        height: CAMPUS_NIGHT_LAMP_POLICY.height
      }));
      accepted++;
    }
  }
}

export function buildCampusNightLampLayout() {
  const lamps = [];
  sampleSegments(ROAD_SEGMENTS, {
    spacing: CAMPUS_NIGHT_LAMP_POLICY.roadSpacing,
    offset: CAMPUS_NIGHT_LAMP_POLICY.roadsideOffset,
    max: CAMPUS_NIGHT_LAMP_POLICY.maxRoadLamps,
    sourceKind: 'road'
  }, lamps);
  sampleSegments(pathSegments(), {
    spacing: CAMPUS_NIGHT_LAMP_POLICY.pathSpacing,
    offset: CAMPUS_NIGHT_LAMP_POLICY.pathOffset,
    max: CAMPUS_NIGHT_LAMP_POLICY.maxPathLamps,
    sourceKind: 'path'
  }, lamps);
  return Object.freeze(lamps);
}

export const CAMPUS_NIGHT_LAMPS = buildCampusNightLampLayout();
