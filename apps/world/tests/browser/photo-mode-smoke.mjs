// Native Chromium acceptance on the offline fixture, desktop mouse/keyboard plus portrait and
// landscape touch. Real photo rig, input, UI, PlayerController, OrbitCameraController and
// Pointer Lock runtime; synthetic background/avatar. No account, storage, network writes or upload.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke } from './harness.mjs';
import { chromium } from 'playwright';
const output = process.env.PHOTO_MODE_QA_OUTPUT || 'test-results/photo-mode/controls';
await mkdir(output, { recursive: true });
const paths = ['src/photo/photo-capture.js', 'src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js',
  'src/photo/photo-camera-controller.js', 'src/photo/photo-input.js', 'src/world-collision.js', 'src/main.js', 'styles.css',
  'tests/browser/photo-mode-fixture.mjs'];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Real Photo Mode rig/input/UI, PlayerController, OrbitCameraController and Pointer Lock runtime on a synthetic rendered scene. Offline only; not campus composition or physical-device acceptance.',
  sourceHashes: {}, cases: [], screenshots: [], downloads: [], status: 'RUNNING',
  limits: ['Touch is Chromium mobile emulation (CDP touch events), not a physical device.',
    'env(safe-area-inset-*) cannot be emulated in headless Chromium; insets are simulated through the same --photo-edge-* properties the env() values feed.'] };
for (const path of paths) report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex');
const expectedHead = process.env.PHOTO_MODE_HEAD_SHA;
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'PHOTO_MODE_HEAD_SHA must identify the exact candidate');
assert.equal(report.head, expectedHead, 'browser must test the exact candidate head');
report.expectedHead = expectedHead;

const snapshot = page => page.evaluate(() => window.__PHOTO_QA__.snapshot());
async function frames(page, count = 3) {
  const at = (await snapshot(page)).ticks;
  await page.waitForFunction(({ at, count }) => window.__PHOTO_QA__.snapshot().ticks >= at + count, { at, count }, { polling: 'raf' });
}
async function holdKey(page, key, count) { await page.keyboard.down(key); try { await frames(page, count); } finally { await page.keyboard.up(key); } }
const travel = s => Math.hypot(s.rig.position.x - s.rig.entry.x, s.rig.position.y - s.rig.entry.y, s.rig.position.z - s.rig.entry.z);
async function settle(page) { await page.waitForFunction(() => window.__PHOTO_QA__.snapshot().rig?.moving === false, null, { polling: 'raf' }); }
const box = (page, selector) => page.locator(selector).boundingBox();
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
async function shot(page, name, entry) {
  const file = `${name}.png`; await page.screenshot({ path: `${output}/${file}` });
  report.screenshots.push(file); entry.screenshots.push(file);
}
async function load(smoke, viewport, mobile) {
  const page = await smoke.context.newPage(); smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/photo-mode-harness.html`);
  await page.waitForFunction(() => window.__PHOTO_QA__?.ready || window.__PHOTO_QA__?.error);
  assert.equal(await page.evaluate(() => window.__PHOTO_QA__.error ?? null), null);
  const served = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const data = await (await fetch(`/${path}`)).arrayBuffer();
    return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('')];
  }))), paths);
  assert.deepEqual(served, report.sourceHashes);
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), mobile, 'pointer class matches the case');
  await frames(page, 5);
  return page;
}
async function capturePng(page, trigger, name, entry) {
  const dimensions = await page.locator('#application').evaluate(c => ({ width: c.width, height: c.height }));
  const before = await snapshot(page);
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = `${name}-${dimensions.width}x${dimensions.height}.png`;
  await download.saveAs(`${output}/${file}`); assert.equal(await download.failure(), null);
  const bytes = await readFile(`${output}/${file}`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), dimensions.width); assert.equal(bytes.readUInt32BE(20), dimensions.height);
  const decoded = await page.evaluate(async base64 => {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, bins = new Set(); let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] === 255) opaque++; if (i % 64 === 0) bins.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`); }
    bitmap.close(); return { width: canvas.width, height: canvas.height, opaque, colorBins: bins.size };
  }, bytes.toString('base64'));
  assert.equal(decoded.opaque, dimensions.width * dimensions.height); assert.ok(decoded.colorBins > 3, 'rendered scene, not blank');
  await page.waitForFunction(() => !window.__PHOTO_QA__.snapshot().ui.busy);
  const after = await snapshot(page);
  assert.deepEqual(after.pose, before.pose, 'capture never moves the camera'); assert.equal(after.active, true);
  const record = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...decoded };
  report.downloads.push(record); entry.downloads.push(record);
  return record;
}

