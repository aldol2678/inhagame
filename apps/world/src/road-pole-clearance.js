// Shared "is this pole standing on a rendered road surface?" test for roadside props
// (night lamps, traffic signals). Every OSM road, campus path, authored Main Gate corridor
// (roads, sidewalks, crossings) and the gate forecourt counts as a rendered surface.
import { SITE_FEATURES } from './basic-campus.js';
import { CAMPUS_PATH_WIDTHS, ROAD_SEGMENTS, distanceToRoad, roadFrame } from './campus-road-layout.js';
import { GATE_DORM_SEGMENTS } from './main-gate-road-layout.js';
import { gateForecourtTreeClear } from './main-gate-forecourt.js';

export const ROAD_POLE_CLEARANCE = 0.18;

export const CAMPUS_PATH_SEGMENTS = Object.freeze(SITE_FEATURES
  .filter(feature => feature.kind === 'path')
  .flatMap(feature => feature.vertices.slice(1).map((point, index) => ({
    id: `${feature.id}_${index}`,
    frame: roadFrame(feature.vertices[index], point),
    width: CAMPUS_PATH_WIDTHS[feature.id] || 3.5,
    kind: 'path'
  }))));

export const RENDERED_CORRIDOR_SEGMENTS = Object.freeze([
  ...ROAD_SEGMENTS,
  ...CAMPUS_PATH_SEGMENTS,
  ...GATE_DORM_SEGMENTS
]);

export function segmentWidth(segment) {
  return Number(segment.road?.width ?? segment.width ?? 3.5);
}

export function outsideRenderedCorridors(point, clearance = ROAD_POLE_CLEARANCE) {
  if (!gateForecourtTreeClear(point, clearance)) return false;
  return RENDERED_CORRIDOR_SEGMENTS.every(segment =>
    distanceToRoad(point, segment) > segmentWidth(segment) / 2 + clearance
  );
}
