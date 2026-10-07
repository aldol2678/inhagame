// Exact-head, offline acceptance of the actual /campus/ scene and the production Photo Mode 2.0.
// PHOTO_MODE_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 \
// WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/photo-mode-campus-smoke.mjs
// The shared harness stubs APIs/Supabase and blocks off-origin traffic. No accounts or live writes.
// SwiftShader renders the full campus at ~1 fps, so every wait counts rendered frames, not time.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.env.PHOTO_MODE_QA_OUTPUT || 'test-results/photo-mode/campus';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo });
const sources = ['campus/index.html', 'src/main.js', 'styles.css', 'src/world-collision.js',
  'src/photo/photo-capture.js', 'src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js',
  'src/photo/photo-camera-controller.js', 'src/photo/photo-input.js',
  'src/orbit-camera-controller.js', 'src/player-controller.js', 'src/input/input-focus-manager.js',
  'src/input/pointer-lock-runtime.js', 'src/character-model.js', 'tests/browser/photo-mode-campus-smoke.mjs'];
const report = {
  status: 'RUNNING', expectedHead: process.env.PHOTO_MODE_HEAD_SHA ?? null,
  scope: 'Actual production campus, avatar, HUD, Photo Mode UI and WebGL2 at an arbitrary non-lake campus point. Offline APIs; no account/backend/live social acceptance.',
  sourceHashes: {}, cases: [], screenshots: [],
  limits: ['Mobile viewport/touch emulation (CDP touch events) is not physical-device acceptance.',
    'SwiftShader frame rate (~1 fps at 1280x720) makes motion checks frame-count based; feel/latency needs a real GPU.',
    'env(safe-area-inset-*) cannot be emulated in headless Chromium; the fixture smoke simulates insets via the same CSS properties.']
};
await mkdir(output, { recursive: true });
const save = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
const watchdog = setTimeout(() => {
  report.status = 'FAIL'; report.error = 'Actual-campus acceptance exceeded 1500000 ms';
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2)); process.exit(1);
}, 1_500_000);

