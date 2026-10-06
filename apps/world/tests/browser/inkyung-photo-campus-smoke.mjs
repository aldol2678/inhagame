// Exact-head, offline acceptance of the actual /campus/ scene and production photo UI.
// Run on the GitHub Chrome runner, not a synthetic scene or a photo/camera render mock:
// PHOTO_MODE_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 \
// WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/inkyung-photo-campus-smoke.mjs
// The shared harness stubs APIs/Supabase and blocks off-origin traffic. No accounts or live writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { worldTimePayload, NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS } from '../../npc-factory/npc-world-time-contract.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.env.PHOTO_MODE_QA_OUTPUT || 'test-results/inkyung-photo-campus';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo });
const sources = ['campus/index.html', 'src/main.js', 'styles.css',
  'src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js', 'src/photo/inkyung-photo-point.js',
  'src/orbit-camera-controller.js', 'src/context-action.js', 'src/player-controller.js',
  'npc-factory/dev-runtime.mjs', 'src/world-scale.js', 'src/character-model.js',
  'npc-factory/npc-world-time-contract.mjs', 'npc-factory/npc-world-clock.mjs',
  'npc-factory/npc-shared-schedule.mjs', 'npc-factory/npc-shared-meetings.mjs',
  'src/ambient-ducks.js', 'src/ambient-ducks-state.js',
  'assets/induck-v3.glb', 'tests/browser/inkyung-photo-campus-smoke.mjs'];
const report = {
  status: 'RUNNING', expectedHead: process.env.PHOTO_MODE_HEAD_SHA ?? null,
  scope: 'Actual production campus, lake, avatar, UI and WebGL2. Offline APIs; no account/backend/live social acceptance.',
  poseFixture: 'Collision-checked player placement near the exported lake anchor preserves gameplay arrival yaw. Native F/touch opens the production lake-facing preset; exit must restore that arrival yaw exactly.',
  visualReview: 'Required: projected lake samples are composition diagnostics, not an occlusion or aesthetic oracle. Inspect the unchanged default screenshots.',
  clockFixture: 'Each case serves the real worldTimePayload contract at class_time+60s, advancing with real elapsed monotonic time. All real NPC schedules, movement, collisions and actors remain active.',
  regressionBaseline: { head: '77d5813956edc4a860356e7328837370d8b4b365', run: '37428945564', status: 'FAIL',
    findings: ['Desktop stopped on DOM/runtime Pointer Lock acknowledgment race.',
      'Portrait controls passed but unchanged arrival-yaw default did not show the lake; visual acceptance failed.'],
    note: 'Historical evidence only. This report must establish its own exact-head result.' },
  sourceHashes: {}, cases: [], checks: [], screenshots: [], warnings: [],
  limits: ['Mobile viewport/touch emulation is not physical-device acceptance.',
    'NPC availability is tested in the documented class_time+60..470s window, not across every crowd/meeting schedule.',
    'Room takeover uses the real local Club Room transition API as a lifecycle fixture, not a lake doorway.',
    'Browser blur is dispatched to the production listener; OS focus loss and authenticated identity changes are not simulated.']
};
await mkdir(output, { recursive: true });
const save = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
const watchdog = setTimeout(() => {
  report.status = 'FAIL'; report.error = 'Actual-campus acceptance exceeded 480000 ms';
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2)); process.exit(1);
}, 480_000);