async function desktop(smoke) {
  const viewport = { width: 1280, height: 720 }, entry = { name: 'desktop', viewport, checks: [], screenshots: [], downloads: [] };
  report.cases.push(entry);
  const page = await load(smoke, viewport, false);
  // Real Pointer Lock first, so entry must release it (keyboard P works while the cursor is locked).
  await page.locator('#application').click({ position: { x: 640, y: 360 } });
  await page.waitForFunction(() => window.__PHOTO_QA__.snapshot().pointerLock.locked === true);
  // Headless Chromium can report one recentering movement as the lock engages, which the
  // gameplay pointer-look applies. Restore the fixture framing so the wall geometry is predictable.
  await frames(page, 2);
  await page.evaluate(() => Object.assign(window.__PHOTO_QA__.orbit, { yaw: .35, pitch: .42 }));
  await frames(page, 2);
  const play = await snapshot(page);
  entry.play = { position: play.position, pose: play.pose, orbit: play.orbit };
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__PHOTO_QA__.snapshot().active && !window.__PHOTO_QA__.snapshot().pointerLock.locked);
  const opened = await snapshot(page);
  assert.deepEqual(opened.pose, play.pose, 'entry frame is the play frame (position, rotation, FOV, near clip)');
  await frames(page, 5); assert.deepEqual((await snapshot(page)).pose, play.pose, 'idle photo frames do not drift');
  assert.deepEqual(opened.topOwners, ['photo-mode']); assert.equal(opened.input, false); assert.equal(opened.cameraInput, false);
  assert.equal(opened.hud, 'active'); assert.equal(await page.locator('#qa-note').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  assert.equal(await page.locator('[data-photo-control="capture"]').evaluate(el => el === document.activeElement), true);
  entry.checks.push('real Pointer Lock released by P entry; entry/idle frames identical to the play frame; HUD hidden; shutter focused');
  await shot(page, 'desktop-default', entry);

  await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(760, 330, { steps: 6 }); await page.mouse.up();
  await frames(page, 2);
  const looked = await snapshot(page);
  assert.ok(looked.rig.yaw < opened.rig.yaw - .3, 'drag right turns right'); assert.ok(looked.rig.pitch < opened.rig.pitch, 'drag up looks up');
  assert.deepEqual(looked.position, play.position, 'the player never turns or moves');
  await page.keyboard.press('KeyR'); await frames(page, 2);
  await holdKey(page, 'KeyW', 20); await settle(page);
  const forward = await snapshot(page), heading = { x: -Math.sin(forward.rig.yaw), z: Math.cos(forward.rig.yaw) };
  const moved = { x: forward.rig.position.x - forward.rig.entry.x, z: forward.rig.position.z - forward.rig.entry.z };
  assert.ok(moved.x * heading.x + moved.z * heading.z > .3, 'W dollies along the view heading');
  assert.ok(Math.abs(forward.rig.position.y - forward.rig.entry.y) < 1e-9, 'planar dolly');
  assert.deepEqual(forward.position, play.position); assert.deepEqual(forward.keys, [], 'PlayerController never sees the key');
  await holdKey(page, 'KeyE', 12); await settle(page);
  const up = await snapshot(page); assert.ok(up.rig.position.y > forward.rig.position.y + .2, 'E raises');
  await holdKey(page, 'KeyQ', 12); await settle(page);
  assert.ok((await snapshot(page)).rig.position.y < up.rig.position.y - .2, 'Q lowers');
  await page.mouse.move(640, 360); await page.mouse.wheel(0, -400); await frames(page, 2);
  assert.ok((await snapshot(page)).pose.fov < play.pose.fov - 5, 'wheel narrows the lens');
  entry.checks.push('mouse drag look, WASD planar dolly, Q/E vertical, wheel FOV; player and PlayerController untouched');

  const travelFor = async shift => {
    await page.keyboard.press('KeyR'); await frames(page, 2);
    if (shift) await page.keyboard.down('ShiftLeft');
    await holdKey(page, 'KeyW', 30);
    if (shift) await page.keyboard.up('ShiftLeft');
    await settle(page);
    return travel(await snapshot(page));
  };
  const precise = await travelFor(true), normal = await travelFor(false);
  entry.precision = { precise, normal, ratio: precise / normal };
  assert.ok(precise / normal > .12 && precise / normal < .45, `Shift precision travel ratio ${precise / normal}`);
  entry.checks.push(`Shift precision dolly ratio ${(precise / normal).toFixed(3)} (nominal 0.25 under real frame timing)`);

  await page.keyboard.press('KeyR'); await frames(page, 2);
  const strafeStart = await snapshot(page);
  // ~2 s of D at 60 Hz is well past the wall (≈2.7 units away); the rig must stop at its skin.
  await holdKey(page, 'KeyD', 120); await settle(page);
  const blocked = await snapshot(page), wall = await page.evaluate(() => window.__PHOTO_QA__.wall);
  entry.collision = { start: strafeStart.rig.position, entry: strafeStart.rig.entry, yaw: strafeStart.rig.yaw,
    stopped: blocked.rig.position, wallMinX: wall.minX };
  assert.ok(blocked.rig.position.x > strafeStart.rig.position.x + 1.5 && blocked.rig.position.x < wall.minX - .3,
    `camera strafes and stops in front of the wall: ${JSON.stringify(entry.collision)}`);
  entry.checks.push('strafing into a collider stops at the camera skin (shared cameraSafeFraction authority)');

  await page.keyboard.press('KeyR'); await frames(page, 2);
  await page.locator('#application').focus(); await page.keyboard.press('KeyH');
  assert.equal(await page.locator('.photo-mode-top').isVisible(), false); assert.equal(await page.locator('.photo-mode-shutter').isVisible(), false);
  assert.equal(await page.locator('[data-photo-control="restore"]').isVisible(), true);
  await shot(page, 'desktop-ui-hidden', entry);
  await page.keyboard.press('KeyH'); assert.equal(await page.locator('.photo-mode-shutter').isVisible(), true);
  entry.checks.push('H hides every photo control except a faint restore button, and H restores');

  await page.locator('[data-photo-control="settings"]').click();
  assert.equal(await page.locator('.photo-mode-settings').isVisible(), true);
  await page.locator('[data-photo-control="grid"]').selectOption('thirds');
  assert.equal(await page.locator('.photo-mode-grid').isVisible(), true);
  const drawer = await box(page, '.photo-mode-settings'), shutterBox = await box(page, '.photo-mode-shutter');
  assert.ok(drawer.x + drawer.width <= viewport.width && drawer.y >= 0 && !overlaps(drawer, shutterBox), 'drawer stays on the right edge');
  assert.ok(drawer.x > viewport.width * .6, 'drawer never covers the centre of the frame');
  await shot(page, 'desktop-settings', entry);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.photo-mode-settings').isVisible(), false);
  assert.equal((await snapshot(page)).active, true, 'Escape closed the drawer first');
  entry.checks.push('⚙ drawer on the right edge, 3×3 grid on, Escape closes the drawer before Photo Mode');

  await page.locator('#application').focus();
  await capturePng(page, () => page.keyboard.press('Space'), 'desktop-captured', entry);
  entry.checks.push('Space captures an opaque native-resolution PNG (grid and HUD are DOM, never in the canvas copy)');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__PHOTO_QA__.snapshot().active);
  await frames(page, 2);
  const closed = await snapshot(page);
  assert.deepEqual(closed.pose, play.pose, 'exit restores the exact play camera'); assert.deepEqual(closed.orbit, play.orbit);
  assert.equal(closed.claims, 0); assert.equal(closed.hud, null); assert.equal(closed.input, true); assert.equal(closed.cameraInput, true);
  assert.equal(closed.pointerLock.locked, false); assert.equal(closed.pointerLock.awaitingGesture, true, 'no automatic Pointer Lock reacquisition');
  await page.locator('#application').focus(); await holdKey(page, 'KeyW', 10);
  const walked = await snapshot(page);
  assert.ok(Math.hypot(walked.position[0] - play.position[0], walked.position[2] - play.position[2]) > .05, 'player controls work after exit');
  entry.checks.push('Escape restores the exact camera/orbit/HUD/focus owner; fresh W moves the player again');
  for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyP'); await page.keyboard.press('Escape'); assert.equal((await snapshot(page)).claims, 0); }
  entry.checks.push('five P/Escape cycles without a focus-owner leak');
  await page.close();
}

