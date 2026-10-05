// Hosted-only real-browser acceptance. Never launch this script locally.
// The unchanged shared harness supplies pinned PlayCanvas, disables Supabase,
// stubs API calls and blocks every other off-origin request. All runtime owners
// below are the real /campus/ app; only clock response/player setup is a fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertHostedBrowserExecution, BIRYONG_QA_VIEWPORTS, BIRYONG_QA_NPCS, BIRYONG_QA_HUD_SELECTORS, assertMapLayout, assertMapPointProjection,
  readNpcConversationReadiness, assertInteractionHintLayout, assertInteractionHintCoverage,
  assertNpcNameplateLayout, assertNpcNameplateCoverage, assertBiryongReturnLabelVisible } from './biryong-map-guidance-qa.mjs';

// This must execute BEFORE importing Playwright indirectly through harness.mjs.
assertHostedBrowserExecution(process.env);
const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
const { worldTimePayload, NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS } = await import('../../npc-factory/npc-world-time-contract.mjs');
const { createBiryongMapDataSource, BIRYONG_MAP_DESTINATIONS } = await import('../../src/biryong/biryong-map-data.js');
const { BIRYONG_REALM_PLACE_ZONES } = await import('../../src/biryong/biryong-village-layout.js');

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(process.env.WORLD_BIRYONG_QA_OUTPUT || 'test-results/biryong-map-guidance');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10000 }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const head = git(['rev-parse', 'HEAD']);
const sourcePaths = ['apps/world/src', 'apps/world/npc-factory', 'apps/world/campus', 'apps/world/styles.css',
  'apps/world/dev-server.mjs', 'apps/world/tests/browser/harness.mjs', 'apps/world/tests/browser/package.json',
  'apps/world/tests/browser/package-lock.json', 'apps/world/tests/browser/biryong-map-guidance-smoke.mjs',
  'apps/world/tests/browser/biryong-map-guidance-qa.mjs', 'apps/world/tests/browser/biryong-map-guidance-proximity.mjs',
  'apps/world/tests/biryong-browser-acceptance.test.mjs',
  '.github/workflows/biryong-map-guidance-browser.yml'];
const report = {
  result: 'RUNNING', startedAt: new Date().toISOString(), head, expectedHead: process.env.EXPECTED_BIRYONG_HEAD,
  tree: git(['rev-parse', 'HEAD^{tree}']), githubRunId: process.env.GITHUB_RUN_ID,
  githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT, runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
  scope: 'Actual offline Campus -> BIRYONG_REALM -> Campus, real map/navigation/NPC/dialogue/input owners; no account or Production endpoints',
  fixtures: ['The existing biryongRealm.enter debug entry starts the disposable region visit',
    'Only /api/world-time is overridden with the real contract at class_time, exposing all three public NPCs',
    'The station north-wall camera-regression placement, not a walked journey, changes/restores only the local player and camera; NPCs continue normally',
    'Player placement near live actorSnapshot positions and at the authored F1 stop; this does not claim a walked journey'],
  limits: ['Mobile is Chromium touch emulation at deviceScaleFactor 1, not physical-device QA',
    'All seven map POIs are keyboard-selected; a visible Korean label, toolbar and NPC buttons also receive real pointer/touch input',
    'Nameplate coverage is conditional on real nearby head projections and HUD-free space; NO_CLEAR_ONSCREEN_HEADS records an uncovered viewport, not visual approval',
    'Screenshot presence and framebuffer checks are not independent visual approval'],
  visualReview: 'PENDING_INDEPENDENT_PIXEL_REVIEW', sources: [], cases: []
};
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'report.json');
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const watchdog = setTimeout(() => {
  report.result = 'FAIL'; report.error = 'Overall hosted browser acceptance deadline exceeded (720s)';
  writeFileSync(reportPath, JSON.stringify(report, null, 2)); process.exit(1);
}, 720000);

function readTransitionVisualState(requireClear = false) {
  const overlays = ['space-fade', 'lobby-transition-fade'].map(id => {
    const element = document.getElementById(id);
    if (!element) return { id, present: false };
    const style = getComputedStyle(element);
    return { id, present: true, hidden: element.hidden, classes: element.className,
      opacity: style.opacity, display: style.display, visibility: style.visibility };
  });
  return requireClear ? overlays.every(item => !item.present || (item.hidden && item.display === 'none')) : overlays;
}

async function state(page) {
  const snapshot = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
    return { renderer: s.renderer, loading: s.loading, region: d.biryongRealm.status(),
      player: { x: p.x, y: p.y, z: p.z }, parent: d.player.parent.name, movementSpace: d.controller.space.id,
      enabled: d.controller.inputEnabled, focus: s.inputFocus, minimap: d.minimap.status(),
      fullMap: d.fullMap.status(), navigation: d.navigation.getSnapshot(), navigationErrors: d.navigation.errors(),
      dialogue: d.biryongVillageDialogue.status(), npcs: d.biryongVillageNpcs.status(), touch: { ...d.controller.touchVector },
      assist: d.controller.assist, mounted: d.controller.mounted, autoMove: s.playerAutoMove ?? s.autoMove ?? null,
      bodyRegion: document.body.dataset.worldRegion };
  });
  return { ...snapshot, transitionVisuals: await page.evaluate(readTransitionVisualState) };
}

