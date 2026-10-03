import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?envTime=sunset`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  const initial = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(initial.environment.targetTime, 'SUNSET');
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
  assert.ok(night.environment.exposure < initial.environment.exposure);
  for (const field of ['tier', 'castShadows', 'shadowResolution', 'shadowDistance'])
    assert.equal(night.graphics[field], initial.graphics[field], `environment must not own graphics field ${field}`);

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('day', { immediate: true }));
  const day = await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
  assert.equal(day.targetTime, 'DAY');
  assert.equal(day.settled, true);
  assert.equal(day.exposure, 1.05);

  const mobile = await smoke.context.newPage();
  smoke.watch(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${smoke.origin}/campus/?envTime=night`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await mobile.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );
  const mobileStatus = await mobile.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
  assert.equal(mobileStatus.targetTime, 'NIGHT');
  assert.deepEqual(smoke.problems, []);
  console.log('world environment P0 smoke: PASS (sunset/night/day transition, graphics ownership, 390px mobile)');
} finally {
  await smoke.close();
}
