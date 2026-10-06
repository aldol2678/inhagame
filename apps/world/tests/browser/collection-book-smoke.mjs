// Exact-head native acceptance using synthetic reads. No live account or database traffic.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = process.env.COLLECTION_BOOK_OUTPUT || 'test-results/collection-book';
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedHead = process.env.EXPECTED_COLLECTION_BOOK_HEAD;
assert.match(expectedHead ?? '', /^[0-9a-f]{40}$/, 'An immutable expected head is required');
assert.equal(head, expectedHead, 'Only the exact candidate head may run this acceptance');
const paths = ['src/collection/collection-book-contract.mjs', 'src/collection/collection-book-client.js', 'src/collection/collection-book-view.js',
  'src/inventory/inventory-panel.js', 'src/inventory/inventory-client.js',
  'src/collection/item-catalog.js', 'src/inventory/inventory-category-registry.js',
  'src/config/supabase-public-config.js', 'src/config/supabase-public-config.mjs',
  'src/collection/collection-discovery-contract.js', 'src/collection/collection-discovery-contract.mjs',
  'tests/browser/collection-book-harness.html', 'styles.css'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { head, expectedHead, result: 'RUNNING', scope: 'Synthetic reads; no live availability/history claim',
  sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, hash(await readFile(new URL(`../../${path}`, import.meta.url)))]))), screenshots: [], cases: [] };
async function screenshot(page, name) {
  await page.screenshot({ path: `${output}/${name}` });
  const bytes = await readFile(`${output}/${name}`);
  report.screenshots.push({ file: name, bytes: bytes.length, sha256: hash(bytes) });
}
let browser, server;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.COLLECTION_BOOK_BROWSER ? { executablePath: process.env.COLLECTION_BOOK_BROWSER } : {}) });
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const port = probe.address().port; probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture server timeout')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(Error(`Fixture server exit ${code}`)); });
  });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const mobile = viewport.width !== 1280, name = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    const staticPaths = new Set(paths.map(path => `/${path}`));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET' && url.origin === origin && !url.pathname.startsWith('/api/') &&
          staticPaths.has(url.pathname) && !url.search) return route.continue();
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const caseReport = { viewport, result: 'RUNNING' }; report.cases.push(caseReport);
    try {
      await page.goto(`${origin}/tests/browser/collection-book-harness.html`);
      await page.waitForFunction(() => Boolean(window.__COLLECTION_BOOK__));
      const servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
        const bytes = await (await fetch(`/${path}`)).arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [path, [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')];
      }))), paths);
      assert.deepEqual(servedSourceHashes, report.sourceHashes); caseReport.servedSourceHashes = servedSourceHashes;
      const panel = page.locator('#inventory');
      const retry = () => page.getByRole('button', { name: '기록 다시 불러오기', exact: true });
      const assertFeedbackVisible = async locator => {
        const position = await locator.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const body = el.closest('.shop-panel-body').getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, bodyTop: body.top, bodyBottom: body.bottom };
        });
        assert.ok(position.top >= position.bodyTop - 1 && position.bottom <= position.bodyBottom + 1,
          `read feedback must be visible inside the scroll viewport: ${JSON.stringify(position)}`);
      };
      const open = async () => {
        if (mobile) await page.locator('#opener').tap(); else { await page.locator('#opener').focus(); await page.keyboard.press('Enter'); }
        const book = page.getByRole('button', { name: '수집도감', exact: true });
        if (mobile) await book.tap(); else { await book.focus(); await page.keyboard.press('Enter'); }
      };
      await open();
      await page.getByText('발견 기록 1 / 2', { exact: false }).waitFor();
      assert.equal(await page.getByText('정문 첫걸음 배지', { exact: true }).count(), 1);
      assert.equal(await page.getByText('별도 콘텐츠 기록 · 발견 여부 미확인', { exact: true }).count(), 1);
      await screenshot(page, `${name}-ready.png`);
      caseReport.layout = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return {
        left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight,
        overflow:document.documentElement.scrollWidth>innerWidth }; });
      assert.ok(caseReport.layout.left >= -1 && caseReport.layout.right <= viewport.width + 1, 'panel fits horizontally');
      assert.ok(caseReport.layout.top >= -1 && caseReport.layout.bottom <= viewport.height + 1, 'panel fits vertically');
      assert.equal(caseReport.layout.overflow, false);
      await page.evaluate(() => window.__COLLECTION_BOOK__.mode('fail'));
      if (mobile) await retry().tap(); else { await retry().focus(); await page.keyboard.press('Enter'); }
      await page.getByText('수집 기록을 불러오지 못했어요.', { exact:true }).waitFor();
      await assertFeedbackVisible(page.getByText('수집 기록을 불러오지 못했어요.', { exact:true }));
      await screenshot(page, `${name}-error.png`);
      await page.evaluate(() => window.__COLLECTION_BOOK__.mode('hold'));
      await retry().click(); assert.equal(await retry().isDisabled(), true);
      await assertFeedbackVisible(page.getByText('수집 기록을 불러오는 중…', { exact:true }));
      await screenshot(page, `${name}-loading.png`);
      await page.evaluate(() => window.__COLLECTION_BOOK__.settle());
      await page.getByText('발견 기록 1 / 2', { exact:false }).waitFor();
      assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true, 'retry retains modal focus');
      await assertFeedbackVisible(page.getByRole('button', { name:'수집도감', exact:true }));
      await screenshot(page, `${name}-recovered.png`);
      await retry().click();
      await page.keyboard.press('Escape'); await page.evaluate(() => window.__COLLECTION_BOOK__.settle());
      assert.equal(await panel.isVisible(), false);
      assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => window.__COLLECTION_BOOK__.mode('ready')); await open();
      await page.getByText('발견 기록 1 / 2', { exact:false }).waitFor();
      await page.evaluate(() => window.__COLLECTION_BOOK__.mode('hold')); await retry().click();
      await page.evaluate(() => window.__COLLECTION_BOOK__.switchAccount());
      caseReport.accountIsolation = await page.evaluate(async () => {
        const fixture = window.__COLLECTION_BOOK__;
        fixture.settle();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { accountId: fixture.book.accountId, state: fixture.book.state, snapshot: fixture.book.snapshot };
      });
      assert.deepEqual(caseReport.accountIsolation,
        { accountId: '22222222-2222-4222-8222-222222222222', state: 'IDLE', snapshot: null });
      assert.equal(await panel.getAttribute('data-inventory-view'), 'inventory');
      assert.doesNotMatch(await panel.innerText(), /붕어|정문 첫걸음 배지/);
      await page.evaluate(() => window.__COLLECTION_BOOK__.signOut());
      await page.getByRole('button', { name:'수집도감', exact:true }).click();
      assert.match(await panel.innerText(), /로그인/); assert.doesNotMatch(await panel.innerText(), /붕어|보유 정보를 확인하는 중/);
      await screenshot(page, `${name}-signed-out.png`);
      const calls = await page.evaluate(() => window.__COLLECTION_BOOK__.calls);
      assert.ok(calls.every(call => ['get_my_world_inventory_v1', 'GET /api/world-collection-book'].includes(call)));
      caseReport.calls = calls; assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      caseReport.result = 'PASS';
    } finally { await context.close(); }
  }
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; throw error; }
finally { server?.kill(); await browser?.close(); await writeFile(`${output}/report.json`, JSON.stringify(report,null,2)); }
