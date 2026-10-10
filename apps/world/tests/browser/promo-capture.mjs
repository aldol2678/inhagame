import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {startSmoke, TIMEOUT_MS} from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const manifestPath = path.resolve(root, process.argv[2] || process.env.WORLD_PROMO_MANIFEST || 'apps/world/promo/capture-manifest.v1.json');
const outputDir = path.resolve(root, process.env.WORLD_PROMO_OUTPUT || 'test-results/world-promo-capture');
const expectedHead = process.env.EXPECTED_PROMO_HEAD || null;
const text = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(text);
const hash = value => createHash('sha256').update(value).digest('hex');
const kinds = new Set(['walk', 'orbit', 'ui']);
const targets = new Set(['current', 'main-hall', 'jeongseok-library', 'student-center', 'poi.main-hall']);

function validate() {
  assert.equal(manifest.schema, 'inha-world.promo-capture.v1');
  assert.ok(Number.isInteger(manifest.output?.width) && manifest.output.width >= 640 && manifest.output.width <= 3840);
  assert.ok(Number.isInteger(manifest.output?.height) && manifest.output.height >= 360 && manifest.output.height <= 2160);
  assert.ok(Number.isInteger(manifest.output?.timelineFps) && manifest.output.timelineFps >= 24 && manifest.output.timelineFps <= 60);
  assert.equal(manifest.output?.container, 'webm');
  assert.ok(Array.isArray(manifest.shots) && manifest.shots.length > 0 && manifest.shots.length <= 12);
  const ids = new Set();
  for (const shot of manifest.shots) {
    assert.match(shot.id, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.ok(!ids.has(shot.id)); ids.add(shot.id);
    assert.ok(kinds.has(shot.kind), `unsupported kind: ${shot.kind}`);
    assert.ok(targets.has(shot.target), `unsupported target: ${shot.target}`);
    assert.ok(Number.isInteger(shot.durationMs) && shot.durationMs >= 1000 && shot.durationMs <= 10000);
    assert.ok(!('x' in shot) && !('z' in shot), `${shot.id}: use semantic targets, not coordinates`);
    if (shot.kind === 'walk') {
      assert.equal(shot.movement?.key, 'KeyW');
      assert.ok(shot.movement.activeMs > 0 && shot.movement.activeMs <= shot.durationMs);
    }
    if (shot.kind === 'ui') assert.equal(shot.action, 'full-map-navigation');
  }
}
validate();
await mkdir(path.join(outputDir, 'thumbs'), {recursive: true});
const rawVideoDir = await mkdtemp(path.join(tmpdir(), 'inha-world-promo-video-'));

const waitFrames = (page, count = 4) => page.evaluate(n => new Promise(resolve => {
  let left = n;
  const tick = () => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), count);

async function boot(page, fatal, origin) {
  const params = new URLSearchParams({lobby: '1', envTime: manifest.environment.time, envWeather: manifest.environment.weather});
  await page.goto(`${origin}/campus/?${params}`, {waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS});
  await Promise.race([
    page.waitForFunction(() => {
      const s = window.__INHAGAME_P0__?.getStatus?.();
      return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished;
    }, null, {timeout: TIMEOUT_MS}),
    fatal
  ]);
  const status = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
  assert.equal(status.renderer, 'WebGL2');
  assert.equal(status.loading?.phase, 'READY');
  await page.locator('#main-gate-start').click({timeout: TIMEOUT_MS});
  await page.waitForFunction(() => {
    const s = window.__INHAGAME_P0__.getStatus();
    return !s.lobby.active && !s.lobbyTransition.active;
  }, null, {timeout: TIMEOUT_MS});
  await waitFrames(page, 4);
}

async function resolveTarget(page, target) {
  return page.evaluate(async targetId => {
    const d = window.__INHAGAME_P0__;
    const current = d.player.getLocalPosition();
    if (targetId === 'current') return {position: {x: current.x, z: current.z}, lookAt: null, semantic: 'current-player-position'};
    if (targetId === 'main-hall') {
      const {MAIN_ENTRANCE, HALL_FRONT} = await import('/src/basic-campus.js');
      return {position: {x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z}, lookAt: {x: (HALL_FRONT.a.x + HALL_FRONT.b.x) / 2, z: (HALL_FRONT.a.z + HALL_FRONT.b.z) / 2}, semantic: 'bldg_01'};
    }
    if (targetId === 'jeongseok-library') {
      const {LIBRARY_FRONT} = await import('/src/basic-campus.js');
      const p = LIBRARY_FRONT.at(0, 8), look = LIBRARY_FRONT.at(0, 0);
      return {position: {x: p.x, z: p.z}, lookAt: {x: look.x, z: look.z}, semantic: 'bldg_jungseok'};
    }
    if (targetId === 'student-center') {
      const {studentConnectedFrame} = await import('/src/student-center-frame.js');
      const frame = studentConnectedFrame(), p = frame.toWorld([0, 0, 29]), look = frame.toWorld([0, 0, 0]);
      return {position: {x: p[0], z: p[2]}, lookAt: {x: look[0], z: look[2]}, semantic: 'bldg_07'};
    }
    throw new Error(`No resolver for ${targetId}`);
  }, target);
}

async function prepareWorld(page, shot) {
  const resolved = await resolveTarget(page, shot.target);
  return page.evaluate(async ({shot, resolved}) => {
    const d = window.__INHAGAME_P0__;
    const {WALK_SHAPE} = await import('/src/player-dimensions.js');
    const {viewDistancePreset} = await import('/src/view-distance.js');
    if (shot.target !== 'current') d.player.setLocalPosition(resolved.position.x, WALK_SHAPE.footOffset, resolved.position.z);
    d.controller.velocityY = 0; d.controller.grounded = true; d.controller.jumpQueued = false;
    d.streaming.setPolicy(viewDistancePreset('MAX'));
    for (let i = 0; i < d.registry.chunks.length + 12; i += 1) d.streaming.update(.05, d.player.getLocalPosition());
    const now = d.player.getLocalPosition();
    const bearing = resolved.lookAt ? Math.atan2(-(resolved.lookAt.x - now.x), resolved.lookAt.z - now.z) * 180 / Math.PI : d.orbit.yaw;
    d.orbit.yaw = bearing + (shot.camera?.yawOffsetDeg || 0);
    if (Number.isFinite(shot.camera?.pitchDeg)) d.orbit.pitch = shot.camera.pitchDeg;
    if (Number.isFinite(shot.camera?.distance)) d.orbit.distance = shot.camera.distance;
    d.orbit.apply(now, d.character.eyeHeight);
    return {position: {x: now.x, y: now.y, z: now.z}, bearing, semantic: resolved.semantic};
  }, {shot, resolved});
}

async function playShot(page, shot) {
  if (shot.kind === 'walk') {
    await page.keyboard.down(shot.movement.key);
    await page.waitForTimeout(shot.movement.activeMs);
    await page.keyboard.up(shot.movement.key);
    await page.waitForTimeout(Math.max(0, shot.durationMs - shot.movement.activeMs));
    return;
  }
  if (shot.kind === 'orbit') {
    await page.evaluate(({durationMs, sweep}) => new Promise(resolve => {
      const d = window.__INHAGAME_P0__, start = performance.now(), base = d.orbit.yaw;
      const tick = now => {
        const t = Math.min(1, (now - start) / durationMs), eased = .5 - Math.cos(Math.PI * t) / 2;
        d.orbit.yaw = base + sweep * eased;
        d.orbit.apply(d.player.getLocalPosition(), d.character.eyeHeight);
        if (t < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    }), {durationMs: shot.durationMs, sweep: shot.camera?.yawSweepDeg || 0});
    return;
  }
  await page.locator('#minimap-open-map').click({timeout: TIMEOUT_MS});
  await page.locator('#full-map-panel').waitFor({state: 'visible'});
  await page.locator(`.full-map-poi[data-poi-id="${shot.target}"]`).press('Enter');
  await page.locator('#full-map-set-destination').click();
  await page.waitForFunction(id => window.__INHAGAME_P0__.fullMap.destination?.poiId === id, shot.target, {timeout: TIMEOUT_MS});
  await page.waitForTimeout(shot.durationMs);
}

const index = {
  schema: 'inha-world.promo-capture-index.v1',
  generatedAt: new Date().toISOString(),
  source: {expectedHead, manifest: path.relative(root, manifestPath), manifestSha256: hash(text), mode: 'offline-real-render', productionClaim: false},
  output: manifest.output,
  environment: manifest.environment,
  shots: []
};

try {
for (const shot of manifest.shots) {
  const smoke = await startSmoke({
    viewport: {width: manifest.output.width, height: manifest.output.height},
    contextOptions: {recordVideo: {dir: rawVideoDir, size: {width: manifest.output.width, height: manifest.output.height}}}
  });
  let page;
  const entry = {id: shot.id, label: shot.label, kind: shot.kind, target: shot.target, result: 'FAIL'};
  try {
    page = await smoke.context.newPage();
    const video = page.video();
    const start = performance.now();
    const fatal = smoke.watch(page);
    await boot(page, fatal, smoke.origin);
    entry.setup = shot.kind === 'ui' ? {semantic: 'campus-full-map'} : await prepareWorld(page, shot);
    await waitFrames(page, 6);
    const inMs = Math.round(performance.now() - start);
    await playShot(page, shot);
    const outMs = Math.round(performance.now() - start);
    const thumb = path.join(outputDir, 'thumbs', `${shot.id}.png`);
    await page.screenshot({path: thumb});
    await page.close(); page = null;
    const target = path.join(outputDir, `${shot.id}.webm`);
    await video.saveAs(target);
    const info = await stat(target);
    entry.file = path.relative(outputDir, target);
    entry.thumbnail = path.relative(outputDir, thumb);
    entry.edit = {inMs, outMs, durationMs: outMs - inMs};
    entry.bytes = info.size;
    entry.sha256 = hash(await readFile(target));
    await video.delete();
    entry.renderer = 'WebGL2';
    entry.capture = shot.kind === 'walk' ? 'real PlayerController via trusted Playwright keyboard input'
      : shot.kind === 'ui' ? 'real Full Map UI and navigation owner'
      : 'real game renderer with capture-only orbit camera motion';
    assert.deepEqual(smoke.problems, [], `${shot.id}: browser problems`);
    entry.result = 'PASS';
  } catch (error) {
    entry.error = String(error.stack || error);
    if (page) await page.screenshot({path: path.join(outputDir, 'thumbs', `${shot.id}-failure.png`)}).catch(() => {});
    throw error;
  } finally {
    index.shots.push(entry);
    if (page) await page.close().catch(() => {});
    await smoke.close();
    await writeFile(path.join(outputDir, 'capture-index.json'), JSON.stringify(index, null, 2));
  }
}
} finally {
  await rm(rawVideoDir, {recursive: true, force: true});
}
console.log(`Promo Capture P0: ${index.shots.length} shots PASS -> ${outputDir}`);
