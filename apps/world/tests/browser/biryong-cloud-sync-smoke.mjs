// Hosted-only, synthetic transport acceptance. No Preview, login, or backend.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertBiryongSourceHashes, assertBiryongInputReceipt } from './biryong-cloud-sync-acceptance.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, process.env.BIRYONG_CLOUD_SYNC_HEAD, 'test the exact proposed head');
const output = process.env.BIRYONG_CLOUD_SYNC_OUTPUT || 'test-results/biryong-cloud-sync';
await mkdir(output, { recursive: true });
const sourcePaths = [
  'src/biryong/biryong-cloud-sync.js', 'src/biryong/biryong-cloud-status.js', 'src/biryong/biryong-state.js',
  'src/biryong/biryong-system.js', 'src/main.js', 'styles.css', 'src/input/input-focus-manager.js',
  'src/input/input-focus-owner.js', 'src/input/input-focus-runtime.js',
  'tests/browser/biryong-cloud-sync-harness.html', 'tests/browser/biryong-cloud-sync-smoke.mjs',
  'tests/browser/biryong-cloud-sync-acceptance.mjs'
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, sha256(await readFile(new URL(`../../${path}`, import.meta.url)))])));
const report = { head, sourceHashes, cases: [], result: 'running' };
let server, browser;
try {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address(); probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture server timeout')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture server exited ${code}`)); });
  });
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height, mobile] of [['desktop', 1280, 720, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]]) {
    const item = { name, viewport: { width, height }, mobile, screenshots: [], result: 'running' };
    report.cases.push(item);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const snapshot = () => page.evaluate(() => window.__BIRYONG_CLOUD_SYNC__.snapshot());
    const retry = page.getByRole('button', { name: '비룡 진행도 클라우드 저장 재시도' });
    const failed = () => page.waitForFunction(() => window.__BIRYONG_CLOUD_SYNC__?.snapshot().status.state === 'failed');
    await page.goto(`${origin}/tests/browser/biryong-cloud-sync-harness.html`); await failed();
    item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
      const response = await fetch(`/${path}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Source read failed: ${path}: ${response.status}`);
      const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return [path, [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')];
    }))), sourcePaths);
    assertBiryongSourceHashes(sourceHashes, item.servedSourceHashes);
    const screenshot = async state => {
      const filename = `${name}-${state}.png`, path = `${output}/${filename}`;
      const captured = await page.screenshot({ path });
      const bytes = await readFile(path);
      assert.equal(sha256(bytes), sha256(captured), 'saved screenshot bytes match the captured frame');
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG screenshot');
      assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
      item.screenshots.push({ filename, sha256: sha256(bytes), bytes: bytes.length, head, width, height });
    };
    await page.evaluate(() => window.__BIRYONG_CLOUD_SYNC__.showObjective());
    assert.equal(await retry.isEnabled(), true);
    const bounds = await page.locator('.biryong-objective').evaluate(el => {
      const r = el.getBoundingClientRect(), button = el.querySelector('button').getBoundingClientRect();
      const label = el.querySelector('[role="status"]').getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height,
        fits: el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
        radius: parseFloat(getComputedStyle(el).borderRadius),
        label: { x: label.x, right: label.right, bottom: label.bottom },
        button: { x: button.x, y: button.y, right: button.right, bottom: button.bottom, height: button.height } };
    });
    assert.ok(bounds.fits && bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height);
    assert.ok(bounds.button.x >= bounds.x && bounds.button.right <= bounds.right && bounds.button.bottom <= bounds.bottom);
    assert.ok(bounds.button.height >= 44, 'retry has a full touch target');
    assert.ok(bounds.radius <= 14, 'multiline recovery status is a card, not a clipping capsule');
    assert.ok(bounds.label.x >= bounds.x + 8 && bounds.label.right <= bounds.button.x && bounds.label.bottom <= bounds.bottom - 4);
    item.bounds = bounds;
    await screenshot('failed');
    if (!mobile) {
      await page.keyboard.down('KeyW');
      assert.deepEqual((await snapshot()).input.held, ['KeyW']);
      await page.keyboard.press('Tab');
      assert.equal(await retry.evaluate(el => document.activeElement === el), true, 'native Tab reaches retry');
      await page.keyboard.up('KeyW');
      assert.deepEqual((await snapshot()).input.held, [], 'keyup on retry reaches the gameplay release listener');
    }
    await page.evaluate(() => { window.__BIRYONG_CLOUD_SYNC__.progress(); window.__BIRYONG_CLOUD_SYNC__.hold(); });
    if (mobile) await retry.tap(); else await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__BIRYONG_CLOUD_SYNC__.snapshot().pending === 1);
    assert.equal(await retry.isDisabled(), true);
    await page.keyboard.press('Enter');
    assert.equal((await snapshot()).calls.length, 3, 'repeated activation cannot duplicate a merge');
    await screenshot('saving');
    const opener = page.locator('#fixture-modal-open');
    if (mobile) await opener.tap(); else await opener.click();
    const opened = await snapshot();
    item.whileSaving = opened.input;
    item.modalOpenTransitionIndex = opened.statusInputs.length;
    await page.evaluate(() => window.__BIRYONG_CLOUD_SYNC__.progress());
    await page.evaluate(() => window.__BIRYONG_CLOUD_SYNC__.settle(0));
    await page.waitForFunction(() => window.__BIRYONG_CLOUD_SYNC__.snapshot().pending === 2);
    const latest = await snapshot(); assert.equal(latest.calls.at(-1).args.p_progress.shouts, 2);
    await page.evaluate(() => window.__BIRYONG_CLOUD_SYNC__.settle(1, 2));
    await page.waitForFunction(() => window.__BIRYONG_CLOUD_SYNC__.snapshot().status.state === 'saved');
    assert.equal(await page.locator('.biryong-cloud-status').isVisible(), false);
    item.afterSaved = (await snapshot()).input;
    // Preserve every post-open transition, including a lost/replaced owner.
    // Filtering by the desired owner here would hide transient arbitration bugs.
    item.transitions = (await snapshot()).statusInputs.slice(item.modalOpenTransitionIndex);
    await screenshot('saved-with-other-owner');
    if (mobile) await page.locator('#fixture-modal-close').tap(); else await page.keyboard.press('Escape');
    item.afterClose = (await snapshot()).input;
    await screenshot('recovered');
    item.events = (await snapshot()).events;
    assertBiryongInputReceipt(item);
    await page.evaluate(() => { window.__BIRYONG_CLOUD_SYNC__.progress(); window.__BIRYONG_CLOUD_SYNC__.account(null); });
    assert.equal((await snapshot()).status.state, 'idle');
    assert.equal(await retry.isVisible(), false);
    assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
    item.final = await snapshot();
    item.result = 'passed'; await context.close();
  }
  report.result = 'passed';
} catch (error) { report.result = 'failed'; report.error = error.stack; throw error; }
finally {
  await browser?.close(); server?.kill();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
