import test from 'node:test';
import assert from 'node:assert/strict';
import { DORM_1_ENTRANCE } from '../src/dorm1-layout.js';
import { distanceToRoad } from '../src/campus-road-layout.js';
import {
  CAMPUS_NIGHT_LAMPS,
  CAMPUS_NIGHT_LAMP_POLE_CLEARANCE,
  CAMPUS_NIGHT_LAMP_POLICY,
  CAMPUS_NIGHT_LAMP_STATS,
  analyzeCampusNightLampLayout,
  isCampusLampPoleClear
} from '../src/environment/night-campus-lamp-layout.js';
import { NIGHT_LIGHT_BUDGET } from '../src/environment/night-street-light-policy.js';
import { MAIN_GATE_JUNCTIONS } from '../src/main-gate-junctions.js';
import { gateForecourtTreeClear } from '../src/main-gate-forecourt.js';
import {
  GATE_DORM_SEGMENTS,
  MAIN_GATE_APPROACH_ROAD,
  SOSUNG_RO
} from '../src/main-gate-road-layout.js';
import {
  RENDERED_CORRIDOR_SEGMENTS,
  outsideRenderedCorridors,
  segmentWidth
} from '../src/road-pole-clearance.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const gateSegments = road => GATE_DORM_SEGMENTS.filter(segment => segment.road === road);
const nearRoad = (road, limit) => CAMPUS_NIGHT_LAMPS.filter(lamp =>
  gateSegments(road).some(segment => distanceToRoad(lamp.center, segment) <= limit));

// Baseline before #261 tightened pole clearance: 63 lamps (41 road + 22 path), none from the
// authored Main Gate corridors. The restored layout must not fall back below it.
const PRE_261_LAMP_COUNT = 63;

test('lamp retention: the campus keeps at least its pre-#261 lamp count', () => {
  assert.ok(CAMPUS_NIGHT_LAMPS.length >= PRE_261_LAMP_COUNT, `got ${CAMPUS_NIGHT_LAMPS.length}`);
  const generic = CAMPUS_NIGHT_LAMPS.filter(lamp => lamp.sourceKind === 'road' || lamp.sourceKind === 'path');
  assert.ok(generic.length >= 58, `generic road/path lamps collapsed to ${generic.length}`);
  assert.ok(CAMPUS_NIGHT_LAMPS.some(lamp => lamp.sourceKind === 'road'));
  assert.ok(CAMPUS_NIGHT_LAMPS.some(lamp => lamp.sourceKind === 'path'));
});

test('lamp retention: blocked candidates are re-anchored before they are rejected', () => {
  const { candidates, rejected, slid, shifted } = CAMPUS_NIGHT_LAMP_STATS;
  assert.ok(candidates > 0);
  assert.ok(slid + shifted > 0, 'at least one blocked candidate must be recovered by sliding');
  assert.ok(rejected / candidates < 0.15, `${rejected}/${candidates} candidates were rejected outright`);
  assert.deepEqual(CAMPUS_NIGHT_LAMP_STATS.unlitAnchors, []);
  const again = analyzeCampusNightLampLayout();
  assert.deepEqual(
    again.lamps.map(lamp => [lamp.id, lamp.center.x, lamp.center.z]),
    CAMPUS_NIGHT_LAMPS.map(lamp => [lamp.id, lamp.center.x, lamp.center.z]),
    're-anchoring must be deterministic'
  );
});

test('re-anchored lamps only exist where the nominal roadside spot was actually blocked', () => {
  const moved = CAMPUS_NIGHT_LAMPS.filter(lamp => lamp.slide > 0 || lamp.shift !== 0);
  assert.ok(moved.length > 0);
  for (const lamp of moved) {
    if (lamp.slide > 0 && lamp.shift === 0) {
      const nominal = lamp.frame.at(0, -lamp.side * lamp.slide);
      assert.ok(!isCampusLampPoleClear(nominal), `${lamp.id} slid although its nominal spot was clear`);
    }
    assert.ok(lamp.slide <= CAMPUS_NIGHT_LAMP_POLICY.maxSlide + 1e-9, `${lamp.id} slid too deep into the lawn`);
    assert.ok(Math.abs(lamp.shift) <= CAMPUS_NIGHT_LAMP_POLICY.maxShift + 1e-9);
    assert.ok(lamp.poleLateralOffset > lamp.corridorHalfWidth);
    assert.ok(lamp.headLateralOffset < lamp.corridorHalfWidth);
  }
});

