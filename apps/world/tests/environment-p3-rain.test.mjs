import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_WEATHER,
  ENVIRONMENT_WEATHER_PRESETS,
  resolveEnvironmentWeather
} from '../src/environment/environment-weather.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
import {
  RAIN_STREAK_BUDGET,
  RAIN_VOLUME_HEIGHT,
  rainOpacity,
  rainStreakBudget,
  rainStreakLayout,
  rainVolumeRadius,
  wetRoadOpacity
} from '../src/environment/rain-weather-policy.js';

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
  return createEnvironmentDirector({
    scene,
    lightEntity,
    camera,
    initialWeather,
    fogTransitionSeconds: transitionSeconds
  });
}

test('P3 RAIN is canonical weather with rain, wetness and lighter haze than FOG', () => {
  const rain = ENVIRONMENT_WEATHER_PRESETS.RAIN;
  const fog = ENVIRONMENT_WEATHER_PRESETS.FOG;
  assert.equal(resolveEnvironmentWeather('rain'), ENVIRONMENT_WEATHER.RAIN);
  assert.equal(rain.fogType, 'linear');
  assert.equal(rain.rainIntensity, 1);
  assert.equal(rain.wetness, 1);
  assert.equal(fog.rainIntensity, 0);
  assert.equal(fog.wetness, 0);
  assert.ok(rain.fogStart > fog.fogStart);
  assert.ok(rain.fogEnd > fog.fogEnd);
  assert.ok(rain.fogColorMix < fog.fogColorMix);
});

test('rain visual budgets are bounded by graphics tier and deterministic', () => {
  assert.deepEqual(RAIN_STREAK_BUDGET, { low: 28, medium: 56, high: 96 });
  assert.equal(rainStreakBudget('low'), 28);
  assert.equal(rainStreakBudget('medium'), 56);
  assert.equal(rainStreakBudget('high'), 96);
  assert.equal(rainStreakBudget('unknown'), 56);
  assert.ok(rainVolumeRadius('low') < rainVolumeRadius('high'));
  assert.ok(rainOpacity('low') < rainOpacity('high'));
  assert.ok(wetRoadOpacity('low') < wetRoadOpacity('high'));

  const a = rainStreakLayout('low');
  const b = rainStreakLayout('low');
  assert.deepEqual(a, b);
  assert.equal(a.length, 28);
  for (const streak of a) {
    assert.ok(Number.isFinite(streak.x) && Number.isFinite(streak.z));
    assert.ok(streak.y >= 0 && streak.y <= RAIN_VOLUME_HEIGHT);
    assert.ok(streak.length > 0);
    assert.ok(streak.width > 0);
  }
});

test('RAIN transition interpolates rain and wetness, CLEAR drains both back to zero', () => {
  const environment = fixture('CLEAR', 4);
  assert.equal(environment.rainIntensity(), 0);
  assert.equal(environment.wetnessFactor(), 0);

  environment.setWeather('rain');
  environment.update(2);
  assert.equal(environment.status().targetWeather, 'RAIN');
  assert.equal(environment.status().weatherProgress, 0.5);
  assert.equal(environment.rainIntensity(), 0.5);
  assert.equal(environment.wetnessFactor(), 0.5);

  environment.update(2);
  assert.equal(environment.status().weatherSettled, true);
  assert.equal(environment.rainIntensity(), 1);
  assert.equal(environment.wetnessFactor(), 1);
  assert.equal(environment.status().rainIntensity, 1);
  assert.equal(environment.status().wetness, 1);

  environment.setWeather('clear');
  environment.update(4);
  assert.equal(environment.rainIntensity(), 0);
  assert.equal(environment.wetnessFactor(), 0);
  assert.equal(environment.status().fog.type, 'none');
});

test('FOG never turns on rain or wet road signals', () => {
  const environment = fixture('FOG');
  assert.equal(environment.status().targetWeather, 'FOG');
  assert.equal(environment.rainIntensity(), 0);
  assert.equal(environment.wetnessFactor(), 0);
  environment.setWeather('rain', { immediate: true });
  assert.equal(environment.rainIntensity(), 1);
  environment.setWeather('fog', { immediate: true });
  assert.equal(environment.rainIntensity(), 0);
  assert.equal(environment.wetnessFactor(), 0);
});
