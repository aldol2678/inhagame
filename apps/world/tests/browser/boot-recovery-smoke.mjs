// Real campus entry; failures injected only by local Playwright routes. Backend/off-origin
// traffic is isolated by the shared harness. No production flags or shortened deadlines.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const smoke = await startSmoke({ viewport: { width: 360, height: 800 },
  contextOptions: { isMobile: true, hasTouch: true } });
const evidenceDir = process.env.BOOT_RECOVERY_QA_OUTPUT || 'test-results/boot-recovery';
await mkdir(evidenceDir, { recursive: true });
const evidence = [];
const url = `${smoke.origin}/campus/?lobby=1#boot-recovery`;
const status = page => page.evaluate(() => ({
  recovery: globalThis.__INHA_WORLD_BOOT_RECOVERY__?.status(),
  loading: globalThis.__INHA_WORLD_LOADING__?.status(),
  inert: document.getElementById('world-lobby').inert
}));
const waitCode = (page, code) => page.waitForFunction(code =>
  globalThis.__INHA_WORLD_BOOT_RECOVERY__?.status().code === code, code, { timeout: TIMEOUT_MS });
const ready = page => page.waitForFunction(() =>
  globalThis.__INHA_WORLD_BOOT_RECOVERY__?.status().state === 'READY', null, { timeout: TIMEOUT_MS });
async function checkRetry(page) {
  const button = page.locator('#world-loading-retry');
  assert.equal(await button.isVisible(), true);
  const box = await button.boundingBox(), viewport = page.viewportSize();
  assert.ok(box.width > 0 && box.height >= 44 && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, JSON.stringify(box));
  const current = await status(page);
  assert.equal(current.inert, true);
  evidence.push({ ...current, viewport, retryBounds: box });
  await page.screenshot({ path: join(evidenceDir, `${evidence.length}-${current.recovery.code}.png`) });
}
try {
  // Independent of either module successfully loading; nested import fetch failures surface
  // on the entry script too. Exercise all three request failures in actual Chromium.
  for (const path of ['/src/lobby/lobby-loading.js', '/src/main.js', '/src/player-controller.js']) {
    const page = await smoke.context.newPage();
    const dependency = path;
    await page.route(`**${dependency}`, route => route.abort('failed'));
    await page.goto(url, { waitUntil: 'commit' });
    await waitCode(page, 'BOOT_MODULE_ERROR');
    await checkRetry(page);
    const failed = await status(page);
    assert.notEqual(failed.loading?.finished, true);
    if (path === '/src/main.js') {
      for (const viewport of [{ width: 320, height: 568 }, { width: 800, height: 360 }]) {
        await page.setViewportSize(viewport); await checkRetry(page);
      }
      await page.unroute(`**${dependency}`);
      await Promise.all([page.waitForURL(url, { waitUntil: 'domcontentloaded' }), page.locator('#world-loading-retry').tap()]);
      await ready(page);
      const recovered = await status(page);
      assert.equal(recovered.loading.essentialReady, true);
      assert.equal(recovered.loading.renderReady, true);
      assert.equal(page.url(), url);
      assert.equal(recovered.inert, false);
    }
    console.log(`PASS module request failure: ${dependency}${path === '/src/main.js' ? ' + manual retry + portrait/landscape' : ''}`);
    await page.close();
  }
  {
    const page = await smoke.context.newPage();
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: 'invalid syntax @' }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitCode(page, 'BOOT_SCRIPT_ERROR'); await checkRetry(page);
    console.log('PASS module parse failure'); await page.close();
  }
  {
    const page = await smoke.context.newPage();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route('**/src/main.js', async route => { await hold; await route.continue(); });
    await page.goto(url, { waitUntil: 'commit' });
    await waitCode(page, 'BOOT_ENTRY_DELAY'); await checkRetry(page);
    assert.equal((await status(page)).recovery.state, 'DELAYED');
    release(); await ready(page);
    console.log('PASS entry stall warning + natural recovery'); await page.close();
  }
  for (const model of ['induck-v3.glb', 'annyongi-flight-v1.glb']) {
    const page = await smoke.context.newPage();
    await page.route(`**/assets/${model}`, route => route.fulfill({ status: 404, body: 'missing test model' }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitCode(page, 'ASSET_LOAD_FAILED'); await checkRetry(page);
    assert.equal((await status(page)).loading.essentialReady, false);
    assert.equal((await status(page)).loading.finished, false);
    console.log(`PASS required asset failure: ${model}`); await page.close();
  }
  {
    const page = await smoke.context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: undefined });
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return /webgl/.test(type) ? null : original.call(this, type, ...args);
      };
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitCode(page, 'GRAPHICS_INIT_FAILED'); await checkRetry(page);
    await page.setViewportSize({ width: 800, height: 360 }); await checkRetry(page);
    console.log('PASS graphics initialization failure + landscape'); await page.close();
  }
  {
    const page = await smoke.context.newPage();
    const fatal = smoke.watch(page);
    await page.addInitScript(() => { globalThis.__BOOT_TEST_HOLD_RENDER__ = true; });
    const source = await readFile(new URL('../../src/lobby/lobby-loading.js', import.meta.url), 'utf8');
    assert.ok(source.includes('const onRender = () => {'));
    await page.route('**/src/lobby/lobby-loading.js', route => route.fulfill({ contentType: 'text/javascript',
      body: source.replace('const onRender = () => {', 'const onRender = () => { if (globalThis.__BOOT_TEST_HOLD_RENDER__) return;') }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await Promise.race([waitCode(page, 'INITIAL_RENDER_DELAY'), fatal]);
    await checkRetry(page);
    assert.equal((await status(page)).loading.finished, false);
    assert.equal((await status(page)).loading.renderReady, false);
    await page.evaluate(() => { globalThis.__BOOT_TEST_HOLD_RENDER__ = false; });
    await Promise.race([ready(page), fatal]);
    assert.deepEqual(smoke.problems, []);
    console.log('PASS initial render stall + real frame gate recovery'); await page.close();
  }
  console.log('boot recovery browser smoke: PASS');
} finally {
  await writeFile(join(evidenceDir, 'scenarios.json'), JSON.stringify(evidence, null, 2));
  await smoke.close();
}
