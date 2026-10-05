import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_WEATHER,
  ENVIRONMENT_WEATHER_PRESETS,
  resolveEnvironmentWeather
} from '../src/environment/environment-weather.js';
import { createEnvironmentDirector } from '../src/environment/environment-director.js';
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

test('P5b CLOUDY is a dry non-fog weather state with dense cover and attenuated daylight', () => {
  const clear = ENVIRONMENT_WEATHER_PRESETS.CLEAR;
  const cloudy = ENVIRONMENT_WEATHER_PRESETS.CLOUDY;
  const rain = ENVIRONMENT_WEATHER_PRESETS.RAIN;

  assert.equal(resolveEnvironmentWeather('cloudy'), ENVIRONMENT_WEATHER.CLOUDY);
  assert.equal(cloudy.fogType, 'none');
  assert.equal(cloudy.rainIntensity, 0);
  assert.equal(cloudy.wetness, 0);
  assert.ok(cloudy.cloudCover > clear.cloudCover);
  assert.ok(cloudy.cloudCover < rain.cloudCover);
  assert.ok(cloudy.sunLightScale < clear.sunLightScale);
  assert.ok(cloudy.sunLightScale > rain.sunLightScale);
  assert.ok(cloudy.ambientLightScale < clear.ambientLightScale);
  assert.ok(cloudy.ambientLightScale > rain.ambientLightScale);
});

test('CLOUDY transition dims directional and ambient light without changing graphics ownership', () => {
  const { scene, lightEntity, director } = fixture('CLEAR', 4);
  const clearIntensity = lightEntity.light.intensity;
  const clearAmbient = [...scene.ambientLight.values];
  const graphicsBefore = {
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  };

  director.setWeather('cloudy');
  director.update(2);
  const half = director.status();
  assert.equal(half.targetWeather, 'CLOUDY');
  assert.equal(half.weatherProgress, 0.5);
  assert.equal(half.rainIntensity, 0);
  assert.equal(half.wetness, 0);
  assert.ok(lightEntity.light.intensity < clearIntensity);
  assert.ok(scene.ambientLight.values.every((value, i) => value < clearAmbient[i]));
  assert.ok(half.cloudCover > ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover);
  assert.ok(half.cloudCover < ENVIRONMENT_WEATHER_PRESETS.CLOUDY.cloudCover);

  director.update(2);
  const cloudy = director.status();
  assert.equal(cloudy.weatherSettled, true);
  near(cloudy.cloudCover, ENVIRONMENT_WEATHER_PRESETS.CLOUDY.cloudCover);
  near(cloudy.sunLightScale, ENVIRONMENT_WEATHER_PRESETS.CLOUDY.sunLightScale);
  near(cloudy.ambientLightScale, ENVIRONMENT_WEATHER_PRESETS.CLOUDY.ambientLightScale);
  near(lightEntity.light.intensity, 1.15 * ENVIRONMENT_WEATHER_PRESETS.CLOUDY.sunLightScale);
  assert.deepEqual({
    castShadows: lightEntity.light.castShadows,
    shadowResolution: lightEntity.light.shadowResolution,
    shadowDistance: lightEntity.light.shadowDistance
  }, graphicsBefore);
});

test('cloud and sun visuals distinguish CLEAR, CLOUDY and RAIN', () => {
  const sunBase = {
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    artificialLightFactor: 0,
    rainIntensity: 0
  };
  const clearSun = sunVisualProfile({
    ...sunBase,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale
  });
  const cloudySun = sunVisualProfile({
    ...sunBase,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLOUDY.sunLightScale
  });
  const rainSun = sunVisualProfile({
    ...sunBase,
    rainIntensity: 1,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.RAIN.sunLightScale
  });
  assert.ok(clearSun.opacity > cloudySun.opacity);
  assert.ok(cloudySun.opacity > rainSun.opacity);

  const clearCloud = cloudVisualProfile({
    sunColor: sunBase.sunColor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover
  });
  const cloudyCloud = cloudVisualProfile({
    sunColor: sunBase.sunColor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLOUDY.cloudCover
  });
  const rainCloud = cloudVisualProfile({
    sunColor: sunBase.sunColor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.RAIN.cloudCover,
    rainIntensity: 1
  });
  assert.ok(clearCloud.opacity < cloudyCloud.opacity);
  assert.ok(cloudyCloud.opacity < rainCloud.opacity);
  assert.ok(cloudyCloud.color.every((value, i) => value < clearCloud.color[i]));
  assert.ok(rainCloud.color.every((value, i) => value <= cloudyCloud.color[i]));
});

test('allocation-free sky snapshot carries interpolated cloud cover and sun scale', () => {
  const { director } = fixture('CLEAR', 4);
  const out = {
    sunColor: [0, 0, 0],
    sunEuler: [0, 0, 0],
    sunIntensity: 0,
    artificialLightFactor: 0,
    rainIntensity: 0,
    cloudCover: 0,
    sunLightScale: 0
  };

  director.copySkyVisualState(out);
  near(out.cloudCover, ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover);
  near(out.sunLightScale, ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale);

  director.setWeather('cloudy');
  director.update(2);
  director.copySkyVisualState(out);
  near(out.cloudCover, (ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover + ENVIRONMENT_WEATHER_PRESETS.CLOUDY.cloudCover) / 2);
  near(out.sunLightScale, (ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale + ENVIRONMENT_WEATHER_PRESETS.CLOUDY.sunLightScale) / 2);
});
