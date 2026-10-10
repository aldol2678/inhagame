import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke({ viewport: { width: 390, height: 844 },
  contextOptions: { isMobile: true, hasTouch: true } });
let page;
try {
  page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  let releaseModel;
  const hold = new Promise(resolve => { releaseModel = resolve; });
  await page.route('**/assets/induck-v3.glb', async route => { await hold; await route.continue(); });
  await page.goto(`${smoke.origin}/campus/?lobby=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(() => document.getElementById('world-loading').dataset.phase === 'ASSETS', null, { timeout: TIMEOUT_MS }), fatal
  ]);
  // Cross the slow-load threshold with the actual character request held open.
  await page.waitForFunction(() => window.__INHA_WORLD_LOADING__?.status().slow === true);
  assert.equal(await page.locator('#world-loading').isVisible(), true);
  assert.equal(await page.locator('#world-loading-continue').isVisible(), false);
  assert.equal(await page.evaluate(() => document.getElementById('world-lobby').inert), true);
  assert.equal(await page.evaluate(() => window.__INHA_WORLD_LOADING__.finish({ early: true })), false);
  releaseModel();
  await Promise.race([
    page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().loading?.renderReady === true, null, { timeout: TIMEOUT_MS }), fatal
  ]);
  await page.locator('#world-loading').waitFor({ state: 'hidden' });
  const status = await page.evaluate(() => ({ loading: window.__INHA_WORLD_LOADING__.status(),
    model: window.__INHAGAME_P0__.character.modelState, inert: document.getElementById('world-lobby').inert }));
  assert.equal(status.loading.finished, true);
  assert.equal(status.model, 'glb');
  assert.equal(status.inert, false);
  await page.locator('#main-gate-start').tap();
  await page.waitForFunction(() => {
    const d = window.__INHAGAME_P0__, s = d.getStatus();
    return d.lobbyWorld.active === false && !s.cinematic?.active && d.controller.inputEnabled;
  }, null, { timeout: TIMEOUT_MS });
  assert.deepEqual(smoke.problems, []);
  console.log('mobile loading render smoke: PASS', JSON.stringify(status));
} catch (error) {
  console.error('loading render smoke state', await page?.evaluate(() => ({
    loading: window.__INHA_WORLD_LOADING__?.status(),
    state: document.getElementById('world-loading')?.dataset.state,
    message: document.getElementById('world-loading-message')?.textContent,
    world: window.__INHAGAME_P0__?.getStatus()
  })));
  throw error;
} finally { await smoke.close(); }
