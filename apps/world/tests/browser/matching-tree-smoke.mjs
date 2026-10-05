// Prepared hosted-only QA. Never launch locally. All effects stay in the
// disposable, offline /campus/ page supplied by the existing harness.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertMatchingTreeHostedExecution, MATCHING_TREE_QA_VIEWPORTS,
  matchingTreeViews, matchingTreeCamera, assertMatchingTreeSeatPose, assertMatchingTreeFraming } from './matching-tree-qa.mjs';
assertMatchingTreeHostedExecution(process.env);
const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
const { SEAT_ANCHORS } = await import('../../src/seat-anchors.js');
const anchors = SEAT_ANCHORS.filter(a => a.interactableId === 'lmk_matching_tree');
assert.equal(anchors.length, 2);
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const koreanFontFamily = execFileSync('fc-match', ['--format=%{family}', ':lang=ko'], { encoding: 'utf8' }).trim();
assert.match(koreanFontFamily, /Noto Sans CJK/, 'Hosted screenshots require installed Korean glyphs');
const head = git(['rev-parse', 'HEAD']), output = process.env.WORLD_MATCHING_TREE_OUTPUT || 'test-results/campus-visual-parity/matching-tree';
assert.equal(head, process.env.EXPECTED_MATCHING_TREE_HEAD, 'exact PR head');
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'tracked runtime must match the recorded HEAD');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { head, tree: git(['rev-parse', 'HEAD^{tree}']), result: 'RUNNING',
  fontEnvironment: { koreanFontFamily },
  scope: 'Actual offline campus, existing production seat/context/keyboard/touch/controller/camera/map owners',
  fixtures: ['Initial actor placement at each real anchor stand point; subsequent sit, stand, walk and jump use real input',
    'The second seated avatar is a local clone of the real posed actor, not a second network client',
    'Final still views freeze updates and use QA camera positions; the live orbit camera is checked separately'],
  limits: ['Chromium touch emulation is not physical-device QA', 'Map-aligned position is an estimate, not a survey',
    'No existing Full Map matching-tree POI or geometry marker exists to move; map coverage checks the actual player marker at the relocated tree, with no invented tree POI',
    'No multi-client occupancy/network concurrency claim'],
  visualReview: 'PENDING_INDEPENDENT_PIXEL_REVIEW', cases: [] };