async function touchCase(smoke, name, viewport) {
  const entry = { name, viewport, checks: [], screenshots: [], downloads: [] };
  report.cases.push(entry);
  const page = await load(smoke, viewport, true);
  const cdp = await smoke.context.newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  async function drag(from, to, id = 1) {
    await touch('touchStart', [{ ...from, id }]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, id }]); await frames(page, 1); }
    await touch('touchEnd', []); await frames(page, 1);
  }
  const center = async selector => { const b = await box(page, selector); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };
  try {
    const play = await snapshot(page);
    await page.locator('#photo-mode-toggle').tap();
    await page.waitForFunction(() => window.__PHOTO_QA__.snapshot().active);
    const opened = await snapshot(page);
    assert.deepEqual(opened.pose, play.pose, `${name}: entry frame is the play frame`);
    // Layout: every control on-screen, 44px+, mutually clear, and nothing in the frame's centre.
    const selectors = ['.photo-mode-badge', '[data-photo-control="ui"]', '[data-photo-control="settings"]', '[data-photo-control="close"]',
      '[data-photo-control="pose"]', '[data-photo-control="capture"]', '[data-photo-control="pad"]', '[data-photo-control="up"]', '[data-photo-control="down"]'];
    const boxes = {};
    for (const selector of selectors) {
      assert.equal(await page.locator(selector).isVisible(), true, `${name}: ${selector} visible`);
      const b = boxes[selector] = await box(page, selector);
      assert.ok(b.x >= 8 && b.y >= 4 && b.x + b.width <= viewport.width - 8 && b.y + b.height <= viewport.height - 8, `${name}: ${selector} inside the viewport ${JSON.stringify(b)}`);
      if (selector !== '.photo-mode-badge') assert.ok(b.width >= 44 && b.height >= 44, `${name}: ${selector} is a 44px+ target`);
      const middle = { x: viewport.width * .3, y: viewport.height * .3, width: viewport.width * .4, height: viewport.height * .4 };
      assert.equal(overlaps(b, middle), false, `${name}: ${selector} stays out of the central frame`);
    }
    const keys = Object.keys(boxes);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++)
      assert.equal(overlaps(boxes[keys[i]], boxes[keys[j]]), false, `${name}: ${keys[i]} clears ${keys[j]}`);
    entry.layout = boxes;
    await shot(page, `${name}-default`, entry);
    entry.checks.push('tap entry keeps the play frame; every touch control visible, 44px+, mutually clear and outside the central 40%');

    const free = { x: viewport.width * .5, y: viewport.height * .42 };
    await drag(free, { x: free.x + 80, y: free.y + 20 });
    const looked = await snapshot(page);
    assert.ok(looked.rig.yaw < opened.rig.yaw - .2, `${name}: one-finger drag turns right`); assert.equal(looked.pose.fov, play.pose.fov);
    await touch('touchStart', [{ x: free.x - 30, y: free.y, id: 1 }, { x: free.x + 30, y: free.y, id: 2 }]); await frames(page, 1);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: free.x - 30 - i * 10, y: free.y, id: 1 }, { x: free.x + 30 + i * 10, y: free.y, id: 2 }]); await frames(page, 1); }
    await touch('touchEnd', []); await frames(page, 1);
    const pinched = await snapshot(page);
    assert.ok(pinched.pose.fov < play.pose.fov - 10, `${name}: pinch-out narrows the lens (${pinched.pose.fov})`);
    assert.ok(Math.abs(pinched.rig.yaw - looked.rig.yaw) < .08, `${name}: pinch barely looks`);
    entry.checks.push('one-finger look and two-finger pinch zoom on the empty frame');

    const shutter = await center('[data-photo-control="capture"]');
    await drag({ x: shutter.x, y: shutter.y }, { x: free.x, y: free.y - 40 });
    const isolated = await snapshot(page);
    assert.equal(isolated.rig.yaw, pinched.rig.yaw, `${name}: a drag that starts on a control never looks`);
    assert.equal(isolated.ui.busy, false); assert.equal(entry.downloads.length, 0, 'and a drag off the shutter is not a tap');
    entry.checks.push('UI pointer isolation: a drag starting on the shutter does not leak into look or capture');

    const pad = await center('[data-photo-control="pad"]');
    const beforePad = await snapshot(page);
    await touch('touchStart', [{ x: pad.x, y: pad.box.y + 6, id: 3 }]); await frames(page, 20); await touch('touchEnd', []);
    await settle(page);
    const padded = await snapshot(page);
    const dist = Math.hypot(padded.rig.position.x - beforePad.rig.position.x, padded.rig.position.z - beforePad.rig.position.z);
    assert.ok(dist > .2, `${name}: photo move pad dollies the camera (${dist})`);
    assert.deepEqual(padded.position, play.position); assert.deepEqual(padded.touch, { x: 0, y: 0 }, 'gameplay joystick untouched');
    const lift = await center('[data-photo-control="up"]');
    await touch('touchStart', [{ x: lift.x, y: lift.y, id: 4 }]); await frames(page, 15); await touch('touchEnd', []);
    await settle(page);
    assert.ok((await snapshot(page)).rig.position.y > padded.rig.position.y + .15, `${name}: ▲ raises the camera`);
    entry.checks.push('photo move pad and ▲ hold move only the photo camera');

    await capturePng(page, () => page.locator('[data-photo-control="capture"]').tap(), `${name}-captured`, entry);
    entry.checks.push('shutter tap downloads an opaque native-resolution PNG without moving the camera');

    // Simulated notch/home-indicator insets through the properties env() feeds.
    await page.evaluate(([t, r, b, l]) => {
      const s = document.querySelector('.photo-mode').style;
      s.setProperty('--photo-edge-t', `${t}px`); s.setProperty('--photo-edge-r', `${r}px`);
      s.setProperty('--photo-edge-b', `${b}px`); s.setProperty('--photo-edge-l', `${l}px`);
    }, viewport.width > viewport.height ? [8, 48, 21, 48] : [47, 12, 34, 12]);
    const insets = viewport.width > viewport.height ? [8, 48, 21, 48] : [47, 12, 34, 12];
    for (const selector of selectors) {
      const b = await box(page, selector);
      assert.ok(b.y >= insets[0] - .5 && b.x + b.width <= viewport.width - insets[1] + .5 && b.y + b.height <= viewport.height - insets[2] + .5 && b.x >= insets[3] - .5,
        `${name}: ${selector} respects simulated safe-area insets ${JSON.stringify(b)}`);
    }
    await shot(page, `${name}-safe-area-simulated`, entry);
    await page.evaluate(() => document.querySelector('.photo-mode').removeAttribute('style'));
    entry.checks.push(`controls stay inside simulated safe-area insets ${JSON.stringify(insets)}`);

    await page.locator('[data-photo-control="close"]').tap();
    await page.waitForFunction(() => !window.__PHOTO_QA__.snapshot().active); await frames(page, 2);
    const closed = await snapshot(page);
    assert.deepEqual(closed.pose, play.pose, `${name}: close restores the exact play camera`);
    assert.equal(closed.claims, 0); assert.equal(closed.input, true);
    entry.checks.push('✕ restores the exact play camera and gameplay input');
  } finally { await touch('touchCancel', []).catch(() => {}); await cdp.detach().catch(() => {}); await page.close(); }
}