async function screenshot(page, name, kind) {
  const path = `${output}/${name}.png`;
  await page.screenshot({ path, timeout: 20_000, animations: 'disabled' });
  const bytes = await readFile(path);
  const evidence = { file: `${name}.png`, kind, sha256: sha256(bytes), bytes: bytes.length,
    viewport: page.viewportSize() };
  report.screenshots.push(evidence); return evidence;
}
const snapshot = page => page.evaluate(() => {
  const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
  return { active: d.photoMode.active, position: [p.x, p.y, p.z], input: d.controller.inputEnabled,
    orbitInput: d.orbit.inputEnabled, camera: { yaw: d.orbit.yaw, pitch: d.orbit.pitch,
      distance: d.orbit.distance, firstPerson: d.orbit.firstPerson, nearClip: d.orbit.camera.camera.nearClip },
    focus: s.inputFocus, pointerLock: s.pointerLock, hud: document.body.dataset.photoMode ?? null,
    hudVisibility: getComputedStyle(document.getElementById('hud')).visibility,
    emote: s.emote?.id ?? null, space: s.space, action: s.contextAction,
    frame: d.app.frame, grounded: d.controller.grounded, mounted: d.controller.mounted };
});
const characterStatus = page => page.evaluate(() => {
  const d = window.__INHAGAME_P0__;
  return { modelState: d.character.modelState, carrierModelState: d.character.dragonModelState,
    loading: d.getStatus().loading, equipmentVisible: d.character.equipmentVisible,
    eyeHeight: d.character.eyeHeight, assetCanary: d.character.assetCanary,
    visuals: d.player.children.filter(e => ['Public_QA_Avatar', 'Induck_GLB_Visual', 'Public_QA_Carrier', 'Annyongi_GLB_Visual'].includes(e.name))
      .map(e => ({ name: e.name, enabled: e.enabled, meshNodeNames: e.find(n => !!n.render).map(n => n.name) })),
    assets: d.app.assets.list().filter(a => ['/assets/induck-v3.glb', '/assets/annyongi-flight-v1.glb'].includes(a.file?.url))
      .map(a => ({ url: a.file.url, loaded: a.loaded, loading: a.loading, resourcePresent: !!a.resource })),
    interpretation: 'modelState=glb only means the committed GLB loaded. Inspect report.characterAssetIdentity: a public QA cuboid asset is not full mascot visual approval.' };
});
const interactionDiagnostics = page => page.evaluate(async () => {
  const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
  const { INKYUNG_PHOTO_POINT: anchor } = await import('/src/photo/inkyung-photo-point.js');
  const ducks = await import('/src/ambient-ducks-state.js');
  const summarize = a => a ? { id: a.id, label: a.label, priority: a.priority, distance: a.distance } : null;
  return { position: { x: p.x, y: p.y, z: p.z }, clock: s.npcTest?.shared_schedule, period: s.npcTest?.period,
    primaryAction: summarize(d.contextActions.active), photoCandidate: summarize(d.photoMode.contextAction()),
    state: { grounded: d.controller.grounded, mounted: d.controller.mounted, seated: d.seats.isSeated,
      following: d.follow.active, photoActive: d.photoMode.active, room: d.rooms.status(), focus: s.inputFocus },
    mechanicalDuck: { present: !!d.app.root.findByName(ducks.MECHANICAL_DUCK_ID)?.enabled,
      shoreEligible: ducks.canObserveInkyungDucksFromShore(p), shoreDistance: ducks.distanceToInkyungPondShore(p),
      priority: ducks.MECHANICAL_DUCK_CONTEXT_PRIORITY },
    nearbyNpcs: d.app.root.find(e => e.name?.startsWith('NPC_TEST_HUMAN_') && e.enabled).map(e => {
      const n = e.getLocalPosition(); return { id: e.name, position: { x: n.x, y: n.y, z: n.z },
        distanceToPlayer: Math.hypot(p.x - n.x, p.z - n.z), distanceToAnchor: Math.hypot(anchor.position.x - n.x, anchor.position.z - n.z) };
    }).filter(n => n.distanceToPlayer < 10 || n.distanceToAnchor < 10),
    approachSearch: window.__PHOTO_CAMPUS_APPROACH_DIAGNOSTICS__ ?? null };
});
async function frames(page, count = 3) {
  const at = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
  await page.waitForFunction(({ at, count }) => window.__INHAGAME_P0__.app.frame >= at + count,
    { at, count }, { timeout: 30_000, polling: 'raf' });
}
async function waitPhoto(page, active) {
  await page.waitForFunction(active => window.__INHAGAME_P0__.photoMode.active === active,
    active, { timeout: 10_000 });
  if (active) await page.waitForFunction(() => document.pointerLockElement === null &&
    window.__INHAGAME_P0__.getStatus().pointerLock.locked === false,
  null, { timeout: 10_000, polling: 50 });
  await frames(page, 2);
}
function restored(actual, before, label) {
  assert.equal(actual.active, false, `${label}: photo closed`);
  assert.deepEqual(actual.camera, before.camera, `${label}: exact camera/perspective/clip restoration`);
  assert.equal(actual.hud, before.hud, `${label}: HUD attribute restored`);
  assert.equal(actual.hudVisibility, before.hudVisibility, `${label}: HUD visibility restored`);
  assert.equal(actual.focus.activeClaimCount, before.focus.activeClaimCount, `${label}: no leaked claim`);
  assert.equal(actual.input, before.input, `${label}: movement restored`);
}

async function placeApproach(page) {
  return page.evaluate(async () => {
    const d = window.__INHAGAME_P0__;
    const { INKYUNG_PHOTO_POINT: anchor } = await import('/src/photo/inkyung-photo-point.js');
    const { canOccupy, moveAroundObstacles } = await import('/src/world-collision.js');
    const { overPondWater, constrainPondWalk } = await import('/src/landmark-detail-layout.js');
    const { metersToWorld } = await import('/src/world-scale.js');
    const { QUEST_NPC_ID } = await import('/npc-factory/npc-presence.mjs');
    const talkRadius = metersToWorld(3);
    const npcs = d.app.root.find(e => e.name?.startsWith('NPC_TEST_HUMAN_') && e.enabled);
    const guide = npcs.find(e => e.name === `NPC_TEST_HUMAN_${QUEST_NPC_ID}`);
    if (!guide) throw Error('The actual lake guide is missing from npcSync=ng2');
    const guidePosition = guide.getLocalPosition();
    const nearest = p => Math.min(...npcs.map(e => {
      const n = e.getLocalPosition(); return Math.hypot(p.x - n.x, p.z - n.z);
    }));
    const yaw = d.orbit.yaw, forward = { x: -Math.sin(yaw), z: Math.cos(yaw) };
    const diagnostics = { testedStarts: 0, rejected: { outsidePhotoBand: 0, npcRadius: 0, water: 0, collider: 0, sweep: 0, bank: 0 },
      arrivalYaw: yaw, pathLength: 1.2, npcMargin: .2, clock: d.getStatus().npcTest?.shared_schedule };
    window.__PHOTO_CAMPUS_APPROACH_DIAGNOSTICS__ = diagnostics;
    const valid = p => {
      if (Math.hypot(p.x - anchor.position.x, p.z - anchor.position.z) > anchor.radius - .1) { diagnostics.rejected.outsidePhotoBand++; return false; }
      if (nearest(p) <= talkRadius + .2) { diagnostics.rejected.npcRadius++; return false; }
      if (overPondWater(p.x, p.z)) { diagnostics.rejected.water++; return false; }
      if (!canOccupy(p)) { diagnostics.rejected.collider++; return false; }
      return true;
    };
    let chosen;
    // Check the entire short walking segment, including pond and swept collider constraints.
    for (const radius of [2.35, 2.6, 2.1]) {
      for (let i = 0; i < 72; i++) {
        diagnostics.testedStarts++;
        const angle = i * Math.PI / 36;
        const p = { x: anchor.position.x + Math.cos(angle) * radius,
          z: anchor.position.z + Math.sin(angle) * radius };
        p.y = d.controller.groundY + d.controller.space.groundHeight(p.x, p.z);
        let previous = p, safe = true;
        for (let step = 0; step <= 12; step++) {
          const next = { x: p.x + forward.x * step / 10, z: p.z + forward.z * step / 10, y: p.y };
          const swept = moveAroundObstacles(previous, next.x - previous.x, next.z - previous.z);
          const bank = constrainPondWalk(previous, next);
          if (!valid(next)) { safe = false; break; }
          if (Math.hypot(swept.x - next.x, swept.z - next.z) > .001) { diagnostics.rejected.sweep++; safe = false; break; }
          if (Math.hypot(bank.x - next.x, bank.z - next.z) > .001) { diagnostics.rejected.bank++; safe = false; break; }
          previous = next;
        }
        if (safe) { chosen = p; break; }
      }
      if (chosen) break;
    }
    if (!chosen) throw Error('No collision-safe photo approach outside actual NPC talk radii');
    d.controller.keys.clear(); d.controller.clearAssistedMovement(); d.controller.velocityY = 0;
    d.controller.jumpQueued = false; d.controller.grounded = true;
    d.player.setLocalPosition(chosen.x, chosen.y, chosen.z);
    // Do not point the gameplay orbit at the lake or alter scene/streaming/rendering.
    // Only the production photo mode may apply its lake-facing entry preset.
    d.app.fire('update', .016);
    return { anchor, initial: chosen, arrivalYaw: yaw, talkRadius,
      guidePosition: { x: guidePosition.x, y: guidePosition.y, z: guidePosition.z },
      guideDistance: Math.hypot(chosen.x - guidePosition.x, chosen.z - guidePosition.z),
      nearestNpcDistance: nearest(chosen), collisionCheckedWalkLength: 1.2 };
  });
}

