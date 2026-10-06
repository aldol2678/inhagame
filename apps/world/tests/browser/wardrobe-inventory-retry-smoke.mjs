// Native keyboard/touch acceptance against the real panel and read clients, using synthetic RPCs.
// Only the local fixture origin is allowed; no login, backend or production requests.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = process.env.WARDROBE_RETRY_OUTPUT || 'test-results/wardrobe-inventory-retry';
await mkdir(output, { recursive: true });
const paths = ['src/appearance/wardrobe-panel.js', 'src/inventory/inventory-client.js', 'src/appearance/loadout-client.js'];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path,
    createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')]))),
  cases: [], result: 'running' };
if (process.env.WARDROBE_RETRY_HEAD) assert.equal(report.head, process.env.WARDROBE_RETRY_HEAD);
let browser, server;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.WARDROBE_RETRY_BROWSER ? { executablePath: process.env.WARDROBE_RETRY_BROWSER } : {}) });
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address(); probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local fixture server timeout')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}`)); });
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 360, height: 800 } : { width: 1000, height: 800 },
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const item = { label: mobile ? 'mobile-360' : 'desktop', result: 'running' }; report.cases.push(item);
    const retry = () => page.locator('.wardrobe-owned button.shop-retry');
    const snapshot = () => page.evaluate(() => window.__WARDROBE_RETRY__.snapshot());
    const focusIs = async selector => assert.equal(await page.locator(selector).evaluate(el => el === document.activeElement), true, selector);
    const open = async () => {
      await page.goto(`${origin}/tests/browser/wardrobe-inventory-retry-harness.html`);
      await page.waitForFunction(() => Boolean(window.__WARDROBE_RETRY__));
      item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
        const bytes = await (await fetch(`/${path}`)).arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [path, [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')];
      }))), paths);
      assert.deepEqual(item.servedSourceHashes, report.sourceHashes);
      if (mobile) await page.locator('#opener').tap(); else await page.keyboard.press('Enter');
      await retry().waitFor();
    };
    try {
      await open();
      await page.locator('.wardrobe-owned').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${item.label}-error.png` });
      const before = await snapshot();
      await page.evaluate(() => window.__WARDROBE_RETRY__.hold());
      if (mobile) await retry().tap();
      else {
        await page.keyboard.press('Tab'); // current HEAD unequip
        await page.keyboard.press('Tab'); // owned-list retry
        await focusIs('.wardrobe-owned button.shop-retry');
        await page.keyboard.press('Enter');
      }
      assert.equal(await retry().isDisabled(), true);
      await page.screenshot({ path: `${output}/${item.label}-pending.png` });
      if (!mobile) await focusIs('.wardrobe-owned');
      await page.evaluate(() => document.querySelector('.wardrobe-owned button').click());
      assert.equal((await snapshot()).inventoryReads, before.inventoryReads + 1);
      const scroll = await page.locator('.shop-panel-body').evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      assert.ok(scroll > 0, 'the fixture exercises actual native scrolling');
      await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, false));
      await page.waitForFunction(() => !document.querySelector('.wardrobe-owned button')?.disabled);
      assert.equal(await page.locator('.shop-panel-body').evaluate(el => el.scrollTop), scroll);
      if (!mobile) { await focusIs('.wardrobe-owned button.shop-retry'); await page.keyboard.press('Space'); }
      else await retry().tap();
      await page.evaluate(() => window.__WARDROBE_RETRY__.settle(1, true));
      await page.locator('.wardrobe-item').waitFor();
      assert.equal(await retry().count(), 0);
      if (!mobile) await focusIs('.profile-close');
      assert.equal(await page.locator('.wardrobe-slot[data-slot="HEAD"]').getAttribute('data-item-id'), 'head.inha_cap');
      assert.equal((await snapshot()).loadoutReads, before.loadoutReads);
      assert.deepEqual((await snapshot()).writes, []);
      item.layout = await page.locator('#wardrobe').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(item.layout.left >= -1 && item.layout.right <= item.layout.width + 1, 'panel fits horizontally');
      assert.ok(item.layout.top >= -1 && item.layout.bottom <= item.layout.height + 1, 'panel fits vertically');
      assert.equal(item.layout.overflow, false, 'no horizontal page overflow');
      await page.screenshot({ path: `${output}/${item.label}-recovered.png` });
      if (mobile) await page.locator('.profile-close').tap(); else await page.keyboard.press('Escape');
      assert.equal(await page.locator('#wardrobe').isVisible(), false);
      await focusIs('#opener');
      item.trustedEvents = await page.evaluate(() => window.__WARDROBE_RETRY__.events.filter(event => event.trusted));
      if (mobile) assert.ok(item.trustedEvents.some(event => event.pointerType === 'touch'));
      else for (const code of ['Tab', 'Enter', 'Space', 'Escape']) {
        assert.ok(item.trustedEvents.some(event => event.type === 'keydown' && event.code === code), `native ${code}`);
      }
      if (!mobile) {
        await open(); await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, true));
        assert.equal(await page.locator('#wardrobe').isVisible(), false); await focusIs('#opener');
        await open(); await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.evaluate(() => window.__WARDROBE_RETRY__.switchAccount('B'));
        assert.equal(await retry().isEnabled(), true);
        await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, true));
        assert.equal(await retry().isDisabled(), true);
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(1, true, 'top.inha_basic'));
        await page.locator('.wardrobe-item[data-item-id="top.inha_basic"]').waitFor();
        assert.equal(await page.locator('.wardrobe-item[data-item-id="head.inha_cap"]').count(), 0);
        assert.deepEqual((await snapshot()).writes, []);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, [], 'the fixture attempts no backend or off-origin requests');
      item.result = 'pass';
    } finally { await context.close(); }
  }
  report.result = 'pass'; console.log('PASS: wardrobe inventory retry native keyboard/touch, loadout preservation, close and account races');
} catch (error) {
  report.result = browser ? 'fail' : 'blocked'; report.error = error.stack; throw error;
} finally {
  await browser?.close(); server?.kill();
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
