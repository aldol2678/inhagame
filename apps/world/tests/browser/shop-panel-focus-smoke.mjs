// Native keyboard/DOM acceptance. Uses only localhost and synthetic read/purchase responses.
// Run: node apps/world/tests/browser/shop-panel-focus-smoke.mjs
// Optional SHOP_FOCUS_BROWSER_PATH selects an already-installed local Chromium.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = process.env.SHOP_FOCUS_OUTPUT || 'test-results/shop-panel-focus';
await mkdir(output, { recursive: true });
const paths = ['src/shop/shop-panel.js', 'src/shop/shop-client.js', 'styles.css'];
const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [path,
  createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')])));
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes,
  scope: 'Production shop client/panel, synthetic responses only; no backend or gameplay purchase', checks: [], result: 'running' };
let browser, server, page;
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const port = probe.address().port; probe.close(() => resolve(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
try {
  if (process.env.SHOP_FOCUS_HEAD_SHA) assert.equal(report.head, process.env.SHOP_FOCUS_HEAD_SHA);
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local fixture server did not start')), 15000);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Local fixture server exited ${code}`)); });
    server.stdout.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true,
    ...(process.env.SHOP_FOCUS_BROWSER_PATH ? { executablePath: process.env.SHOP_FOCUS_BROWSER_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const focus = async selector => assert.equal(await page.locator(selector).evaluate(el => el === document.activeElement), true, selector);
  const action = id => `.shop-offer[data-listing-id="fixture.${id}"] .shop-offer-buy`;
  const card = id => `.shop-offer[data-listing-id="fixture.${id}"]`;
  const run = async (name, check) => { await check(); report.checks.push(name); };
  await page.goto(`${origin}/tests/browser/shop-panel-focus-harness.html`);
  await page.waitForFunction(() => Boolean(window.__SHOP_FOCUS__));
  await run('served source matches working tree', async () => {
    const served = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
      const data = await (await fetch(`/${path}`)).arrayBuffer();
      return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('')];
    }))), paths);
    assert.deepEqual(served, hashes);
  });
  await run('native Enter open and Tab/Shift+Tab', async () => {
    await page.keyboard.press('Enter'); await page.waitForSelector('.shop-offer'); await focus('.profile-close');
    await page.keyboard.press('Tab'); await focus(action(0));
    await page.keyboard.press('Tab'); await focus(action(1));
    await page.keyboard.press('Shift+Tab'); await focus(action(0));
  });
  await run('native scrolling and reordered semantic listing focus', async () => {
    await page.locator(action(8)).focus();
    const before = await page.locator('.shop-panel-body').evaluate(el => { el.scrollTop = 300; return el.scrollTop; });
    assert.ok(before > 0);
    await page.evaluate(() => window.__SHOP_FOCUS__.read({ reverse: true }));
    await focus(action(8)); assert.equal(await page.locator('.shop-panel-body').evaluate(el => el.scrollTop), before);
  });
  await run('pending-safe anchor and successful readback', async () => {
    await page.keyboard.press('Enter'); await focus(card(8));
    assert.equal(await page.locator(action(8)).isDisabled(), true);
    assert.equal(await page.locator(card(8)).getAttribute('tabindex'), '-1');
    await page.keyboard.press('Tab'); await focus(action(7));
    await page.locator(card(8)).focus();
    await page.keyboard.press('Shift+Tab'); await focus(action(9));
    await page.locator(card(8)).focus();
    await page.screenshot({ path: `${output}/pending.png` });
    await page.evaluate(() => window.__SHOP_FOCUS__.finish());
    await page.waitForFunction(() => window.__SHOP_FOCUS__.panel.status().hint.startsWith('구매 완료'));
    await focus(action(8));
    await page.screenshot({ path: `${output}/ready.png` });
  });
  await run('pending completion respects newer keyboard focus', async () => {
    await page.keyboard.press('Enter'); await focus(card(8));
    await page.keyboard.press('Tab'); await focus(action(7));
    await page.evaluate(() => window.__SHOP_FOCUS__.finish('INSUFFICIENT_FUNDS'));
    await page.waitForFunction(() => window.__SHOP_FOCUS__.panel.status().hint.includes('부족'));
    await focus(action(7));
    await page.locator(action(8)).focus();
  });
  await run('disabled/removed listing fallback', async () => {
    await page.evaluate(() => window.__SHOP_FOCUS__.read({ disable: 'fixture.8' })); await focus(card(8));
    await page.evaluate(() => window.__SHOP_FOCUS__.read({ remove: 'fixture.8' })); await focus('.profile-close');
  });
  await run('read failure and retry recovery', async () => {
    await page.evaluate(() => window.__SHOP_FOCUS__.read({ fail: true }));
    await page.locator('.shop-retry').focus(); await page.keyboard.press('Enter');
    await page.evaluate(() => Promise.resolve()); await focus('.shop-retry');
    await page.evaluate(() => window.__SHOP_FOCUS__.read()); await focus('.profile-close');
  });
  await run('outside focus is never stolen by render or close', async () => {
    await page.locator('#outside').focus(); await page.evaluate(() => window.__SHOP_FOCUS__.panel.render()); await focus('#outside');
    await page.evaluate(() => window.__SHOP_FOCUS__.panel.setOpen(false)); await focus('#outside');
  });
  await run('account boundary resets scroll and old purchase context', async () => {
    await page.locator('#opener').click(); await page.locator(action(8)).focus(); await page.keyboard.press('Enter');
    await page.evaluate(() => window.__SHOP_FOCUS__.account('fixture-account-b')); await focus('.profile-close');
    assert.equal(await page.locator('.shop-panel-body').evaluate(el => el.scrollTop), 0);
    await page.evaluate(() => window.__SHOP_FOCUS__.finish()); await focus('.profile-close');
    assert.equal(await page.evaluate(() => window.__SHOP_FOCUS__.panel.status().hint), '');
  });
  await run('native Escape restores opener', async () => {
    await page.keyboard.press('Escape'); await focus('#opener');
    assert.equal(await page.locator('#shop').isVisible(), false);
  });
  report.trustedKeyboard = await page.evaluate(() => window.__SHOP_FOCUS__.events
    .filter(event => event.type === 'keydown' && event.trusted));
  for (const code of ['Tab', 'Enter', 'Escape']) assert.ok(report.trustedKeyboard.some(event => event.code === code), `native ${code}`);
  assert.ok(report.trustedKeyboard.some(event => event.code === 'Tab' && event.shiftKey), 'native Shift+Tab');
  for (const invalid of ['disabled', 'hidden', 'inert', 'removed']) await run(`invalid ${invalid} opener`, async () => {
    await page.reload(); await page.waitForFunction(() => Boolean(window.__SHOP_FOCUS__));
    await page.keyboard.press('Enter'); await page.waitForSelector('.shop-offer');
    await page.evaluate(invalid => {
      const opener = document.getElementById('opener');
      if (invalid === 'removed') opener.remove(); else opener.setAttribute(invalid, '');
    }, invalid);
    await page.keyboard.press('Escape'); assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'opener');
  });
  assert.deepEqual(errors, []);
  report.result = 'pass'; console.log(`PASS: ${report.checks.length} shop native keyboard/focus checks`);
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  report.result = 'fail'; report.error = error.stack; throw error;
} finally {
  await browser?.close(); server?.kill();
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