async function checkMechanicalCompetition(page) {
  const fixture = await page.evaluate(async () => {
    const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
    const saved = { x: p.x, y: p.y, z: p.z };
    const { INKYUNG_PHOTO_POINT: anchor } = await import('/src/photo/inkyung-photo-point.js');
    const { canOccupy } = await import('/src/world-collision.js');
    const { canObserveInkyungDucksFromShore } = await import('/src/ambient-ducks-state.js');
    const { metersToWorld } = await import('/src/world-scale.js');
    const npcs = d.app.root.find(e => e.name?.startsWith('NPC_TEST_HUMAN_') && e.enabled);
    let outside;
    for (const radius of [anchor.radius + .4, anchor.radius + .8]) {
      for (let i = 0; i < 72; i++) {
        const angle = i * Math.PI / 36;
        const p = { x: anchor.position.x + Math.cos(angle) * radius, z: anchor.position.z + Math.sin(angle) * radius };
        p.y = d.controller.groundY + d.controller.space.groundHeight(p.x, p.z);
        if (canOccupy(p) && canObserveInkyungDucksFromShore(p) && npcs.every(e => {
          const n = e.getLocalPosition(); return Math.hypot(p.x - n.x, p.z - n.z) > metersToWorld(3) + .2;
        })) { outside = p; break; }
      }
      if (outside) break;
    }
    if (!outside) throw Error('No safe mechanical-duck-only shore position outside the photo radius');
    d.controller.keys.clear(); d.controller.clearAssistedMovement(); d.controller.velocityY = 0; d.controller.grounded = true;
    d.player.setLocalPosition(outside.x, outside.y, outside.z); d.app.fire('update', .016);
    return { saved, outside, setup: 'Two collision-checked offline player poses; no actor disabled, candidate injected or duck action triggered' };
  });
  try {
    await page.waitForFunction(() => window.__INHAGAME_P0__.contextActions.active?.id === 'inkyung-mechanical-duck');
    fixture.outsideEvidence = await interactionDiagnostics(page);
    assert.equal(fixture.outsideEvidence.photoCandidate, null, 'Photo unavailable outside its authored radius');
    assert.equal(fixture.outsideEvidence.primaryAction.priority, 240, 'Real broad duck candidate remains priority 240');
  } finally {
    await page.evaluate(saved => {
      const d = window.__INHAGAME_P0__; d.controller.velocityY = 0; d.controller.grounded = true;
      d.player.setLocalPosition(saved.x, saved.y, saved.z); d.app.fire('update', .016);
    }, fixture.saved);
  }
  await page.waitForFunction(() => window.__INHAGAME_P0__.contextActions.active?.id === 'inkyung-photo-mode');
  fixture.insideEvidence = await interactionDiagnostics(page);
  assert.equal(fixture.insideEvidence.mechanicalDuck.present, true, 'The real competing duck stays present');
  assert.equal(fixture.insideEvidence.mechanicalDuck.shoreEligible, true, 'Broad duck observation remains eligible inside photo band');
  assert.equal(fixture.insideEvidence.primaryAction.priority, 245, 'Local photo action outranks broad duck observation');
  return fixture;
}