await mkdir(output, { recursive: true });
async function screenshot(page, name) {
  const file = `${name}.png`; await page.screenshot({ path: `${output}/${file}`, animations: 'disabled' });
  return { file, sha256: sha(await readFile(`${output}/${file}`)) };
}
async function readPose(page) {
  return page.evaluate(() => {
    const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
    return { id: d.seats.seated?.id ?? null, seated: d.seats.isSeated, position: { x: p.x, y: p.y, z: p.z },
      yaw: d.player.getLocalEulerAngles().y, legs: d.character.pose?.legs,
      grounded: d.controller.grounded, active: d.contextActions.active?.id, label: document.getElementById('context-action').textContent };
  });
}
async function approach(page, anchor) {
  await page.evaluate(anchor => {
    const d = window.__INHAGAME_P0__;
    if (d.seats.isSeated) throw Error('Prior interaction did not release its seat');
    d.controller.keys.clear(); d.controller.touchVector.x = d.controller.touchVector.y = 0;
    d.controller.jumpQueued = false; d.controller.velocityY = 0; d.controller.grounded = true;
    d.player.setLocalPosition(anchor.standPoint.x, anchor.standPoint.y, anchor.standPoint.z);
  }, anchor);
  await page.waitForFunction(id => {
    const d = window.__INHAGAME_P0__;
    return d.seating.nearby?.id === id && d.contextActions.active?.id === 'seat' && !d.seats.isSeated;
  }, anchor.id, { timeout: TIMEOUT_MS });
  const state = await readPose(page); assert.match(state.label, /앉기/); return state;
}
async function activate(page, mobile) {
  if (mobile) await page.locator('#context-action').tap({ timeout: TIMEOUT_MS });
  else await page.keyboard.press('KeyF');
}
async function awaitSeat(page, anchor) {
  await page.waitForFunction(id => {
    const d = window.__INHAGAME_P0__;
    return d.seats.seated?.id === id && d.character.pose?.legs?.every(v => Math.abs(v - 70) < 1e-5) && /일어나기/.test(document.getElementById('context-action').textContent);
  }, anchor.id, { timeout: TIMEOUT_MS });
  const state = await readPose(page); assertMatchingTreeSeatPose(state, anchor); return state;
}
async function frame(page, mode = 'initial') {
  return page.evaluate(mode => new Promise((resolve, reject) => {
    const app = window.__INHAGAME_P0__.app;
    const timer = setTimeout(() => { app.off('postrender', finish); reject(Error('matching-tree frame deadline')); }, 12000);
    function finish() {
      clearTimeout(timer);
      try {
        const gl = app.graphicsDevice.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, bytes = new Uint8Array(w * h * 4);
        const binding = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.finish(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes); }
        finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, binding); }
        let changed = 0;
        const previous = window.__matchingTreePixels;
        if (mode === 'initial') window.__matchingTreePixels = bytes;
        else {
          if (previous?.length !== bytes.length) throw Error('Missing original matching-tree pixels');
          for (let i = 0; i < bytes.length; i += 4) if (Math.abs(bytes[i] - previous[i]) + Math.abs(bytes[i + 1] - previous[i + 1]) + Math.abs(bytes[i + 2] - previous[i + 2]) > 12) changed++;
        }
        resolve({ width: w, height: h, changed, glError: gl.getError(), contextLost: gl.isContextLost() });
      } catch (error) { reject(error); }
    }
    app.once('postrender', finish); app.renderNextFrame = true;
  }), mode);
}
// worldToScreen is applied to live geometry-space samples, including canopy
// extents and the small seated avatar envelope, not just the center point.
async function projectedTargets(page, canopy = true) {
  return page.evaluate(async canopy => {
    const { matchingTreeTargetSamples } = await import('/tests/browser/matching-tree-qa.mjs');
    const d = window.__INHAGAME_P0__, camera = d.app.root.findByName('Camera'), samples = matchingTreeTargetSamples(canopy);
    const { Vec3 } = await import('playcanvas');
    return samples.map(p => {
      const world = new Vec3(p.x, p.y, -p.z), screen = camera.camera.worldToScreen(world);
      const depth = new Vec3().sub2(world, camera.getPosition()).dot(camera.forward);
      return { x: screen.x, y: screen.y, depth };
    });
  }, canopy);
}
try {
  for (const { name, viewport, mobile } of MATCHING_TREE_QA_VIEWPORTS) {
    const entry = { name, viewport, mobile, interactions: [], screenshots: [] }; report.cases.push(entry);
    const smoke = await startSmoke({ viewport, contextOptions: { deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile } });
    try {
      const page = await smoke.context.newPage(), fatal = smoke.watch(page);
      await page.goto(`${smoke.origin}/campus/?lobby=1&envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      await Promise.race([page.waitForFunction(() => {
        const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished;
      }, null, { timeout: TIMEOUT_MS }), fatal]);
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer), 'WebGL2');
      await page.locator('#main-gate-start').click({ timeout: TIMEOUT_MS });
      await page.waitForFunction(() => {
        const d = window.__INHAGAME_P0__; return !d.lobbyWorld.active && !d.lobbyTransition.active && d.controller.inputEnabled;
      }, null, { timeout: TIMEOUT_MS });
      await page.waitForFunction(() => window.__INHAGAME_ENVIRONMENT__?.status?.().settled && window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled, null, { timeout: TIMEOUT_MS });
      await page.evaluate(() => window.__INHAGAME_P0__.character.ready);
      await page.evaluate(() => {
        window.__matchingTreeEvents = [];
        window.__INHAGAME_P0__.seats.onChange(e => window.__matchingTreeEvents.push({ type: e.type, reason: e.reason ?? null, id: e.anchor.id }));
      });
      for (const anchor of anchors) {
        const before = await approach(page, anchor); await activate(page, mobile); const seated = await awaitSeat(page, anchor);
        await activate(page, mobile); await page.waitForFunction(() => !window.__INHAGAME_P0__.seats.isSeated);
        const standing = await readPose(page);
        for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(standing.position[key] - anchor.standPoint[key]) < 1e-4);
        entry.interactions.push({ anchor: anchor.id, input: mobile ? 'real-context-tap' : 'real-KeyF', before, seated, standing });
      }
      await approach(page, anchors[0]); await activate(page, mobile); await awaitSeat(page, anchors[0]);
      await page.keyboard.down('KeyW');
      try { await page.waitForFunction(() => !window.__INHAGAME_P0__.seats.isSeated && window.__INHAGAME_P0__.controller.moving); }
      finally { await page.keyboard.up('KeyW'); }
      entry.walkRelease = await readPose(page);
      await approach(page, anchors[1]); await activate(page, mobile); await awaitSeat(page, anchors[1]);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !window.__INHAGAME_P0__.seats.isSeated && !window.__INHAGAME_P0__.controller.grounded);
      entry.jumpRelease = await readPose(page);
      await page.waitForFunction(() => window.__INHAGAME_P0__.controller.grounded);
      entry.events = await page.evaluate(() => window.__matchingTreeEvents);
      assert.ok(entry.events.some(e => e.type === 'stand' && e.reason === 'move'));
      assert.ok(entry.events.some(e => e.type === 'stand' && e.reason === 'jump'));
      await approach(page, anchors[0]); await activate(page, mobile); await awaitSeat(page, anchors[0]);
      entry.liveCamera = await page.evaluate(async aspect => {
        const { MATCHING_TREE: t } = await import('/src/matching-tree-layout.js'), { cameraSafeFraction } = await import('/src/world-collision.js'), d = window.__INHAGAME_P0__;
        d.orbit.yaw = Math.atan2(t.front.x, -t.front.z); d.orbit.pitch = .24;
        d.orbit.distance = Math.min(d.orbit.zoomLimits.max, 10 * Math.max(1, 1 / aspect));
        d.orbit.apply(d.player.getLocalPosition(), d.character.eyeHeight);
        const p = d.player.getLocalPosition(), camera = d.app.root.findByName('Camera').getPosition();
        const position = [camera.x, camera.y, -camera.z], eye = [p.x, p.y + d.character.eyeHeight, p.z];
        return { position, eye, safeFraction: cameraSafeFraction(eye, position), yaw: d.orbit.yaw, pitch: d.orbit.pitch, distance: d.orbit.distance, occluded: d.orbit.localVisualOccluded, targetCoverage: 'fork and seated avatar; full canopy is covered by the composed still views' };
      }, viewport.width / viewport.height);
      await frame(page); entry.liveCamera.targets = await projectedTargets(page, false);
      assertMatchingTreeFraming(entry.liveCamera.targets, viewport); assert.equal(entry.liveCamera.occluded, false);
      assert.ok([...entry.liveCamera.position, ...entry.liveCamera.eye].every(Number.isFinite));
      assert.ok(entry.liveCamera.safeFraction >= .999, 'Existing orbit camera clears the actual campus collision envelope');
      entry.screenshots.push(await screenshot(page, `${name}-live-seated-orbit`));
      // There was never a dedicated tree marker. Check the real map/player at
      // this shared facility location, retaining that limitation in the report.
      await page.locator('#minimap-open-map').click({ timeout: TIMEOUT_MS });
      await page.locator('#full-map-panel').waitFor({ state: 'visible' });
      entry.map = await page.evaluate(async () => {
        const { FACILITIES } = await import('/src/campus-facilities.js'), { WORLD_BOUNDS } = await import('/src/campus-layout.js');
        const { projectFullMapPoint } = await import('/src/minimap/full-map-controller.js'), { geoToWorld } = await import('/src/geo-coordinates.js');
        const provenance = await (await fetch('/data/reality/matching-tree-placement.provenance.json')).json();
        const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition(), expected = projectFullMapPoint(p, WORLD_BOUNDS);
        const marker = document.getElementById('full-map-player'), facility = FACILITIES.find(f => f.id === 'lmk_matching_tree');
        const before = geoToWorld(provenance.previousCoordinate.lat, provenance.previousCoordinate.lon);
        const after = geoToWorld(provenance.selectedCoordinate.lat, provenance.selectedCoordinate.lon);
        return { facility: facility.center, before, after, oldPositionDistance: Math.hypot(before.x - facility.center.x, before.z - facility.center.z),
          player: { x: p.x, y: p.y, z: p.z }, expectedPercent: { left: expected.x / 10, top: expected.y / 10 },
          actualPercent: { left: parseFloat(marker.style.left), top: parseFloat(marker.style.top) },
          treeMarkerCount: [...document.querySelectorAll('.full-map-poi')].filter(e => /궁합/.test(e.textContent)).length };
      });
      assert.deepEqual(entry.map.facility, entry.map.after); assert.ok(entry.map.oldPositionDistance > 20);
      assert.equal(entry.map.treeMarkerCount, 0);
      for (const k of ['left', 'top']) assert.ok(Math.abs(entry.map.actualPercent[k] - entry.map.expectedPercent[k]) < .001);
      entry.screenshots.push(await screenshot(page, `${name}-map-player-at-tree`));
      await page.locator('#full-map-close').click();
      await page.locator('#full-map-panel').waitFor({ state: 'hidden' });
      entry.twoAvatars = await page.evaluate(async anchors => {
        const d = window.__INHAGAME_P0__; d.app.off('update'); d.app.autoRender = false;
        d.character.setFirstPerson(false); d.character.setCameraOccluded(false);
        d.character.update(0, { mounted: false, moving: false, grounded: true, seated: true });
        const clone = d.player.clone(); clone.name = 'MatchingTreeQA_SecondSeatedAvatar'; d.player.parent.addChild(clone);
        clone.setLocalPosition(anchors[1].position.x, anchors[1].position.y, anchors[1].position.z); clone.setLocalEulerAngles(0, anchors[1].yaw, 0);
        window.__matchingTreeSecondAvatar = clone;
        const owners = d.app.root.find(e => e.name === 'lmk_matching_tree'); if (owners.length !== 1) throw Error('Matching tree must have one owner');
        window.__matchingTreeOwner = owners[0];
        const { MATCHING_TREE: t } = await import('/src/matching-tree-layout.js');
        for (const mi of owners[0].findComponents('render').flatMap(c => c.meshInstances)) {
          const center = mi.aabb.center; if (Math.hypot(center.x - t.center.x, -center.z - t.center.z) > 4) throw Error('Tree remains at old location');
        }
        const state = (entity, anchor) => { const p = entity.getLocalPosition(); return { id: anchor.id, seated: true, position: { x: p.x, y: p.y, z: p.z }, yaw: entity.getLocalEulerAngles().y, legs: d.character.pose.legs }; };
        return [state(d.player, anchors[0]), state(clone, anchors[1])];
      }, anchors);
      entry.twoAvatars.forEach((state, i) => assertMatchingTreeSeatPose(state, anchors[i]));
      // Static views keep real runtime meshes/materials and pose. Only unrelated
      // actors and HUD are hidden so the independent reviewer can see the fork.
      await page.addStyleTag({ content: 'body > :not(#application):not(script):not(style){visibility:hidden!important}' });
      entry.views = [];
      for (const source of matchingTreeViews()) {
        const view = matchingTreeCamera(source, viewport.width / viewport.height);
        await page.evaluate(view => {
          const d = window.__INHAGAME_P0__, camera = d.app.root.findByName('Camera');
          for (const actor of d.app.root.find(e => e.name?.startsWith('inkyung_duck_') || e.name?.startsWith('NPC_TEST_HUMAN_'))) actor.enabled = false;
          d.player.enabled = window.__matchingTreeSecondAvatar.enabled = view.id === 'two-seats';
          camera.camera.fov = 56; camera.camera.nearClip = .3; camera.camera.farClip = 600;
          camera.setPosition(view.from[0], view.from[1], -view.from[2]); camera.lookAt(view.target[0], view.target[1], -view.target[2]); d.app.root.syncHierarchy();
        }, view);
        const initial = await frame(page), stable = await frame(page, 'compare');
        assert.equal(initial.glError, 0); assert.equal(initial.contextLost, false); assert.equal(stable.changed, 0);
        const projected = await projectedTargets(page); assertMatchingTreeFraming(projected, viewport);
        const shot = await screenshot(page, `${name}-${view.id}`);
        await page.evaluate(() => { window.__matchingTreeOwner.enabled = false; }); const hidden = await frame(page, 'compare');
        assert.ok(hidden.changed > 30, 'The tree must contribute actual visible pixels');
        await page.evaluate(() => { window.__matchingTreeOwner.enabled = true; }); const restored = await frame(page, 'compare');
        assert.equal(restored.changed, 0, 'Tree visibility round trip restores the original image');
        entry.views.push({ view, initial, stable, projected, visibleTreePixels: hidden.changed, restored, screenshot: shot });
      }
      assert.deepEqual(smoke.problems, []); entry.passed = true;
    } finally { await smoke.close(); }
  }
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.stack || String(error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
