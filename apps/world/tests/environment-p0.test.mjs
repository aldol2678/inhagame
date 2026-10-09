import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENT_TIME,
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_TIME,
  environmentPreset,
  resolveEnvironmentTime
} from '../src/environment/environment-presets.js';
import { resolveEnvironmentRuntimeTime } from '../src/environment/environment-clock.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';

class FakeColor {
  constructor() { this.values = [0, 0, 0]; }
  set(r, g, b) { this.values[0] = r; this.values[1] = g; this.values[2] = b; }
}

function fixture(initialTime = ENVIRONMENT_TIME.DAY, transitionSeconds = 4) {
  const scene = { ambientLight: new FakeColor(), exposure: 0 };
  const lightEntity = {
    light: {
      color: new FakeColor(),
      intensity: 0,
      shadowIntensity: 0,
      castShadows: false,
      shadowResolution: 512,
      shadowDistance: 50
    },
    euler: [0, 0, 0],
    setEulerAngles(x, y, z) { this.euler = [x, y, z]; }
  };
  const camera = { camera: { clearColor: new FakeColor() } };
  const director = createEnvironmentDirector({ scene, lightEntity, camera, initialTime, transitionSeconds });
  return { scene, lightEntity, camera, director };
}

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('environment presets expose bounded visual-phase values with DAY fail-safe', () => {
  assert.deepEqual(Object.keys(ENVIRONMENT_PRESETS), ['DAWN', 'DAY', 'GOLDEN_HOUR', 'SUNSET', 'DUSK', 'NIGHT']);
  for (const preset of Object.values(ENVIRONMENT_PRESETS)) {
    for (const tuple of [preset.sunColor, preset.ambientColor, preset.clearColor])
      for (const value of tuple) assert.ok(value >= 0 && value <= 1);
    assert.ok(preset.exposure > 0);
    assert.ok(preset.sunIntensity >= 0);
    assert.ok(preset.shadowIntensity >= 0 && preset.shadowIntensity <= 1);
  }
  assert.equal(resolveEnvironmentTime('sunset'), ENVIRONMENT_TIME.SUNSET);
  assert.equal(resolveEnvironmentTime(' NIGHT '), ENVIRONMENT_TIME.NIGHT);
  assert.equal(resolveEnvironmentTime('__invalid__'), DEFAULT_ENVIRONMENT_TIME);
  assert.strictEqual(environmentPreset('__invalid__'), ENVIRONMENT_PRESETS.DAY);
});

test('runtime query override is preview-only and invalid preview values fail safe to DAY', () => {
  const params = new URLSearchParams('envTime=night');
  assert.equal(resolveEnvironmentRuntimeTime(params, { previewHost: true }), ENVIRONMENT_TIME.NIGHT);
  assert.equal(resolveEnvironmentRuntimeTime(params, { previewHost: false }), ENVIRONMENT_TIME.DAY);
  assert.equal(resolveEnvironmentRuntimeTime(new URLSearchParams('envTime=wat'), { previewHost: true }), ENVIRONMENT_TIME.DAY);
  assert.equal(resolveEnvironmentRuntimeTime(new URLSearchParams(''), { previewHost: true }), ENVIRONMENT_TIME.DAY);
});

test('director applies initial profile immediately and interpolates without taking graphics-quality ownership', () => {
  const { scene, lightEntity, camera, director } = fixture();
  const day = ENVIRONMENT_PRESETS.DAY;
  assert.deepEqual(scene.ambientLight.values, day.ambientColor);
  assert.deepEqual(lightEntity.light.color.values, day.sunColor);
  assert.deepEqual(lightEntity.euler, day.sunEuler);
  assert.deepEqual(camera.camera.clearColor.values, day.clearColor);
  assert.equal(scene.exposure, day.exposure);

  const graphicsBefore = {
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  };

  assert.equal(director.setTimeOfDay('night'), ENVIRONMENT_TIME.NIGHT);
  assert.equal(director.status().settled, false);
  director.update(2);
  const night = ENVIRONMENT_PRESETS.NIGHT;
  near(scene.exposure, (day.exposure + night.exposure) / 2);
  near(lightEntity.light.intensity, (day.sunIntensity + night.sunIntensity) / 2);
  assert.equal(director.status().progress, 0.5);

  director.update(2);
  assert.equal(director.status().settled, true);
  assert.equal(director.status().targetTime, ENVIRONMENT_TIME.NIGHT);
  near(scene.exposure, night.exposure);
  assert.deepEqual(lightEntity.light.color.values, night.sunColor);
  assert.deepEqual(camera.camera.clearColor.values, night.clearColor);
  assert.deepEqual({
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  }, graphicsBefore);
});

test('director ignores negative/non-finite time and supports immediate preview switching', () => {
  const { director, scene } = fixture(ENVIRONMENT_TIME.SUNSET, 3);
  const start = scene.exposure;
  director.setTimeOfDay('night');
  director.update(-1);
  director.update(Number.NaN);
  assert.equal(scene.exposure, start);
  director.setTimeOfDay('day', { immediate: true });
  assert.equal(director.status().settled, true);
  assert.equal(director.status().targetTime, ENVIRONMENT_TIME.DAY);
  assert.equal(scene.exposure, ENVIRONMENT_PRESETS.DAY.exposure);
});