async function composition(page) {
  return page.evaluate(async () => {
    const d = window.__INHAGAME_P0__, camera = d.orbit.camera, pc = await import('playcanvas');
    const { getCanonicalLandmark, projectPolygon } = await import('/src/reality-adapter.js');
    const { polygonOverlap } = await import('/src/polygon-collision.js');
    const ring = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
    const lake = d.app.root.findByName('lmk_inkyung_pond');
    const rect = d.app.graphicsDevice.canvas.getBoundingClientRect();
    const projection = p => {
      const v = new pc.Vec3(p.x, p.y ?? .025, -p.z), screen = camera.camera.worldToScreen(v);
      const ahead = camera.forward.dot(v.clone().sub(camera.getPosition())) > 0;
      return { x: screen.x, y: screen.y, ahead,
        inFrame: ahead && screen.x >= 0 && screen.x < rect.width && screen.y >= 0 && screen.y < rect.height };
    };
    const xs = ring.map(p => p.x), zs = ring.map(p => p.z);
    let sampleCount = 0, projectedWaterSamples = 0, unobscuredByDockSamples = 0;
    const dockElement = document.querySelector('.photo-mode-dock'), dock = dockElement.getBoundingClientRect();
    const dockVisible = !dockElement.hidden && getComputedStyle(dockElement).display !== 'none' && dock.height > 0;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += .6)
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += .6) {
        if (!polygonOverlap(x, z, ring, 0)) continue;
        sampleCount++; const p = projection({ x, z });
        if (p.inFrame) { projectedWaterSamples++; if (!dockVisible || p.y < dock.top) unobscuredByDockSamples++; }
      }
    const visual = d.player.children.find(e => e.name === 'Induck_GLB_Visual' && e.enabled) ??
      d.player.children.find(e => e.name === 'Public_QA_Avatar' && e.enabled);
    const avatarPoints = [];
    const avatarMeshes = visual?.find(e => !!e.render).flatMap(e => e.render.meshInstances) ?? [];
    for (const mesh of avatarMeshes) {
      const { center, halfExtents } = mesh.aabb;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const corner = new pc.Vec3(center.x + x * halfExtents.x, center.y + y * halfExtents.y, center.z + z * halfExtents.z);
        if (camera.forward.dot(corner.clone().sub(camera.getPosition())) > 0) avatarPoints.push(camera.camera.worldToScreen(corner));
      }
    }
    const avatarBounds = avatarPoints.length ? {
      left: Math.min(...avatarPoints.map(p => p.x)), right: Math.max(...avatarPoints.map(p => p.x)),
      top: Math.min(...avatarPoints.map(p => p.y)), bottom: Math.max(...avatarPoints.map(p => p.y))
    } : null;
    const c = camera.getPosition(), p = d.player.getLocalPosition();
    return { renderer: d.getStatus().renderer, camera: { yaw: d.orbit.yaw, pitch: d.orbit.pitch,
      distance: d.orbit.distance, worldPosition: [c.x, c.y, c.z] },
      playerProjection: projection({ x: p.x, y: p.y + d.character.eyeHeight, z: p.z }),
      lakePresent: !!lake?.render, lakeEnabled: lake?.enabled ?? false,
      materials: lake?.render?.meshInstances.map(m => m.material.name) ?? [],
      sampleCount, projectedWaterSamples, unobscuredByDockSamples, dockVisible,
      avatarVisual: visual?.name ?? null, avatarMeshCount: avatarMeshes.length, avatarBounds,
      note: 'Projection is not an occlusion test; buildings/trees may obscure these points. No scene objects or camera angle were changed for this diagnostic.' };
  });
}

async function realFrame(page) {
  return page.evaluate(() => new Promise(resolve => {
    const app = window.__INHAGAME_P0__.app;
    app.once('postrender', () => {
      const gl = app.graphicsDevice.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), pixels = new Uint8Array(w * h * 4);
      try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.finish(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels); }
      finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old); }
      const bins = new Set();
      for (let i = 0; i < pixels.length; i += 64) bins.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
      resolve({ width: w, height: h, colorBins: bins.size, glError: gl.getError(),
        context: gl.getParameter(gl.VERSION), frame: app.frame, framebuffer: 'resolved-default' });
    });
    app.renderNextFrame = true;
  }));
}

async function nativeLakeLook(page, viewport) {
  const target = await page.evaluate(async () => {
    const { getCanonicalLandmark, projectPolygon, computePolygonCentroid } = await import('/src/reality-adapter.js');
    const { MOUSE_DRAG_LOOK } = await import('/src/orbit-camera-controller.js');
    const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
    const center = computePolygonCentroid(projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon));
    return { beforeYaw: d.orbit.yaw, targetYaw: Math.atan2(p.x - center.x, center.z - p.z),
      sensitivity: MOUSE_DRAG_LOOK.yaw * d.orbit.mouseSensitivity };
  });
  const difference = Math.atan2(Math.sin(target.targetYaw - target.beforeYaw), Math.cos(target.targetYaw - target.beforeYaw));
  // Ordinary right-button orbit dragging never requests Pointer Lock. This optional diagnostic
  // uses the production input listener, not orbit assignment, and cannot replace default evidence.
  const distance = -difference / target.sensitivity, steps = Math.max(1, Math.ceil(Math.abs(distance) / (viewport.width * .5)));
  for (let i = 0; i < steps; i++) {
    const dx = distance / steps, x = viewport.width / 2 - dx / 2, y = viewport.height / 2;
    await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + dx, y, { steps: 5 }); await page.mouse.up({ button: 'right' });
  }
  await frames(page, 2);
  return { ...target, afterYaw: (await snapshot(page)).camera.yaw,
    input: 'Native gameplay right-button orbit drag; supplementary desktop-input view, including in the mobile-sized viewport' };
}

