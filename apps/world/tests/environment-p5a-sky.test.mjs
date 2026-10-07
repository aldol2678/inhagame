import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  shadowRayDirectionFromSunSource,
  sunSourceDirectionFromLightUp,
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
  assert.deepEqual(SKY_CLOUD_FIELD_RADIUS, { low: 128, medium: 172, high: 205 });
  assert.equal(skyCloudPatchBudget('low'), 6);
  assert.equal(skyCloudPatchBudget('high'), 16);
  assert.equal(skyCloudPatchBudget('unknown'), 10);
  assert.equal(skyCloudFieldRadius('unknown'), 172);
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

test('visible sun source is normalized from light.up and shadow rays point exactly opposite', () => {
  const source = sunSourceDirectionFromLightUp({ x: 0.41, y: 0.57, z: 0.71 });
  const rays = shadowRayDirectionFromSunSource(source);
  near(Math.hypot(...source), 1);
  near(Math.hypot(...rays), 1);
  near(source[0] * rays[0] + source[1] * rays[1] + source[2] * rays[2], -1);
  near(rays[0], -source[0]);
  near(rays[1], -source[1]);
  near(rays[2], -source[2]);
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
  assert.ok(nightCloud.color[2] < 0.17);
  assert.ok(nightCloud.emissiveIntensity <= 0.30);
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
  near(out.sunEuler[0], (55 + 84) / 2);
  near(out.sunEuler[1], (30 + 258) / 2);
  near(out.artificialLightFactor, 0.11);
  near(out.rainIntensity, 0.5);

  environment.update(2);
  environment.copySkyVisualState(out);
  assert.deepEqual(out.sunEuler, [84, 258, 0]);
  assert.equal(out.artificialLightFactor, 0.22);
  assert.equal(out.rainIntensity, 1);
});


test('sky runtime binds the visible sun to the live directional-light axis, not an independent Euler formula', async () => {
  const skyVisuals = await readFile(new URL('../src/environment/sky-visuals.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(skyVisuals, /writeSunSourceDirection\(sunDirection, lightEntity\?\.up\)/);
  assert.doesNotMatch(skyVisuals, /writeSunDirection\(sunDirection, skyState\.sunEuler\)/);
  assert.match(main, /createSkyVisuals\(\{[\s\S]*?lightEntity: light,/);
});


test('sky material cache always performs the first authoritative environment sync', async () => {
  const skyVisuals = await readFile(new URL('../src/environment/sky-visuals.js', import.meta.url), 'utf8');
  assert.match(skyVisuals, /let materialSignalInitialized = false/);
  assert.match(skyVisuals, /const colorChanged = !materialSignalInitialized \|\|/);
  assert.match(skyVisuals, /const scalarChanged = !materialSignalInitialized \|\|/);
  assert.match(skyVisuals, /materialSignalInitialized = true/);
  assert.match(skyVisuals, /comparisons? against NaN is false|comparison against NaN is false/);
});
