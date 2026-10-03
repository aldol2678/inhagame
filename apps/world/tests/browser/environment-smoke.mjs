import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?envTime=sunset&envWeather=fog`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_NIGHT_LIGHTS__?.status?.().artificialLightFactor >= 0.17 &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  const initial = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(initial.environment.targetTime, 'SUNSET');
  assert.equal(initial.environment.targetWeather, 'FOG');
  assert.equal(initial.environment.fog.type, 'linear');
  assert.ok(initial.environment.fog.start < initial.environment.fog.end);
  assert.ok(initial.environment.exposure < 1.05 && initial.environment.exposure > 0.82);
  assert.equal(initial.environment.artificialLightFactor, 0.18);
  assert.equal(initial.streetLights.artificialLightFactor, 0.18);
  assert.ok(initial.streetLights.lampCount > 0);
  assert.equal(initial.streetLights.bulbCount + initial.streetLights.registeredLampCount, initial.streetLights.lampCount);
  assert.ok(initial.streetLights.dynamicBudget >= 0 && initial.streetLights.dynamicBudget <= 4);
  assert.ok(initial.streetLights.activeDynamicLights <= initial.streetLights.dynamicBudget);

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('night'));
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().settled &&
      window.__INHAGAME_ENVIRONMENT__.status().targetTime === 'NIGHT' &&
      window.__INHAGAME_NIGHT_LIGHTS__.status().artificialLightFactor >= 0.999,
    null,
    { timeout: TIMEOUT_MS }
  );
  const night = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(night.environment.targetTime, 'NIGHT');
  assert.equal(night.environment.fog.type, 'linear');
  assert.equal(night.environment.artificialLightFactor, 1);
  assert.equal(night.streetLights.artificialLightFactor, 1);
  assert.ok(night.environment.exposure < initial.environment.exposure);
  assert.ok(night.streetLights.activeDynamicLights <= night.streetLights.dynamicBudget);
  for (const field of ['tier', 'castShadows', 'shadowResolution', 'shadowDistance'])
    assert.equal(night.graphics[field], initial.graphics[field], `environment must not own graphics field ${field}`);

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setWeather('clear'));
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().weatherSettled &&
      window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'CLEAR',
    null,
    { timeout: TIMEOUT_MS }
  );
  const clear = await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
  assert.equal(clear.fog.type, 'none');

  await page.evaluate(() => {
    window.__INHAGAME_ENVIRONMENT__.setWeather('fog', { immediate: true });
    window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('day', { immediate: true });
  });
  await page.waitForFunction(
    () => window.__INHAGAME_NIGHT_LIGHTS__.status().artificialLightFactor === 0,
    null,
    { timeout: TIMEOUT_MS }
  );
  const dayFog = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status()
  }));
  assert.equal(dayFog.environment.targetTime, 'DAY');
  assert.equal(dayFog.environment.targetWeather, 'FOG');
  assert.equal(dayFog.environment.fog.type, 'linear');
  assert.equal(dayFog.environment.settled, true);
  assert.equal(dayFog.environment.weatherSettled, true);
  assert.equal(dayFog.environment.exposure, 1.05);
  assert.equal(dayFog.environment.artificialLightFactor, 0);
  assert.equal(dayFog.streetLights.artificialLightFactor, 0);
  assert.equal(dayFog.streetLights.activeDynamicLights, 0);

  const mobile = await smoke.context.newPage();
  smoke.watch(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${smoke.origin}/campus/?envTime=night&envWeather=fog`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await mobile.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_NIGHT_LIGHTS__?.status?.().artificialLightFactor >= 0.999 &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );
  const mobileStatus = await mobile.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status()
  }));
  assert.equal(mobileStatus.environment.targetTime, 'NIGHT');
  assert.equal(mobileStatus.environment.targetWeather, 'FOG');
  assert.equal(mobileStatus.environment.fog.type, 'linear');
  assert.equal(mobileStatus.streetLights.artificialLightFactor, 1);
  assert.ok(mobileStatus.streetLights.dynamicBudget <= 4);
  assert.ok(mobileStatus.streetLights.activeDynamicLights <= mobileStatus.streetLights.dynamicBudget);
  assert.deepEqual(smoke.problems, []);
  console.log('world environment smoke: PASS (day/sunset/night, fog fade, pooled street lights, graphics ownership, 390px mobile)');
} finally {
  await smoke.close();
}
