import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENT_WEATHER,
  ENVIRONMENT_WEATHER,
  ENVIRONMENT_WEATHER_PRESETS,
  environmentWeatherPreset,
  resolveEnvironmentWeather
} from '../src/environment/environment-weather.js';
import { resolveEnvironmentRuntimeWeather } from '../src/environment/environment-clock.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';

class FakeColor {
  constructor() { this.values = [0, 0, 0]; }
  set(r, g, b) { this.values[0] = r; this.values[1] = g; this.values[2] = b; }
}

function fixture({ initialWeather = 'CLEAR', initialTime = 'DAY', fogTransitionSeconds = 4 } = {}) {
  const scene = {
    ambientLight: new FakeColor(),
    exposure: 0,
    fog: {
      type: 'none',
      color: new FakeColor(),
      start: 1,
      end: 1000,
      density: 99
    }
  };
  const lightEntity = {
    light: {
      color: new FakeColor(),
      intensity: 0,
      shadowIntensity: 0,
      castShadows: true,
      shadowResolution: 2048,
      shadowDistance: 100
    },
    setEulerAngles() {}
  };
  const camera = { camera: { clearColor: new FakeColor() } };
  const director = createEnvironmentDirector({
    scene,
    lightEntity,
    camera,
    initialTime,
    initialWeather,
    transitionSeconds: 2,
    fogTransitionSeconds
  });
  return { scene, lightEntity, camera, director };
}

const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('P1 weather contract exposes CLEAR and FOG with preview-only fail-safe override', () => {
  assert.deepEqual(Object.keys(ENVIRONMENT_WEATHER_PRESETS), ['CLEAR', 'CLOUDY', 'FOG', 'RAIN']);
  const clear = ENVIRONMENT_WEATHER_PRESETS.CLEAR;
  const fog = ENVIRONMENT_WEATHER_PRESETS.FOG;
  assert.equal(clear.fogType, 'none');
  assert.equal(fog.fogType, 'linear');
  assert.ok(fog.fogStart > 0 && fog.fogStart < fog.fogEnd);
  assert.ok(fog.fogEnd < clear.fogStart);
  assert.ok(fog.fogColorMix > 0 && fog.fogColorMix <= 1);
  assert.equal(resolveEnvironmentWeather('fog'), ENVIRONMENT_WEATHER.FOG);
  assert.equal(resolveEnvironmentWeather('__invalid__'), DEFAULT_ENVIRONMENT_WEATHER);
  assert.strictEqual(environmentWeatherPreset('__invalid__'), clear);

  const params = new URLSearchParams('envWeather=fog');
  assert.equal(resolveEnvironmentRuntimeWeather(params, { previewHost: true }), ENVIRONMENT_WEATHER.FOG);
  assert.equal(resolveEnvironmentRuntimeWeather(params, { previewHost: false }), ENVIRONMENT_WEATHER.CLEAR);
  assert.equal(resolveEnvironmentRuntimeWeather(new URLSearchParams('envWeather=storm'), { previewHost: true }), ENVIRONMENT_WEATHER.CLEAR);
});

test('initial FOG applies PlayCanvas v2 fog params and preserves graphics-quality ownership', () => {
  const { scene, lightEntity, director } = fixture({ initialWeather: 'FOG' });
  const preset = ENVIRONMENT_WEATHER_PRESETS.FOG;
  assert.equal(scene.fog.type, 'linear');
  assert.equal(scene.fog.start, preset.fogStart);
  assert.equal(scene.fog.end, preset.fogEnd);
  assert.equal(scene.fog.density, 0);
  assert.equal(director.status().targetWeather, 'FOG');
  assert.equal(director.status().weatherSettled, true);

  const before = {
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  };
  director.setTimeOfDay('night', { immediate: true });
  assert.deepEqual({
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  }, before);
  assert.equal(scene.fog.type, 'linear');
  assert.ok(scene.fog.color.values[2] > scene.fog.color.values[0], 'night fog keeps a cool tint');
});

test('FOG fades inward, CLEAR fades outward, then disables the fog shader path', () => {
  const { scene, director } = fixture({ initialWeather: 'CLEAR', fogTransitionSeconds: 4 });
  const clear = ENVIRONMENT_WEATHER_PRESETS.CLEAR;
  const fog = ENVIRONMENT_WEATHER_PRESETS.FOG;
  assert.equal(scene.fog.type, 'none');

  assert.equal(director.setWeather('fog'), 'FOG');
  director.update(0);
  assert.equal(scene.fog.type, 'linear');
  assert.equal(director.status().weatherSettled, false);

  director.update(2);
  near(scene.fog.start, (clear.fogStart + fog.fogStart) / 2);
  near(scene.fog.end, (clear.fogEnd + fog.fogEnd) / 2);
  near(director.status().weatherProgress, 0.5);

  director.update(2);
  assert.equal(director.status().weatherSettled, true);
  assert.equal(scene.fog.type, 'linear');
  near(scene.fog.start, fog.fogStart);
  near(scene.fog.end, fog.fogEnd);

  assert.equal(director.setWeather('clear'), 'CLEAR');
  director.update(2);
  assert.equal(scene.fog.type, 'linear', 'linear fog remains enabled during fade-out');
  assert.ok(scene.fog.start > fog.fogStart);
  director.update(2);
  assert.equal(scene.fog.type, 'none');
  near(scene.fog.start, clear.fogStart);
  near(scene.fog.end, clear.fogEnd);
});

test('fog transition ignores negative/non-finite delta and immediate switching snaps canonically', () => {
  const { scene, director } = fixture();
  director.setWeather('fog');
  const start = scene.fog.start;
  director.update(-1);
  director.update(Number.NaN);
  assert.equal(scene.fog.start, start);
  director.setWeather('fog', { immediate: true });
  assert.equal(scene.fog.type, 'linear');
  assert.equal(scene.fog.start, ENVIRONMENT_WEATHER_PRESETS.FOG.fogStart);
  director.setWeather('clear', { immediate: true });
  assert.equal(scene.fog.type, 'none');
  assert.equal(director.status().weatherSettled, true);
});
