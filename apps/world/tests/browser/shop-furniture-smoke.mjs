// Offline acceptance: real Shop/Inventory clients and UI, synthetic RPC only. No backend writes.
// SHOP_FURNITURE_BROWSER_PATH can select installed Chromium; output stays under test-results/.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const output = process.env.SHOP_FURNITURE_OUTPUT ?? 'test-results/shop-furniture';
await mkdir(output, { recursive: true });
const report = { result: 'running', scope: 'Local real Shop/Inventory clients and UI; synthetic RPC, room authority and editor', checks: [] };
const port = await new Promise(resolve => { const probe = createServer().listen(0, '127.0.0.1', () => {
  const port = probe.address().port; probe.close(() => resolve(port));
}); });
const origin = `http://127.0.0.1:${port}`;
let browser, server, page;
try {
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Local server timeout')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve(); } });
    server.on('exit', code => { clearTimeout(timeout); reject(Error(`Server exit: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true,
    ...(process.env.SHOP_FURNITURE_BROWSER_PATH ? { executablePath: process.env.SHOP_FURNITURE_BROWSER_PATH } : {}) });
  for (const viewport of [{ width: 1000, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const run = async (name, callback) => { await callback(); report.checks.push(`${viewport.width}px: ${name}`); };
    const card = page.locator('[data-listing-id="fixture.0"]');
    const buy = card.locator('.shop-offer-buy'), action = card.locator('.shop-furniture-action');
    const ready = async () => {
      await page.goto(`${origin}/tests/browser/shop-furniture-harness.html`);
      await page.waitForFunction(() => Boolean(window.__FURNITURE_SHOP__)); await page.locator('#opener').click();
      await buy.waitFor();
    };
    await ready();
    await run('actual dimensions and floor/wall placement shown', async () => {
      assert.match(await card.textContent(), /가로 0\.45 × 높이 0\.14 × 깊이 0\.4/);
      assert.match(await card.textContent(), /놓을 곳: 바닥 · 침대 위/);
      assert.match(await page.locator('[data-listing-id="fixture.1"]').textContent(), /놓을 곳: 벽/);
      assert.equal(await page.locator('.shop-offer').count(), 3);
    });
    await run('purchase waits for Inventory and blocks repeated clicks', async () => {
      await buy.click(); await page.evaluate(() => window.__FURNITURE_SHOP__.finishPurchase({ inventory: 'deferred' }));
      await page.waitForFunction(() => Boolean(document.querySelector('.shop-furniture-action')));
      assert.equal(await buy.isDisabled(), true); assert.equal(await action.isDisabled(), true);
      await buy.evaluate(button => { button.click(); button.click(); });
      assert.equal(await page.evaluate(() => window.__FURNITURE_SHOP__.writes()), 1);
      assert.equal(await page.locator('#editor').isVisible(), false);
      await page.evaluate(() => window.__FURNITURE_SHOP__.finishInventory('failed'));
      await page.waitForFunction(() => document.querySelector('.shop-furniture-action')?.textContent === '보유 가구 다시 확인');
    });
    await run('failed Inventory preserves success, no overflow, and touch-sized read-only recovery', async () => {
      assert.match(await card.textContent(), /다시 구매하지 말고/); assert.equal(await buy.isDisabled(), true);
      await action.scrollIntoViewIfNeeded(); const box = await action.boundingBox();
      assert.ok(box.height >= 44); assert.ok(box.x >= 0 && box.x + box.width <= viewport.width);
      const overflow = await page.locator('#shop').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth,
        bottom: el.getBoundingClientRect().bottom, height: innerHeight }));
      assert.ok(overflow.scroll <= overflow.width + 1); assert.ok(overflow.bottom <= overflow.height);
      await page.screenshot({ path: `${output}/inventory-retry-${viewport.width}.png` });
      await page.evaluate(() => window.__FURNITURE_SHOP__.setInventory('deferred'));
      await action.focus(); await page.keyboard.press('Enter');
      assert.equal(await action.isDisabled(), true);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), 'furniture:fixture.0');
      await page.evaluate(() => window.__FURNITURE_SHOP__.finishInventory('owned'));
      await page.waitForFunction(() => document.querySelector('.shop-furniture-action')?.textContent === '내 방 꾸미기');
      assert.equal(await action.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.__FURNITURE_SHOP__.writes()), 1);
    });
    await run('visitor transition cannot execute a stale own-room action', async () => {
      await page.evaluate(() => { window.__FURNITURE_SHOP__.context.metadata.visitRole = 'visitor'; });
      await action.click(); assert.equal(await page.locator('#editor').isVisible(), false);
      assert.equal(await card.locator('.shop-furniture-action').count(), 0);
      assert.match(await card.textContent(), /내 방에 들어가 권한/);
      await page.evaluate(() => { window.__FURNITURE_SHOP__.context.metadata.visitRole = 'owner'; window.__FURNITURE_SHOP__.panel.render(); });
      await action.click(); assert.equal(await page.locator('#editor').isVisible(), true); assert.equal(await page.locator('#shop').isVisible(), false);
    });
    await ready();
    await run('Escape during Inventory read never reopens the panel or editor', async () => {
      await buy.click(); await page.evaluate(() => window.__FURNITURE_SHOP__.finishPurchase({ inventory: 'deferred' }));
      await action.waitFor(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => window.__FURNITURE_SHOP__.finishInventory('failed'));
      assert.equal(await page.locator('#shop').isVisible(), false); assert.equal(await page.locator('#editor').isVisible(), false);
      await page.locator('#opener').click(); await action.waitFor();
      assert.equal(await action.textContent(), '보유 가구 다시 확인'); assert.equal(await buy.isDisabled(), true);
    });
    assert.deepEqual(errors, []); await context.close(); page = null;
  }
  report.result = 'pass'; console.log(`PASS: ${report.checks.length} shop furniture desktop/mobile checks`);
} catch (error) {
  report.result = 'fail'; report.error = error.stack;
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); server?.kill(); await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
