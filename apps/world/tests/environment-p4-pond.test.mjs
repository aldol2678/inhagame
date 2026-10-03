import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  POND_WATER_BASE,
  POND_WATER_NIGHT,
  POND_WATER_RAIN,
  pondWeatherProfile
} from '../src/environment/pond-weather-policy.js';

const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('P4 dry daytime profile preserves the existing Inkyung pond material contract', () => {
  const profile = pondWeatherProfile(0, 0);
  assert.deepEqual(profile.diffuse, POND_WATER_BASE.diffuse);
  assert.deepEqual(profile.specular, POND_WATER_BASE.specular);
  assert.equal(profile.gloss, POND_WATER_BASE.gloss);
  assert.equal(profile.reflectivity, POND_WATER_BASE.reflectivity);
  assert.equal(profile.bumpiness, POND_WATER_BASE.bumpiness);
  assert.equal(profile.rippleSpeed, POND_WATER_BASE.rippleSpeed);
});

test('rain strengthens ripples and specular response without exceeding bounded material values', () => {
  const dry = pondWeatherProfile(0, 0);
  const rain = pondWeatherProfile(1, 0);
  assert.deepEqual(rain.diffuse, POND_WATER_RAIN.diffuse);
  assert.deepEqual(rain.specular, POND_WATER_RAIN.specular);
  assert.ok(rain.bumpiness > dry.bumpiness);
  assert.ok(rain.rippleSpeed > dry.rippleSpeed);
  assert.ok(rain.reflectivity > dry.reflectivity);
  assert.ok(rain.gloss > dry.gloss);
  assert.ok(rain.gloss <= 1);
  assert.ok(rain.reflectivity <= 1);
});

test('night darkens water while preserving a cool blue lift and reflection visibility', () => {
  const day = pondWeatherProfile(0, 0);
  const night = pondWeatherProfile(0, 1);
  assert.ok(night.diffuse[0] < day.diffuse[0]);
  assert.ok(night.diffuse[1] < day.diffuse[1]);
  assert.ok(night.diffuse[2] < day.diffuse[2]);
  assert.ok(night.diffuse[2] > day.diffuse[2] * POND_WATER_NIGHT.diffuseScale);
  assert.ok(night.reflectivity > day.reflectivity);
  assert.ok(night.gloss > day.gloss);
  near(night.bumpiness, day.bumpiness);
  near(night.rippleSpeed, day.rippleSpeed);
});

test('rain and night inputs clamp safely and interpolate deterministically', () => {
  assert.deepEqual(pondWeatherProfile(-10, Number.NaN), pondWeatherProfile(0, 0));
  assert.deepEqual(pondWeatherProfile(10, 10), pondWeatherProfile(1, 1));

  const half = pondWeatherProfile(0.5, 0);
  near(half.bumpiness, (POND_WATER_BASE.bumpiness + POND_WATER_RAIN.bumpiness) / 2);
  near(half.rippleSpeed, (POND_WATER_BASE.rippleSpeed + POND_WATER_RAIN.rippleSpeed) / 2);
  near(half.reflectivity, (POND_WATER_BASE.reflectivity + POND_WATER_RAIN.reflectivity) / 2);
});

test('P4 isolates the Inkyung weather material from other reflecting pools', async () => {
  const pondWater = await readFile(new URL('../src/pond-water.js', import.meta.url), 'utf8');
  const central = await readFile(new URL('../src/central-blockout.js', import.meta.url), 'utf8');
  const grounds = await readFile(new URL('../src/campus-grounds.js', import.meta.url), 'utf8');

  assert.match(pondWater, /materialKey = `\$\{brightness\}:\$\{variant\}`/);
  assert.match(central, /pondWaterMaterial\(device, 1, "inkyung-weather"\)/);
  assert.doesNotMatch(grounds, /inkyung-weather/);
});