let smoke;
try {
  if (!process.env.WORLD_SMOKE_BROWSER) {
    try { await access(chromium.executablePath()); } catch { throw Error('BROWSER_UNAVAILABLE: pinned Chromium is not installed'); }
  }
  // Local iteration only: PHOTO_MODE_QA_CASES=desktop,portrait. CI always runs every case.
  const only = new Set((process.env.PHOTO_MODE_QA_CASES || 'desktop,portrait,landscape').split(','));
  if (only.has('desktop')) {
    smoke = await startSmoke({ viewport: { width: 1280, height: 720 }, contextOptions: { acceptDownloads: true } });
    await desktop(smoke);
    assert.deepEqual(smoke.problems, []);
    await smoke.close(); smoke = null;
  }
  for (const [name, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]].filter(([name]) => only.has(name))) {
    smoke = await startSmoke({ viewport, contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true } });
    await touchCase(smoke, name, viewport);
    assert.deepEqual(smoke.problems, []);
    await smoke.close(); smoke = null;
  }
  report.status = only.size === 3 ? 'PASS' : 'PARTIAL';
} catch (error) {
  report.status = /BROWSER_UNAVAILABLE|EPERM|Operation not permitted|EACCES/.test(String(error)) ? 'BLOCKED' : 'FAIL';
  report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  if (smoke) { report.problems = smoke.problems; await smoke.close(); }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
