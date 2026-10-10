// Presentation-only P0 surface lookup. Reuse rendered footprints, never a Place Zone
// as a blanket material. Unmapped outdoor paving keeps the conservative hard fallback.
import { SITE_FEATURES } from '../basic-campus.js';
import { CAMPUS_PATH_WIDTHS, ROAD_SEGMENTS, roadFrame, distanceToRoad } from '../campus-road-layout.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { polygonOverlap } from '../polygon-collision.js';
import { PERSONAL_ROOM_BASIC_FURNITURE } from '../rooms/personal-room-layout.js';
import { CLUB_ROOM_FURNITURE } from '../rooms/club-room-layout.js';
import { ROOMS } from '../rooms/room-registry.js';

const lawns = SITE_FEATURES.filter(feature => feature.kind === 'lawn');
const paths = SITE_FEATURES.filter(feature => feature.kind === 'path').flatMap(feature =>
  feature.vertices.slice(1).map((end, index) => ({
    frame: roadFrame(feature.vertices[index], end),
    road: { width: CAMPUS_PATH_WIDTHS[feature.id] ?? 3.5, shoulder: 1.05 }
  })));
const paved = [...ROAD_SEGMENTS, ...GATE_DORM_SEGMENTS, ...paths];
const rugs = new Map([
  ['ROOM_PERSONAL_BASIC', PERSONAL_ROOM_BASIC_FURNITURE.filter(item => item.kind === 'rug')],
  ['ROOM_CLUBHOUSE_01', CLUB_ROOM_FURNITURE.filter(item => item.kind === 'rug')]
]);

export function resolveFootstepSurface({ space = 'campus', position } = {}) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  if (Object.hasOwn(ROOMS, space)) {
    const soft = rugs.get(space)?.some(item =>
      Math.abs(position.x - item.at[0]) <= item.size[0] / 2 &&
      Math.abs(position.z - item.at[2]) <= item.size[2] / 2);
    return soft ? 'indoor-soft' : 'indoor-hard';
  }
  if (space !== 'campus') return null;
  if (!lawns.some(lawn => polygonOverlap(position.x, position.z, lawn.vertices))) return 'hard-outdoor';
  if (paved.some(segment => distanceToRoad(position, segment) <= segment.road.width / 2 + (segment.road.shoulder ?? 0))) return 'hard-outdoor';
  return 'soft-outdoor';
}

export function resolveDoorCue(from, to) {
  if (from === to || ![from, to].every(space => space === 'campus' || Object.hasOwn(ROOMS, space))) return null;
  const room = to === 'campus' || from === 'ROOM_PERSONAL_BASIC' ? from : to;
  const family = room === 'ROOM_PERSONAL_BASIC' || room === 'ROOM_CLUBHOUSE_01' ? 'wood'
    : room === 'ROOM_DORM1_LOBBY' ? 'glass' : 'threshold';
  return { kind: 'door', family, direction: to === 'campus' || from === 'ROOM_PERSONAL_BASIC' ? 'exit' : 'enter' };
}
