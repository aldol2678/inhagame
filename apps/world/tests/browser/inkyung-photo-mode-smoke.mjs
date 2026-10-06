// Native Chromium acceptance, offline only. No account, storage, network writes or capture upload.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke } from './harness.mjs';
import { chromium } from 'playwright';
const output = process.env.PHOTO_MODE_QA_OUTPUT || 'test-results/inkyung-photo-mode';
await mkdir(output, { recursive: true });
const paths = ['src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js', 'src/photo/inkyung-photo-point.js', 'src/main.js', 'styles.css'];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Real photo UI, OrbitCameraController, PlayerController and EmoteController; synthetic rendered background/avatar. Offline only, not full lake visual or live social QA.',
  sourceHashes: {}, checks: [], screenshots: [], status: 'RUNNING' };
for (const path of paths) report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex');
const expectedHead = process.env.PHOTO_MODE_HEAD_SHA;
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'PHOTO_MODE_HEAD_SHA must identify the exact candidate');
assert.equal(report.head, expectedHead, 'browser must test the exact candidate head');
report.expectedHead = expectedHead;
const snapshot = page => page.evaluate(() => window.__PHOTO_QA__.snapshot());
let smoke;
try {
  if (!process.env.WORLD_SMOKE_BROWSER) {
    try { await access(chromium.executablePath()); } catch { throw Error('BROWSER_UNAVAILABLE: pinned Chromium is not installed'); }
  }
  smoke = await startSmoke({ viewport: { width: 1280, height: 720 }, contextOptions: { hasTouch: true } });
  const page = await smoke.context.newPage(); smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/inkyung-photo-mode-harness.html`);
  await page.waitForFunction(() => window.__PHOTO_QA__?.ready || window.__PHOTO_QA__?.error);
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.error ?? null), null);
  const served = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const data = await (await fetch(`/${path}`)).arrayBuffer();
    return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('')];
  }))), paths);
  assert.deepEqual(served, report.sourceHashes); report.checks.push('served production source hashes match the candidate');
  const before = await snapshot(page);
  await page.locator('#application').focus(); await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__PHOTO_QA__.mode.active);
  assert.equal((await snapshot(page)).input, false);
  assert.equal(await page.locator('#qa-note').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  const close = page.locator('[data-photo-control="close"]');
  assert.equal(await close.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('[data-photo-control="pose"]').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter'); assert.equal((await snapshot(page)).pose, 'photo_pose');
  await page.keyboard.press('Tab'); assert.equal(await close.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Tab');
  const yawBefore = (await snapshot(page)).camera.yaw;
  await page.keyboard.press('ArrowRight'); assert.ok((await snapshot(page)).camera.yaw > yawBefore);
  const still = await snapshot(page); await page.keyboard.down('KeyW');
  await page.waitForFunction(t => window.__PHOTO_QA__.snapshot().ticks > t + 4, still.ticks); await page.keyboard.up('KeyW');
  assert.deepEqual((await snapshot(page)).position, still.position);
  report.checks.push('native F entry, focus/Tab/Shift+Tab, pose, arrow framing and held movement blocked');
  for (const viewport of [{ width: 360, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const selector of ['.photo-mode-dock', '[data-photo-control="close"]']) {
      const box = await page.locator(selector).boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
    }
    const slider = page.locator('[data-photo-control="distance"]');
    const bounds = await slider.boundingBox(); await slider.tap({ position: { x: bounds.width * .75, y: bounds.height / 2 } });
    assert.ok((await snapshot(page)).camera.distance >= 2.5 && (await snapshot(page)).camera.distance <= 6);
    const image = `photo-${viewport.width}x${viewport.height}.png`; await page.screenshot({ path: `${output}/${image}` }); report.screenshots.push(image);
  }
  await close.tap(); assert.equal((await snapshot(page)).active, false); assert.deepEqual((await snapshot(page)).camera, before.camera);
  assert.equal((await snapshot(page)).hud, null);
  assert.equal(await page.locator('#application').evaluate(el => el === document.activeElement), true, 'hidden opener falls back to focusable game canvas');
  report.checks.push('touch exit, portrait/landscape viewport changes, HUD and exact original camera restore');
  for (let i = 0; i < 5; i++) { await page.locator('#context-action').tap(); await page.keyboard.press('Escape'); assert.equal((await snapshot(page)).claims, 0); }
  report.checks.push('five repeated touch-entry/Escape-exit sessions without focus-owner leak');
  await page.locator('#context-action').tap();
  await page.evaluate(() => { window.__PHOTO_QA__.state.accountId = 'synthetic-account-b'; });
  await page.waitForFunction(() => !window.__PHOTO_QA__.mode.active);
  assert.equal((await snapshot(page)).claims, 0);
  await page.evaluate(() => { window.__PHOTO_QA__.controller.mounted = true; });
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.mode.open()), false);
  await page.evaluate(() => { window.__PHOTO_QA__.controller.mounted = false; window.__PHOTO_QA__.controller.grounded = false; });
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.mode.open()), false);
  await page.evaluate(() => { window.__PHOTO_QA__.controller.grounded = true; });
  report.checks.push('synthetic account boundary and mounted/airborne entry rejection');
  await page.evaluate(() => { window.__PHOTO_QA__.orbit.togglePerspective(); }); const first = await snapshot(page);
  await page.locator('#context-action').tap(); assert.equal((await snapshot(page)).camera.firstPerson, false);
  await page.evaluate(() => { window.__PHOTO_QA__.takeover(); });
  assert.deepEqual((await snapshot(page)).camera, first.camera); assert.equal((await snapshot(page)).claims, 1); assert.equal((await snapshot(page)).input, false);
  report.checks.push('first-person restoration and transition takeover keeps movement locked');
  assert.deepEqual(smoke.problems, []); report.status = 'PASS';
} catch (error) {
  report.status = /BROWSER_UNAVAILABLE|EPERM|Operation not permitted|EACCES/.test(String(error)) ? 'BLOCKED' : 'FAIL';
  report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  await smoke?.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
