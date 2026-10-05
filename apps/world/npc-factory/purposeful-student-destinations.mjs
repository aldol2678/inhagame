import { MAIN_ENTRANCE } from '../src/basic-campus.js';
import { LANDMARKS } from '../src/campus-layout.js';
import { studentCenterFrontPoint } from '../src/student-center-front.js';
import { SEAT_ANCHORS } from '../src/seat-anchors.js';

// Existing map POI IDs, with walkable outdoor anchors instead of collider interiors.
export function campusStudentDestinations() {
  const seat = SEAT_ANCHORS.find(item => item.id === 'SEAT_INKYUNG_TREE_1_A');
  if (!seat) throw new Error('Campus student POI anchors unavailable');
  return Object.freeze({
    'poi.main-gate': { type: 'GATE', label: '정문', position: { x: LANDMARKS.gate.x, z: LANDMARKS.gate.z } },
    'poi.main-hall': { type: 'ACADEMIC', label: '본관 앞', position: { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z } },
    'poi.student-center': { type: 'FOOD', label: '학생회관 앞', position: { ...studentCenterFrontPoint() } },
    'seat.inkyung-tree-1-a': { type: 'REST', label: '인경호 나무 벤치',
      position: { x: seat.standPoint.x, z: seat.standPoint.z }, seat }
  });
}
