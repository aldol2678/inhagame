import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../apps/world/tests/browser/package.json', import.meta.url));
const { chromium } = require('playwright');
const output = 'test-results/aldol-studio-p1-2';
await mkdir(output, { recursive: true });
const report = { environment: 'Chromium CDP touch, isMobile/hasTouch; real editor HTTP adapter; emulation only', physicalAndroid: 'BLOCKED', physicalIOS: 'BLOCKED', checks: [] };
const runner = spawn(process.execPath, ['bin/dev-server.mjs', '--allow-write', '--port', '0', '--editor-dir', resolve('apps/world/src/editor')],
  { cwd: resolve('tools/aldol-3d-studio-p1'), stdio: ['ignore', 'pipe', 'pipe'] });
let browser, page;
const host = await new Promise((ok, fail) => {
  let log = ''; const timer = setTimeout(() => fail(Error('Server start timeout: ' + log)), 10000);
  runner.stdout.on('data', data => { log += data; const m = log.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); ok(m[0]); } });
  runner.stderr.on('data', data => log += data);
  runner.on('exit', code => { clearTimeout(timer); fail(Error(`Server exited ${code}: ${log}`)); });
});
const pass = name => { report.checks.push({ name, status: 'PASS' }); console.log('PASS', name); };
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(host, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#mode').textContent.startsWith('LEGACY'));
  const cdp = await page.context().newCDPSession(page);
  const point = (x, y, id = 1) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 6, radiusY: 6, force: 1 });
  const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const scene = async () => (await page.request.get(host + '/api/scene')).json();
  const settled = () => page.waitForFunction(() => !document.querySelector('#status').textContent.startsWith('오류:'));
  const position = async selector => { const b = await page.locator(selector).boundingBox(); assert.ok(b, selector); return point(b.x+b.width/2, b.y+b.height/2); };
  const viewportPoint = async (x = .5, y = .6) => { const b = await page.locator('#canvas').boundingBox(); return point(b.x+b.width*x, b.y+b.height*y); };
  const drag = async (start, dx, dy, cancel = false) => {
    await touch('touchStart', [start]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [point(start.x+dx*i/5, start.y+dy*i/5)]);
    await touch(cancel ? 'touchCancel' : 'touchEnd');
    // Let Chromium finish dispatching the gesture before starting a new button tap.
    await page.waitForTimeout(120);
  };
  const waitRevision = async old => {
    await page.waitForFunction(old => document.querySelector('#revision').textContent !== old, old);
    await settled();
  };
  const revision = () => page.locator('#revision').textContent();
  await page.locator('#add-box').tap();
  await page.locator('#cancel-placement').tap();
  let p = await viewportPoint(); await page.touchscreen.tap(p.x, p.y);
  assert.equal((await scene()).nodes.length, 0);
  pass('placement cancellation leaves scene empty');
  await page.locator('#add-box').tap();
  await touch('touchStart', [p]); await touch('touchCancel');
  assert.equal((await scene()).nodes.length, 0);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForFunction(() => document.querySelectorAll('.node-row').length === 1);
  assert.equal((await scene()).nodes.length, 1);
  await page.waitForFunction(() => !document.querySelector('#gizmo-overlay').hidden);
  pass('pointercancel prevents placement; following single touch creates/selects one real entity');

  // Gizmo deltas are checked against the committed server scene, not only visual movement.
  for (const mode of ['move', 'rotate', 'scale']) {
    await page.locator(`[data-tool="${mode}"]`).tap();
    const before = (await scene()).nodes[0].transform;
    const old = await revision();
    await drag(await position('[data-gizmo-axis="x"]'), 26, -14);
    await waitRevision(old);
    const after = (await scene()).nodes[0].transform;
    const key = { move: 'position', rotate: 'rotation', scale: 'scale' }[mode];
    assert.notDeepEqual(after[key], before[key]);
    const undo = await revision(); await page.locator('#undo').tap(); await waitRevision(undo);
    assert.deepEqual((await scene()).nodes[0].transform, before);
    const redo = await revision(); await page.locator('#redo').tap(); await waitRevision(redo);
    assert.deepEqual((await scene()).nodes[0].transform, after);
    pass(`touch ${mode} gizmo commits once; undo/redo restore real transforms`);
  }
  const stable = await scene();
  await drag(await position('[data-gizmo-axis="x"]'), 30, 0, true);
  assert.deepEqual(await scene(), stable);
  pass('gizmo pointercancel preserves committed revision and transform');

  // A second finger during a gizmo drag must cancel, not commit an accidental edit.
  const handle = await position('[data-gizmo-axis="x"]');
  p = await viewportPoint(.85, .75);
  await touch('touchStart', [handle]);
  await touch('touchMove', [point(handle.x+15, handle.y)]);
  await touch('touchStart', [point(handle.x+15, handle.y), point(p.x, p.y, 2)]);
  await touch('touchEnd');
  assert.deepEqual(await scene(), stable);
  pass('second finger cancels an active gizmo without accidental commit');

  await page.locator('#reset-view').tap();
  const getHandle = () => page.locator('[data-gizmo-axis="x"]').getAttribute('style');
  const cameraBefore = await getHandle();
  p = await viewportPoint(.8, .75); await drag(p, -45, 15);
  await page.waitForFunction(before => document.querySelector('[data-gizmo-axis="x"]').getAttribute('style') !== before, cameraBefore);
  assert.deepEqual(await scene(), stable);
  pass('single finger camera orbit changes projection without mutating scene');
  const pinchBefore = await getHandle();
  p = await viewportPoint(.5, .78);
  await touch('touchStart', [point(p.x-25,p.y),point(p.x+25,p.y,2)]);
  for (const distance of [32,42,55]) await touch('touchMove', [point(p.x-distance,p.y),point(p.x+distance,p.y,2)]);
  await touch('touchEnd');
  await page.waitForFunction(before => document.querySelector('[data-gizmo-axis="x"]').getAttribute('style') !== before, pinchBefore);
  assert.deepEqual(await scene(), stable);
  pass('two-finger pinch changes camera projection without ghost edits');
  await page.locator('#add-floor').tap();
  await touch('touchStart', [point(p.x-25,p.y),point(p.x+25,p.y,2)]);
  await touch('touchMove', [point(p.x-45,p.y),point(p.x+45,p.y,2)]);
  await touch('touchEnd');
  assert.deepEqual(await scene(), stable);
  await page.locator('#cancel-placement').tap();
  pass('pinch while placement armed does not create a ghost object');

  await page.locator('#reset-view').tap();
  // Clear with empty canvas then select through projected object center (SVG axis origins).
  p = await viewportPoint(.95,.4); await page.touchscreen.tap(p.x,p.y);
  await page.waitForFunction(() => document.querySelector('#no-selection').hidden === false);
  await page.locator('.node-row .node').tap();
  const center = await page.evaluate(() => { const line = document.querySelector('#gizmo-lines line'); const box = document.querySelector('#canvas').getBoundingClientRect();
    return { x: box.x+Number(line.getAttribute('x1')), y: box.y+Number(line.getAttribute('y1')) }; });
  p = await viewportPoint(.95,.4); await page.touchscreen.tap(p.x,p.y);
  await page.touchscreen.tap(center.x,center.y);
  await page.waitForFunction(() => document.querySelector('#no-selection').hidden === true);
  pass('touch blank canvas deselects; touch object selects');
  await page.screenshot({ path: `${output}/mobile-390x844.png`, fullPage: true });

  const beforeRotation = await scene();
  const rotatingHandle = await position('[data-gizmo-axis="x"]');
  await touch('touchStart', [rotatingHandle]);
  await touch('touchMove', [point(rotatingHandle.x+20,rotatingHandle.y)]);
  await page.setViewportSize({ width: 740, height: 360 });
  await page.waitForTimeout(120);
  await touch('touchEnd');
  await page.waitForTimeout(120);
  assert.deepEqual(await scene(), beforeRotation);
  pass('orientation change cancels active gizmo without saving stale drag coordinates');

  for (const viewport of [{ width: 320, height: 568 }, { width: 740, height: 360 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right }; };
      return { innerWidth, innerHeight, scrollWidth:document.documentElement.scrollWidth, canvas:rect('#canvas'), footer:rect('footer'), add:rect('#add-box'), left:rect('.left'), right:rect('.right') };
    });
    assert.ok(layout.scrollWidth <= layout.innerWidth+1, JSON.stringify(layout));
    assert.ok(layout.footer.bottom <= layout.innerHeight+1, JSON.stringify(layout));
    assert.ok(layout.canvas.height >= 150 && layout.canvas.width >= 200, JSON.stringify(layout));
    assert.ok(layout.add.y >= 0 && layout.add.bottom <= layout.innerHeight, JSON.stringify(layout));
    assert.ok(layout.left.bottom <= layout.footer.y+1 && layout.right.bottom <= layout.footer.y+1, JSON.stringify(layout));
    await page.locator('#add-box').tap(); await page.locator('#cancel-placement').tap();
    await page.screenshot({ path: `${output}/mobile-${viewport.width}x${viewport.height}.png`, fullPage: true });
    pass(`viewport/orientation ${viewport.width}x${viewport.height}: canvas/panels/footer/actions fit`);
  }
  assert.deepEqual(errors, []); pass('mobile JavaScript and console errors absent');
} catch (error) {
  report.checks.push({ name: 'mobile execution', status: 'FAIL', error: String(error) });
  if (page) await page.screenshot({ path: `${output}/mobile-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/mobile-report.json`, JSON.stringify(report, null, 2));
  if (page) await page.context().tracing.stop({ path: `${output}/mobile-trace.zip` });
  if (browser) await browser.close(); runner.kill();
}
