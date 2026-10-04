import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_WEATHER,
  ENVIRONMENT_WEATHER_PRESETS,
  resolveEnvironmentWeather
} from '../src/environment/environment-weather.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
import {
  SNOW_FLAKE_BUDGET,
  SNOW_VOLUME_HEIGHT,
  snowFlakeBudget,
  snowFlakeLayout,
  snowOpacity,
  snowVolumeRadius
} from '../src/environment/snow-weather-policy.js';
import { cloudVisualProfile, sunVisualProfile } from '../src/environment/sky-visual-policy.js';

class FakeColor {
  constructor() { this.values = [0, 0, 0]; }
  set(r, g, b) { this.values[0] = r; this.values[1] = g; this.values[2] = b; }
}

function fixture(initialWeather = 'CLEAR', transitionSeconds = 4) {
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
  const director = createEnvironmentDirector({
    scene,
    lightEntity,
    camera,
    initialTime: 'DAY',
    initialWeather,
    transitionSeconds: 4,
    fogTransitionSeconds: transitionSeconds
  });
  return { scene, lightEntity, director };
}

const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('P5c SNOW is a distinct dry precipitation state with pale haze and heavy cloud cover', () => {
  const snow = ENVIRONMENT_WEATHER_PRESETS.SNOW;
  const rain = ENVIRONMENT_WEATHER_PRESETS.RAIN;
  const cloudy = ENVIRONMENT_WEATHER_PRESETS.CLOUDY;

  assert.equal(resolveEnvironmentWeather('snow'), ENVIRONMENT_WEATHER.SNOW);
  assert.equal(snow.fogType, 'linear');
  assert.equal(snow.rainIntensity, 0);
  assert.equal(snow.snowIntensity, 1);
  assert.equal(snow.wetness, 0);
  assert.ok(snow.cloudCover > cloudy.cloudCover);
  assert.ok(snow.cloudCover < rain.cloudCover);
  assert.ok(snow.fogStart > 0 && snow.fogStart < snow.fogEnd);
  assert.ok(snow.sunLightScale > rain.sunLightScale);
  assert.ok(snow.sunLightScale < cloudy.sunLightScale);
});

test('snow visual budgets are deterministic and tier-bounded', () => {
  assert.deepEqual(SNOW_FLAKE_BUDGET, { low: 36, medium: 72, high: 120 });
  assert.equal(snowFlakeBudget('low'), 36);
  assert.equal(snowFlakeBudget('medium'), 72);
  assert.equal(snowFlakeBudget('high'), 120);
  assert.equal(snowFlakeBudget('unknown'), 72);
  assert.ok(snowVolumeRadius('low') < snowVolumeRadius('high'));
  assert.ok(snowOpacity('low') < snowOpacity('high'));

  const a = snowFlakeLayout('low');
  const b = snowFlakeLayout('low');
  assert.deepEqual(a, b);
  assert.equal(a.length, 36);
  for (const flake of a) {
    assert.ok(Number.isFinite(flake.x) && Number.isFinite(flake.z));
    assert.ok(flake.y >= 0 && flake.y <= SNOW_VOLUME_HEIGHT);
    assert.ok(flake.size > 0);
    assert.ok(flake.stretch > 0);
  }
});

test('SNOW transition interpolates snow signal while rain and wetness remain off', () => {
  const { director } = fixture('CLEAR', 4);
  assert.equal(director.snowIntensity(), 0);

  director.setWeather('snow');
  director.update(2);
  const half = director.status();
  assert.equal(half.targetWeather, 'SNOW');
  assert.equal(half.weatherProgress, 0.5);
  assert.equal(half.rainIntensity, 0);
  assert.equal(half.wetness, 0);
  near(half.snowIntensity, 0.5);
  near(director.snowIntensity(), 0.5);

  director.update(2);
  const settled = director.status();
  assert.equal(settled.weatherSettled, true);
  assert.equal(settled.snowIntensity, 1);
  assert.equal(settled.rainIntensity, 0);
  assert.equal(settled.wetness, 0);

  director.setWeather('clear');
  director.update(4);
  assert.equal(director.snowIntensity(), 0);
  assert.equal(director.status().fog.type, 'none');
});

test('snow sky is paler than rain and still attenuates the sun', () => {
  const snowPreset = ENVIRONMENT_WEATHER_PRESETS.SNOW;
  const rainPreset = ENVIRONMENT_WEATHER_PRESETS.RAIN;

  const snowCloud = cloudVisualProfile({
    sunColor: [1, 0.94, 0.81],
    cloudCover: snowPreset.cloudCover,
    snowIntensity: 1
  });
  const rainCloud = cloudVisualProfile({
    sunColor: [1, 0.94, 0.81],
    cloudCover: rainPreset.cloudCover,
    rainIntensity: 1
  });
  assert.ok(snowCloud.color.every((value, i) => value >= rainCloud.color[i]));
  assert.ok(snowCloud.opacity > 0.5);

  const clearSun = sunVisualProfile({
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    sunLightScale: 1
  });
  const snowSun = sunVisualProfile({
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    snowIntensity: 1,
    sunLightScale: snowPreset.sunLightScale
  });
  assert.equal(snowSun.visible, true);
  assert.ok(snowSun.opacity < clearSun.opacity);
});

test('allocation-free sky snapshot carries snow intensity', () => {
  const { director } = fixture('SNOW', 4);
  const out = {
    sunColor: [0, 0, 0],
    sunEuler: [0, 0, 0],
    sunIntensity: 0,
    artificialLightFactor: 0,
    rainIntensity: 0,
    snowIntensity: 0,
    cloudCover: 0,
    sunLightScale: 0
  };
  director.copySkyVisualState(out);
  assert.equal(out.snowIntensity, 1);
  assert.equal(out.rainIntensity, 0);
  near(out.cloudCover, ENVIRONMENT_WEATHER_PRESETS.SNOW.cloudCover);
  near(out.sunLightScale, ENVIRONMENT_WEATHER_PRESETS.SNOW.sunLightScale);
});