async function readMap(page) {
  return page.evaluate(() => {
    const root = document.getElementById('full-map-panel'), box = el => el.getBoundingClientRect().toJSON();
    return { surface: box(document.getElementById('full-map-surface')), card: box(root.querySelector('.full-map-card')),
      controls: box(root.querySelector('.full-map-controls')), viewport: { width: innerWidth, height: innerHeight },
      infoHidden: document.getElementById('full-map-info').hidden,
      objectiveHidden: document.getElementById('full-map-objective').hidden,
      destinationHidden: document.getElementById('full-map-destination').hidden,
      socialCount: document.getElementById('full-map-social').children.length,
      geometry: [...document.querySelectorAll('#full-map-geometry [data-map-id]')].map(el => ({ id: el.dataset.mapId, path: el.getAttribute('d') })),
      labels: [...root.querySelectorAll('.full-map-poi[data-label-visible="true"] .full-map-poi-label')].map(el => {
        const r = box(el), id = el.closest('button').dataset.poiId;
        return { id, text: el.textContent, font: getComputedStyle(el).fontSize, ...r,
          clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
          hitId: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.full-map-poi')?.dataset.poiId ?? null };
      }),
      pois: [...root.querySelectorAll('.full-map-poi')].map(el => ({ id: el.dataset.poiId, state: el.dataset.presentation,
        mapPositionPercent: { left: parseFloat(el.style.left), top: parseFloat(el.style.top) },
        icon: el.querySelector('.full-map-poi-icon path')?.getAttribute('d'), ...box(el) })),
      controlButtons: [...root.querySelectorAll('.full-map-controls button')].map(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        return { text: el.textContent, lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size, ...box(el) };
      }) };
  });
}

async function readNpcNameplates(page) {
  const receipt = await page.evaluate(async hudSelectors => {
    const [{ npcNameplateOffset }, { BIRYONG_VILLAGE_NPC_ROSTER }] = await Promise.all([
      import('/npc-factory/npc-dimensions.mjs'), import('/src/biryong/biryong-village-npc-contract.js')
    ]);
    const d = window.__INHAGAME_P0__, canvas = d.app.graphicsDevice.canvas.getBoundingClientRect();
    const player = d.player.getLocalPosition();
    const candidates = BIRYONG_VILLAGE_NPC_ROSTER.map(definition => {
      const actor = d.biryongVillageNpcs.actorSnapshot(definition.id);
      const avatar = d.app.root.findByName(`NPC_TEST_HUMAN_${definition.id}`);
      const point = avatar.getPosition().clone(); point.y += npcNameplateOffset(definition.appearance.height);
      const screen = d.orbit.camera.camera.worldToScreen(point);
      return { id: definition.id, visible: actor.visible && avatar.enabled,
        distance: Math.hypot(player.x - actor.position.x, player.z - actor.position.z),
        x: screen.x + canvas.left, y: screen.y + canvas.top, depth: screen.z };
    });
    const labels = [...document.querySelectorAll('.biryong-npc-nameplate')].filter(element => {
      const style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
    }).map(element => ({ ...element.getBoundingClientRect().toJSON(),
      name: element.querySelector('strong').textContent, detail: element.querySelector('small').textContent,
      font: getComputedStyle(element.querySelector('strong')).fontSize }));
    const visibleHud = element => {
      if (element.hidden || !element.getClientRects().length) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const exclusions = [...document.querySelectorAll(hudSelectors.join(','))].filter(visibleHud)
      .map(element => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() }));
    const tourElement = document.getElementById('tour');
    const tourHud = { present: Boolean(tourElement), visible: Boolean(tourElement && visibleHud(tourElement)) };
    const cameraPosition = d.orbit.camera.getPosition(), eye = d.player.getPosition().clone();
    eye.y += d.character.eyeHeight; // Same animated eye offset as main.js, in reflected world coordinates.
    const camera = { regionId: d.biryongRealm.status().regionId, indoor: Boolean(d.orbit.indoor),
      mounted: d.controller.mounted, firstPerson: d.orbit.firstPerson, chosenZoom: d.orbit.distance, eyeHeight: d.character.eyeHeight,
      localVisualOccluded: d.orbit.localVisualOccluded, equipmentVisible: d.character.equipmentVisible,
      playerLocal: { x: player.x, y: player.y, z: player.z },
      position: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
      eye: { x: eye.x, y: eye.y, z: eye.z },
      eyeDistance: Math.hypot(cameraPosition.x - eye.x, cameraPosition.y - eye.y, cameraPosition.z - eye.z) };
    return { canvas: canvas.toJSON(), viewport: { width: innerWidth, height: innerHeight },
      nearest: d.biryongVillageNpcs.nearestNpc(22), candidates, labels, exclusions, tourHud, camera };
  }, BIRYONG_QA_HUD_SELECTORS);
  return receipt;
}

async function inspectRoute(page) {
  return page.evaluate(async () => {
    const d = window.__INHAGAME_P0__, nav = d.navigation.getSnapshot();
    const [{ createBiryongNavigation }, { moveAroundPolygons }, { WALK_SHAPE, PLAYER_ORIGIN_Y },
      { BIRYONG_REALM_P0_OBSTACLES }, { BIRYONG_STATION_BUILDING }, { biryongMapRectangle }] = await Promise.all([
      import('/src/biryong/biryong-navigation.js'), import('/src/polygon-collision.js'), import('/src/player-dimensions.js'),
      import('/src/biryong/biryong-village-layout.js'), import('/src/biryong/biryong-realm-layout.js'), import('/src/biryong/biryong-map-data.js')
    ]);
    const provider = createBiryongNavigation(), obstacles = [...BIRYONG_REALM_P0_OBSTACLES,
      { polygon: biryongMapRectangle(BIRYONG_STATION_BUILDING), minY: 0, maxY: BIRYONG_STATION_BUILDING.height }];
    const segments = nav.routePoints.slice(1).map((b, i) => {
      const a = nav.routePoints[i], reached = moveAroundPolygons({ ...a, y: PLAYER_ORIGIN_Y }, b.x - a.x, b.z - a.z, obstacles, WALK_SHAPE);
      return { from: a, to: b, safe: provider.segmentSafe(a, b), capsuleError: Math.hypot(reached.x - b.x, reached.z - b.z) };
    });
    return { snapshot: nav, pointsWalkable: nav.routePoints.every(provider.walkable), segments,
      player: { x: d.player.getLocalPosition().x, z: d.player.getLocalPosition().z } };
  });
}