test('Sosung-ro frontage in front of Dormitory 1 is lit on both sides at ~22 m rhythm', () => {
  const lamps = nearRoad(SOSUNG_RO, 12);
  assert.ok(lamps.length >= 8, `Sosung-ro frontage has only ${lamps.length} lamps`);
  const segment = gateSegments(SOSUNG_RO)[0];
  const lateral = lamp => {
    const a = segment.frame.at(0), b = segment.frame.at(1);
    const t = { x: b.x - a.x, z: b.z - a.z };
    return (lamp.center.x - a.x) * -t.z + (lamp.center.z - a.z) * t.x;
  };
  assert.ok(lamps.some(lamp => lateral(lamp) > 0), 'north side must be lit');
  assert.ok(lamps.some(lamp => lateral(lamp) < 0), 'south (dormitory) side must be lit');
  const along = lamp => {
    const a = segment.frame.at(0), b = segment.frame.at(1);
    return (lamp.center.x - a.x) * (b.x - a.x) + (lamp.center.z - a.z) * (b.z - a.z);
  };
  const sorted = lamps.map(along).sort((x, y) => x - y);
  // Largest dark stretch along the frontage stays under ~44 m (22 WU) of road.
  const gaps = sorted.slice(1).map((value, index) => value - sorted[index]);
  assert.ok(Math.max(...gaps) <= 22, `dark stretch of ${Math.max(...gaps).toFixed(1)} WU on Sosung-ro`);
});

test('Main Gate approach and Dormitory 1 entrance are never left dark', () => {
  assert.ok(nearRoad(MAIN_GATE_APPROACH_ROAD, 14).length >= 2, 'gate approach needs lamps');
  const entrance = DORM_1_ENTRANCE.position;
  assert.ok(
    CAMPUS_NIGHT_LAMPS.some(lamp => distance(lamp.center, entrance) <= 12),
    'Dormitory 1 entrance needs a lamp within 24 m'
  );
});

test('every Main Gate / dormitory junction keeps a valid lamp within its radius', () => {
  assert.ok(MAIN_GATE_JUNCTIONS.length >= 5);
  for (const junction of MAIN_GATE_JUNCTIONS) {
    const lit = CAMPUS_NIGHT_LAMPS.filter(lamp => distance(lamp.center, junction.center) <= junction.radius);
    assert.ok(lit.length >= 1, `${junction.id} has no lamp within ${junction.radius} WU`);
  }
});

test('every lamp pole is off all asphalt, sidewalks, crossings and the forecourt', () => {
  const clearance = CAMPUS_NIGHT_LAMP_POLE_CLEARANCE - 1e-8;
  for (const lamp of CAMPUS_NIGHT_LAMPS) {
    assert.ok(gateForecourtTreeClear(lamp.center, clearance), `${lamp.id} is inside the forecourt`);
    assert.ok(outsideRenderedCorridors(lamp.center, clearance), `${lamp.id} stands on a rendered corridor`);
    for (const segment of RENDERED_CORRIDOR_SEGMENTS) {
      assert.ok(
        distanceToRoad(lamp.center, segment) > segmentWidth(segment) / 2 + clearance,
        `${lamp.id} must stay clear of ${segment.id}`
      );
    }
    assert.ok(Number.isFinite(lamp.frame.yaw), lamp.id);
    assert.ok(Number.isFinite(lamp.head.x) && Number.isFinite(lamp.head.z), lamp.id);
  }
});

test('re-anchoring does not enlarge the real omni light pool', () => {
  assert.deepEqual(NIGHT_LIGHT_BUDGET, { low: 3, medium: 6, high: 10 });
});
