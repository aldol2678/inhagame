// Offline native-browser acceptance against the real panel and GuestbookClient.
// The local server exposes an allowlist of source files only; no backend or write endpoint.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const output = process.env.GUESTBOOK_RETRY_OUTPUT || 'test-results/guestbook-load-retry';
await mkdir(output, { recursive: true });
const paths = ['src/guestbook/guestbook-panel.js', 'src/guestbook/guestbook-client.js',
  'tests/browser/guestbook-load-retry-harness.html', 'styles.css'];
const sources = new Map(await Promise.all(paths.map(async name => [`/${name}`, await readFile(new URL(`../../${name}`, import.meta.url))])));
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: 'RUNNING',
  sourceHashes: Object.fromEntries([...sources].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
  viewports: [], screenshots: [], scope: 'Synthetic read-only RPCs; no login, account, backend, or production writes' };
if (process.env.GUESTBOOK_RETRY_HEAD) assert.equal(report.head, process.env.GUESTBOOK_RETRY_HEAD);
let browser, server, origin;
const screenshot = async (page, name) => {
  await page.screenshot({ path: `${output}/${name}` });
  const bytes = await readFile(`${output}/${name}`);
  report.screenshots.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};
try {
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname, body = sources.get(pathname);
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8'
      : pathname.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8' }); response.end(body);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.GUESTBOOK_RETRY_BROWSER ? { executablePath: process.env.GUESTBOOK_RETRY_BROWSER } : {}) });
  report.browserVersion = browser.version();
  for (const [label, width, height, mobile] of [
    ['desktop', 1280, 800, false], ['portrait', 360, 800, true], ['landscape', 800, 360, true]
  ]) {
    const viewport = { width, height };
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && sources.has(url.pathname)) return route.continue();
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const item = { label, ...viewport, mobile, status: 'RUNNING' }; report.viewports.push(item);
    const snapshot = () => page.evaluate(() => window.__GUESTBOOK_RETRY__.snapshot());
    const mode = value => page.evaluate(v => window.__GUESTBOOK_RETRY__.mode(v), value);
    const settle = (index, success) => page.evaluate(([i, ok]) => window.__GUESTBOOK_RETRY__.settle(i, ok), [index, success]);
    const retry = () => page.locator('.guestbook-retry');
    const waitError = () => page.waitForFunction(() => document.querySelector('.guestbook-retry')?.disabled === false);
    const focusIs = async selector => assert.equal(await page.locator(selector).evaluate(node => document.activeElement === node), true);
    const open = () => mobile ? page.locator('#opener').tap() : page.locator('#opener').click();
    try {
      await page.goto(`${origin}/tests/browser/guestbook-load-retry-harness.html`);
      await page.waitForFunction(() => window.__GUESTBOOK_RETRY__);
      item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
        const bytes = await (await fetch(path)).arrayBuffer(), hash = await crypto.subtle.digest('SHA-256', bytes);
        return [path, [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')];
      }))), [...sources.keys()]);
      assert.deepEqual(item.servedSourceHashes, report.sourceHashes);
      if (mobile) await open(); else await page.keyboard.press('Enter');
      await waitError(); await screenshot(page, `${viewport.width}-error.png`);
      await mode('hold');
      if (mobile) await retry().tap();
      else {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
        await focusIs('.guestbook-retry'); await page.keyboard.press('Enter');
      }
      assert.equal(await retry().isDisabled(), true);
      if (!mobile) await focusIs('.guestbook-load-status');
      await page.evaluate(() => { document.querySelector('.guestbook-retry').click(); void window.__GUESTBOOK_RETRY__.ui.refresh(); });
      assert.equal((await snapshot()).calls.length, 2, 'repeat retry is single-flight');
      await screenshot(page, `${viewport.width}-pending.png`);
      await settle(0, false); await waitError();
      if (mobile) await retry().tap();
      else { await focusIs('.guestbook-retry'); await page.keyboard.press('Space'); }
      await settle(1, true); await page.locator('.guestbook-textarea').waitFor();
      assert.equal(await retry().count(), 0); assert.equal(await page.locator('.guestbook-hint').count(), 0);
      if (!mobile) await focusIs('.guestbook-textarea');
      await page.locator('.guestbook-textarea').fill('같은 계정의 작성 중 내용');
      await mode('error');
      if (mobile) await page.locator('.profile-close').tap(); else await page.keyboard.press('Escape');
      assert.equal(await page.locator('#guestbook').isVisible(), false);
      await open(); await waitError(); await mode('success');
      if (mobile) await retry().tap(); else await retry().click();
      await page.locator('.guestbook-textarea').waitFor();
      assert.equal(await page.locator('.guestbook-textarea').inputValue(), '같은 계정의 작성 중 내용');
      await page.locator('.guestbook-entry-edit').click(); await page.locator('.guestbook-textarea').fill('수정 중 내용');
      await page.locator('.profile-close').click(); await open(); await page.locator('.guestbook-textarea').waitFor();
      assert.equal(await page.locator('.guestbook-textarea').inputValue(), '수정 중 내용');
      assert.notEqual((await snapshot()).editingId, null);
      await screenshot(page, `${viewport.width}-recovered.png`);
      item.layout = await page.locator('#guestbook').evaluate(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(item.layout.left >= -1 && item.layout.right <= viewport.width + 1);
      assert.ok(item.layout.top >= -1 && item.layout.bottom <= viewport.height + 1);
      assert.equal(item.layout.overflow, false);
      // Close/account/logout boundaries fence both delayed successes and failures.
      for (const boundary of ['close', 'account', 'logout']) for (const success of [false, true]) {
        await page.evaluate(() => window.__GUESTBOOK_RETRY__.ui.setOpen(false));
        await page.evaluate(() => window.__GUESTBOOK_RETRY__.switchAccount('A'));
        await mode('error'); await open(); await waitError(); await mode('hold');
        await retry().click(); const index = (await snapshot()).pending - 1;
        if (boundary === 'close') await page.locator('.profile-close').click();
        else await page.evaluate(value => window.__GUESTBOOK_RETRY__.switchAccount(value), boundary === 'account' ? 'B' : null);
        if (boundary !== 'logout') {
          await mode('success'); await open(); await page.locator('.guestbook-textarea').waitFor();
          if (boundary === 'account') assert.equal(await page.locator('.guestbook-textarea').inputValue(), '');
          await page.locator('.guestbook-textarea').fill('현재 화면의 초안');
        }
        const current = await snapshot(); await settle(index, success);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.equal((await snapshot()).owner, current.owner);
        if (boundary === 'logout') assert.equal(await page.locator('#guestbook').isVisible(), false);
        else assert.equal(await page.locator('.guestbook-textarea').inputValue(), '현재 화면의 초안');
      }
      item.final = await snapshot(); assert.deepEqual(item.final.writes, []);
      item.trustedEvents = await page.evaluate(() => window.__GUESTBOOK_RETRY__.events.filter(e => e.trusted));
      if (mobile) assert.ok(item.trustedEvents.some(e => e.pointerType === 'touch'));
      else for (const code of ['Tab', 'Enter', 'Space', 'Escape']) assert.ok(item.trustedEvents.some(e => e.code === code));
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []); item.status = 'PASS';
    } finally { await context.close(); }
  }
  report.status = 'PASS'; console.log('PASS: guestbook native retry, same-account drafts, close/account/logout races; zero writes');
} catch (error) {
  report.status = browser ? 'FAIL' : 'BLOCKED'; report.error = error.stack; throw error;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
