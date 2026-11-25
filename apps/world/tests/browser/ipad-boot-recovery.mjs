import assert from 'node:assert/strict';
import { devices, webkit } from 'playwright';

const origin = 'http://127.0.0.1:8021';
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url);
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ ...devices['iPad Pro 11 landscape'] });
  page.on('pageerror', error => console.log('WebKit page error:', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log(msg.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return url.pathname.startsWith('/api/')
      ? route.fulfill({ status: 204 }) : route.continue();
    if (url.href === 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.4/build/playcanvas.mjs') {
      return route.fulfill({ path: engine.pathname, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/src/main.js', async route => {
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
  console.log('PASS WebKit tablet: rendered campus and interactive lobby after early rejection');
} finally {
  await browser.close();
}