async function runCase(startSmoke, TIMEOUT_MS, name, viewport, mobile) {
  const entry = { name, viewport, mobile, status: 'RUNNING', checks: [], screenshots: [] };
  report.cases.push(entry);
  let smoke, page;
  try {
    smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
    page = await smoke.context.newPage(); page.setDefaultTimeout(15_000);
    const fatal = smoke.watch(page);
    const clockStarted = performance.now(), clockBase = NPC_WORLD_EPOCH_MS + NPC_WORLD_PERIOD_MS + 60_000;
    entry.clockFixture = { endpoint: '/api/world-time', basePayload: worldTimePayload(clockBase),
      mode: 'class_time+60s advancing with real monotonic elapsed time',
      observationWindow: { startOffsetSeconds: 60, exclusiveEndOffsetSeconds: 470, maxElapsedMs: 410_000 },
      rationale: 'Real shared schedule sampled every 0.5s across the entire 900s class_time period: the chosen full path is clear from +60 through +470s; NPC010 enters its clearance band at +474.5s.', requests: [] };
    // Existing NPC smokes use this same valid server contract. The real shared schedule and
    // every actor remain active; runner wall time cannot accidentally select a different crowd.
    await page.route(`${smoke.origin}/api/world-time`, route => {
      const elapsedMs = Math.floor(performance.now() - clockStarted), payload = worldTimePayload(clockBase + elapsedMs);
      entry.clockFixture.requests.push({ elapsedMs, serverNowMs: payload.serverNowMs });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(payload) });
    });
    await page.goto(`${smoke.origin}/campus/?npcSync=ng2&mechanicalDuck=1&envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await Promise.race([page.waitForFunction(() => {
      const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished;
    }, null, { timeout: TIMEOUT_MS }), fatal]);
    const boot = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
    assert.equal(boot.renderer, 'WebGL2', boot.error ?? 'Expected the actual WebGL2 renderer');
    assert.equal(boot.loading.phase, 'READY');
    await page.waitForFunction(() => {
      const c = window.__INHAGAME_P0__.character;
      return ['glb', 'fallback'].includes(c.modelState) && ['glb', 'fallback'].includes(c.dragonModelState);
    }, null, { timeout: TIMEOUT_MS });
    entry.characterAtBoot = await characterStatus(page);
    await Promise.race([page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().npcTest?.status === 'READY', null, { timeout: TIMEOUT_MS }), fatal]);
    entry.clockAtBoot = await page.evaluate(() => {
      const n = window.__INHAGAME_P0__.getStatus().npcTest; return { period: n.period, ...n.shared_schedule };
    });
    assert.equal(entry.clockAtBoot.state, 'SYNCED'); assert.equal(entry.clockAtBoot.period, 'class_time');
    assert.ok(performance.now() - clockStarted < entry.clockFixture.observationWindow.maxElapsedMs,
      'Authored NPC fixture observation window expired during boot');
    await page.waitForFunction(() => {
      const e = window.__INHAGAME_ENVIRONMENT__?.status?.(); return e?.settled && e?.weatherSettled;
    }, null, { timeout: TIMEOUT_MS });
    entry.servedHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
      const response = await fetch(`/${path}`, { cache: 'no-store' });
      if (!response.ok) throw Error(`Source fetch ${path}: ${response.status}`);
      const bytes = await response.arrayBuffer();
      return [path, [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')];
    }))), sources);
    assert.deepEqual(entry.servedHashes, report.sourceHashes);
    entry.checks.push('Actual production boot, real NPC runtime, served/local/committed SHA-256 match');

    entry.approach = await placeApproach(page); await frames(page, 6);
    await page.waitForFunction(() => window.__INHAGAME_P0__.contextActions.active?.id === 'inkyung-photo-mode');
    entry.approachDiagnostics = await interactionDiagnostics(page);
    entry.mechanicalCompetition = await checkMechanicalCompetition(page);
    entry.checks.push('Actual mechanical duck 240 wins outside photo radius; real photo 245 wins inside while the duck remains eligible');
    const canvas = page.locator('#application'); await canvas.focus();
    const initial = await snapshot(page);
    await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(initial => {
        const p = window.__INHAGAME_P0__.player.getLocalPosition(); return Math.hypot(p.x - initial[0], p.z - initial[2]) >= .1;
      }, initial.position, { timeout: 10_000, polling: 'raf' });
    } finally { await page.keyboard.up('KeyW'); }
    await frames(page, 2);
    entry.walk = await snapshot(page);
    assert.equal(entry.walk.action, 'inkyung-photo-mode', 'Native approach ends at the shared photo action');
    assert.equal(entry.walk.grounded, true); assert.equal(entry.walk.mounted, false);
    assert.ok(Math.hypot(entry.walk.position[0] - initial.position[0], entry.walk.position[2] - initial.position[2]) >= .1);
    entry.checks.push('Native W movement on a collider/water-checked approach outside NPC talk radius');

    if (!mobile) {
      await canvas.click({ position: { x: viewport.width / 2, y: viewport.height / 2 } });
      // The browser changes pointerLockElement before dispatching pointerlockchange.
      // Wait for both the browser lock AND the real runtime's acknowledgment; neither suffices alone.
      await page.waitForFunction(() => document.pointerLockElement === document.getElementById('application') &&
        window.__INHAGAME_P0__.getStatus().pointerLock.locked === true,
      null, { timeout: 10_000, polling: 50 });
      assert.equal((await snapshot(page)).pointerLock.locked, true);
    }
    const before = await snapshot(page); entry.before = before;
    if (mobile) await page.locator('#context-action').tap(); else await page.keyboard.press('KeyF');
    await waitPhoto(page, true);
    const opened = await snapshot(page); entry.opened = opened;
    assert.equal(opened.input, false); assert.equal(opened.orbitInput, false);
    assert.equal(opened.hudVisibility, 'hidden'); assert.equal(opened.pointerLock.locked, false);
    assert.equal(opened.focus.focusClass, 'BLOCKING_UI');
    assert.deepEqual(opened.focus.topOwners, ['inkyung-photo-mode']);
    entry.expectedPhotoPreset = await page.evaluate(async () => {
      const { INKYUNG_PHOTO_POINT, inkyungPhotoYaw } = await import('/src/photo/inkyung-photo-point.js');
      const p = window.__INHAGAME_P0__.player.getLocalPosition();
      return { yaw: inkyungPhotoYaw(p), lookAt: INKYUNG_PHOTO_POINT.lookAt };
    });
    entry.expectedPhotoPreset.arrivalYaw = before.camera.yaw;
    assert.ok(Number.isFinite(entry.expectedPhotoPreset.yaw), 'Production lake preset must be finite');
    assert.ok(Math.abs(opened.camera.yaw - entry.expectedPhotoPreset.yaw) < 1e-8, 'Default photo uses the production lake-facing helper');
    assert.equal(opened.camera.pitch, .25); assert.equal(opened.camera.distance, 4);
    assert.equal(await page.locator('[data-photo-control="close"]').evaluate(el => el === document.activeElement), true);
    entry.defaultComposition = await composition(page);
    entry.characterAtDefault = await characterStatus(page);
    entry.frame = await realFrame(page);
    assert.equal(entry.frame.glError, 0); assert.ok(entry.frame.colorBins > 12, 'Actual rendered campus must not be a blank frame');
    entry.screenshots.push(await screenshot(page, `${name}-default-${viewport.width}x${viewport.height}`, 'untouched default production photo composition'));
    const compositionMinimum = { projected: Math.max(20, Math.ceil(entry.defaultComposition.sampleCount * .1)),
      aboveDock: Math.max(12, Math.ceil(entry.defaultComposition.sampleCount * .05)) };
    entry.compositionMinimum = compositionMinimum;
    assert.equal(entry.defaultComposition.lakePresent, true, 'Default preset renders the actual lake entity');
    assert.equal(entry.defaultComposition.lakeEnabled, true, 'Actual lake remains enabled');
    assert.ok(entry.defaultComposition.projectedWaterSamples >= compositionMinimum.projected,
      'Default preset must frame a meaningful set of actual lake samples');
    assert.ok(entry.defaultComposition.unobscuredByDockSamples >= compositionMinimum.aboveDock,
      'Default preset must leave meaningful lake samples above the controls');
    assert.equal(entry.defaultComposition.playerProjection.inFrame, true, 'Local avatar remains inside the default composition');
    if (entry.characterAtDefault.modelState !== 'glb') report.warnings.push(`${name}: avatar modelState=${entry.characterAtDefault.modelState}; inspect fallback rendering separately`);
    entry.checks.push(`${mobile ? 'Native touch' : 'Native F with real Pointer Lock'} entry, HUD hidden, photo owns focus`);
    for (const selector of ['.photo-mode-dock', '[data-photo-control="close"]', '[data-photo-control="controls"]', '[data-photo-control="yaw"]', '[data-photo-control="pitch"]', '[data-photo-control="distance"]']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} is on-screen at ${name}`);
    }
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('[data-photo-control="pose"]').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal((await snapshot(page)).emote, 'photo_pose', 'Real local avatar accepts the photo pose');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-photo-control="close"]').evaluate(el => el === document.activeElement), true);
    for (const control of ['yaw', 'pitch', 'distance']) {
      const slider = page.locator(`[data-photo-control="${control}"]`);
      const previous = Number(await slider.inputValue());
      if (mobile) { const box = await slider.boundingBox(); await slider.tap({ position: { x: box.width * .8, y: box.height / 2 } }); }
      else { await slider.focus(); await page.keyboard.press('ArrowRight'); }
      const value = Number(await slider.inputValue());
      assert.notEqual(value, previous, `${control}: native control changes its value`);
      const camera = (await snapshot(page)).camera;
      assert.ok(Math.abs(camera[control] - (control === 'yaw' ? entry.expectedPhotoPreset.yaw + value : value)) < 1e-8, `${control}: UI changes production orbit`);
    }
    const stationary = await snapshot(page);
    await page.keyboard.down('KeyW'); await frames(page, 5); await page.keyboard.up('KeyW');
    assert.deepEqual((await snapshot(page)).position, stationary.position, 'Movement blocked during framing');
    entry.screenshots.push(await screenshot(page, `${name}-framed-${viewport.width}x${viewport.height}`, 'native controls adjusted; not the default composition'));
    const close = page.locator('[data-photo-control="close"]');
    const controlsToggle = page.locator('[data-photo-control="controls"]'), dock = page.locator('.photo-mode-dock');
    const beforeHidingControls = await snapshot(page);
    if (mobile) await controlsToggle.tap(); else await controlsToggle.click();
    await dock.waitFor({ state: 'hidden' }); await frames(page, 2);
    const clearFrameState = await snapshot(page);
    assert.equal(clearFrameState.active, true, 'Hiding framing controls keeps photo mode active');
    assert.equal(clearFrameState.input, false); assert.equal(clearFrameState.orbitInput, false);
    assert.equal(clearFrameState.hudVisibility, 'hidden'); assert.equal(clearFrameState.pointerLock.locked, false);
    assert.deepEqual(clearFrameState.camera, beforeHidingControls.camera, 'Hiding controls never changes composition');
    assert.equal(clearFrameState.focus.activeClaimCount, beforeHidingControls.focus.activeClaimCount, 'Same blocking focus owner is retained');
    for (const control of [close, controlsToggle]) {
      assert.equal(await control.isVisible(), true, 'Exit and restore-controls affordances remain visible');
      const box = await control.boundingBox();
      assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
        'Clear-frame exit/toggle stays within the viewport');
    }
    assert.equal(await controlsToggle.evaluate(el => el === document.activeElement), true);
    for (const [key, target] of [['Tab', close], ['Tab', controlsToggle], ['Shift+Tab', close], ['Shift+Tab', controlsToggle]]) {
      await page.keyboard.press(key);
      assert.equal(await target.evaluate(el => el === document.activeElement), true, `${key}: hidden dock controls are excluded from the two-button focus loop`);
    }
    const clearFrameStill = await snapshot(page);
    await page.keyboard.down('KeyW'); await frames(page, 3); await page.keyboard.up('KeyW');
    assert.deepEqual((await snapshot(page)).position, clearFrameStill.position, 'Movement remains blocked with the dock hidden');
    entry.clearFrameComposition = await composition(page);
    entry.characterAtClearFrame = await characterStatus(page);
    entry.screenshots.push(await screenshot(page, `${name}-clear-frame-${viewport.width}x${viewport.height}`,
      'same actual lake/avatar camera composition with framing dock hidden by native toggle; visible exit and restore-controls buttons'));
    assert.equal(entry.clearFrameComposition.dockVisible, false);
    assert.ok(entry.clearFrameComposition.projectedWaterSamples > 0, 'Actual lake remains in the clear frame');
    assert.equal(entry.clearFrameComposition.unobscuredByDockSamples, entry.clearFrameComposition.projectedWaterSamples);
    const avatar = entry.clearFrameComposition.avatarBounds;
    assert.ok(avatar && entry.clearFrameComposition.avatarMeshCount > 0, 'Actual active local-avatar meshes are inspectable');
    assert.ok(avatar.left >= -1 && avatar.top >= -1 && avatar.right <= viewport.width + 1 && avatar.bottom <= viewport.height + 1,
      'The whole projected local avatar fits in the clear-frame screenshot');
    for (const control of [close, controlsToggle]) {
      const box = await control.boundingBox();
      assert.equal(box.x < avatar.right && box.x + box.width > avatar.left && box.y < avatar.bottom && box.y + box.height > avatar.top,
        false, 'Persistent clear-frame controls do not cover the projected avatar');
    }
    if (mobile) await controlsToggle.tap(); else await controlsToggle.click();
    await dock.waitFor({ state: 'visible' });
    const controlsRestored = await snapshot(page);
    assert.equal(controlsRestored.active, true); assert.equal(controlsRestored.input, false);
    assert.deepEqual(controlsRestored.camera, beforeHidingControls.camera, 'Restoring the dock never changes the camera');
    entry.checks.push('Native hide/show controls preserves framing and input lock; two-button focus loop and hashed unobscured avatar/lake clear frame');
    if (mobile) await close.tap(); else await close.click();
    await waitPhoto(page, false); restored(await snapshot(page), before, 'Close');
    assert.equal(await canvas.evaluate(el => el === document.activeElement), true, 'Focus returns to the canvas');
    assert.equal((await snapshot(page)).emote, null, 'Photo pose cancelled on exit');
    if (!mobile) {
      assert.equal((await snapshot(page)).pointerLock.locked, false, 'No automatic pointer reacquisition');
      assert.equal((await snapshot(page)).pointerLock.awaitingGesture, true);
    }
    entry.checks.push('All native sliders, focus wrap, real avatar pose, blocked movement, close/HUD/camera/focus restoration');
    for (let cycle = 0; cycle < 5; cycle++) {
      if (mobile) await page.locator('#context-action').tap(); else { await canvas.focus(); await page.keyboard.press('KeyF'); }
      await waitPhoto(page, true); await page.keyboard.press('Escape'); await waitPhoto(page, false);
      restored(await snapshot(page), before, `Escape cycle ${cycle + 1}`);
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.photoMode.close()), false, 'Repeated close is idempotent');
    }
    entry.checks.push('Five real entry/Escape cycles plus repeated close without leaked focus owners');

    // Keep the untouched production preset above. The separate native gameplay look proves
    // entry and restoration also work from another arrival yaw; it cannot replace default evidence.
    entry.lakeFacingLook = await nativeLakeLook(page, viewport);
    const lakeBefore = await snapshot(page);
    if (mobile) await page.locator('#context-action').tap(); else { await canvas.focus(); await page.keyboard.press('KeyF'); }
    await waitPhoto(page, true);
    entry.lakeFacingComposition = await composition(page);
    entry.screenshots.push(await screenshot(page, `${name}-lake-facing-native-look-${viewport.width}x${viewport.height}`,
      'supplementary lake-facing photo after ordinary gameplay camera drag; NOT the default arrival composition'));
    assert.ok(entry.lakeFacingComposition.projectedWaterSamples > 0, 'Native gameplay look reaches a lake-facing photo view');
    await page.keyboard.press('Escape'); await waitPhoto(page, false);
    restored(await snapshot(page), lakeBefore, 'Lake-facing native look');
    entry.checks.push('Separately labelled real lake-facing screenshot reached by native gameplay camera drag');

    if (!mobile) {
      await canvas.focus(); await page.keyboard.press('KeyV');
      const first = await snapshot(page); assert.equal(first.camera.firstPerson, true);
      await page.keyboard.press('KeyF'); await waitPhoto(page, true);
      assert.equal((await snapshot(page)).camera.firstPerson, false);
      await page.keyboard.press('Escape'); await waitPhoto(page, false);
      restored(await snapshot(page), first, 'First-person exit');
      await canvas.focus(); await page.keyboard.press('KeyV');
      const normal = await snapshot(page);
      await page.keyboard.press('KeyF'); await waitPhoto(page, true);
      await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await waitPhoto(page, false);
      restored(await snapshot(page), normal, 'Blur listener');
      await canvas.focus(); await page.keyboard.press('KeyF'); await waitPhoto(page, true);
      entry.roomTakeover = await page.evaluate(() => {
        const d = window.__INHAGAME_P0__, accepted = d.rooms.enter('ROOM_CLUBHOUSE_01');
        return { accepted, active: d.photoMode.active, input: d.controller.inputEnabled,
          focus: d.getStatus().inputFocus, camera: { yaw: d.orbit.yaw, pitch: d.orbit.pitch,
            distance: d.orbit.distance, firstPerson: d.orbit.firstPerson, nearClip: d.orbit.camera.camera.nearClip } };
      });
      assert.equal(entry.roomTakeover.accepted, true); assert.equal(entry.roomTakeover.active, false);
      assert.equal(entry.roomTakeover.input, false); assert.equal(entry.roomTakeover.focus.focusClass, 'SYSTEM_LOCK');
      assert.deepEqual(entry.roomTakeover.camera, normal.camera, 'Restore photo camera before the transition snapshots it');
      await page.waitForFunction(() => {
        const d = window.__INHAGAME_P0__; return d.rooms.currentSpace === 'ROOM_CLUBHOUSE_01' && d.rooms.status().ready;
      });
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.photoMode.open()), false, 'Indoor entry rejected');
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.rooms.exit()), true);
      await page.waitForFunction(() => {
        const d = window.__INHAGAME_P0__; return d.rooms.currentSpace === 'campus' && !d.rooms.status().busy;
      });
      const returned = await snapshot(page);
      assert.equal(returned.camera.distance, normal.camera.distance);
      assert.equal(returned.camera.pitch, normal.camera.pitch);
      assert.equal(returned.focus.activeClaimCount, 0); assert.equal(returned.input, true);
      entry.checks.push('Native V first-person restoration; production blur handler; real Club Room takeover and campus return');

      // Real NPC priority at the same lake anchor; never inject a fabricated context action.
      entry.npcPriority = await page.evaluate(async () => {
        const d = window.__INHAGAME_P0__, { QUEST_NPC_ID } = await import('/npc-factory/npc-presence.mjs');
        const guide = d.app.root.findByName(`NPC_TEST_HUMAN_${QUEST_NPC_ID}`), g = guide.getLocalPosition();
        const { canOccupy } = await import('/src/world-collision.js');
        const { overPondWater } = await import('/src/landmark-detail-layout.js');
        const { INKYUNG_PHOTO_POINT: anchor } = await import('/src/photo/inkyung-photo-point.js');
        let at;
        for (let i = 0; i < 24; i++) {
          const p = { x: g.x + Math.cos(i * Math.PI / 12) * .9, z: g.z + Math.sin(i * Math.PI / 12) * .9 };
          p.y = d.controller.groundY + d.controller.space.groundHeight(p.x, p.z);
          if (canOccupy(p) && !overPondWater(p.x, p.z) && Math.hypot(p.x - anchor.position.x, p.z - anchor.position.z) < anchor.radius) { at = p; break; }
        }
        if (!at) throw Error('No safe overlapping NPC/photo position');
        d.controller.keys.clear(); d.controller.clearAssistedMovement(); d.controller.velocityY = 0;
        d.controller.grounded = true; d.player.setLocalPosition(at.x, at.y, at.z); d.app.fire('update', .016);
        return { position: at, action: d.contextActions.active?.id, priority: d.contextActions.active?.priority,
          photoCandidate: d.photoMode.contextAction()?.id, photoPriority: d.photoMode.contextAction()?.priority, guideId: QUEST_NPC_ID };
      });
      await page.waitForFunction(() => window.__INHAGAME_P0__.contextActions.active?.id === 'npc-talk');
      assert.equal(entry.npcPriority.photoCandidate, 'inkyung-photo-mode');
      assert.equal(entry.npcPriority.photoPriority, 245);
      assert.equal(entry.npcPriority.action, 'npc-talk'); assert.equal(entry.npcPriority.priority, 300);
      await canvas.focus(); await page.keyboard.press('KeyF');
      await page.waitForFunction(() => !!window.__INHAGAME_P0__.getStatus().npcTest?.conversation_active);
      assert.equal((await snapshot(page)).active, false);
      entry.npcPriority.conversationId = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().npcTest.conversation_active);
      // main.js interactionAction explicitly closes a live dialogue with the same shared F key.
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => !window.__INHAGAME_P0__.getStatus().npcTest?.conversation_active);
      assert.equal((await snapshot(page)).focus.activeClaimCount, 0);
      entry.checks.push('Actual lake NPC priority 300 beats available photo action 245; native F opens and closes dialogue, restoring focus');
    }
    entry.clockFixture.observedElapsedMs = Math.floor(performance.now() - clockStarted);
    entry.clockAtEnd = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().npcTest?.shared_schedule);
    assert.ok(entry.clockFixture.observedElapsedMs < entry.clockFixture.observationWindow.maxElapsedMs,
      'Authored NPC fixture exceeded class_time+470s; rerun on a sufficiently responsive runner rather than accept crowd drift');
    assert.deepEqual(smoke.problems, [], 'No browser/runtime/same-origin errors');
    entry.status = 'PASS'; console.log(`${name}: PASS (${entry.checks.length} acceptance groups)`);
  } catch (error) {
    entry.status = 'FAIL'; entry.error = String(error.stack ?? error);
    entry.problems = smoke?.problems ?? [];
    if (page && !page.isClosed()) {
      try { entry.interactionAtFailure = await interactionDiagnostics(page); }
      catch (statusError) { entry.interactionStatusError = String(statusError); }
      try { entry.characterAtFailure = await characterStatus(page); }
      catch (statusError) { entry.characterStatusError = String(statusError); }
      try { entry.screenshots.push(await screenshot(page, `${name}-failure-${viewport.width}x${viewport.height}`, 'failure evidence; production page unchanged')); }
      catch (captureError) { entry.captureError = String(captureError); }
    }
    console.error(`${name}: FAIL\n${entry.error}`);
  } finally {
    try { await smoke?.close(); } catch (error) { entry.status = 'FAIL'; entry.closeError = String(error); }
    await save();
  }
}

