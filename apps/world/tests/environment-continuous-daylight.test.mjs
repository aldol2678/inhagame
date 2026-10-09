import test from 'node:test';
import assert from 'node:assert/strict';
import * as daylight from '../src/environment/environment-presets.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
import { createEnvironmentWorldTime } from '../src/environment/environment-world-time.js';
import { NPC_WORLD_EPOCH_MS as E } from '../npc-factory/npc-world-time-contract.mjs';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const fields = ['sunIntensity', 'exposure', 'shadowIntensity'];
function fixture() {
  const color = () => ({ set() {} });
  const scene = { ambientLight: color(), fog: { color: color() } };
  const lightEntity = { light: { color: color(), castShadows: false, shadowResolution: 512 }, setEulerAngles() {} };
  const camera = { camera: { clearColor: color() } };
  return { scene, lightEntity, director: createEnvironmentDirector({ scene, lightEntity, camera }) };
}

test('continuous lighting preserves approved anchors and changes within DAY', () => {
  assert.equal(typeof daylight.environmentLightingAtCycleSeconds, 'function');
  const sample = daylight.environmentLightingAtCycleSeconds;
  for (const [minute, id] of [[0, 'NIGHT'], [2, 'DAWN'], [30, 'DAY'], [52, 'GOLDEN_HOUR'], [56, 'SUNSET'], [59, 'DUSK'], [60, 'NIGHT'], [75, 'NIGHT']]) {
    for (const key of fields) near(sample(minute * 60)[key], daylight.ENVIRONMENT_PRESETS[id][key]);
  }
  assert.ok(sample(10 * 60).sunIntensity < sample(20 * 60).sunIntensity);
  assert.ok(sample(35 * 60).sunIntensity > sample(45 * 60).sunIntensity);
});

test('samples are bounded, continuous around every phase and cycle seam, deterministic and night-safe', () => {
  assert.equal(typeof daylight.environmentLightingAtCycleSeconds, 'function');
  const sample = daylight.environmentLightingAtCycleSeconds;
  for (let second = 0; second < 4500; second++) {
    const frame = sample(second);
    assert.deepEqual(frame, sample(second + 4500));
    for (const key of fields) {
      const values = Object.values(daylight.ENVIRONMENT_PRESETS).map(preset => preset[key]);
      assert.ok(frame[key] >= Math.min(...values) && frame[key] <= Math.max(...values));
      near(frame[key], sample(second + 0.001)[key], 0.0001);
    }
    if (second >= 3600) { assert.equal(frame.sunIntensity, 0); assert.equal(frame.shadowIntensity, 0); }
  }
  for (const minute of [0, 2, 4, 15, 30, 40, 50, 52, 54, 56, 58, 59, 60, 75]) {
    for (const key of fields) near(sample(minute * 60 - 0.001)[key], sample(minute * 60 + 0.001)[key], 0.0001);
  }
  assert.deepEqual(sample(-60), sample(4440));
});

test('director continuously samples authoritative time without restarting preset transitions or enabling shadows', () => {
  const { director, scene, lightEntity } = fixture();
  assert.equal(typeof director.setWorldTime, 'function');
  director.setWorldTime(10 * 60, 'DAY', { immediate: true });
  const first = scene.exposure;
  director.setWorldTime(20 * 60, 'DAY');
  director.update(1 / 60);
  assert.ok(scene.exposure > first);
  near(scene.exposure, daylight.environmentLightingAtCycleSeconds(1200).exposure);
  director.setWorldTime(54 * 60, 'SUNSET');
  director.update(1);
  near(scene.exposure, daylight.environmentLightingAtCycleSeconds(3240).exposure);
  director.setWorldTime(54 * 60 + 1, 'SUNSET');
  director.update(1);
  near(director.status().progress, 2 / 3);
  assert.equal(lightEntity.light.castShadows, false);
  assert.equal(lightEntity.light.shadowResolution, 512);
});

