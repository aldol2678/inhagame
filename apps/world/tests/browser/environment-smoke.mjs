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
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  const initial = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(initial.environment.targetTime, 'SUNSET');
  assert.equal(initial.environment.targetWeather, 'FOG');
  assert.equal(initial.environment.fog.type, 'linear');
  assert.ok(initial.environment.fog.start < initial.environment.fog.end);
  assert.ok(initial.environment.exposure < 1.05 && initial.environment.exposure > 0.82);

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('night'));
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().settled &&
      window.__INHAGAME_ENVIRONMENT__.status().targetTime === 'NIGHT',
    null,
    { timeout: TIMEOUT_MS }
  );
  const night = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(night.environment.targetTime, 'NIGHT');
  assert.equal(night.environment.fog.type, 'linear');
  assert.ok(night.environment.exposure < initial.environment.exposure);
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
  const dayFog = await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
  assert.equal(dayFog.targetTime, 'DAY');
  assert.equal(dayFog.targetWeather, 'FOG');
  assert.equal(dayFog.fog.type, 'linear');
  assert.equal(dayFog.settled, true);
  assert.equal(dayFog.weatherSettled, true);
  assert.equal(dayFog.exposure, 1.05);

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
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );
  const mobileStatus = await mobile.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
  assert.equal(mobileStatus.targetTime, 'NIGHT');
  assert.equal(mobileStatus.targetWeather, 'FOG');
  assert.equal(mobileStatus.fog.type, 'linear');
  assert.deepEqual(smoke.problems, []);
  console.log('world environment smoke: PASS (day/sunset/night, fog fade, graphics ownership, 390px mobile)');
} finally {
  await smoke.close();
}
