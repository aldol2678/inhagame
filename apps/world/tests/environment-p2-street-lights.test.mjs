import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
import {
  CAMPUS_NIGHT_LAMP_POLE_CLEARANCE,
  CAMPUS_NIGHT_LAMPS
} from '../src/environment/night-campus-lamp-layout.js';
import { ROAD_SEGMENTS, distanceToRoad } from '../src/campus-road-layout.js';
import { GATE_DORM_SEGMENTS } from '../src/main-gate-road-layout.js';
import { gateForecourtTreeClear } from '../src/main-gate-forecourt.js';
import {
  NIGHT_LIGHT_BUDGET,
  NIGHT_LIGHT_MAX_DISTANCE,
  NIGHT_LIGHT_OMNI_RANGE,
  lampArmLayout,
  lampHeadPosition,
  lampPolePosition,
  nearestNightLampIndices,
  nightLightBudget
} from '../src/environment/night-street-light-policy.js';

class FakeColor {
  constructor() { this.values = [0, 0, 0]; }
  set(r, g, b) { this.values[0] = r; this.values[1] = g; this.values[2] = b; }
}

function environmentFixture(initialTime = 'DAY', transitionSeconds = 4) {
  const scene = { ambientLight: new FakeColor(), exposure: 0 };
  const lightEntity = {
    light: {
      color: new FakeColor(),
      intensity: 0,
      shadowIntensity: 0,
      castShadows: true,
      shadowResolution: 1024,
      shadowDistance: 75
    },
    setEulerAngles() {}
  };
  const camera = { camera: { clearColor: new FakeColor() } };
  return createEnvironmentDirector({ scene, lightEntity, camera, initialTime, transitionSeconds });
}

const frame = (x, z, yaw = 0) => ({
  yaw,
  at(u, v = 0) { return { x: x + u, z: z + v }; }
});

const segmentWidth = segment => Number(segment.road?.width ?? segment.width ?? 3.5);

test('night graphics budgets keep real omni lights bounded while giving every tier local illumination', () => {
  assert.deepEqual(NIGHT_LIGHT_BUDGET, { low: 3, medium: 6, high: 10 });
  assert.equal(nightLightBudget('low'), 3);
  assert.equal(nightLightBudget('medium'), 6);
  assert.equal(nightLightBudget('high'), 10);
  assert.equal(nightLightBudget('unknown'), 6);
});

test('night light coverage reaches adjacent lamp spacing without unbounded mobile light counts', () => {
  assert.equal(NIGHT_LIGHT_MAX_DISTANCE, 68);
  assert.equal(NIGHT_LIGHT_OMNI_RANGE, 16.5);
  assert.ok(NIGHT_LIGHT_OMNI_RANGE * 2 > 22, 'road-lamp pools overlap the 22 WU nominal road spacing');
  assert.ok(NIGHT_LIGHT_BUDGET.low <= 3 && NIGHT_LIGHT_BUDGET.high <= 10, 'real omni pool remains tightly bounded');
});

test('generated campus lamp poles stay outside road/path surfaces while heads overhang inward', () => {
  assert.ok(CAMPUS_NIGHT_LAMPS.length > 0);
  for (const lamp of CAMPUS_NIGHT_LAMPS) {
    assert.deepEqual(lampPolePosition(lamp), lamp.center, lamp.id);
    assert.ok(lamp.poleLateralOffset > lamp.corridorHalfWidth, `${lamp.id} pole must sit beyond corridor edge`);
    assert.ok(lamp.headLateralOffset < lamp.corridorHalfWidth, `${lamp.id} lamp head should overhang the corridor`);
    const arm = lampArmLayout(lamp);
    assert.ok(Math.abs(arm.length - 0.88) < 1e-8, `${lamp.id} arm spans pole to head`);
    assert.ok(Number.isFinite(arm.yaw));
  }
});

test('generated campus lamp poles avoid intersecting campus roads and authored main-gate corridors', () => {
  const clearance = CAMPUS_NIGHT_LAMP_POLE_CLEARANCE - 1e-8;
  const corridors = [...ROAD_SEGMENTS, ...GATE_DORM_SEGMENTS];
  for (const lamp of CAMPUS_NIGHT_LAMPS) {
    assert.ok(gateForecourtTreeClear(lamp.center, clearance), `${lamp.id} must stay outside the main-gate forecourt`);
    for (const segment of corridors) {
      assert.ok(
        distanceToRoad(lamp.center, segment) > segmentWidth(segment) / 2 + clearance,
        `${lamp.id} must stay clear of ${segment.id}`
      );
    }
  }
});

test('lamp head follows the observed roadside LED head offset and height', () => {
  const lamp = { frame: frame(10, 20, 35), side: 1, height: 4.6 };
  const first = lampHeadPosition(lamp);
  assert.equal(first.x, 10);
  assert.ok(Math.abs(first.y - 4.655) < 1e-9);
  assert.ok(Math.abs(first.z - 19.07) < 1e-9);
  const opposite = { frame: frame(-5, 7), side: -1, height: 4.6 };
  const second = lampHeadPosition(opposite);
  assert.equal(second.x, -5);
  assert.ok(Math.abs(second.y - 4.655) < 1e-9);
  assert.ok(Math.abs(second.z - 7.93) < 1e-9);
});

test('nearest real-light selection is deterministic, distance bounded, and budget bounded', () => {
  const lamps = [
    { head: { x: 5, y: 4, z: 0 } },
    { head: { x: 2, y: 4, z: 0 } },
    { head: { x: 2, y: 4, z: 2 } },
    { head: { x: NIGHT_LIGHT_MAX_DISTANCE + 1, y: 4, z: 0 } }
  ];
  assert.deepEqual(nearestNightLampIndices(lamps, { x: 0, z: 0 }, 2), [1, 2]);
  assert.deepEqual(nearestNightLampIndices(lamps, { x: 0, z: 0 }, 99), [1, 2, 0]);
  assert.deepEqual(nearestNightLampIndices(lamps, { x: 0, z: 0 }, 0), []);
  assert.deepEqual(nearestNightLampIndices(lamps, null, 4), []);
});

test('time-of-day interpolation provides a scalar artificial-light signal without changing graphics ownership', () => {
  const environment = environmentFixture('DAY', 4);
  assert.equal(environment.artificialLightFactor(), 0);
  assert.equal(environment.status().artificialLightFactor, 0);

  environment.setTimeOfDay('SUNSET', { immediate: true });
  assert.equal(environment.artificialLightFactor(), 0.22);

  environment.setTimeOfDay('NIGHT');
  environment.update(2);
  assert.equal(environment.status().progress, 0.5);
  assert.ok(environment.artificialLightFactor() > 0.22 && environment.artificialLightFactor() < 1);

  environment.update(2);
  assert.equal(environment.artificialLightFactor(), 1);
  assert.equal(environment.status().artificialLightFactor, 1);

  environment.setTimeOfDay('DAY', { immediate: true });
  assert.equal(environment.artificialLightFactor(), 0);
});
