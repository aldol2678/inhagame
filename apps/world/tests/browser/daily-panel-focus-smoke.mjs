// Real Chromium focus/scroll + trusted keyboard/touch against production UI and synthetic RPCs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = process.env.DAILY_PANEL_FOCUS_OUTPUT || 'test-results/daily-panel-focus';
await mkdir(output, { recursive: true });
const paths = ['src/attendance/attendance-panel.js', 'src/daily-quiz/daily-quiz-panel.js',
  'src/attendance/attendance-client.js', 'src/daily-quiz/daily-quiz-client.js',
  'npc-factory/quest-reward-shape.mjs', 'styles.css',
  'tests/browser/daily-panel-focus-fixture.mjs', 'tests/browser/daily-panel-focus-harness.html'];
const devices = [
  { label: 'desktop', viewport: { width: 1000, height: 800 }, mobile: false },
  { label: 'mobile-portrait', viewport: { width: 360, height: 800 }, mobile: true },
  { label: 'mobile-landscape', viewport: { width: 800, height: 360 }, mobile: true }
];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  expectedHead: process.env.DAILY_PANEL_FOCUS_HEAD || null,
  sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path,
    createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')]))), cases: [], result: 'running' };
let browser, server, launchAttempted = false;
try {
  if (report.expectedHead) assert.equal(report.head, report.expectedHead, 'browser QA must check the requested commit');
  launchAttempted = true;
  browser = await chromium.launch({ headless: true,
    ...(process.env.DAILY_PANEL_FOCUS_BROWSER ? { executablePath: process.env.DAILY_PANEL_FOCUS_BROWSER } : {}) });
  report.browserVersion = browser.version();
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address(); probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`, env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local fixture server timeout')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}`)); });
  });
  for (const kind of ['attendance', 'quiz']) for (const device of devices) {
    const { mobile, viewport } = device;
    const context = await browser.newContext({ viewport,
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const item = { label: `${kind}-${device.label}`, kind, viewport, mobile, result: 'running' }; report.cases.push(item);
    const close = () => page.locator('.profile-close');
    const action = () => page.locator(kind === 'attendance' ? '.attendance-claim' : '.daily-quiz-option[data-index="2"]');
    const body = () => page.locator('.shop-panel-body');
    const focusIs = async selector => assert.equal(await page.locator(selector).evaluate(el => document.activeElement === el), true, selector);
    const press = async locator => { if (mobile) await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } };
    const settle = (index, mode = 'ready') => page.evaluate(({ index, mode }) => {
      const h = window.__DAILY_FOCUS__;
      const value = mode === 'failed' ? h.failed : h.ok(mode === 'done'
        ? (h.kind === 'attendance' ? { ...h.attendanceView(true), claimed: false, replayed: true, rewards: [] } : h.quizView(1)) : h.view());
      h.settle(index, value);
    }, { index, mode });
    const start = async (mode = 'ready') => {
      await page.goto(`${origin}/tests/browser/daily-panel-focus-harness.html?kind=${kind}`);
      await page.waitForFunction(() => Boolean(window.__DAILY_FOCUS__));
      await press(page.locator('#opener')); await focusIs('.profile-close'); await settle(0, mode);
      await page.waitForFunction(() => window.__DAILY_FOCUS__.client.state !== 'LOADING'); await focusIs('.profile-close');
    };
    try {
      await start();
      item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
        const bytes = await (await fetch(`/${path}`)).arrayBuffer(); const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [path, [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')];
      }))), paths);
      assert.deepEqual(item.servedSourceHashes, report.sourceHashes);
      if (!mobile) {
        await page.keyboard.press('Tab');
        if (kind === 'quiz') { await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); }
        await focusIs(kind === 'attendance' ? '.attendance-claim' : '.daily-quiz-option[data-index="2"]');
        await page.keyboard.press('Shift+Tab');
        await focusIs(kind === 'attendance' ? '.profile-close' : '.daily-quiz-option[data-index="1"]');
        await page.keyboard.press('Tab');
      }
      await press(action()); assert.equal(await action().isDisabled(), true);
      assert.equal(await page.evaluate(() => document.getElementById('daily-panel').contains(document.activeElement)), true);
      assert.equal(await close().evaluate(el => document.activeElement === el), false, 'disabled control uses its semantic anchor');
      await action().evaluate(el => el.click()); assert.equal(await page.evaluate(() => window.__DAILY_FOCUS__.requests.length), 2);
      const scroll = await body().evaluate(el => { el.scrollTop = 80; return el.scrollTop; }); assert.ok(scroll > 0, 'native overflow exists');
      await page.screenshot({ path: `${output}/${item.label}-pending.png` });
      await settle(1, 'failed'); await page.waitForFunction(() => !window.__DAILY_FOCUS__.client.pending);
      await focusIs(kind === 'attendance' ? '.attendance-claim' : '.daily-quiz-option[data-index="2"]');
      assert.equal(await body().evaluate(el => el.scrollTop), scroll);
      await settle(2); await page.waitForFunction(() => window.__DAILY_FOCUS__.requests[2].settled);
      await press(action()); await settle(3, 'done'); await page.waitForFunction(() => !window.__DAILY_FOCUS__.client.pending);
      await focusIs('.profile-close');
      if (kind === 'quiz') assert.equal(await body().evaluate(el => el.scrollTop), 0, 'new question starts at top');
      await page.screenshot({ path: `${output}/${item.label}-completed.png` });
      if (mobile) await close().tap(); else await page.keyboard.press('Escape');
      await focusIs('#opener'); assert.equal(await page.locator('#daily-panel').isVisible(), false);
      item.trustedEvents = await page.evaluate(() => window.__DAILY_FOCUS__.events.filter(event => event.trusted));
      assert.ok(item.trustedEvents.some(event => mobile ? event.pointerType === 'touch' : event.code === 'Enter'));
      if (!mobile) {
        await start('failed'); await press(page.locator('.shop-retry')); await settle(1, 'failed'); await focusIs('.shop-retry');
        await press(page.locator('.shop-retry')); await settle(2); await page.waitForFunction(() => window.__DAILY_FOCUS__.client.state === 'READY'); await focusIs('.profile-close');
        await press(action()); await page.locator('#outside').focus(); await settle(3, 'failed'); await settle(4); await focusIs('#outside');
        await start(); await press(action()); await page.evaluate(() => void window.__DAILY_FOCUS__.client.setAccount('synthetic-account-b'));
        await focusIs('.profile-close'); await settle(1, 'failed'); await settle(2); await focusIs('.profile-close');
        await start(); await press(action()); await page.keyboard.press('Escape'); await focusIs('#opener');
        await press(page.locator('#opener')); await page.locator('#outside').focus(); await settle(1, 'failed'); await settle(2); await focusIs('#outside');
        assert.equal(await page.locator('.shop-hint').count(), 0, 'old session result cannot add a notice');
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []); item.result = 'pass';
    } catch (error) {
      item.result = 'fail'; item.error = error.stack;
      await page.screenshot({ path: `${output}/${item.label}-failure.png` }).catch(() => {});
      throw error;
    } finally { item.pageErrors = errors; item.blockedRequests = blocked; await context.close(); }
  }
  report.result = 'pass'; console.log('PASS: daily panels native focus, scroll, keyboard/touch, retries, account and close/reopen races');
} catch (error) {
  report.result = !browser && launchAttempted ? 'blocked' : 'fail'; report.error = error.stack; throw error;
} finally {
  await browser?.close(); server?.kill(); await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
