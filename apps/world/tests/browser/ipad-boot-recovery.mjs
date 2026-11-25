import assert from 'node:assert/strict';
import { devices, webkit } from 'playwright';

const origin = 'http://127.0.0.1:8021';
const engine = '/vendor/playcanvas/2.22.4/playcanvas.min.mjs';
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ ...devices['iPad Pro 11 landscape'] });
  page.on('pageerror', error => console.log('WebKit page error:', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log(msg.text()); });
  let engineLoaded = false;
  page.on('response', response => {
    if (response.url() === origin + engine && response.ok()) engineLoaded = true;
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && (url.pathname.startsWith('/data/reality/') || url.pathname === '/data/editor/main-gate.world.json')) {
      return route.abort();
    }
    if (url.origin === origin) return url.pathname.startsWith('/api/')
      ? route.fulfill({ status: 204 }) : route.continue();
    return route.abort();
  });
  const isMain = url => url.pathname === '/src/main.js';
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route(isMain, async route => {
    await hold;
    await route.continue();
  });
  await page.goto(origin + '/campus/?lobby=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.__INHA_WORLD_BOOT_RECOVERY__);
  await page.evaluate(() => { void Promise.reject(new Error('optional initialization')); });
  await page.waitForFunction(() =>
    window.__INHA_WORLD_BOOT_RECOVERY__.status().code === 'BOOT_ENTRY_DELAY_AFTER_REJECTION');
  assert.equal(await page.locator('#world-loading-retry').isVisible(), true);
  release();
  await page.waitForFunction(() =>
    ['ERROR', 'READY'].includes(window.__INHA_WORLD_BOOT_RECOVERY__.status().state), null, { timeout: 90000 });
  const status = await page.evaluate(() => window.__INHA_WORLD_BOOT_RECOVERY__.status());
  console.log('WebKit campus boot', status);
  assert.equal(status.state, 'READY');
  await page.locator('#world-loading').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#world-lobby').evaluate(el => el.inert), false);
  assert.equal(engineLoaded, true);
  await page.locator('#main-gate-start').tap();
  await page.locator('#world-lobby').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#application').isVisible(), true);
  console.log('PASS WebKit tablet: rendered campus and entered through the main gate after early rejection');
  await page.route(isMain, route => route.fulfill({
    contentType: 'text/javascript', body: "throw new ReferenceError('test entry failure')"
  }));
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__INHA_WORLD_BOOT_RECOVERY__?.status().code === 'BOOT_ENTRY_IMPORT_FAILED');
  assert.match(await page.locator('#world-loading-detail').innerText(), /ReferenceError.*test entry failure/);
  assert.equal(await page.locator('#world-loading-retry').isVisible(), true);
  await page.unroute(isMain);
  await Promise.all([
    page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() }),
    page.locator('#world-loading-retry').tap()
  ]);
  await page.waitForFunction(() => window.__INHA_WORLD_BOOT_RECOVERY__?.status().state === 'READY',
    null, { timeout: 90000 });
  await page.locator('#main-gate-start').tap();
  await page.locator('#world-lobby').waitFor({ state: 'hidden' });
  console.log('PASS WebKit tablet: entry exception displayed and manual retry reached campus');
} finally {
  await browser.close();
}
