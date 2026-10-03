import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_CLOUD_ALTITUDE,
  SKY_CLOUD_FIELD_RADIUS,
  SKY_CLOUD_PATCH_BUDGET,
  SKY_SUN_DIAMETER,
  SKY_SUN_DISTANCE,
  cloudVisualProfile,
  skyCloudFieldRadius,
  skyCloudLayout,
  skyCloudPatchBudget,
  sunDirectionFromEuler,
  sunVisualProfile
} from '../src/environment/sky-visual-policy.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';

class FakeColor {
  constructor() { this.values = [0, 0, 0]; }
  set(r, g, b) { this.values[0] = r; this.values[1] = g; this.values[2] = b; }
}

function environmentFixture(initialTime = 'DAY', initialWeather = 'CLEAR') {
  const scene = {
    ambientLight: new FakeColor(),
    exposure: 0,
    fog: { type: 'none', color: new FakeColor(), start: 1, end: 1000, density: 0 }
  };
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
  return createEnvironmentDirector({
    scene,
    lightEntity,
    camera,
    initialTime,
    initialWeather,
    transitionSeconds: 4,
    fogTransitionSeconds: 4
  });
}

const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('P5a sky budgets are tiny, tier-bounded, and keep sun inside far clip', () => {
  assert.deepEqual(SKY_CLOUD_PATCH_BUDGET, { low: 6, medium: 10, high: 16 });
  assert.deepEqual(SKY_CLOUD_FIELD_RADIUS, { low: 120, medium: 150, high: 180 });
  assert.equal(skyCloudPatchBudget('low'), 6);
  assert.equal(skyCloudPatchBudget('high'), 16);
  assert.equal(skyCloudPatchBudget('unknown'), 10);
  assert.equal(skyCloudFieldRadius('unknown'), 150);
  assert.ok(SKY_SUN_DISTANCE < 700);
  assert.ok(SKY_SUN_DIAMETER > 0);
});

test('cloud patch layout is deterministic and remains inside the bounded sky field', () => {
  for (const tier of ['low', 'medium', 'high']) {
    const a = skyCloudLayout(tier);
    const b = skyCloudLayout(tier);
    assert.deepEqual(a, b);
    assert.equal(a.length, SKY_CLOUD_PATCH_BUDGET[tier]);
    const radius = SKY_CLOUD_FIELD_RADIUS[tier];
    for (const patch of a) {
      assert.ok(Math.hypot(patch.x, patch.z) <= radius + 1e-9);
      assert.ok(patch.y >= SKY_CLOUD_ALTITUDE.min && patch.y <= SKY_CLOUD_ALTITUDE.max);
      assert.ok(patch.width > 0 && patch.depth > 0);
      assert.ok(patch.yaw >= 0 && patch.yaw <= 180);
    }
  }
});

test('sun direction is normalized and sunset lowers the visible sun toward the horizon', () => {
  const day = sunDirectionFromEuler([55, 30, 0]);
  const sunset = sunDirectionFromEuler([18, 35, 0]);
  near(Math.hypot(...day), 1);
  near(Math.hypot(...sunset), 1);
  assert.ok(day[1] > sunset[1]);
  assert.ok(day[1] > 0);
  assert.ok(sunset[1] > 0);
});

test('sun and clouds react to night and rain without creating a separate CLOUDY weather state', () => {
  const daySun = sunVisualProfile({
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    artificialLightFactor: 0,
    rainIntensity: 0
  });
  const rainSun = sunVisualProfile({
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    artificialLightFactor: 0,
    rainIntensity: 1
  });
  const nightSun = sunVisualProfile({
    sunColor: [0.38, 0.46, 0.68],
    sunIntensity: 0.35,
    artificialLightFactor: 1,
    rainIntensity: 0
  });
  assert.equal(daySun.visible, true);
  assert.equal(daySun.opacity, 1);
  assert.ok(rainSun.opacity < daySun.opacity);
  assert.equal(nightSun.visible, false);
  assert.equal(nightSun.opacity, 0);

  const clearCloud = cloudVisualProfile({
    sunColor: [1, 0.94, 0.81],
    artificialLightFactor: 0,
    rainIntensity: 0
  });
  const rainCloud = cloudVisualProfile({
    sunColor: [1, 0.94, 0.81],
    artificialLightFactor: 0,
    rainIntensity: 1
  });
  const nightCloud = cloudVisualProfile({
    sunColor: [0.38, 0.46, 0.68],
    artificialLightFactor: 1,
    rainIntensity: 0
  });
  assert.ok(rainCloud.opacity > clearCloud.opacity);
  assert.ok(rainCloud.color.every((value, i) => value < clearCloud.color[i]));
  assert.ok(nightCloud.color.every((value, i) => value < clearCloud.color[i]));
});

test('Environment exposes allocation-free interpolated sky state for the renderer', () => {
  const environment = environmentFixture();
  const out = {
    sunColor: [0, 0, 0],
    sunEuler: [0, 0, 0],
    sunIntensity: 0,
    artificialLightFactor: 0,
    rainIntensity: 0
  };
  assert.strictEqual(environment.copySkyVisualState(out), out);
  assert.deepEqual(out.sunEuler, [55, 30, 0]);
  assert.deepEqual(out.sunColor, [1, 0.94, 0.81]);
  assert.equal(out.artificialLightFactor, 0);
  assert.equal(out.rainIntensity, 0);

  environment.setTimeOfDay('sunset');
  environment.setWeather('rain');
  environment.update(2);
  environment.copySkyVisualState(out);
  near(out.sunEuler[0], (55 + 18) / 2);
  near(out.sunEuler[1], (30 + 35) / 2);
  near(out.artificialLightFactor, 0.09);
  near(out.rainIntensity, 0.5);

  environment.update(2);
  environment.copySkyVisualState(out);
  assert.deepEqual(out.sunEuler, [18, 35, 0]);
  assert.equal(out.artificialLightFactor, 0.18);
  assert.equal(out.rainIntensity, 1);
});
