// Offline real-render PNG readback. Device gallery integration still requires device testing.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke } from './harness.mjs';
const output = process.env.PHOTO_PNG_QA_OUTPUT || 'test-results/inkyung-photo/png';
const backend = process.env.PHOTO_PNG_BACKEND || 'webgl2';
assert.ok(['webgl2', 'webgpu'].includes(backend));
await mkdir(output, { recursive: true });
const paths = ['src/photo/photo-capture.js', 'src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js',
  'src/main.js', 'styles.css', 'tests/browser/inkyung-photo-mode-fixture.mjs'];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), backend,
  scope: 'Offline PlayCanvas render and production photo controls on a synthetic scene; actual downloaded PNG bytes decoded and compared pixel-for-pixel to the same existing framebuffer. Not a device-gallery or full-campus visual check.',
  sourceHashes: {}, checks: [], downloads: [], screenshots: [], status: 'RUNNING' };
const expectedHead = process.env.PHOTO_MODE_HEAD_SHA;
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'PHOTO_MODE_HEAD_SHA must identify the exact candidate');
assert.equal(report.head, expectedHead);
for (const path of paths) report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex');
let smoke;
try {
  smoke = await startSmoke({ viewport: { width: 1280, height: 720 }, contextOptions: { hasTouch: true, acceptDownloads: true } });
  const page = await smoke.context.newPage(); smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/inkyung-photo-mode-harness.html?backend=${backend}`);
  await page.waitForFunction(() => window.__PHOTO_QA__?.ready || window.__PHOTO_QA__?.error);
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.error ?? null), null);
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.backend), backend, 'never silently count a fallback renderer');
  const served = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const bytes = await (await fetch(`/${path}`)).arrayBuffer();
    return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')];
  }))), paths);
  assert.deepEqual(served, report.sourceHashes);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    const state = window.__PNG_QA__ = { encoded: 0, hold: false, fail: false, callbacks: [], urls: new Set() };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.urls.add(url); return url; };
    URL.revokeObjectURL = url => { state.urls.delete(url); revoke(url); };
    state.hash = async pixels => [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(n => n.toString(16).padStart(2, '0')).join('');
    HTMLCanvasElement.prototype.toBlob = function(callback, type) {
      state.encoded++;
      // Independent read of the actual existing game canvas in the same frameend callback.
      const source = document.getElementById('application'), reference = document.createElement('canvas');
      reference.width = source.width; reference.height = source.height;
      const context = reference.getContext('2d', { willReadFrequently: true }); context.drawImage(source, 0, 0);
      state.expected = { width: reference.width, height: reference.height, hash: state.hash(context.getImageData(0, 0, reference.width, reference.height).data) };
      reference.width = reference.height = 0;
      return original.call(this, blob => {
        if (state.hold) state.callbacks.push(() => callback(blob));
        else callback(state.fail ? null : blob);
      }, type);
    };
  });
  await page.locator('#context-action').click(); await page.waitForFunction(() => window.__PHOTO_QA__.mode.active);
  let downloadEvents = 0; page.on('download', () => downloadEvents++);
  for (const [width, height] of [[1280, 720], [360, 800], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(({ width, height }) => {
      const c = document.getElementById('application'); return c.width === width && c.height === height;
    }, { width, height });
    const count = await page.evaluate(() => window.__PNG_QA__.encoded);
    const received = page.waitForEvent('download');
    // Same-task duplicate click cannot queue a second save.
    await page.locator('[data-photo-control="save"]').evaluate(button => { button.click(); button.click(); });
    const download = await received, filename = `photo-${backend}-${width}x${height}.png`;
    assert.match(download.suggestedFilename(), /^inha-world-.*\.png$/);
    await download.saveAs(`${output}/${filename}`); assert.equal(await download.failure(), null);
    const bytes = await readFile(`${output}/${filename}`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
    const decoded = await page.evaluate(async base64 => {
      const state = window.__PNG_QA__, raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set(); let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) visible++; if (i % 256 === 0) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`); }
      const result = { width: canvas.width, height: canvas.height, hash: await state.hash(pixels), expected: await state.expected.hash, visible, colors: colors.size };
      bitmap.close(); canvas.width = canvas.height = 0; return result;
    }, bytes.toString('base64'));
    assert.equal(decoded.hash, decoded.expected, 'downloaded PNG exactly matches framebuffer, without DOM/HUD or a flipped/blank image');
    assert.equal(decoded.visible, width * height); assert.ok(decoded.colors > 3, 'actual rendered scene has varied pixels');
    assert.equal(await page.evaluate(() => window.__PNG_QA__.encoded), count + 1);
    assert.match(await page.locator('[data-photo-control="status"]').textContent(), /다운로드.*요청/);
    report.downloads.push({ filename, bytes: bytes.length, width, height, sha256: createHash('sha256').update(bytes).digest('hex'), rgbaSha256: decoded.hash, colors: decoded.colors });
    await page.locator('[data-photo-control="preview"]').click();
    assert.equal(await page.locator('[data-photo-control="image"]').isVisible(), true);
    for (const selector of ['.photo-mode-dock', '[data-photo-control="close"]']) {
      const box = await page.locator(selector).boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
    }
    const screenshot = `preview-${backend}-${width}x${height}.png`; await page.screenshot({ path: `${output}/${screenshot}` }); report.screenshots.push(screenshot);
    await page.locator('[data-photo-control="preview"]').click();
  }
  report.checks.push('desktop, portrait and landscape decoded PNG pixels match existing render; repeated click creates one download; explicit preview fits viewport');
  await page.evaluate(() => { window.__PNG_QA__.fail = true; });
  await page.locator('[data-photo-control="save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-photo-control="status"]').textContent.includes('만들지 못했'));
  assert.equal(await page.evaluate(() => window.__PNG_QA__.urls.size), 0);
  await page.evaluate(() => { window.__PNG_QA__.fail = false; });
  report.checks.push('null encoding surfaces retry/screenshot fallback and drops prior image URL');
  for (const reason of ['escape', 'account', 'pagehide', 'takeover']) {
    await page.evaluate(() => { window.__PNG_QA__.hold = true; });
    await page.locator('[data-photo-control="save"]').click();
    await page.waitForFunction(() => window.__PNG_QA__.callbacks.length === 1);
    const before = downloadEvents;
    if (reason === 'escape') await page.keyboard.press('Escape');
    else await page.evaluate(reason => {
      if (reason === 'account') { window.__PHOTO_QA__.state.accountId += '-changed'; window.__PHOTO_QA__.mode.update(); }
      if (reason === 'pagehide') dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      if (reason === 'takeover') window.__PHOTO_QA__.releaseTakeover = window.__PHOTO_QA__.takeover();
    }, reason);
    await page.waitForFunction(() => !window.__PHOTO_QA__.mode.active);
    const reopened = await page.evaluate(() => {
      if (window.__PHOTO_QA__.releaseTakeover) window.__PHOTO_QA__.focus.release(window.__PHOTO_QA__.releaseTakeover);
      window.__PHOTO_QA__.releaseTakeover = null;
      window.__PNG_QA__.hold = false; return window.__PHOTO_QA__.mode.open();
    });
    assert.equal(reopened, true, `${reason}: a new photo session must open before flushing the old encode`);
    assert.equal(await page.evaluate(() => window.__PHOTO_QA__.mode.active), true);
    await page.evaluate(() => window.__PNG_QA__.callbacks.splice(0).forEach(fn => fn()));
    await page.waitForFunction(() => !document.querySelector('[data-photo-control="save"]').disabled);
    assert.equal(downloadEvents, before); assert.equal(await page.evaluate(() => window.__PNG_QA__.urls.size), 0);
  }
  report.checks.push('Escape, account change, BFCache pagehide and transition takeover discard held encodes even after reopen');
  assert.deepEqual(smoke.problems, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); process.exitCode = 1; }
finally { await smoke?.close(); await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2)); }