test('weather blending composes with lighting; manual/photo override holds and resumes latest world sample', () => {
  const { director, scene, lightEntity } = fixture();
  assert.equal(typeof director.setWorldTime, 'function');
  director.setWorldTime(1200, 'DAY', { immediate: true });
  director.setWeather('RAIN');
  director.update(1.25);
  near(lightEntity.light.intensity, daylight.environmentLightingAtCycleSeconds(1200).sunIntensity * director.status().sunLightScale);
  director.setTimeOfDay('NIGHT', { immediate: true });
  director.setWorldTime(3300, 'SUNSET');
  director.update(5);
  assert.equal(scene.exposure, daylight.ENVIRONMENT_PRESETS.NIGHT.exposure);
  assert.equal(lightEntity.light.intensity, 0);
  assert.equal(director.status().lightingMode, 'manual');
  director.resumeWorldTime({ immediate: true });
  near(scene.exposure, daylight.environmentLightingAtCycleSeconds(3300).exposure);
  assert.equal(director.status().targetTime, 'SUNSET');
  assert.equal(director.status().lightingMode, 'world');
  director.setWorldTime(4000, 'NIGHT');
  director.update(3);
  assert.equal(lightEntity.light.intensity, 0);
  assert.equal(lightEntity.light.shadowIntensity, 0);
  assert.equal(director.status().targetWeather, 'RAIN');
});

test('world controller forwards every sample and disabled preview leaves manual director untouched', async () => {
  const { director, scene } = fixture();
  let now = E + 600000;
  const clock = { now: () => now, sync: async () => {}, refreshIfDue() {} };
  const world = createEnvironmentWorldTime({ environment: director, clock });
  await world.sync();
  const first = scene.exposure;
  now += 600000;
  world.update();
  assert.ok(scene.exposure > first);
  world.destroy();
  now += 600000;
  assert.equal(world.update(), false);
  director.setTimeOfDay('SUNSET', { immediate: true });
  const preview = createEnvironmentWorldTime({ environment: director, clock, enabled: false });
  await preview.sync(); preview.update();
  assert.equal(scene.exposure, daylight.ENVIRONMENT_PRESETS.SUNSET.exposure);
});

test('lighting is frame-rate independent at the same world instant and invalid samples are inert', () => {
  const fast = fixture();
  const sparse = fixture();
  fast.director.setWorldTime(1800, 'DAY', { immediate: true });
  sparse.director.setWorldTime(1800, 'DAY', { immediate: true });
  for (let i = 1; i <= 120; i++) {
    fast.director.setWorldTime(1800 + i / 2, 'DAY');
    fast.director.update(1 / 120);
  }
  sparse.director.setWorldTime(1860, 'DAY');
  sparse.director.update(60);
  near(fast.scene.exposure, sparse.scene.exposure);
  near(fast.lightEntity.light.intensity, sparse.lightEntity.light.intensity);
  near(fast.lightEntity.light.shadowIntensity, sparse.lightEntity.light.shadowIntensity);
  const before = sparse.director.status();
  for (const invalid of [NaN, Infinity, undefined, null]) assert.equal(sparse.director.setWorldTime(invalid, 'NIGHT'), false);
  assert.deepEqual(sparse.director.status(), before);
});

test('continuous daylight composes with every weather preset without taking shadow ownership', () => {
  const { director, lightEntity } = fixture();
  director.setWorldTime(2000, 'DAY', { immediate: true });
  const skyBefore = director.copySkyVisualState({});
  for (const weather of ['CLEAR', 'CLOUDY', 'FOG', 'RAIN', 'SNOW']) {
    for (const enabled of [false, true]) {
      lightEntity.light.castShadows = enabled;
      director.setWeather(weather, { immediate: true });
      director.setWorldTime(2050, 'DAY');
      director.update(100);
      assert.equal(director.status().targetWeather, weather);
      assert.equal(lightEntity.light.castShadows, enabled);
      const lighting = daylight.environmentLightingAtCycleSeconds(2050);
      near(lightEntity.light.intensity, lighting.sunIntensity * director.status().sunLightScale);
      assert.deepEqual(director.copySkyVisualState({}).sunColor, skyBefore.sunColor);
    }
  }
});
