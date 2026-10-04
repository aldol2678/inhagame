import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATMOSPHERE_DOME_RADIUS,
  ATMOSPHERE_ELEVATIONS,
  ATMOSPHERE_SEGMENTS,
  ATMOSPHERE_SUN_GLOW_SIZE,
  atmosphereColorAtElevation,
  atmosphereSkyProfile
} from '../src/environment/atmospheric-sky-policy.js';
import { ENVIRONMENT_WEATHER_PRESETS } from '../src/environment/environment-weather.js';
import { ENVIRONMENT_PRESETS } from '../src/environment/environment-presets.js';
import { SKY_SUN_DISTANCE } from '../src/environment/sky-visual-policy.js';

const luminance = color => color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('P6A dome stays behind sun/clouds and inside the camera far clip with a tiny mesh budget', () => {
  assert.ok(ATMOSPHERE_DOME_RADIUS > SKY_SUN_DISTANCE);
  assert.ok(ATMOSPHERE_DOME_RADIUS < 700);
  assert.equal(ATMOSPHERE_SEGMENTS, 24);
  assert.ok(ATMOSPHERE_ELEVATIONS.length <= 8);
  assert.ok(ATMOSPHERE_ELEVATIONS[0] < 0);
  assert.ok(ATMOSPHERE_SUN_GLOW_SIZE > 0);
  assert.ok(ATMOSPHERE_SEGMENTS * ATMOSPHERE_ELEVATIONS.length + 1 < 200);
});

test('clear daytime sky has a bright hazy horizon and deeper blue zenith', () => {
  const profile = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.DAY.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.DAY.artificialLightFactor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale
  });
  assert.ok(luminance(profile.horizonColor) > luminance(profile.zenithColor));
  assert.ok(profile.zenithColor[2] > profile.zenithColor[0]);
  assert.ok(profile.sunGlowOpacity > 0.2);
  assert.equal(profile.sunsetFactor, 0);
});

test('sunset warms the horizon far more than the zenith and strengthens the glow', () => {
  const clear = ENVIRONMENT_WEATHER_PRESETS.CLEAR;
  const day = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.DAY.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.DAY.artificialLightFactor,
    cloudCover: clear.cloudCover,
    sunLightScale: clear.sunLightScale
  });
  const sunset = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.SUNSET.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.SUNSET.artificialLightFactor,
    cloudCover: clear.cloudCover,
    sunLightScale: clear.sunLightScale
  });
  assert.ok(sunset.sunsetFactor > 0.8);
  assert.ok(sunset.horizonColor[0] > sunset.horizonColor[2]);
  assert.ok(
    (sunset.horizonColor[0] - day.horizonColor[0]) >
    (sunset.zenithColor[0] - day.zenithColor[0])
  );
  assert.ok(sunset.sunGlowOpacity > day.sunGlowOpacity);
});

test('night becomes a dark navy gradient and disables atmospheric sun glow', () => {
  const profile = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.NIGHT.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.NIGHT.artificialLightFactor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale
  });
  assert.ok(luminance(profile.horizonColor) < 0.2);
  assert.ok(luminance(profile.zenithColor) < 0.2);
  assert.ok(profile.zenithColor[2] > profile.zenithColor[0]);
  assert.equal(profile.sunGlowOpacity, 0);
  assert.ok(profile.sunsetFactor < 1e-12);
});

test('clear NIGHT stays dark even with the baseline cloud-cover signal', () => {
  const day = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.DAY.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.DAY.artificialLightFactor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale
  });
  const night = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.NIGHT.sunColor,
    artificialLightFactor: ENVIRONMENT_PRESETS.NIGHT.artificialLightFactor,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover,
    sunLightScale: ENVIRONMENT_WEATHER_PRESETS.CLEAR.sunLightScale
  });

  assert.ok(luminance(night.horizonColor) < 0.07);
  assert.ok(luminance(night.zenithColor) < 0.03);
  assert.ok(luminance(night.horizonColor) < luminance(day.horizonColor) * 0.12);
  assert.ok(luminance(night.zenithColor) < luminance(day.zenithColor) * 0.08);
});

test('weather tint darkens rain, desaturates overcast and brightens snow haze', () => {
  const time = ENVIRONMENT_PRESETS.DAY;
  const clear = atmosphereSkyProfile({
    sunColor: time.sunColor,
    artificialLightFactor: time.artificialLightFactor,
    ...ENVIRONMENT_WEATHER_PRESETS.CLEAR
  });
  const cloudy = atmosphereSkyProfile({
    sunColor: time.sunColor,
    artificialLightFactor: time.artificialLightFactor,
    ...ENVIRONMENT_WEATHER_PRESETS.CLOUDY
  });
  const rain = atmosphereSkyProfile({
    sunColor: time.sunColor,
    artificialLightFactor: time.artificialLightFactor,
    ...ENVIRONMENT_WEATHER_PRESETS.RAIN
  });
  const snow = atmosphereSkyProfile({
    sunColor: time.sunColor,
    artificialLightFactor: time.artificialLightFactor,
    ...ENVIRONMENT_WEATHER_PRESETS.SNOW
  });

  assert.ok(luminance(cloudy.zenithColor) < luminance(clear.zenithColor));
  assert.ok(luminance(rain.zenithColor) < luminance(cloudy.zenithColor));
  assert.ok(luminance(snow.horizonColor) > luminance(rain.horizonColor));
  assert.ok(clear.sunGlowOpacity > cloudy.sunGlowOpacity);
  assert.ok(cloudy.sunGlowOpacity > rain.sunGlowOpacity);
});

test('gradient writer pins the horizon and zenith colors at their intended bands', () => {
  const profile = atmosphereSkyProfile({
    sunColor: ENVIRONMENT_PRESETS.DAY.sunColor,
    artificialLightFactor: 0,
    cloudCover: ENVIRONMENT_WEATHER_PRESETS.CLEAR.cloudCover,
    sunLightScale: 1
  });
  for (const elevation of [-20, 0]) {
    const color = atmosphereColorAtElevation(profile, elevation);
    for (let i = 0; i < 3; i++) near(color[i], profile.horizonColor[i]);
    assert.equal(color[3], 1);
  }
  const zenith = atmosphereColorAtElevation(profile, 90);
  for (let i = 0; i < 3; i++) near(zenith[i], profile.zenithColor[i]);
  assert.equal(zenith[3], 1);

  const low = atmosphereColorAtElevation(profile, 12);
  const high = atmosphereColorAtElevation(profile, 48);
  assert.ok(luminance(low) > luminance(high), 'horizon haze should fade with elevation');
});