function checkRoute(receipt, poi, name) {
  const nav = receipt.snapshot;
  assert.equal(nav.destination?.poiId, poi.poiId, `${name}: exact requested target`);
  assert.equal(nav.destination.mapSourceId, 'BIRYONG_REALM');
  assert.equal(nav.currentSpaceId, 'BIRYONG_REALM');
  assert.deepEqual(nav.destination.approach, poi.position);
  assert.ok(['GUIDING', 'ARRIVED'].includes(nav.status), `${name}: safe guidance cannot fail or pause`);
  if (nav.status === 'GUIDING') {
    assert.equal(nav.routeMode, 'NETWORK', `${name}: no direct Campus fallback`);
    assert.ok(receipt.segments.length > 0 && receipt.pointsWalkable, `${name}: implemented walkable route`);
    assert.ok(receipt.segments.every(s => s.safe && s.capsuleError < 1e-6), `${name}: every segment clears the actual player capsule`);
  }
}

async function renderedPixels(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const app = window.__INHAGAME_P0__.app;
    const timer = setTimeout(() => { app.off('postrender', finish); reject(Error('Real rendered frame deadline')); }, 12000);
    function finish() {
      clearTimeout(timer);
      try {
        const gl = app.graphicsDevice.gl;
        if (!gl) throw Error('Actual WebGL2 framebuffer required');
        gl.finish();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, bytes = new Uint8Array(width * height * 4);
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes); }
        finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); }
        const colors = new Set(); let sum = 0, square = 0;
        for (let i = 0; i < bytes.length; i += 16) {
          const l = (bytes[i] + bytes[i + 1] + bytes[i + 2]) / 3;
          sum += l; square += l * l; colors.add((bytes[i] >> 4) * 256 + (bytes[i + 1] >> 4) * 16 + (bytes[i + 2] >> 4));
        }
        const count = Math.ceil(bytes.length / 16);
        resolve({ width, height, colors: colors.size, luminanceStddev: Math.sqrt(Math.max(0, square / count - (sum / count) ** 2)),
          glError: gl.getError(), contextLost: gl.isContextLost() });
      } catch (error) { reject(error); }
    }
    app.once('postrender', finish); app.renderNextFrame = true;
  }));
}

function waitForRenderedFrames() {
  return new Promise((resolve, reject) => {
    const app = window.__INHAGAME_P0__.app;
    let frames = 0;
    const timer = setTimeout(() => { app.off('postrender', onFrame); reject(Error('Post-transition rendered frame deadline')); }, 12000);
    function onFrame() {
      if (++frames < 2) { app.renderNextFrame = true; return; }
      clearTimeout(timer); app.off('postrender', onFrame); resolve({ frames });
    }
    app.on('postrender', onFrame); app.renderNextFrame = true;
  });
}

async function verifyManualInput(page, context, mobile) {
  const before = await state(page);
  assert.equal(before.enabled, true, 'ordinary player input restored');
  const waitMoved = () => page.waitForFunction(start => {
    const p = window.__INHAGAME_P0__.player.getLocalPosition(); return Math.hypot(p.x - start.x, p.z - start.z) > .15;
  }, before.player, { timeout: 8000 });
  if (mobile) {
    const pad = await page.locator('#joystick').boundingBox(); assert.ok(pad, 'visible mobile joystick');
    const cdp = await context.newCDPSession(page), x = pad.x + pad.width / 2, y = pad.y + pad.height / 2;
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 25, id: 1 }] });
      await waitMoved();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual((await state(page)).touch, { x: 0, y: 0 }, 'touch end releases joystick owner');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y - 20, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      assert.deepEqual((await state(page)).touch, { x: 0, y: 0 }, 'touch cancellation releases joystick owner');
    } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {}); await cdp.detach(); }
  } else {
    await page.locator('#application').focus();
    await page.keyboard.down('w');
    try { await waitMoved(); } finally { await page.keyboard.up('w'); }
  }
  const after = await state(page);
  assert.equal(after.enabled, true);
  return { input: mobile ? 'Chromium trusted touch joystick including touchCancel' : 'Playwright trusted KeyW', before: before.player, after: after.player, released: after.touch };
}

