// Offline, real-renderer integration smoke. No accounts, rewards, production or uploads.
// Uses the committed offline harness; only the main.js clock-construction expression
// is replaced in the test response so localhost exercises the production clock consumer.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { NPC_WORLD_EPOCH_MS } from '../../npc-factory/npc-world-time-contract.mjs';

const output = resolve(process.env.WORLD_GRAPHICS_QA_OUTPUT || 'graphics-parallel-artifacts');
await mkdir(output, { recursive: true });
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exactHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const receipt = { schema: 'graphics-parallel-smoke-v1', exactHead,
  measurementClass: 'CI_BROWSER_SURROGATE', realDevice: false, screenshots: [], checks: {},
  note: 'Real app with offline backend and injected fixed world clock. Not mobile GPU, battery or thermal evidence.' };
let smoke = null, page;
const wait = predicate => page.waitForFunction(predicate, null, { timeout: TIMEOUT_MS });
const graphics = () => page.evaluate(() => window.__INHAGAME_P0__.getStatus().graphics);
async function shot(name) {
  // Observe a completed postrender after state changes, not a stale pre-toggle canvas.
  await page.evaluate(() => new Promise((resolve,reject) => {
    const app=window.__INHAGAME_P0__?.app;if(!app)return resolve();
    let timer;
    const rendered=()=>{clearTimeout(timer);app.graphicsDevice.gl?.finish();resolve();};
    timer=setTimeout(()=>{app.off('postrender',rendered);reject(Error('screenshot render barrier timed out'));},15000);
    app.once('postrender',rendered);app.renderNextFrame=true;
  }));
  // Full live canvas capture, not a generated reference image or NullGraphics output.
  await page.screenshot({ path: `${output}/${name}.png`, timeout: TIMEOUT_MS });
  receipt.screenshots.push(`${name}.png`);
}
async function openSettings() {
  if (!(await page.locator('#view-settings').isVisible())) {
    await page.locator('#hud-menu-toggle').click();
    await page.locator('#open-settings').click();
  }
}
async function verifyMovementRestored(label) {
  const beforeFocus = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().inputFocus);
  assert.equal(beforeFocus.owners.viewSettings, false, 'settings owner released');
  assert.ok(!beforeFocus.topOwners.includes('view-settings'));
  assert.equal(beforeFocus.movement, true, JSON.stringify(beforeFocus));
  assert.equal(beforeFocus.owners.lobbyWorld, false, 'fixture must not be in lobby');
  // The canonical gate-spawn corridor is covered by main-gate-camera-smoke.
  // Do not release focus tokens or enable input here: either would hide the regression.
  const saved = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
    if (d.controller.mounted || !d.controller.inputEnabled) throw Error('movement fixture not walking/input-enabled');
    const state = { x:p.x, y:p.y, z:p.z, yaw:d.orbit.yaw };
    d.player.setLocalPosition(0,1.15,-98); d.orbit.yaw = 0;
    d.controller.velocityY = 0; d.controller.grounded = true;
    return state;
  });
  let moved;
  try {
    await page.locator('#application').focus();
    await page.keyboard.down('w');
    await page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition();
      return d.controller.keys.has('KeyW') && Math.hypot(p.x,p.z+98) > .2;
    }, null, { timeout: TIMEOUT_MS });
    moved = await page.evaluate(() => {
      const d=window.__INHAGAME_P0__,p=d.player.getLocalPosition();
      return {x:p.x,y:p.y,z:p.z,input:d.getStatus().inputFocus};
    });
  } finally {
    await page.keyboard.up('w');
    await page.evaluate(p => { const d=window.__INHAGAME_P0__;
      d.player.setLocalPosition(p.x,p.y,p.z); d.orbit.yaw=p.yaw;
      d.controller.velocityY=0; d.controller.touchVector={x:0,y:0};
    }, saved);
  }
  assert.ok(Math.hypot(moved.x,moved.z+98) > .2, 'native keyboard moves player');
  (receipt.checks.inputRestoration ??= []).push({label,beforeFocus,moved});
}
async function contactGardenShots() {
  const view = await page.evaluate(async () => {
    const {GARDEN_BENCHES,GARDEN_FLOOR}=await import('/src/library-garden-layout.js');
    const pc=await import('playcanvas'),d=window.__INHAGAME_P0__;
    const bench=GARDEN_BENCHES[0]; if(!bench) throw Error('canonical garden bench missing');
    const camera=d.app.root.findByName('Camera'),p=d.player.getLocalPosition();
    window.__GRAPHICS_QA_CONTACT_SAVED__={player:[p.x,p.y,p.z],playerEnabled:d.player.enabled,
      cameraEnabled:camera.camera.enabled,contactEnabled:window.__INHAGAME_CONTACT_SHADING__.status().enabled};
    d.player.setLocalPosition(bench.center.x,1.1,bench.center.z);
    for(let i=0;i<8;i++)d.streaming.update(.3,bench.center);
    d.player.enabled=false;camera.camera.enabled=false;
    const qaCamera=new pc.Entity('GraphicsContactQaCamera');
    qaCamera.addComponent('camera',{nearClip:.05,farClip:400,fov:45,clearColor:new pc.Color(.52,.71,.84)});
    qaCamera.camera.toneMapping=pc.TONEMAP_NEUTRAL;d.app.root.addChild(qaCamera);
    qaCamera.setPosition(bench.center.x+3,GARDEN_FLOOR+3,-bench.center.z-3);
    qaCamera.lookAt(new pc.Vec3(bench.center.x,GARDEN_FLOOR,-bench.center.z));
    window.__INHAGAME_CONTACT_SHADING__.setEnabled(true);
    return {benchId:bench.id,center:bench.center,floor:GARDEN_FLOOR};
  });
  try {
    await wait(() => window.__INHAGAME_CONTACT_SHADING__.status().activeMeshes > 0);
    const contact=await page.evaluate(() => window.__INHAGAME_CONTACT_SHADING__.status());
    assert.equal(contact.snow,0,'fixed initial mock clock must leave garden contacts visible');
    const base=contact.batches.find(b=>b.name==='campus_contact_base');
    assert.ok(base?.enabled && base.opacity>0,'garden/base contact must be visible');
    assert.ok(base.sources.some(source=>source.id===view.benchId && source.receivers.includes('garden')),
      'rendered contact batch contains the exact garden bench receiver');
    assert.ok(contact.activeMeshes>0); assert.ok(contact.meshes<=contact.budget.meshes);
    assert.ok(contact.triangles<=contact.budget.totalTriangles);
    assert.ok(contact.bufferBytes<=contact.budget.bufferBytes);
    const cameraState=()=>page.evaluate(()=>{
      const c=window.__INHAGAME_P0__.app.root.findByName('GraphicsContactQaCamera');
      const p=c.getPosition(),q=c.getRotation();return [p.x,p.y,p.z,q.x,q.y,q.z,q.w];
    });
    const onCamera=await cameraState(); await shot('contact-garden-enabled');
    await page.evaluate(()=>window.__INHAGAME_CONTACT_SHADING__.setEnabled(false));
    assert.equal(await page.evaluate(()=>window.__INHAGAME_CONTACT_SHADING__.status().activeMeshes),0);
    await shot('contact-garden-disabled');
    assert.deepEqual(await cameraState(),onCamera,'contact on/off uses identical camera');
    receipt.checks.contact={view,contact,camera:onCamera};
  } finally {
    await page.evaluate(()=>{
      const d=window.__INHAGAME_P0__,s=window.__GRAPHICS_QA_CONTACT_SAVED__;
      d.app.root.findByName('GraphicsContactQaCamera')?.destroy();
      d.app.root.findByName('Camera').camera.enabled=s.cameraEnabled;
      d.player.enabled=s.playerEnabled;d.player.setLocalPosition(...s.player);
      d.controller.velocityY=0;
      for(let i=0;i<8;i++)d.streaming.update(.3,d.player.getLocalPosition());
      window.__INHAGAME_CONTACT_SHADING__.setEnabled(s.contactEnabled);
      delete window.__GRAPHICS_QA_CONTACT_SAVED__;
    });
    assert.equal(await page.evaluate(()=>!!window.__INHAGAME_P0__.app.root.findByName('GraphicsContactQaCamera')),false);
  }
}
async function clockAt(minute) {
  await page.evaluate(({ epoch, minute }) => { window.__GRAPHICS_QA_CLOCK__.nowMs = epoch + minute * 60_000; },
    { epoch: NPC_WORLD_EPOCH_MS, minute });
  await page.waitForFunction(value => {
    const s = window.__INHAGAME_ENVIRONMENT__.status();
    return Math.abs(s.worldCycleSeconds - value * 60) < .001 && s.settled && s.weatherSettled;
  }, minute, { timeout: TIMEOUT_MS });
  return page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.status());
}
async function renderedSample() {
  return page.evaluate(() => new Promise(resolve => {
    const app = window.__INHAGAME_P0__.app;
    const intervals = []; let previous = null, updates = 0, renders = 0;
    const start = performance.now();
    const update = () => { updates++; };
    const render = () => { const now = performance.now(); renders++;
      if (previous !== null) intervals.push(now - previous); previous = now; };
    app.on('update', update); app.on('postrender', render);
    setTimeout(() => { app.off('update', update); app.off('postrender', render);
      const elapsedMs = performance.now() - start;
      const sorted = [...intervals].sort((a,b) => a-b);
      resolve({ updates, renders, elapsedMs, renderedFps: renders * 1000 / elapsedMs,
        intervals, p50Ms: sorted[Math.floor(sorted.length * .5)] ?? null,
        p95Ms: sorted[Math.min(sorted.length-1, Math.ceil(sorted.length * .95)-1)] ?? null });
    }, 2500);
  }));
}
try {
  if (process.env.EXPECTED_GRAPHICS_HEAD) assert.equal(receipt.exactHead, process.env.EXPECTED_GRAPHICS_HEAD, 'exact PR head');
  smoke = await startSmoke({ viewport: { width: 1280, height: 720 } });
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const needle = 'const worldClock = previewHost ? null : createNpcWorldClock();';
  assert.equal(main.split(needle).length, 2, 'test-only clock seam must match exactly once');
  await smoke.context.route('**/src/main.js', route => route.fulfill({ status: 200,
    contentType: 'text/javascript', body: main.replace(needle, 'const worldClock = window.__GRAPHICS_QA_CLOCK__;') }));
  await smoke.context.addInitScript(({ epoch }) => {
    window.__GRAPHICS_QA_CLOCK__ = {
      nowMs: epoch + 10 * 60_000,
      now() { return this.nowMs; },
      async sync() { return this.status(); }, refreshIfDue() {}, dispose() {},
      status() { return { state: 'SYNCED', serverNowMs: this.nowMs, ageMs: 0, rttMs: 0, lastError: null }; }
    };
  }, { epoch: NPC_WORLD_EPOCH_MS });
  page = await smoke.context.newPage(); smoke.watch(page);
  await page.bringToFront();
  await page.goto(`${smoke.origin}/campus/?biryongVisual=p0e`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await wait(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished);
  receipt.renderer = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer);
  assert.ok(['WebGPU', 'WebGL2'].includes(receipt.renderer));
  await openSettings();
  const initialView = await page.locator('#view-distance').inputValue();
  await page.locator('#graphics-quality').selectOption('high');
  await page.locator('#graphics-render-scale').selectOption('0.7');
  await page.locator('#graphics-shadows').selectOption('off');
  await page.locator('#graphics-frame-limit').selectOption('30');
  await page.locator('#graphics-show-fps').check();
  await wait(() => window.__INHAGAME_P0__.getStatus().graphics.frameLimit === 30);
  const detail = await graphics();
  assert.equal(detail.preference, 'high'); assert.equal(detail.renderScale, .7);
  assert.equal(detail.shadows, 'off'); assert.equal(detail.castShadows, false); assert.equal(detail.showFps, true);
  assert.equal(await page.locator('#view-distance').inputValue(), initialView);
  const width70 = await page.locator('#application').evaluate(el => el.width);
  await page.locator('#graphics-render-scale').selectOption('1');
  await page.waitForFunction(width => document.getElementById('application').width > width,
    width70, { timeout: TIMEOUT_MS });
  await page.locator('#graphics-shadows').selectOption('medium');
  assert.equal((await graphics()).shadowResolution, 1024);
  assert.equal((await graphics()).castShadows, true);
  await wait(() => /^\d+ FPS$/.test(document.getElementById('graphics-fps').textContent));
  assert.equal(await page.locator('#graphics-fps').isVisible(), true);
  receipt.checks.settings = { detail, width70, width100: await page.locator('#application').evaluate(el => el.width) };
  await shot('settings-ui-fps');
  await page.locator('#close-settings').click();
  await verifyMovementRestored('after-detail-controls');
  const pacing = await renderedSample();
  assert.ok(pacing.renders > 2, 'need actual rendered frames');
  assert.ok(pacing.updates >= pacing.renders, 'pacing must not stop simulation updates');
  assert.ok(pacing.renderedFps <= 34, '30 FPS ceiling with scheduling tolerance');
  receipt.checks.framePacing = pacing;

  // Test actual persisted UI details, then clear only this disposable context's graphics settings.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await wait(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished);
  assert.equal((await graphics()).frameLimit, 30); assert.equal((await graphics()).renderScale, 1);
  assert.equal((await graphics()).showFps, true);
  await openSettings(); await page.locator('#graphics-reset').click();
  const reset = await graphics();
  assert.equal(reset.preference, 'auto'); assert.equal(reset.frameLimit, 'auto');
  assert.equal(reset.renderScale, 'auto'); assert.equal(reset.shadows, 'auto'); assert.equal(reset.showFps, false);
  await page.locator('#graphics-quality').selectOption('high');
  await page.locator('#close-settings').click();

  await verifyMovementRestored('after-reset-and-quality');
  await contactGardenShots();

  const morning = await clockAt(10), noon = await clockAt(20);
  assert.equal(morning.lightingMode, 'world'); assert.equal(noon.lightingMode, 'world');
  assert.notEqual(morning.exposure, noon.exposure, 'DAY period lighting must evolve continuously');
  const left = await clockAt(29.999), right = await clockAt(30.001);
  assert.ok(Math.abs(left.exposure-right.exposure) < .005, 'no daylight anchor exposure jump');
  await shot('continuous-daylight');
  receipt.checks.daylight = { morning, noon, left, right };

  // Region transition and clock changes while inside must restore the current environment.
  const campusPresentation=await page.evaluate(()=>({canvasFilter:document.getElementById('application').style.filter,
    toneMapping:window.__INHAGAME_P0__.app.root.findByName('Camera').camera.toneMapping}));
  assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.biryongRealm.enter()), true);
  await wait(() => window.__INHAGAME_P0__.biryongRealm.inBiryong && !window.__INHAGAME_P0__.biryongRealm.busy);
  await wait(() => window.__INHAGAME_BIRYONG_VISUAL_LAB__.status().active && window.__INHAGAME_BIRYONG_ATMOSPHERE__.status().active);
  await shot('biryong-enter-day');
  await clockAt(65);
  await wait(() => window.__INHAGAME_BIRYONG_ATMOSPHERE__.status().profile?.targetTime === 'NIGHT');
  await shot('biryong-night');
  const inside = await page.evaluate(() => ({ lighting: window.__INHAGAME_BIRYONG_VISUAL_LAB__.status(),
    atmosphere: window.__INHAGAME_BIRYONG_ATMOSPHERE__.status(), density: window.__INHAGAME_BIRYONG_DENSITY__.status() }));
  assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.biryongRealm.returnToCampus()), true);
  await wait(() => window.__INHAGAME_P0__.biryongRealm.inCampus && !window.__INHAGAME_P0__.biryongRealm.busy);
  await wait(() => !window.__INHAGAME_BIRYONG_VISUAL_LAB__.status().active && !window.__INHAGAME_BIRYONG_ATMOSPHERE__.status().active);
  const restored = await page.evaluate(() => ({ environment: window.__INHAGAME_ENVIRONMENT__.status(),
    sceneExposure: window.__INHAGAME_P0__.app.scene.exposure,
    canvasFilter: document.getElementById('application').style.filter,
    toneMapping:window.__INHAGAME_P0__.app.root.findByName('Camera').camera.toneMapping }));
  assert.equal(restored.environment.targetTime, 'NIGHT');
  assert.ok(Math.abs(restored.sceneExposure-restored.environment.exposure) < 1e-6, 'restore live night exposure, not entry daylight');
  assert.equal(restored.canvasFilter,campusPresentation.canvasFilter,'restore campus CSS filter');
  assert.equal(restored.toneMapping,campusPresentation.toneMapping,'restore campus tone mapping');
  await shot('campus-return-night');
  receipt.checks.biryong = { inside, restored };
  assert.deepEqual(smoke.problems, []);
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.error = error.stack || String(error);
  if (page) { try { await shot('failure'); } catch (captureError) { receipt.captureError = String(captureError); } }
  throw error;
} finally {
  receipt.problems = [...(smoke?.problems ?? [])];
  await writeFile(`${output}/report.json`, JSON.stringify(receipt, null, 2));
  await smoke?.close();
}
console.log(`graphics parallel smoke: PASS (${output})`);