async function screenshot(page, entry, name, kind) {
  const path = `${output}/${name}.png`;
  await page.screenshot({ path, timeout: 60_000, animations: 'disabled' });
  const bytes = await readFile(path);
  const evidence = { file: `${name}.png`, kind, sha256: sha256(bytes), bytes: bytes.length, viewport: page.viewportSize() };
  report.screenshots.push(evidence); entry.screenshots.push(evidence); return evidence;
}
const snapshot = page => page.evaluate(() => {
  const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
  const c = d.orbit.camera, cp = c.getPosition(), cr = c.getRotation();
  return { active: d.photoMode.active, position: [p.x, p.y, p.z], input: d.controller.inputEnabled, orbitInput: d.orbit.inputEnabled,
    pose: { position: [cp.x, cp.y, cp.z], rotation: [cr.x, cr.y, cr.z, cr.w], fov: c.camera.fov, nearClip: c.camera.nearClip },
    orbit: { yaw: d.orbit.yaw, pitch: d.orbit.pitch, distance: d.orbit.distance, firstPerson: d.orbit.firstPerson },
    photo: s.photoMode, focus: s.inputFocus, pointerLock: s.pointerLock, hud: document.body.dataset.photoMode ?? null,
    hudVisibility: getComputedStyle(document.querySelector('.campus-topbar')).visibility, space: s.space,
    bodyVisible: d.character.equipmentVisible, emote: s.emote?.id ?? null, frame: d.app.frame, touch: { ...d.controller.touchVector } };
});
async function frames(page, count = 3) {
  const at = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
  await page.waitForFunction(({ at, count }) => window.__INHAGAME_P0__.app.frame >= at + count,
    { at, count }, { timeout: 120_000, polling: 'raf' });
}
async function holdKey(page, key, count) { await page.keyboard.down(key); try { await frames(page, count); } finally { await page.keyboard.up(key); } }
async function settle(page) {
  await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().photoMode.camera?.moving === false, null, { timeout: 120_000, polling: 'raf' });
}
const rig = s => s.photo.camera;
const travel = s => Math.hypot(rig(s).position.x - rig(s).entry.x, rig(s).position.y - rig(s).entry.y, rig(s).position.z - rig(s).entry.z);
function restored(actual, before, label) {
  assert.equal(actual.active, false, `${label}: photo closed`);
  assert.deepEqual(actual.pose, before.pose, `${label}: exact camera transform/lens restoration`);
  assert.deepEqual(actual.orbit, before.orbit, `${label}: orbit untouched`);
  assert.equal(actual.hud, before.hud, `${label}: HUD attribute restored`);
  assert.equal(actual.hudVisibility, before.hudVisibility, `${label}: HUD visibility restored`);
  assert.equal(actual.focus.activeClaimCount, before.focus.activeClaimCount, `${label}: no leaked claim`);
  assert.equal(actual.input, before.input, `${label}: movement restored`);
}
async function decodePng(page, bytes) {
  return page.evaluate(async base64 => {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, bins = new Set(); let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] === 255) opaque++; if (i % 64 === 0) bins.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`); }
    const result = { width: canvas.width, height: canvas.height, opaque, colorBins: bins.size };
    bitmap.close(); canvas.width = canvas.height = 0; return result;
  }, bytes.toString('base64'));
}
async function capture(page, entry, trigger, name) {
  const dimensions = await page.locator('#application').evaluate(c => ({ width: c.width, height: c.height }));
  const before = await snapshot(page);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), trigger()]);
  const file = `${name}-saved-photo-${dimensions.width}x${dimensions.height}.png`;
  assert.match(download.suggestedFilename(), /^inha-world-.*\.png$/);
  await download.saveAs(`${output}/${file}`); assert.equal(await download.failure(), null);
  const bytes = await readFile(`${output}/${file}`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), dimensions.width); assert.equal(bytes.readUInt32BE(20), dimensions.height);
  const decoded = await decodePng(page, bytes);
  assert.equal(decoded.opaque, dimensions.width * dimensions.height);
  assert.ok(decoded.colorBins > 12, 'Actual-campus saved PNG must not be blank');
  await page.waitForFunction(() => !window.__INHAGAME_P0__.getStatus().photoMode.panel.busy, null, { timeout: 120_000 });
  const after = await snapshot(page);
  assert.equal(after.active, true); assert.deepEqual(after.pose, before.pose, 'capture never moves the camera');
  assert.deepEqual(after.position, before.position);
  const evidence = { file, kind: 'Actual campus PNG downloaded by the production shutter', bytes: bytes.length, sha256: sha256(bytes), ...decoded };
  entry.downloads.push(evidence); report.screenshots.push(evidence); return evidence;
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// An arbitrary walkable campus point, deliberately far from the Inkyung lake anchor.
async function placeAnywhere(page) {
  return page.evaluate(async () => {
    const d = window.__INHAGAME_P0__;
    const { canOccupy } = await import('/src/world-collision.js');
    const { overPondWater } = await import('/src/landmark-detail-layout.js');
    const { INKYUNG_PHOTO_POINT: lake } = await import('/src/photo/inkyung-photo-point.js');
    const candidates = [[-18, 24], [22, -36], [8, 14], [-35, -20], [40, 58], [0, -80]];
    for (const [x, z] of candidates) {
      const p = { x, z, y: d.controller.groundY + d.controller.space.groundHeight(x, z) };
      if (!canOccupy(p) || overPondWater(x, z) || Math.hypot(x - lake.position.x, z - lake.position.z) < 40) continue;
      d.controller.keys.clear(); d.controller.clearAssistedMovement(); d.controller.velocityY = 0; d.controller.grounded = true;
      d.player.setLocalPosition(p.x, p.y, p.z);
      d.orbit.yaw = 2.4; d.orbit.pitch = .3;
      return { ...p, lakeDistance: Math.hypot(x - lake.position.x, z - lake.position.z) };
    }
    throw Error('no walkable arbitrary campus point');
  });
}
async function boot(startSmoke, TIMEOUT_MS, entry, viewport, mobile) {
  const smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, acceptDownloads: true } });
  const page = await smoke.context.newPage(); page.setDefaultTimeout(60_000);
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await Promise.race([page.waitForFunction(() => {
    const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished;
  }, null, { timeout: TIMEOUT_MS }), fatal]);
  const status = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
  assert.equal(status.renderer, 'WebGL2', status.error ?? 'Expected the actual WebGL2 renderer');
  assert.equal(status.lobby?.active ?? false, false, 'normal world exploration, not the lobby');
  entry.servedHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const bytes = await (await fetch(`/${path}`, { cache: 'no-store' })).arrayBuffer();
    return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')];
  }))), sources);
  assert.deepEqual(entry.servedHashes, report.sourceHashes);
  entry.place = await placeAnywhere(page);
  await frames(page, 4);
  entry.checks.push(`Actual production boot (WebGL2), served SHA-256 match, player at arbitrary campus point ${entry.place.lakeDistance.toFixed(0)} units from the lake`);
  return { smoke, page };
}

async function desktopCase(startSmoke, TIMEOUT_MS) {
  const viewport = { width: 1280, height: 720 }, entry = { name: 'desktop', viewport, status: 'RUNNING', checks: [], screenshots: [], downloads: [] };
  report.cases.push(entry);
  let smoke, page, stage = 'boot';
  try {
    ({ smoke, page } = await boot(startSmoke, TIMEOUT_MS, entry, viewport, false));
    stage = 'entry';
    const canvas = page.locator('#application');
    await canvas.click({ position: { x: 640, y: 360 } });
    await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().pointerLock.locked === true, null, { timeout: 30_000 });
    // Headless Chromium can deliver a recentering delta when the lock engages; keep a readable framing.
    await frames(page, 1);
    await page.evaluate(() => Object.assign(window.__INHAGAME_P0__.orbit, { yaw: 2.4, pitch: .3 }));
    await frames(page, 3);
    const play = await snapshot(page);
    assert.equal(play.pointerLock.locked, true);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__INHAGAME_P0__.photoMode.active && document.pointerLockElement === null &&
      window.__INHAGAME_P0__.getStatus().pointerLock.locked === false, null, { timeout: 30_000, polling: 50 });
    const opened = await snapshot(page);
    assert.deepEqual(opened.pose, play.pose, 'entry frame is the play frame (no snap toward any landmark)');
    await frames(page, 3);
    assert.deepEqual((await snapshot(page)).pose, play.pose, 'rendered photo frames keep the entry pose');
    assert.deepEqual(opened.focus.topOwners, ['photo-mode']); assert.equal(opened.focus.focusClass, 'BLOCKING_UI');
    assert.equal(opened.input, false); assert.equal(opened.orbitInput, false); assert.equal(opened.hudVisibility, 'hidden');
    assert.equal(opened.pointerLock.locked, false);
    await screenshot(page, entry, 'desktop-default', 'Photo Mode default overlay at the unchanged play composition');
    entry.checks.push('P entry with real Pointer Lock: lock released, exact play frame kept across rendered frames, HUD hidden, photo owns focus');

    stage = 'camera';
    await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(740, 340, { steps: 4 }); await page.mouse.up();
    await frames(page, 2);
    const looked = await snapshot(page);
    assert.ok(rig(looked).yaw < rig(opened).yaw - .3, 'mouse drag looks'); assert.deepEqual(looked.position, play.position);
    await holdKey(page, 'KeyW', 4); await settle(page);
    const forward = await snapshot(page);
    assert.ok(travel(forward) > .2, `W dollies (${travel(forward)})`); assert.deepEqual(forward.position, play.position, 'player stays put');
    await holdKey(page, 'KeyE', 3); await settle(page);
    assert.ok(rig(await snapshot(page)).position.y > rig(forward).position.y + .1, 'E raises');
    await page.mouse.move(640, 360); await page.mouse.wheel(0, -300); await frames(page, 2);
    assert.ok((await snapshot(page)).pose.fov < play.pose.fov - 5, 'wheel zoom');
    await screenshot(page, entry, 'desktop-moved', 'After drag look, W dolly, E rise and wheel zoom');
    entry.checks.push('mouse drag look, W dolly, E rise, wheel FOV on the real campus; the player never moves');

    stage = 'ui-and-settings';
    await canvas.focus(); await page.keyboard.press('KeyH'); await frames(page, 1);
    assert.equal(await page.locator('.photo-mode-shutter').isVisible(), false);
    await screenshot(page, entry, 'desktop-ui-hidden', 'H: clean frame with one faint restore control');
    await page.keyboard.press('KeyH');
    await page.locator('[data-photo-control="settings"]').click();
    await page.locator('[data-photo-control="grid"]').selectOption('thirds'); await frames(page, 1);
    await screenshot(page, entry, 'desktop-settings', 'CAMERA settings drawer on the right edge with the 3x3 grid');
    await page.keyboard.press('Escape');
    assert.equal((await snapshot(page)).active, true, 'Escape closes the drawer first');
    entry.checks.push('H clean frame; ⚙ drawer and 3×3 grid; Escape closes the drawer before Photo Mode');

    stage = 'capture';
    await canvas.focus();
    await capture(page, entry, () => page.keyboard.press('Space'), 'desktop');
    entry.checks.push('Space downloads an opaque, nonblank, native-resolution PNG without moving the camera (grid on)');

    stage = 'reset-exit';
    await page.keyboard.press('KeyR'); await frames(page, 2);
    const reset = await snapshot(page);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(reset.pose.position[i] - play.pose.position[i]) < 1e-4, 'R returns to the entry position');
    assert.equal(reset.pose.fov, play.pose.fov, 'R restores the lens');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__INHAGAME_P0__.photoMode.active); await frames(page, 2);
    const closed = await snapshot(page);
    restored(closed, play, 'Escape');
    assert.equal(closed.pointerLock.awaitingGesture, true, 'no automatic Pointer Lock reacquisition');
    await canvas.focus(); await holdKey(page, 'KeyW', 4);
    const walked = await snapshot(page);
    assert.ok(Math.hypot(walked.position[0] - play.position[0], walked.position[2] - play.position[2]) > .05, 'player controls work after exit');
    entry.checks.push('R reset; Escape restores exact camera/orbit/HUD/focus; fresh W walks the player');

    stage = 'first-person';
    await canvas.focus(); await page.keyboard.press('KeyV'); await frames(page, 2);
    const first = await snapshot(page);
    assert.equal(first.orbit.firstPerson, true); assert.equal(first.bodyVisible, false);
    await page.keyboard.press('KeyP'); await page.waitForFunction(() => window.__INHAGAME_P0__.photoMode.active); await frames(page, 2);
    const firstOpen = await snapshot(page);
    assert.deepEqual(firstOpen.pose, first.pose, 'first-person entry keeps the eye frame');
    assert.equal(firstOpen.bodyVisible, false, 'local body stays hidden while the camera is at the eye');
    await holdKey(page, 'KeyS', 6); await settle(page);
    assert.equal((await snapshot(page)).bodyVisible, true, 'backing away reveals the local body for the shot');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__INHAGAME_P0__.photoMode.active); await frames(page, 2);
    const firstClosed = await snapshot(page);
    restored(firstClosed, first, 'First-person exit'); assert.equal(firstClosed.bodyVisible, false);
    await canvas.focus(); await page.keyboard.press('KeyV'); await frames(page, 2);
    entry.checks.push('first-person entry keeps the eye frame, reveals the body once the camera leaves the eye, restores first person');

    stage = 'room-takeover-and-indoor';
    const normal = await snapshot(page);
    await page.keyboard.press('KeyP'); await page.waitForFunction(() => window.__INHAGAME_P0__.photoMode.active);
    // PhotoMode's own entry snapshot is the restoration contract (the pre-entry frame may differ in the last bits).
    const saved = await page.evaluate(() => {
      const s = window.__INHAGAME_P0__.photoMode.saved;
      return { position: [s.position.x, s.position.y, -s.position.z], rotation: [...s.rotation], fov: s.fov, nearClip: s.nearClip };
    });
    await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(700, 360, { steps: 3 }); await page.mouse.up(); await frames(page, 1);
    entry.roomTakeover = await page.evaluate(() => {
      const d = window.__INHAGAME_P0__, accepted = d.rooms.enter('ROOM_CLUBHOUSE_01');
      const c = d.orbit.camera, p = c.getPosition(), r = c.getRotation();
      return { accepted, active: d.photoMode.active, input: d.controller.inputEnabled, focus: d.getStatus().inputFocus,
        pose: { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w], fov: c.camera.fov, nearClip: c.camera.nearClip } };
    });
    assert.equal(entry.roomTakeover.accepted, true); assert.equal(entry.roomTakeover.active, false);
    assert.equal(entry.roomTakeover.input, false); assert.equal(entry.roomTakeover.focus.focusClass, 'SYSTEM_LOCK');
    // rooms.enter() re-applies the orbit itself right after the restore, so compare within float noise.
    const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    assert.ok(near(entry.roomTakeover.pose.position, saved.position) && near(entry.roomTakeover.pose.rotation, saved.rotation) &&
      entry.roomTakeover.pose.fov === saved.fov && entry.roomTakeover.pose.nearClip === saved.nearClip,
      `the transition sees the restored play camera: ${JSON.stringify({ seen: entry.roomTakeover.pose, saved })}`);
    await page.waitForFunction(() => { const d = window.__INHAGAME_P0__; return d.rooms.currentSpace === 'ROOM_CLUBHOUSE_01' && d.rooms.status().ready; }, null, { timeout: 120_000 });
    await frames(page, 3);
    const indoor = await snapshot(page);
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.photoMode.open()), true, 'indoor rooms open Photo Mode');
    await frames(page, 2); assert.deepEqual((await snapshot(page)).pose, indoor.pose, 'indoor entry keeps the play frame');
    await holdKey(page, 'KeyA', 30); await settle(page);
    const wallTest = await snapshot(page);
    const roomHalf = await page.evaluate(async () => (await import('/src/rooms/club-room-layout.js')).CLUB_ROOM_BOUNDS);
    assert.ok(rig(wallTest).position.x > roomHalf.minX - .1 && rig(wallTest).position.x < roomHalf.maxX + .1, `room walls hold the photo camera inside (${rig(wallTest).position.x})`);
    await screenshot(page, entry, 'desktop-indoor-club-room', 'Photo Mode inside the real Club Room after strafing into its wall');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__INHAGAME_P0__.photoMode.active); await frames(page, 2);
    restored(await snapshot(page), indoor, 'Indoor exit');
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.rooms.exit()), true);
    await page.waitForFunction(() => { const d = window.__INHAGAME_P0__; return d.rooms.currentSpace === 'campus' && !d.rooms.status().busy; }, null, { timeout: 120_000 });
    const returned = await snapshot(page);
    assert.equal(returned.focus.activeClaimCount, 0); assert.equal(returned.input, true);
    entry.checks.push('real Club Room transition takes over (camera restored first); indoor Photo Mode opens, room walls bound it, exit restores; campus return clean');

    stage = 'repeat';
    for (let i = 0; i < 3; i++) {
      await canvas.focus(); await page.keyboard.press('KeyP'); await page.waitForFunction(() => window.__INHAGAME_P0__.photoMode.active);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__INHAGAME_P0__.photoMode.active);
      assert.equal((await snapshot(page)).focus.activeClaimCount, 0);
    }
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.photoMode.close()), false, 'repeated close is idempotent');
    entry.checks.push('three P/Escape cycles plus repeated close without leaked focus owners');
    assert.deepEqual(smoke.problems, []);
    entry.status = 'PASS';
  } catch (error) {
    entry.status = 'FAIL'; entry.stage = stage; entry.error = String(error.stack ?? error);
    if (page) await screenshot(page, entry, `desktop-failure-${stage}`, 'failure evidence').catch(() => {});
    throw error;
  } finally { entry.problems = smoke?.problems ?? []; await smoke?.close(); await save(); }
}

async function touchCase(startSmoke, TIMEOUT_MS, name, viewport) {
  const entry = { name, viewport, status: 'RUNNING', checks: [], screenshots: [], downloads: [] };
  report.cases.push(entry);
  let smoke, page, cdp, stage = 'boot';
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const center = async selector => { const b = await page.locator(selector).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };
  try {
    ({ smoke, page } = await boot(startSmoke, TIMEOUT_MS, entry, viewport, true));
    cdp = await smoke.context.newCDPSession(page);
    stage = 'hud-entry';
    // The 📷 entry lives in the existing social row and must clear the mobile HUD (incl. landscape override).
    const hud = await page.evaluate(() => {
      const rect = id => { const n = document.querySelector(id); if (!n || n.hidden || !n.getClientRects().length) return null;
        const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      return { photo: rect('#photo-mode-toggle'), social: rect('.social-cluster'), joystick: rect('#joystick'), run: rect('#run'),
        jump: rect('#jump'), minimap: rect('#minimap'), context: rect('#context-action'), transport: rect('#transport-action'),
        topbar: rect('.campus-topbar'), coarse: matchMedia('(pointer: coarse)').matches };
    });
    entry.hud = hud;
    assert.equal(hud.coarse, true);
    assert.ok(hud.photo && hud.photo.width >= 40 && hud.photo.height >= 40, `${name}: 📷 visible as a touch target`);
    assert.ok(hud.photo.x >= 0 && hud.photo.y >= 0 && hud.photo.x + hud.photo.width <= viewport.width && hud.photo.y + hud.photo.height <= viewport.height);
    for (const key of ['joystick', 'run', 'jump', 'minimap', 'context', 'transport', 'topbar'])
      if (hud[key]) assert.equal(overlaps(hud.photo, hud[key]), false, `${name}: 📷 clears ${key}`);
    await screenshot(page, entry, `${name}-hud-entry`, 'Play HUD with the 📷 entry in the social row');
    entry.checks.push('📷 entry visible in the social row, inside the viewport and clear of joystick/RUN/JUMP/minimap/actions/top bar');

    stage = 'entry';
    const play = await snapshot(page);
    await page.locator('#photo-mode-toggle').tap();
    await page.waitForFunction(() => window.__INHAGAME_P0__.photoMode.active, null, { timeout: 30_000 });
    const opened = await snapshot(page);
    assert.deepEqual(opened.pose, play.pose, `${name}: entry frame is the play frame`);
    await frames(page, 2); assert.deepEqual((await snapshot(page)).pose, play.pose);
    assert.equal(opened.hudVisibility, 'hidden');
    for (const selector of ['[data-photo-control="close"]', '[data-photo-control="capture"]', '[data-photo-control="pad"]', '[data-photo-control="up"]', '[data-photo-control="down"]']) {
      const b = await page.locator(selector).boundingBox();
      assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height, `${name}: ${selector} on screen`);
    }
    await screenshot(page, entry, `${name}-default`, 'Photo Mode touch overlay at the unchanged play composition');
    entry.checks.push('tap entry keeps the exact play frame; close/shutter/pad/▲▼ on screen; play HUD hidden');

    stage = 'gestures';
    const free = { x: viewport.width * .5, y: viewport.height * .42 };
    await touch('touchStart', [{ ...free, id: 1 }]);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: free.x + i * 20, y: free.y + i * 4, id: 1 }]);
    await frames(page, 2); await touch('touchEnd', []); await frames(page, 1);
    const looked = await snapshot(page);
    assert.ok(rig(looked).yaw < rig(opened).yaw - .2, `${name}: one-finger look`);
    await touch('touchStart', [{ x: free.x - 30, y: free.y, id: 1 }, { x: free.x + 30, y: free.y, id: 2 }]); await frames(page, 1);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: free.x - 30 - i * 15, y: free.y, id: 1 }, { x: free.x + 30 + i * 15, y: free.y, id: 2 }]);
    await frames(page, 2); await touch('touchEnd', []); await frames(page, 1);
    assert.ok((await snapshot(page)).pose.fov < play.pose.fov - 10, `${name}: pinch zoom`);
    const pad = await center('[data-photo-control="pad"]'), beforePad = await snapshot(page);
    await touch('touchStart', [{ x: pad.x, y: pad.box.y + 6, id: 3 }]); await frames(page, 4); await touch('touchEnd', []); await settle(page);
    const padded = await snapshot(page);
    assert.ok(Math.hypot(rig(padded).position.x - rig(beforePad).position.x, rig(padded).position.z - rig(beforePad).position.z) > .1, `${name}: pad dolly`);
    assert.deepEqual(padded.position, play.position); assert.deepEqual(padded.touch, { x: 0, y: 0 }, 'gameplay joystick untouched');
    const lift = await center('[data-photo-control="up"]');
    await touch('touchStart', [{ x: lift.x, y: lift.y, id: 4 }]); await frames(page, 3); await touch('touchEnd', []); await settle(page);
    assert.ok(rig(await snapshot(page)).position.y > rig(padded).position.y + .05, `${name}: ▲ rises`);
    await screenshot(page, entry, `${name}-moved`, 'After one-finger look, pinch zoom, pad dolly and ▲ rise');
    entry.checks.push('one-finger look, pinch zoom, photo move pad and ▲ hold on the real campus; player and gameplay joystick untouched');

    stage = 'reset';
    await page.locator('[data-photo-control="settings"]').tap();
    assert.equal(await page.locator('.photo-mode-settings').isVisible(), true);
    await screenshot(page, entry, `${name}-settings`, 'CAMERA settings drawer on a touch viewport');
    await page.locator('[data-photo-control="reset"]').tap(); await frames(page, 2);
    await page.locator('[data-photo-control="settings"]').tap();
    const reset = await snapshot(page);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(reset.pose.position[i] - play.pose.position[i]) < 1e-4, `${name}: reset returns to the entry position`);
    assert.equal(reset.pose.fov, play.pose.fov, `${name}: reset restores the lens`);
    entry.checks.push('⚙ drawer reset returns the photo camera to the entry pose and lens');

    stage = 'capture-close';
    await capture(page, entry, () => page.locator('[data-photo-control="capture"]').tap(), name);
    await page.locator('[data-photo-control="ui"]').tap(); await frames(page, 1);
    assert.equal(await page.locator('.photo-mode-shutter').isVisible(), false);
    await screenshot(page, entry, `${name}-ui-hidden`, '👁: clean frame with one faint restore control');
    await page.locator('[data-photo-control="restore"]').tap();
    await page.locator('[data-photo-control="close"]').tap();
    await page.waitForFunction(() => !window.__INHAGAME_P0__.photoMode.active); await frames(page, 2);
    restored(await snapshot(page), play, `${name} close`);
    const stick = await center('#joystick');
    await touch('touchStart', [{ x: stick.x, y: stick.y, id: 5 }]); await touch('touchMove', [{ x: stick.x, y: stick.y - 30, id: 5 }]);
    await frames(page, 3);
    const walking = await snapshot(page); await touch('touchEnd', []);
    assert.ok(walking.touch.y !== 0 || Math.hypot(walking.position[0] - play.position[0], walking.position[2] - play.position[2]) > .02, `${name}: joystick works after exit`);
    entry.checks.push('shutter tap PNG (camera unchanged), 👁 hide/restore, ✕ exact restore, gameplay joystick works again');
    assert.deepEqual(smoke.problems, []);
    entry.status = 'PASS';
  } catch (error) {
    entry.status = 'FAIL'; entry.stage = stage; entry.error = String(error.stack ?? error);
    if (page) await screenshot(page, entry, `${name}-failure-${stage}`, 'failure evidence').catch(() => {});
    throw error;
  } finally {
    if (cdp) { await touch('touchCancel', []).catch(() => {}); await cdp.detach().catch(() => {}); }
    entry.problems = smoke?.problems ?? []; await smoke?.close(); await save();
  }
}

try {
  assert.match(report.expectedHead ?? '', /^[a-f0-9]{40}$/, 'Set PHOTO_MODE_HEAD_SHA to the exact 40-character candidate SHA');
  report.head = git('rev-parse', 'HEAD').toString().trim();
  assert.equal(report.head, report.expectedHead, 'Local HEAD must equal the requested candidate');
  report.trackedDiffAgainstHead = git('diff', '--name-only', 'HEAD', '--', 'apps/world').toString().trim().split('\n').filter(Boolean);
  for (const path of sources) report.sourceHashes[path] = sha256(await readFile(new URL(`../../${path}`, import.meta.url)));
  const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
  const only = new Set((process.env.PHOTO_MODE_QA_CASES || 'desktop,portrait,landscape').split(','));
  if (only.has('desktop')) await desktopCase(startSmoke, TIMEOUT_MS);
  if (only.has('portrait')) await touchCase(startSmoke, TIMEOUT_MS, 'portrait', { width: 390, height: 844 });
  if (only.has('landscape')) await touchCase(startSmoke, TIMEOUT_MS, 'landscape', { width: 844, height: 390 });
  report.status = only.size === 3 ? 'PASS' : 'PARTIAL';
} catch (error) {
  report.status = /BROWSER_UNAVAILABLE|EPERM|Operation not permitted|EACCES/.test(String(error)) ? 'BLOCKED' : 'FAIL';
  report.error ??= String(error.stack ?? error); process.exitCode = 1;
} finally {
  clearTimeout(watchdog); await save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status, checks: c.checks.length, stage: c.stage })), error: report.error }, null, 2));
}
