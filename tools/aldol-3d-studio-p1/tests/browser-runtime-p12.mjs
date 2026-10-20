import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { runtimeFixture } from './runtime-fixture.mjs';
import { startSmoke, TIMEOUT_MS } from '../../../apps/world/tests/browser/harness.mjs';

const output = 'test-results/aldol-studio-p1-2';
await mkdir(output, { recursive: true });
const report = { environment: 'local offline full INHA WORLD campus; PlayCanvas 2.22.4; Chromium; WebGL2 SwiftShader', checks: [], physicalDevices: 'BLOCKED: no connected device/provider credentials' };
const pass = (name, evidence = {}) => { report.checks.push({ name, status: 'PASS', ...evidence }); console.log('PASS', name, JSON.stringify(evidence)); };
const near = (actual, expected) => expected.forEach((n, i) => assert.ok(Math.abs(actual[i] - n) < 1e-5, `${actual} != ${expected}`));
const { text, world } = await runtimeFixture();
await writeFile(`${output}/runtime.world.json`, text);
pass('adapter export, real serializer roundtrip, unknown data, undo/redo, committed world preservation');
process.env.WORLD_SMOKE_DISABLE_WEBGPU = '1';
const smoke = await startSmoke();
let page;
try {
  page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  // A new disposable browser context, loopback origin. Existing/production DBs are never accessed.
  await page.goto(`${smoke.origin}/src/editor/fixtures/minimal.world.json`);
  await page.evaluate(async text => {
    const { EditorBrowserStore } = await import('/src/editor/editor-browser-store.js');
    const store = await EditorBrowserStore.open();
    await store.writeCanonicalVerified(JSON.parse(text).worldId, text);
    store.database.close();
  }, text);
  await page.goto(`${smoke.origin}/campus/?editorWorld=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await Promise.race([page.waitForFunction(() => {
    const s = window.__INHAGAME_P0__?.getStatus();
    return s?.renderer === 'UNAVAILABLE' || (s?.loading?.finished && s?.editorWorld?.state !== 'loading');
  }, null, { timeout: TIMEOUT_MS }), fatal]);
  const status = await page.evaluate(() => {
    const s = window.__INHAGAME_P0__.getStatus();
    return { renderer: s.renderer, loading: s.loading, editorWorld: s.editorWorld };
  });
  assert.equal(status.renderer, 'WebGL2');
  assert.equal(status.loading.finished, true);
  assert.equal(status.editorWorld.worldId, world.worldId);
  assert.equal(status.editorWorld.entities, world.entities.length);
  assert.equal(status.editorWorld.state, 'ready-with-warnings');
  assert.deepEqual(status.editorWorld.diagnostics.map(d => d.code), ['R_UNKNOWN_COMPONENT']);
  pass('actual main.js editorWorld boot and expected unknown-component diagnostic', status);
  const observed = await page.evaluate(worldId => {
    const app = window.__INHAGAME_P0__.app;
    const root = app.root.findByName(`WorldDocument:${worldId}`);
    const vec = v => [v.x, v.y, v.z];
    return { rootScale: vec(root.getLocalScale()), campusScale: vec(root.parent.getLocalScale()), frame: app.frame,
      entities: root.find(node => node.name.startsWith('P12 ')).map(e => ({ name: e.name, parent: e.parent.name,
        position: vec(e.getLocalPosition()), worldPosition: vec(e.getPosition()), scale: vec(e.getLocalScale()),
        rotation: [...vec(e.getLocalRotation()), e.getLocalRotation().w], enabled: e.enabled,
        renderCount: e.findComponents('render').length })) };
  }, world.worldId);
  near(observed.rootScale, [.5, .5, .5]);
  near(observed.campusScale, [1, 1, -1]);
  for (const source of world.entities) {
    const actual = observed.entities.find(e => e.name === source.name);
    assert.ok(actual, source.name);
    near(actual.position, source.transform.position); near(actual.scale, source.transform.scale); near(actual.rotation, source.transform.rotation);
    assert.equal(actual.parent, source.parentId ? world.entities.find(e => e.id === source.parentId).name : `WorldDocument:${world.worldId}`);
  }
  near(observed.entities.find(e => e.name === 'P12 child').worldPosition, [8, 4, -2]);
  assert.equal(observed.entities.find(e => e.name === 'P12 disabled').enabled, false);
  assert.equal(observed.entities.find(e => e.name === 'P12 disabled child').enabled, false);
  assert.equal(observed.entities.find(e => e.name === 'P12 visible').renderCount, 1);
  await page.waitForFunction(frame => window.__INHAGAME_P0__.app.frame > frame + 2, observed.frame);
  pass('real pc.Entity hierarchy, local quaternion/scale, world meters/Z conversion and inherited visibility', observed);
  await page.screenshot({ path: `${output}/campus-runtime.png` });

  // Isolate fixture pixels inside the already running game Application. This is not the Studio renderer.
  await page.evaluate(async worldId => {
    const pc = await import('playcanvas');
    const app = window.__INHAGAME_P0__.app;
    const root = app.root.findByName(`WorldDocument:${worldId}`);
    const camera = new pc.Entity('P12 evidence camera');
    camera.addComponent('camera', { priority: 100, clearColor: new pc.Color(.05, .08, .12), farClip: 100 });
    camera.setPosition(6, 5, 9); camera.lookAt(0, .5, 0); app.root.addChild(camera);
    const layer = new pc.Layer({ name: 'P12 evidence only' });
    app.scene.layers.push(layer); camera.camera.layers = [layer.id];
    const meshes = root.findComponents('render').filter(r => r.entity.enabled).flatMap(r => r.meshInstances);
    layer.addMeshInstances(meshes);
    window.__p12 = { root, layer, meshes, camera, frame: app.frame };
  }, world.worldId);
  // Keep moving HTML HUD/name labels out of the pixel comparison.
  await page.addStyleTag({ content: 'body * { visibility:hidden !important } #application { visibility:visible !important }' });
  const capture = async enabled => {
    const frame = await page.evaluate(enabled => {
      const p = window.__p12; enabled ? p.layer.addMeshInstances(p.meshes) : p.layer.removeMeshInstances(p.meshes);
      return window.__INHAGAME_P0__.app.frame;
    }, enabled);
    await page.waitForFunction(frame => window.__INHAGAME_P0__.app.frame > frame + 2, frame);
    return page.locator('#application').screenshot();
  };
  const before = await capture(false), after = await capture(true);
  await writeFile(`${output}/playcanvas-before.png`, before); await writeFile(`${output}/playcanvas-after.png`, after);
  const changedPixels = await page.evaluate(async ([a, b]) => {
    async function pixels(s) { const image = await createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, c.width, c.height).data; }
    const x = await pixels(a), y = await pixels(b); let count = 0;
    for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]) > 30) count++;
    return count;
  }, [before.toString('base64'), after.toString('base64')]);
  assert.ok(changedPixels > 1000, `Only ${changedPixels} changed pixels`);
  pass('actual game PlayCanvas rendered fixture pixels', { changedPixels });
  const stored = await page.evaluate(async () => {
    const { EditorBrowserStore } = await import('/src/editor/editor-browser-store.js');
    const store = await EditorBrowserStore.open(); const text = await store.readLatestCanonical(); store.database.close(); return text;
  });
  assert.equal(stored, text);
  assert.deepEqual(smoke.problems, []);
  pass('runtime leaves serialized source intact; no page/console/same-origin HTTP errors');
} catch (error) {
  report.checks.push({ name: 'runtime execution', status: 'FAIL', error: String(error), problems: smoke.problems });
  if (page) await page.screenshot({ path: `${output}/runtime-failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/runtime-report.json`, JSON.stringify(report, null, 2));
  await smoke.close();
}
