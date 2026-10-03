import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
import {
  NIGHT_LIGHT_BUDGET,
  NIGHT_LIGHT_MAX_DISTANCE,
  lampHeadPosition,
  nearestNightLampIndices,
  nightLightBudget
} from '../src/environment/night-street-lights.js';

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

test('P2 graphics budgets keep mobile LOW emissive-only and cap real omni lights', () => {
  assert.deepEqual(NIGHT_LIGHT_BUDGET, { low: 0, medium: 2, high: 4 });
  assert.equal(nightLightBudget('low'), 0);
  assert.equal(nightLightBudget('medium'), 2);
  assert.equal(nightLightBudget('high'), 4);
  assert.equal(nightLightBudget('unknown'), 2);
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
  assert.equal(environment.artificialLightFactor(), 0.18);

  environment.setTimeOfDay('NIGHT');
  environment.update(2);
  assert.equal(environment.status().progress, 0.5);
  assert.ok(environment.artificialLightFactor() > 0.18 && environment.artificialLightFactor() < 1);

  environment.update(2);
  assert.equal(environment.artificialLightFactor(), 1);
  assert.equal(environment.status().artificialLightFactor, 1);

  environment.setTimeOfDay('DAY', { immediate: true });
  assert.equal(environment.artificialLightFactor(), 0);
});
