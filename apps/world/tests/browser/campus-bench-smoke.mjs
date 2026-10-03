// Real Campus boot + approved GLB + PlayerController, using the existing offline
// harness. Supabase/API traffic is stubbed; no login, heartbeat or production writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = resolve(process.env.CAMPUS_BENCH_QA_OUTPUT || 'test-results/campus-bench');
await mkdir(output, { recursive: true });
const report = { backend: process.env.WORLD_SMOKE_DISABLE_WEBGPU === '1' ? 'WebGL2' : 'WebGPU', cases: [] };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);

for (const spec of [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile-portrait', width: 390, height: 844, mobile: true },
  { name: 'mobile-landscape', width: 844, height: 390, mobile: true }
]) {
  const smoke = await startSmoke({ viewport: { width: spec.width, height: spec.height },
    contextOptions: { isMobile: spec.mobile, hasTouch: spec.mobile, deviceScaleFactor: 1 } });
  const result = { mode: spec.name, assetResponses: [], warnings: [] };
  report.cases.push(result);
  try {
    const page = await smoke.context.newPage();
    const fatal = smoke.watch(page);
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/assets/prop_bench_campus_001.glb') result.assetResponses.push(response.status());
    });
    page.on('console', message => { if (message.type() === 'warning') result.warnings.push(message.text()); });
    const settled = () => Promise.race([
      page.waitForFunction(() => {
        const status = window.__INHAGAME_P0__?.getStatus?.();
        return status?.renderer === 'UNAVAILABLE' || status?.loading?.finished && status?.campusBench?.state !== 'loading';
      }, null, { timeout: TIMEOUT_MS }), fatal
    ]);
    await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await settled();
    result.boot = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
    result.problems = [...smoke.problems];
    if (result.boot.renderer === 'UNAVAILABLE') await page.screenshot({ path: resolve(output, `${spec.name}-boot-failure.png`) });
    assert.notEqual(result.boot.renderer, 'UNAVAILABLE', `boot failed before bench QA: ${result.boot.error}`);

    const readScene = () => page.evaluate(async () => {
      const { CAMPUS_BENCH_WORLD: world, CAMPUS_BENCH_COLLIDER: box } = await import('/src/campus-bench-layout.js');
      const d = window.__INHAGAME_P0__;
      const entity = d.app.root.findByName('PROP_BENCH_CAMPUS_001');
      const renders = entity?.findComponents('render') ?? [];
      const meshes = renders.flatMap(render => render.meshInstances);
      const bounds = meshes.map(mesh => ({ min: [...mesh.aabb.getMin().toArray()], max: [...mesh.aabb.getMax().toArray()] }));
      const min = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis])));
      const max = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis])));
      const all = root => [root, ...root.children.flatMap(all)];
      return {
        status: d.getStatus().campusBench, renderer: d.getStatus().renderer,
        worldPosition: entity ? [...entity.getPosition().toArray()] : null,
        localPosition: entity ? [...entity.getLocalPosition().toArray()] : null,
        transform: entity ? [...entity.getWorldTransform().data] : [],
        parent: entity?.parent?.name, grandparent: entity?.parent?.parent?.name,
        instances: all(d.app.root).filter(node => node.name === 'PROP_BENCH_CAMPUS_001').length,
        renderComponents: renders.length, meshInstances: meshes.length,
        materials: [...new Set(meshes.map(mesh => mesh.material.name))].sort(),
        min, max, expectedPosition: world.entities[0].transform.position.map(value => value / 2), box,
        assetContainers: d.app.assets.list().filter(asset => asset.type === 'container' && asset.file?.url?.endsWith('/prop_bench_campus_001.glb')).length,
        frame: d.app.frame
      };
    });
    result.initial = await readScene();
    const scene = result.initial;
    assert.equal(scene.renderer, report.backend);
    assert.equal(scene.status.state, 'ready', JSON.stringify(scene.status));
    assert.equal(scene.status.entities, 1);
    assert.deepEqual(scene.status.diagnostics, []);
    assert.equal(scene.instances, 1);
    assert.equal(scene.renderComponents, 2);
    assert.equal(scene.meshInstances, 2);
    assert.deepEqual(scene.materials, ['Bench_Metal', 'Bench_Wood']);
    assert.equal(scene.parent, 'WorldDocument:world.campus-bench-p1');
    assert.equal(scene.grandparent, 'CampusBase');
    assert.equal(scene.assetContainers, 1);
    assert.ok([...scene.transform, ...scene.min, ...scene.max].every(Number.isFinite));
    const [x, y, z] = scene.expectedPosition;
    near(scene.worldPosition[0], x, 'world X'); near(scene.worldPosition[1], y, 'ground origin'); near(scene.worldPosition[2], -z, 'one inherited Z reflection');
    near(scene.max[0] - scene.min[0], .9, 'rendered width');
    near(scene.max[1] - scene.min[1], .4, 'rendered height');
    near(scene.max[2] - scene.min[2], .285, 'rendered depth');
    near(scene.min[1], y, 'feet touch ground');
    near(scene.min[2], -scene.box.maxZ, 'asymmetric depth minimum');
    near(scene.max[2], -scene.box.minZ, 'asymmetric depth maximum');
    assert.deepEqual(result.assetResponses, [200], 'one actual successful GLB request at boot');

    // Exercise the actual PlayerController deterministically in the running
    // browser. Render ticks remain live; only the sampled input steps are fixed.
    result.walk = await page.evaluate(async () => {
      const { CAMPUS_BENCH_COLLIDER: b } = await import('/src/campus-bench-layout.js');
      const { WALK_SHAPE, PLAYER_ORIGIN_Y } = await import('/src/player-dimensions.js');
      const d = window.__INHAGAME_P0__, c = d.controller;
      const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      const samples = [];
      for (const [side, px, pz, key, axis, edge, retreat] of [
        ['left', b.minX - 1, z, 'KeyD', 'x', b.minX - WALK_SHAPE.radius, 'KeyA'],
        ['right', b.maxX + 1, z, 'KeyA', 'x', b.maxX + WALK_SHAPE.radius, 'KeyD'],
        ['backrest', x, b.minZ - 1, 'KeyW', 'z', b.minZ - WALK_SHAPE.radius, 'KeyS'],
        ['front', x, b.maxZ + 1, 'KeyS', 'z', b.maxZ + WALK_SHAPE.radius, 'KeyW']
      ]) {
        c.keys.clear(); c.assist = null; c.velocityY = 0; c.grounded = true;
        d.player.setLocalPosition(px, PLAYER_ORIGIN_Y, pz);
        c.keys.add(key);
        for (let i = 0; i < 60; i++) c.update(1 / 60, 0);
        const hit = d.player.getLocalPosition()[axis];
        c.keys.clear(); c.keys.add(retreat);
        for (let i = 0; i < 10; i++) c.update(1 / 60, 0);
        samples.push({ side, hit, edge, retreatDistance: Math.abs(d.player.getLocalPosition()[axis] - hit) });
      }
      c.keys.clear(); c.velocityY = 0;
      d.player.setLocalPosition(x + 1.4, PLAYER_ORIGIN_Y, z - 1.2);
      d.orbit.yaw = Math.atan2(1.4, 1.2); d.orbit.pitch = .35; d.orbit.distance = 2;
      return { samples, positionedFrame: d.app.frame };
    });
    for (const walk of result.walk.samples) {
      assert.ok(Math.abs(walk.hit - walk.edge) < 2e-5, `${walk.side} stops at the polygon separation epsilon`);
      assert.ok(walk.retreatDistance > .3, `${walk.side} can back away`);
    }
    const waitFrames = frame => page.waitForFunction(value => window.__INHAGAME_P0__.app.frame > value + 2, frame, { timeout: TIMEOUT_MS });
    await waitFrames(result.walk.positionedFrame);
    result.visibility = await page.evaluate(async () => {
      const pc = await import('playcanvas');
      const d = window.__INHAGAME_P0__, e = d.app.root.findByName('PROP_BENCH_CAMPUS_001');
      const meshes = e.findComponents('render').flatMap(render => render.meshInstances);
      const points = meshes.flatMap(mesh => {
        const min = mesh.aabb.getMin().clone(), max = mesh.aabb.getMax().clone();
        return [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => d.orbit.camera.camera.worldToScreen(new pc.Vec3(x, y, z)))));
      });
      const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x))));
      const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))));
      const right = Math.min(innerWidth, Math.ceil(Math.max(...points.map(p => p.x))));
      const bottom = Math.min(innerHeight, Math.ceil(Math.max(...points.map(p => p.y))));
      d.app.timeScale = 0;
      return { visibleMeshes: meshes.filter(mesh => mesh.visibleThisFrame).length, crop: { x: left, y: top, width: right - left, height: bottom - top } };
    });
    assert.equal(result.visibility.visibleMeshes, 2, 'both actual mesh instances reached the renderer');
    assert.ok(result.visibility.crop.width > 10 && result.visibility.crop.height > 5, 'bench projects to a visible on-screen region');
    const hiddenFrame = await page.evaluate(() => {
      const d = window.__INHAGAME_P0__; d.app.root.findByName('PROP_BENCH_CAMPUS_001').enabled = false; return d.app.frame;
    });
    await waitFrames(hiddenFrame);
    const hidden = await page.screenshot();
    const visibleFrame = await page.evaluate(() => {
      const d = window.__INHAGAME_P0__; d.app.root.findByName('PROP_BENCH_CAMPUS_001').enabled = true; return d.app.frame;
    });
    await waitFrames(visibleFrame);
    const visible = await page.screenshot({ path: resolve(output, `${spec.name}.png`) });
    result.visibility.changedPixels = await page.evaluate(async ({ hidden, visible, crop }) => {
      const pixels = async encoded => {
        const img = new Image(); img.src = `data:image/png;base64,${encoded}`; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return ctx.getImageData(crop.x, crop.y, crop.width, crop.height).data;
      };
      const [a, b] = await Promise.all([pixels(hidden), pixels(visible)]);
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) changed++;
      window.__INHAGAME_P0__.app.timeScale = 1;
      return changed;
    }, { hidden: hidden.toString('base64'), visible: visible.toString('base64'), crop: result.visibility.crop });
    assert.ok(result.visibility.changedPixels > 25, 'bench on/off changes visible framebuffer pixels inside its projected bounds');

    // Force real chunk eviction/reentry; BASE holds exactly the same bench and
    // registry resource while streamed near/detail roots are destroyed/rebuilt.
    result.streaming = await page.evaluate(async () => {
      const d = window.__INHAGAME_P0__, before = d.app.root.findByName('PROP_BENCH_CAMPUS_001');
      d.streaming.update(1, { x: 10000, z: 10000 });
      const away = d.streaming.getMetrics();
      const p = before.getPosition();
      d.streaming.update(1, { x: p.x, z: -p.z });
      return { sameEntity: before === d.app.root.findByName('PROP_BENCH_CAMPUS_001'), away, back: d.streaming.getMetrics() };
    });
    assert.equal(result.streaming.sameEntity, true);
    assert.ok(result.streaming.away.chunkDestroys > 0);
    assert.equal((await readScene()).instances, 1);
    assert.equal(result.assetResponses.length, 1, 'streaming does not refetch the bench');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await settled();
    result.reload = await readScene();
    assert.equal(result.reload.status.state, 'ready');
    assert.equal(result.reload.instances, 1);
    assert.equal(result.reload.assetContainers, 1);
    result.problems = [...smoke.problems];
    assert.deepEqual(result.problems, []);
    assert.ok(result.warnings.every(warning => !/campus.bench|PROP_BENCH|prop_bench/i.test(warning)), 'no bench-related console warnings');
    result.pass = true;
    console.log(`campus bench ${spec.name}: PASS`, JSON.stringify(result));
  } catch (error) {
    result.problems = [...smoke.problems];
    result.error = String(error?.stack ?? error);
    throw error;
  } finally {
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await smoke.close();
  }
}
