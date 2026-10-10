import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceToRoad } from '../src/campus-road-layout.js';
import { gateForecourtTreeClear } from '../src/main-gate-forecourt.js';
import {
  GATE_DORM_CROSSINGS,
  GATE_DORM_SEGMENTS,
  MAIN_GATE_APPROACH_ROAD,
  SOSUNG_RO
} from '../src/main-gate-road-layout.js';
import {
  ROAD_POLE_CLEARANCE,
  RENDERED_CORRIDOR_SEGMENTS,
  segmentWidth
} from '../src/road-pole-clearance.js';
import { TRAFFIC_SIGNAL_INTERSECTION } from '../src/traffic-signal-layout.js';

const poles = TRAFFIC_SIGNAL_INTERSECTION.poles;
const heads = pole => [pole.vehicle?.arm, pole.pedestrian?.head].filter(Boolean);

test('the Main Gate junction has vehicle and pedestrian signals on every crossing', () => {
  assert.equal(TRAFFIC_SIGNAL_INTERSECTION.id, 'main_gate_sosung');
  const vehicleGroups = new Set(poles.filter(pole => pole.vehicle).map(pole => pole.vehicle.group));
  assert.deepEqual([...vehicleGroups].sort(), ['A', 'B']);
  for (const crossing of GATE_DORM_CROSSINGS) {
    const onCrossing = poles.filter(pole => pole.pedestrian?.crossingId === crossing.id);
    assert.equal(onCrossing.length, 2, `${crossing.id} needs a pedestrian head for each landing`);
    assert.ok(onCrossing.every(pole => pole.vehicle?.group === 'A'), `${crossing.id} poles also face Sosung-ro traffic`);
  }
  assert.ok(poles.some(pole => pole.vehicle?.group === 'B' && pole.id === 'main_gate_approach_exit'));
  assert.equal(poles.length, 5);
});

test('signal ids are unique and every pole stands off all rendered road surfaces', () => {
  const ids = poles.map(pole => pole.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate signal id');
  const clearance = ROAD_POLE_CLEARANCE - 1e-8;
  for (const pole of poles) {
    assert.ok(gateForecourtTreeClear(pole.pole, clearance), `${pole.id} is inside the forecourt`);
    for (const segment of RENDERED_CORRIDOR_SEGMENTS) {
      assert.ok(
        distanceToRoad(pole.pole, segment) > segmentWidth(segment) / 2 + clearance,
        `${pole.id} must stay clear of ${segment.id}`
      );
    }
    // Explicitly: never on Sosung-ro / approach asphalt or on a zebra crossing.
    for (const segment of GATE_DORM_SEGMENTS.filter(s =>
      [SOSUNG_RO, MAIN_GATE_APPROACH_ROAD, ...GATE_DORM_CROSSINGS].includes(s.road))) {
      assert.ok(distanceToRoad(pole.pole, segment) > segment.road.width / 2, `${pole.id} on ${segment.id}`);
    }
  }
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i].pole, b = poles[j].pole;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3, `${poles[i].id} and ${poles[j].id} overlap`);
    }
  }
});

test('signal heads have finite positions and unit-length facing with matching yaw', () => {
  for (const pole of poles) {
    assert.ok(Number.isFinite(pole.pole.x) && Number.isFinite(pole.pole.z) && pole.height > 2);
    assert.ok(heads(pole).length >= 1, `${pole.id} carries no head`);
    for (const head of heads(pole)) {
      for (const value of [head.position.x, head.position.y, head.position.z, head.facing.x, head.facing.z, head.yaw]) {
        assert.ok(Number.isFinite(value), `${pole.id} has a non-finite head value`);
      }
      assert.ok(Math.abs(Math.hypot(head.facing.x, head.facing.z) - 1) < 1e-9);
      assert.ok(Math.abs(head.yaw + Math.atan2(head.facing.z, head.facing.x) * 180 / Math.PI) < 1e-9);
      assert.ok(head.position.y < pole.height + 0.2);
    }
  }
});

test('vehicle heads look at oncoming traffic and pedestrian heads look across the road', () => {
  const sosung = SOSUNG_RO.vertices;
  const along = (() => {
    const length = Math.hypot(sosung.at(-1).x - sosung[0].x, sosung.at(-1).z - sosung[0].z);
    return { x: (sosung.at(-1).x - sosung[0].x) / length, z: (sosung.at(-1).z - sosung[0].z) / length };
  })();
  for (const pole of poles.filter(item => item.vehicle?.group === 'A')) {
    const dot = pole.vehicle.arm.facing.x * along.x + pole.vehicle.arm.facing.z * along.z;
    assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-6, `${pole.id} vehicle head must face along Sosung-ro`);
    assert.ok(pole.vehicle.direction === 'forward' ? dot < 0 : dot > 0, `${pole.id} must face its oncoming direction`);
    const ped = pole.pedestrian.head.facing;
    assert.ok(Math.abs(ped.x * along.x + ped.z * along.z) < 1e-6, `${pole.id} pedestrian head must face across the road`);
    // The pedestrian head looks at the road centreline from its own side.
    const sideOfRoad = (pole.pole.x - sosung[0].x) * -along.z + (pole.pole.z - sosung[0].z) * along.x;
    assert.ok(sideOfRoad * (ped.x * -along.z + ped.z * along.x) < 0, `${pole.id} pedestrian head faces away from the road`);
  }
});
