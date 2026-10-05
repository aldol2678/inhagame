// Offline graphics settings plus WebGPU-to-WebGL2 fallback smoke.
// Run with WORLD_SMOKE_BROWSER=msedge WORLD_SMOKE_HEADED=1 on a GPU-enabled desktop.
import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished, null, { timeout: TIMEOUT_MS });
  assert.equal((await page.evaluate(() => window.__INHAGAME_P0__.getStatus())).renderer, 'WebGPU');
  await page.locator('#hud-menu-toggle').click();
  await page.locator('#open-settings').click();
  assert.equal(await page.locator('#graphics-quality').inputValue(), 'auto');
  const measure = () => page.evaluate(() => {
    const runtime = window.__INHAGAME_P0__;
    return {
      graphics: runtime.getStatus().graphics,
      canvasWidth: document.getElementById('application').width,
      detailEnter: runtime.streaming.policy.detailEnter,
      viewDistance: runtime.viewSettings.current.id,
      map: runtime.getStatus().minimap?.state ?? null
    };
  });
  const initial = await measure();
  const readings = {};
  for (const tier of ['low', 'medium', 'high']) {
    await page.locator('#graphics-quality').selectOption(tier);
    readings[tier] = await measure();
    assert.equal(readings[tier].graphics.preference, tier);
    assert.equal(readings[tier].graphics.tier, tier);
    assert.equal(readings[tier].viewDistance, initial.viewDistance);
    assert.equal(readings[tier].map, initial.map);
  }
  assert.ok(readings.low.canvasWidth < readings.medium.canvasWidth);
  assert.equal(readings.low.graphics.castShadows, false);
  assert.equal(readings.medium.graphics.shadowResolution, 1024);
  assert.equal(readings.high.graphics.shadowResolution, 2048);
  assert.ok(readings.low.detailEnter < readings.medium.detailEnter);
  assert.ok(readings.high.detailEnter > readings.medium.detailEnter);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished, null, { timeout: TIMEOUT_MS });
  assert.equal((await measure()).graphics.preference, 'high', 'manual choice survives reload');
  await page.locator('#hud-menu-toggle').click();
  await page.locator('#open-settings').click();
  await page.locator('#graphics-quality').selectOption('auto');
  assert.equal((await measure()).graphics.preference, 'auto');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished, null, { timeout: TIMEOUT_MS });
  assert.equal((await measure()).graphics.preference, 'auto', 'AUTO survives reload');

  const fallback = await smoke.context.newPage();
  smoke.watch(fallback);
  await fallback.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
  await fallback.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await fallback.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished, null, { timeout: TIMEOUT_MS });
  const fallbackStatus = await fallback.evaluate(() => window.__INHAGAME_P0__.getStatus());
  assert.equal(fallbackStatus.renderer, 'WebGL2');
  assert.equal(fallbackStatus.loading.phase, 'READY');
  assert.equal(await fallback.locator('#world-loading').getAttribute('data-state'), 'DONE');

  const mobile = await smoke.context.newPage();
  smoke.watch(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${smoke.origin}/campus/?lobby=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await mobile.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished, null, { timeout: TIMEOUT_MS });
  await mobile.locator('#lobby-menu-toggle').click();
  await mobile.locator('#lobby-open-settings').click();
  assert.equal(await mobile.locator('#view-settings').isVisible(), true);
  await mobile.locator('#graphics-quality').selectOption('medium');
  assert.equal((await mobile.evaluate(() => window.__INHAGAME_P0__.getStatus())).graphics.tier, 'medium');
  assert.deepEqual(smoke.problems, []);
  console.log(`world graphics smoke: PASS (low/medium/high, persistence, AUTO, WebGL2 fallback, mobile lobby settings; ${JSON.stringify(readings)})`);
} finally { await smoke.close(); }