try {
  assert.equal(head, report.expectedHead, 'exact PR head checkout is required');
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]);
  report.sourceStatus = dirty || 'clean'; assert.equal(dirty, '', 'exact-head evidence requires clean source inputs');
  for (const file of git(['ls-files', '--', ...sourcePaths]).split('\n').filter(Boolean).sort()) {
    report.sources.push({ path: file, sha256: sha(await readFile(path.join(repo, file))) });
  }
  await writeFile(path.join(output, 'head.txt'), head + '\n'); await flush();
  for (const { name, viewport, mobile } of BIRYONG_QA_VIEWPORTS) {
    const entry = { name, viewport, mobile, deviceScaleFactor: 1, result: 'RUNNING', screenshots: [], npcs: [],
      requests: { api: [], offOrigin: [], unexpectedExternalResponses: [] } };
    report.cases.push(entry); await flush();
    let smoke, page;
    const capture = async (label, { settled = true } = {}) => {
      // Region cooldown completion does not prove its independently scheduled
      // DOM fade completed. Never hide/bypass the overlay to manufacture a frame.
      if (settled) {
        try {
          await page.waitForFunction(readTransitionVisualState, true, { timeout: 15000 });
          await page.evaluate(waitForRenderedFrames);
        } catch (error) {
          entry.captureBlocker = { label, transitionVisuals: await page.evaluate(readTransitionVisualState).catch(() => null), error: String(error) };
          throw error;
        }
      }
      const transitionVisuals = await page.evaluate(readTransitionVisualState);
      const file = `${name}-${label}.png`, bytes = await page.screenshot({ path: path.join(output, file), animations: 'disabled', fullPage: false, timeout: 20000 });
      entry.screenshots.push({ file, sha256: sha(bytes), bytes: bytes.length, viewport, transitionVisuals, settled,
        visualReview: 'PENDING_INDEPENDENT_PIXEL_REVIEW' });
      await flush();
    };
    try {
      smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
      // Valid local offline clock response, not an account or fake NPC system.
      const clockPayload = worldTimePayload(NPC_WORLD_EPOCH_MS + NPC_WORLD_PERIOD_MS + 1000);
      await smoke.context.route(`${smoke.origin}/api/world-time`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(clockPayload) }));
      entry.clockFixture = { path: '/api/world-time', ...clockPayload };
      page = await smoke.context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(TIMEOUT_MS);
      const fatal = smoke.watch(page);
      const evaluate = (fn, arg) => Promise.race([page.evaluate(fn, arg), fatal]);
      const action = locator => mobile ? locator.tap() : locator.click();
      const wait = (fn, arg = null, timeout = TIMEOUT_MS) => Promise.race([page.waitForFunction(fn, arg, { timeout }), fatal]);
      page.on('request', request => {
        const u = new URL(request.url());
        if (u.origin !== smoke.origin) entry.requests.offOrigin.push(`${u.origin}${u.pathname}`);
        else if (u.pathname.startsWith('/api/')) entry.requests.api.push(u.pathname);
      });
      page.on('response', response => {
        const u = new URL(response.url());
        if (u.origin !== smoke.origin && !(u.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(?:playcanvas@|@supabase\/supabase-js@)/.test(u.pathname)))
          entry.requests.unexpectedExternalResponses.push(`${u.origin}${u.pathname}`);
      });
      await page.goto(`${smoke.origin}/campus/?lobby=1&envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded' });
      await wait(() => { const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished; });
      const boot = await evaluate(() => window.__INHAGAME_P0__.getStatus());
      assert.equal(boot.renderer, 'WebGL2'); assert.equal(boot.loading.phase, 'READY');
      entry.boot = { renderer: boot.renderer, loading: boot.loading, npcMode: boot.npcMode ?? null };
      await action(page.locator('#main-gate-start'));
      await wait(() => { const s = window.__INHAGAME_P0__.getStatus(); return !s.lobby.active && !s.lobbyTransition.active; });
      await evaluate(() => document.fonts.ready);
      entry.campusBefore = await state(page);
      assert.equal(entry.campusBefore.minimap.mapSourceId, 'campus');
      await action(page.locator('#minimap-open-map')); await page.locator('#full-map-panel').waitFor({ state: 'visible' });
      entry.campusMap = await readMap(page); assertMapLayout(entry.campusMap, `${name} Campus`);
      assert.equal(entry.campusMap.pois.length, 12, 'Campus POIs include existing Woonam and gazebo landmarks');
      await page.locator('.full-map-poi[data-poi-id="poi.main-hall"]').press('Enter');
      await action(page.locator('#full-map-set-destination'));
      assert.equal((await state(page)).navigation.destination.mapSourceId, 'campus');
      await capture('campus-before');

      assert.equal(await evaluate(() => window.__INHAGAME_P0__.biryongRealm.enter()), true);
      await wait(() => { const d = window.__INHAGAME_P0__; return d.biryongRealm.inBiryong && d.biryongRealm.status().ready; });
      entry.realmArrival = await state(page);
      assert.equal(entry.realmArrival.region.regionId, 'BIRYONG_REALM');
      assert.equal(entry.realmArrival.movementSpace, 'BIRYONG_REALM');
      assert.equal(entry.realmArrival.parent, 'BiryongRealmCoordinateFrame');
      assert.equal(entry.realmArrival.minimap.mapSourceId, 'BIRYONG_REALM');
      assert.equal(entry.realmArrival.minimap.indoorMapActive, false);
      assert.equal(entry.realmArrival.fullMap.mapSourceId, 'BIRYONG_REALM');
      assert.equal(entry.realmArrival.fullMap.open, false); assert.equal(entry.realmArrival.enabled, true);
      assert.equal(entry.realmArrival.navigation.status, 'PAUSED');
      assert.equal(entry.realmArrival.navigation.pauseReason, 'SPACE_MISMATCH');
      assert.equal(entry.realmArrival.minimap.objectiveActive, false);
      assert.equal(entry.realmArrival.minimap.visibleSocialCount, 0);
      assert.equal(entry.realmArrival.minimap.navigationActive, false);
      entry.realmOwnership = await evaluate(campusParent => {
        const d = window.__INHAGAME_P0__, root = d.app.root.findByName('BiryongRealmCoordinateFrame');
        return { enabled: root.enabled, reflectedZ: root.getLocalScale().z,
          campusEnabled: d.app.root.findByName(campusParent).enabled,
          renderMeshes: root.findComponents('render').reduce((sum, component) => sum + component.meshInstances.length, 0) };
      }, entry.campusBefore.parent);
      assert.equal(entry.realmOwnership.enabled, true); assert.equal(entry.realmOwnership.campusEnabled, false);
      assert.equal(entry.realmOwnership.reflectedZ, -1); assert.ok(entry.realmOwnership.renderMeshes > 20);
      entry.pixels = await renderedPixels(page);
      assert.equal(entry.pixels.glError, 0); assert.equal(entry.pixels.contextLost, false);
      assert.ok(entry.pixels.colors > 12 && entry.pixels.luminanceStddev > 1, 'nonblank actual rendered realm pixels');
      await page.evaluate(waitForRenderedFrames);
      entry.arrivalNameplates = await readNpcNameplates(page);
      assert.equal(entry.arrivalNameplates.tourHud.visible, true, `${name}: real first-tour HUD coverage required`);
      assertNpcNameplateLayout(entry.arrivalNameplates, `${name} realm arrival`);
      await capture('realm-arrival');
      entry.manualInput = await verifyManualInput(page, smoke.context, mobile);
      await action(page.locator('#minimap-open-map')); await page.locator('#full-map-panel').waitFor({ state: 'visible' });
      entry.overview = await readMap(page); assertMapLayout(entry.overview, `${name} Biryong overview`);
      assertBiryongReturnLabelVisible(entry.overview, `${name} Biryong overview`);
      assert.equal(entry.overview.infoHidden, true); assert.equal(entry.overview.objectiveHidden, true);
      assert.equal(entry.overview.destinationHidden, true); assert.equal(entry.overview.socialCount, 0);
      const source = createBiryongMapDataSource();
      assert.deepEqual(entry.overview.pois.map(p => p.id).sort(), BIRYONG_MAP_DESTINATIONS.map(p => p.poiId).sort());
      assert.deepEqual(entry.overview.geometry.map(g => g.id).sort(), source.geometry().map(g => g.id).sort());
      assert.ok(entry.overview.geometry.every(g => g.path && !/NaN|Infinity/.test(g.path)));
      assert.deepEqual([...new Set(BIRYONG_MAP_DESTINATIONS.map(p => p.placeZoneId))].sort(), BIRYONG_REALM_PLACE_ZONES.map(z => z.id).sort());
      for (const poi of BIRYONG_MAP_DESTINATIONS) {
        const node = entry.overview.pois.find(p => p.id === poi.poiId), b = source.bounds;
        assertMapPointProjection(node, poi.position, b);
      }
      await capture('realm-map-overview');
      // Pointer/touch activation on a visible Korean label is independent of the
      // full seven-location keyboard coverage, so marker overlap is not bypassed.
      const label = entry.overview.labels[0];
      await action(page.locator(`.full-map-poi[data-poi-id="${label.id}"] .full-map-poi-label`));
      assert.equal(await evaluate(() => window.__INHAGAME_P0__.fullMap.selectedPoi.poiId), label.id);
      entry.labelActivation = { id: label.id, input: mobile ? 'touch' : 'mouse' };
      entry.poiRoutes = [];
      for (const poi of BIRYONG_MAP_DESTINATIONS) {
        await page.locator(`.full-map-poi[data-poi-id="${poi.poiId}"]`).press('Enter');
        assert.equal(await page.locator('#full-map-set-destination').isEnabled(), true);
        assert.equal(await page.locator('#full-map-auto-move').isEnabled(), false, 'Biryong automatic movement remains disabled');
        const before = await state(page);
        await action(page.locator('#full-map-set-destination'));
        const route = await inspectRoute(page); checkRoute(route, poi, `${name} ${poi.poiId}`);
        assert.deepEqual(route.player, { x: before.player.x, z: before.player.z }, 'guidance never moves the player');
        entry.poiRoutes.push(route);
        if (poi.poiId.endsWith('.market')) {
          entry.selected = await readMap(page); assertMapLayout(entry.selected, `${name} selected guidance`);
          assert.equal((await state(page)).fullMap.routeVisible, true);
          await capture('realm-map-guidance');
        }
      }
      await action(page.locator('#full-map-nav-clear')); assert.equal((await state(page)).navigation.status, 'IDLE');
      await action(page.locator('#full-map-zoom-in')); await action(page.locator('#full-map-zoom-in'));
      const zoomed = await evaluate(() => window.__INHAGAME_P0__.fullMap.viewport); assert.ok(zoomed.zoom > 1.55);
      const surface = await page.locator('#full-map-surface').boundingBox();
      if (mobile) {
        const cdp = await smoke.context.newCDPSession(page);
        try {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: surface.x + 12, y: surface.y + 12, id: 3 }] });
          for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: surface.x + 12 + 43 * step / 5, y: surface.y + 12 + 28 * step / 5, id: 3 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally { await cdp.detach(); }
      } else {
        await page.mouse.move(surface.x + 12, surface.y + 12); await page.mouse.down();
        await page.mouse.move(surface.x + 55, surface.y + 40, { steps: 5 }); await page.mouse.up();
      }
      const panned = await evaluate(() => window.__INHAGAME_P0__.fullMap.viewport);
      assert.ok(panned.panX !== zoomed.panX || panned.panY !== zoomed.panY, 'real map drag pans the viewport');
      await action(page.locator('#full-map-reset-view'));
      const reset = await evaluate(() => window.__INHAGAME_P0__.fullMap.viewport);
      assert.deepEqual(reset, { zoom: 1, panX: 0, panY: 0 }); entry.viewControls = { zoomed, panned, reset };
      await page.keyboard.press('Escape'); await page.locator('#full-map-panel').waitFor({ state: 'hidden' });
      assert.equal((await state(page)).enabled, true);
      await action(page.locator('#minimap-open-map')); await action(page.locator('#full-map-close'));
      assert.equal((await state(page)).enabled, true, 'repeat open/close restores input');

      // Public dialogue supports moving actors and pauses them through its normal
      // open action. Wall time is not simulation time on slow software rendering;
      // never wait for an unrelated schedule journey or advance its clock here.
      for (const npc of BIRYONG_QA_NPCS) {
        const approachNpc = async (timeoutMs = 90000) => {
          const deadline = Date.now() + timeoutMs;
          await wait(readNpcConversationReadiness, npc.id, timeoutMs);
          return evaluate(async ({ npc, timeoutMs }) => {
          const d = window.__INHAGAME_P0__;
          const [{ createBiryongNavigation }, { PLAYER_ORIGIN_Y }, { biryongDialogueTopics }, { BIRYONG_MAP_DESTINATIONS },
            { findBiryongNpcApproach }] = await Promise.all([
            import('/src/biryong/biryong-navigation.js'), import('/src/player-dimensions.js'), import('/src/biryong/biryong-village-dialogue-contract.js'),
            import('/src/biryong/biryong-map-data.js'), import('/tests/browser/biryong-map-guidance-proximity.mjs')]);
          const target = BIRYONG_MAP_DESTINATIONS.find(poi => poi.poiId === npc.target).position;
          const provider = createBiryongNavigation(), started = performance.now();
          let attempts = 0, lastStatus = null;
          // A visible actor may temporarily walk through a station footprint
          // excluded by player guidance. Observe until a real legal approach is
          // available; do not move anything for an unsuccessful candidate.
          while (performance.now() - started < timeoutMs) {
            attempts++; lastStatus = d.biryongVillageNpcs.status();
            const placed = findBiryongNpcApproach({ npcId: npc.id, actors: lastStatus.npcs, target,
              walkable: provider.walkable, segmentSafe: provider.segmentSafe });
            if (!placed) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
            d.player.setLocalPosition(placed.player.x, PLAYER_ORIGIN_Y, placed.player.z);
            d.controller.grounded = true; d.controller.velocityY = 0;
            const nearest = d.biryongVillageNpcs.nearestNpc(2.2);
            if (nearest?.id !== npc.id) throw Error(`Live nearest NPC did not match the pure legal candidate: ${npc.id}`);
            d.app.fire('update', 0);
            return { ...placed, nearest, attempts, waitMs: performance.now() - started,
              context: d.getStatus().contextAction, contextLabel: document.getElementById('context-action').getAttribute('aria-label'),
              clock: lastStatus.clock, period: lastStatus.period,
              topic: biryongDialogueTopics(npc.id, 1).find(topic => topic.id === npc.topicId) };
          }
          throw Error(JSON.stringify({ reason: 'NPC_APPROACH_UNAVAILABLE', npcId: npc.id, attempts,
            waitedMs: performance.now() - started, lastStatus }));
          }, { npc, timeoutMs: Math.max(1, deadline - Date.now()) });
        };
        const proof = await approachNpc();
        const npcReceipt = { ...npc, proof, result: 'RUNNING' };
        entry.npcs.push(npcReceipt); await flush();
        assert.equal(proof.actor.name, npc.name); assert.equal(proof.nearest.id, npc.id);
        assert.ok(proof.nearest.distance <= 2.2); assert.equal(proof.context, 'biryong-npc-talk'); assert.ok(proof.topic);
        assert.ok(proof.contextLabel.includes(npc.name), 'normal context action identifies the intended live NPC');
        await page.evaluate(waitForRenderedFrames);
        npcReceipt.nameplatesBeforeDialogue = await readNpcNameplates(page);
        assertNpcNameplateLayout(npcReceipt.nameplatesBeforeDialogue, `${name} ${npc.name} before dialogue`);
        const contextButton = page.locator('#context-action').and(page.getByRole('button', { name: new RegExp(npc.name) }));
        if (mobile) await action(contextButton);
        else { await page.locator('#application').focus(); await page.keyboard.press('f'); }
        const panel = page.locator('#biryong-village-dialogue'); await panel.waitFor({ state: 'visible' });
        let open = await state(page);
        assert.equal(open.dialogue.npcId, npc.id); assert.equal(open.dialogue.relationshipStage, 1);
        assert.equal(open.dialogue.unlockedFactCount, 0); assert.equal(open.enabled, false); assert.equal(open.focus.owners.npcDialogue, true);
        const actorAtInitialOpen = open.npcs.npcs.find(actor => actor.id === npc.id);
        npcReceipt.actorAtInitialOpen = actorAtInitialOpen;
        assert.equal(actorAtInitialOpen.moving, false, 'normal conversation pauses the real moving actor');

        // Verify dismissal immediately, before final guidance resumes its actual
        // schedule. A later screenshot must not impose a second walking journey.
        await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
        const escapeState = await state(page);
        assert.equal(escapeState.enabled, true); assert.equal(escapeState.focus.owners.npcDialogue, false);
        assert.equal(escapeState.dialogue.open, false);
        const reopenContext = await evaluate(async id => {
          const { createBiryongNavigation } = await import('/src/biryong/biryong-navigation.js');
          const d = window.__INHAGAME_P0__, provider = createBiryongNavigation();
          const p = d.player.getLocalPosition(), actor = d.biryongVillageNpcs.actorSnapshot(id), status = d.biryongVillageNpcs.status();
          return { player: { x: p.x, z: p.z }, actor, nearest: d.biryongVillageNpcs.nearestNpc(2.2),
            context: d.getStatus().contextAction, contextLabel: document.getElementById('context-action').getAttribute('aria-label'),
            playerWalkable: provider.walkable(p), actorWalkable: provider.walkable(actor.position),
            segmentSafe: provider.segmentSafe(p, actor.position), clock: status.clock, period: status.period };
        }, npc.id);
        assert.deepEqual(reopenContext.player, proof.player, 'Escape alone cannot reposition the player');
        // Existing public dialogue has a live proximity contract. Reuse the
        // unchanged legal player location when that exact NPC is still offered;
        // geometry observations remain in the receipt, including station crossing.
        const reuseProximity = reopenContext.playerWalkable && reopenContext.nearest?.id === npc.id &&
          reopenContext.context === 'biryong-npc-talk' && reopenContext.contextLabel?.includes(npc.name);
        const finalApproachProof = reuseProximity ? reopenContext : await approachNpc();
        assert.equal(finalApproachProof.nearest.id, npc.id);
        assert.equal(finalApproachProof.context, 'biryong-npc-talk'); assert.ok(finalApproachProof.contextLabel.includes(npc.name));
        npcReceipt.escapeState = escapeState; npcReceipt.reopenContext = reopenContext;
        npcReceipt.reusedProximity = reuseProximity; npcReceipt.finalApproachProof = finalApproachProof;
        if (mobile) await action(contextButton);
        else { await page.locator('#application').focus(); await page.keyboard.press('f'); }
        await panel.waitFor({ state: 'visible' }); open = await state(page);
        assert.equal(open.dialogue.npcId, npc.id); assert.equal(open.dialogue.relationshipStage, 1);
        assert.equal(open.dialogue.unlockedFactCount, 0); assert.equal(open.enabled, false); assert.equal(open.focus.owners.npcDialogue, true);
        const actorAtOpen = open.npcs.npcs.find(actor => actor.id === npc.id);
        npcReceipt.actorAtOpen = actorAtOpen;
        assert.equal(actorAtOpen.moving, false, 'reopened normal dialogue pauses the same actual actor');
        await action(panel.getByRole('button', { name: proof.topic.label, exact: true }));
        const poi = BIRYONG_MAP_DESTINATIONS.find(p => p.poiId === npc.target);
        const placeButton = panel.getByRole('button', { name: `📍 ${poi.title} 길안내`, exact: true });
        await placeButton.scrollIntoViewIfNeeded();
        const dialogBounds = await panel.boundingBox(), buttonBounds = await placeButton.boundingBox();
        assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= viewport.width + 1 && dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= viewport.height + 1, 'NPC panel fits viewport');
        assert.ok(buttonBounds.y >= dialogBounds.y && buttonBounds.y + buttonBounds.height <= dialogBounds.y + dialogBounds.height + 1, 'actual destination button is visible after scrolling');
        await capture(`npc-${npc.id}-place-button`);
        const actorWhileOpen = await evaluate(id => window.__INHAGAME_P0__.biryongVillageNpcs.actorSnapshot(id), npc.id);
        npcReceipt.actorWhileOpen = actorWhileOpen;
        assert.deepEqual(actorWhileOpen.position, actorAtOpen.position, 'the actual actor remains paused while its public topic is open');
        await action(placeButton); await panel.waitFor({ state: 'hidden' });
        const route = await inspectRoute(page); checkRoute(route, poi, `${name} ${npc.name}`);
        assert.deepEqual(route.player, finalApproachProof.player, 'NPC place guidance never teleports the player');
        const closed = await state(page);
        assert.equal(closed.enabled, true); assert.equal(closed.focus.owners.npcDialogue, false); assert.equal(closed.dialogue.open, false);
        await page.locator('#nav-guidance').waitFor({ state: 'visible' });
        await page.evaluate(waitForRenderedFrames);
        const interactionLayout = await evaluate(() => {
          const visibleBox = id => {
            const el = document.getElementById(id), style = getComputedStyle(el), rect = el.getBoundingClientRect();
            return el.hidden || style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0
              ? null : rect.toJSON();
          };
          return { context: visibleBox('context-action'), hint: visibleBox('pointer-lock-hint') };
        });
        assertInteractionHintLayout(interactionLayout, `${name} ${npc.name}`);
        npcReceipt.interactionLayout = interactionLayout;
        npcReceipt.nameplatesAfterGuidance = await readNpcNameplates(page);
        assertNpcNameplateLayout(npcReceipt.nameplatesAfterGuidance, `${name} ${npc.name} after guidance`);
        await capture(`npc-${npc.id}-guidance`);
        await action(page.locator('#nav-guidance-cancel')); assert.equal((await state(page)).navigation.status, 'IDLE');
        assert.equal((await state(page)).enabled, true);
        Object.assign(npcReceipt, { actorAfterClose: closed.npcs.npcs.find(actor => actor.id === npc.id),
          clockAfterClose: closed.npcs.clock, dialogBounds, buttonBounds, route, inputRestored: true, escapeClose: true, result: 'PASS' });
      }

      // Deterministic station-close-wall camera regression, independent of NPC timing.
      const priorStationProbePose = await evaluate(() => {
        const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
        if (d.controller.mounted || d.orbit.firstPerson || d.orbit.indoor) throw Error('Station camera probe requires outdoor walking third person');
        const saved = { player: { x: p.x, y: p.y, z: p.z }, yaw: d.orbit.yaw, pitch: d.orbit.pitch,
          distance: d.orbit.distance, thirdPersonPitch: d.orbit.thirdPersonPitch, walkDistance: d.orbit.distances.walk,
          grounded: d.controller.grounded, velocityY: d.controller.velocityY };
        d.player.setLocalPosition(-1.2164960827128801, d.controller.groundY, 29.446387731183304);
        d.controller.grounded = true; d.controller.velocityY = 0;
        d.orbit.yaw = 0; d.orbit.pitch = Math.atan2(7.3, 18.5); d.orbit.thirdPersonPitch = d.orbit.pitch;
        d.orbit.distance = 3.5; d.orbit.distances.walk = 3.5;
        return saved;
      });
      try {
        await page.evaluate(waitForRenderedFrames);
        entry.stationCloseWall = await readNpcNameplates(page);
        assertNpcNameplateLayout(entry.stationCloseWall, `${name} station close wall`);
        assert.ok(entry.stationCloseWall.camera.eyeDistance < .6, 'exact station wall case must reproduce real camera compression');
        assert.equal(entry.stationCloseWall.camera.firstPerson, false);
        assert.equal(entry.stationCloseWall.camera.chosenZoom, 3.5);
        assert.equal(entry.stationCloseWall.camera.localVisualOccluded, true);
        assert.equal(entry.stationCloseWall.camera.equipmentVisible, false);
        await capture('station-close-wall');
      } finally {
        await evaluate(saved => {
          const d = window.__INHAGAME_P0__;
          d.player.setLocalPosition(saved.player.x, saved.player.y, saved.player.z);
          d.controller.grounded = saved.grounded; d.controller.velocityY = saved.velocityY;
          d.orbit.yaw = saved.yaw; d.orbit.pitch = saved.pitch; d.orbit.distance = saved.distance;
          d.orbit.thirdPersonPitch = saved.thirdPersonPitch; d.orbit.distances.walk = saved.walkDistance;
        }, priorStationProbePose);
        await page.evaluate(waitForRenderedFrames);
      }

      // Retain a realm route across the existing F1 return to detect stale local
      // coordinates or target markers leaking into the Campus map.
      await action(page.locator('#minimap-open-map'));
      await page.locator('.full-map-poi[data-poi-id="poi.biryong-realm.council"]').press('Enter');
      await action(page.locator('#full-map-set-destination')); await action(page.locator('#full-map-close'));
      entry.returnPlacement = await evaluate(async () => {
        const d = window.__INHAGAME_P0__, { BIRYONG_STATION_RETURN_STOP } = await import('/src/biryong/biryong-realm-layout.js');
        const { PLAYER_ORIGIN_Y } = await import('/src/player-dimensions.js');
        d.player.setLocalPosition(BIRYONG_STATION_RETURN_STOP.x, PLAYER_ORIGIN_Y, BIRYONG_STATION_RETURN_STOP.z);
        d.controller.grounded = true; d.controller.velocityY = 0; d.app.fire('update', 0);
        return { stop: BIRYONG_STATION_RETURN_STOP, context: d.getStatus().contextAction };
      });
      await wait(() => window.__INHAGAME_P0__.getStatus().contextAction === 'biryong-station-transit');
      await capture('f1-return-stop');
      if (mobile) await action(page.locator('#context-action'));
      else { await page.locator('#application').focus(); await page.keyboard.press('f'); }
      await wait(() => window.__INHAGAME_P0__.biryongRealm.inCampus && window.__INHAGAME_P0__.biryongRealm.status().ready);
      entry.campusReturn = await state(page);
      assert.equal(entry.campusReturn.region.stats.enters, 1); assert.equal(entry.campusReturn.region.stats.exits, 1);
      assert.equal(entry.campusReturn.parent, entry.campusBefore.parent); assert.equal(entry.campusReturn.movementSpace, entry.campusBefore.movementSpace);
      assert.equal(entry.campusReturn.minimap.mapSourceId, 'campus'); assert.equal(entry.campusReturn.fullMap.mapSourceId, 'campus');
      assert.equal(entry.campusReturn.navigation.status, 'PAUSED'); assert.equal(entry.campusReturn.navigation.pauseReason, 'SPACE_MISMATCH');
      assert.equal(entry.campusReturn.minimap.navigationActive, false); assert.equal(entry.campusReturn.enabled, true);
      await action(page.locator('#minimap-open-map'));
      entry.returnMap = await readMap(page); assertMapLayout(entry.returnMap, `${name} Campus return`);
      assert.deepEqual(entry.returnMap.pois.map(p => p.id).sort(), entry.campusMap.pois.map(p => p.id).sort());
      assert.deepEqual(entry.returnMap.geometry.map(g => g.id).sort(), entry.campusMap.geometry.map(g => g.id).sort());
      assert.equal(entry.returnMap.destinationHidden, true); assert.equal(entry.returnMap.infoHidden, true);
      assert.equal((await state(page)).fullMap.routeVisible, false);
      await capture('campus-return');
      await action(page.locator('#full-map-nav-clear')); await action(page.locator('#full-map-close'));
      assert.equal((await state(page)).enabled, true);
      assert.deepEqual(entry.requests.unexpectedExternalResponses, []);
      assert.deepEqual(smoke.problems, [], `${name}: no page, console, renderer or request failures`);
      entry.final = await state(page); assert.deepEqual(entry.final.navigationErrors, []); assert.deepEqual(entry.final.minimap.errors, []);
      assertInteractionHintCoverage(entry.npcs.map(npc => npc.interactionLayout), mobile);
      entry.nameplateCoverage = assertNpcNameplateCoverage(entry.npcs.flatMap(npc =>
        [npc.nameplatesBeforeDialogue, npc.nameplatesAfterGuidance]), name);
      entry.result = 'AUTOMATED_PASS_VISUAL_REVIEW_PENDING';
    } catch (error) {
      entry.result = 'FAIL'; entry.error = String(error.stack || error); entry.problems = smoke?.problems ?? [];
      if (page) { entry.failureState = await state(page).catch(() => null); await capture('failure', { settled: false }).catch(() => {}); }
    } finally {
      if (smoke) await smoke.close().catch(error => { entry.result = 'FAIL'; entry.cleanupError = String(error); });
      entry.requests.api = [...new Set(entry.requests.api)].sort(); entry.requests.offOrigin = [...new Set(entry.requests.offOrigin)].sort();
      await flush();
    }
  }
  assert.ok(report.cases.every(entry => entry.result === 'AUTOMATED_PASS_VISUAL_REVIEW_PENDING'), 'Biryong hosted acceptance failed; inspect report.json and failure screenshots');
  report.result = 'AUTOMATED_PASS_VISUAL_REVIEW_PENDING';
} catch (error) {
  report.result = 'FAIL'; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  clearTimeout(watchdog); report.finishedAt = new Date().toISOString(); await flush();
  const files = (await readdir(output)).filter(file => file !== 'SHA256SUMS').sort();
  const sums = await Promise.all(files.map(async file => `${sha(await readFile(path.join(output, file)))}  ${file}`));
  await writeFile(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(JSON.stringify({ result: report.result, head, visualReview: report.visualReview, report: reportPath }));
}