try {
  report.head = git('rev-parse', 'HEAD').toString().trim();
  assert.match(report.expectedHead ?? '', /^[0-9a-f]{40}$/, 'PHOTO_MODE_HEAD_SHA must be the full required PR head');
  assert.equal(report.head, report.expectedHead, 'Refusing nonmatching checkout/PR head');
  assert.equal(process.env.WORLD_SMOKE_DISABLE_WEBGPU, '1', 'This evidence job requires real WebGL2');
  assert.equal(process.env.WORLD_SMOKE_BROWSER, 'chrome', 'Use the GitHub runner Chrome channel');
  for (const path of sources) {
    const local = await readFile(new URL(`../../${path}`, import.meta.url));
    const committed = git('show', `${report.head}:apps/world/${path}`);
    assert.equal(sha256(local), sha256(committed), `Uncommitted source differs from required head: ${path}`);
    report.sourceHashes[path] = sha256(local);
    if (path === 'assets/induck-v3.glb') {
      assert.equal(local.toString('ascii', 0, 4), 'glTF', 'Character source must be a GLB');
      const json = JSON.parse(local.subarray(20, 20 + local.readUInt32LE(12)).toString('utf8'));
      report.characterAssetIdentity = { path, sha256: sha256(local), generator: json.asset?.generator ?? null,
        rootNodeNames: json.scenes?.flatMap(scene => scene.nodes ?? []).map(i => json.nodes?.[i]?.name) ?? [],
        materialColors: json.materials?.map(m => m.pbrMetallicRoughness?.baseColorFactor ?? null) ?? [] };
      if (/QA cuboids/i.test(json.asset?.generator ?? '')) report.warnings.push('Committed avatar GLB is an independent public QA cuboid asset; successful loading does not approve final mascot appearance');
    }
  }
  report.checks.push('Required full head equals git HEAD and attested sources equal committed bytes');
  const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1280, height: 720 }, false],
    ['portrait', { width: 360, height: 800 }, true],
    ['landscape', { width: 844, height: 390 }, true]
  ]) await runCase(startSmoke, TIMEOUT_MS, name, viewport, mobile);
  report.status = report.cases.every(entry => entry.status === 'PASS') ? 'PASS' : 'FAIL';
  report.visualApproval = report.warnings.length ? 'FLAGGED: inspect default compositions and avatar-asset limitations' : 'PENDING: inspect default screenshots';
  if (report.status === 'FAIL') process.exitCode = 1;
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  clearTimeout(watchdog); await save(); console.log(JSON.stringify(report, null, 2));
}
