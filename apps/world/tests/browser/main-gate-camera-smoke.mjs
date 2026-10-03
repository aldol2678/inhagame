// Offline real-renderer gate replay; no backend requests or production writes.
// WORLD_GATE_QA_OUTPUT may select a directory for the fixed vista screenshots.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

async function captureFrame(page, path) {
  // SwiftShader can keep the compositor busy if a large world renders continuously
  // while Chromium captures it. Render the requested state once, then capture the
  // settled buffer; this affects only the offline test page.
  await page.evaluate(() => new Promise(resolve => {
    const app = window.__INHAGAME_P0__.app;
    app.autoRender = false;
    app.once('postrender', () => {
      // postrender queues WebGL commands; finish the requested software-GPU
      // frame before Chromium asks its compositor to copy the canvas.
      app.graphicsDevice.gl?.finish();
      resolve();
    });
    app.renderNextFrame = true;
  }));
  await page.screenshot({ path, timeout: TIMEOUT_MS, animations: 'disabled' });
}

for (const [name, viewport, mobile] of [
  ['portrait', { width: 390, height: 844 }, true],
  ['landscape', { width: 844, height: 390 }, true],
  ['desktop', { width: 1280, height: 720 }, false]
]) {
  const smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile } });
  try {
    const page = await smoke.context.newPage();
    const fatal = smoke.watch(page);
    await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await Promise.race([page.waitForFunction(() => {
      const s = window.__INHAGAME_P0__?.getStatus?.();
      return s?.renderer === 'UNAVAILABLE' || (s?.loading?.finished && s?.characterModel === 'glb');
    }, null, { timeout: TIMEOUT_MS }), fatal]);
    const status = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
    assert.notEqual(status.renderer, 'UNAVAILABLE', status.error);
    assert.equal(status.loading.phase, 'READY');
    assert.equal(status.characterModel, 'glb');
    assert.deepEqual(await page.evaluate(() => {
      const p = window.__INHAGAME_P0__.player.getLocalPosition(); return [p.x, p.y, p.z];
    }), [0, 1.15, -98]);

    const replay = await page.evaluate(async () => {
      const d = window.__INHAGAME_P0__;
      const { moveAroundObstacles, cameraSafeFraction } = await import('/src/world-collision.js');
      const { OBSTACLES } = await import('/src/campus-layout.js');
      const { polygonCameraFraction } = await import('/src/polygon-collision.js');
      const body = OBSTACLES.find(b => b.id === 'bldg_continuing_0');
      const from = [.5, .8, -92.6], pitch = Math.atan2(7.3, 18.5);
      const to = [.5, .8 + Math.sin(pitch) * 1.5, -92.6 - (Math.cos(pitch) * 1.5 - .35)];
      const legacy = polygonCameraFraction(from, to, body), corrected = cameraSafeFraction(from, to);
      // Freeze only the offline test scene's world update callbacks. PlayCanvas still
      // renders; deterministic movement uses the production collision and orbit code.
      d.app.off('update');
      let samples = 0;
      for (const step of [.15, .3]) for (const direction of [1, -1]) {
        let p = { x: 0, y: 1.15, z: direction === 1 ? -98 : -76 };
        while (direction === 1 ? p.z < -76 : p.z > -98) {
          const dz = direction * Math.min(step, Math.abs(p.z - (direction === 1 ? -76 : -98)));
          const next = moveAroundObstacles(p, 0, dz);
          if (Math.abs(next.z - p.z - dz) > 1e-7) throw Error('gate movement blocked');
          p = { ...next, y: 1.15 };
          for (const distance of [1.5, 3.5, 7]) for (const pitch of [-1.25, .12, Math.atan2(7.3, 18.5), 1.2]) for (const yaw of [-.3, 0, .3]) {
            d.orbit.distance = distance; d.orbit.pitch = pitch; d.orbit.yaw = yaw;
            d.player.setLocalPosition(p.x, p.y, p.z);
            d.orbit.apply(p, -.35);
            const eye = d.app.root.findByName('Camera').getPosition();
            if (![eye.x, eye.y, eye.z].every(Number.isFinite) || d.orbit.localVisualOccluded) throw Error('unsafe clear gate camera');
            samples++;
          }
        }
      }
      d.orbit.distance = 3.5; d.orbit.pitch = Math.atan2(7.3, 18.5); d.orbit.yaw = 0;
      return { legacy, corrected, samples };
    });
    assert.equal(replay.legacy, .06); assert.equal(replay.corrected, 1); assert.ok(replay.samples > 15000);
    const terrain = await page.evaluate(async () => {
      const d=window.__INHAGAME_P0__;
      const { MAIN_GATE_TERRAIN_VISTAS: vistas }=await import('/src/main-gate-terrain-layout.js');
      const { roadviewGroundHeight }=await import('/src/roadview-layout.js');
      const { moveAroundObstacles,resolveHeight }=await import('/src/world-collision.js');
      const byId=id=>vistas.find(p=>p.id===id);
      const route=['spawn','before-inner-zebra','after-inner-zebra','gate-opening','central-lawn-axis'].map(byId);
      let samples=0,maxJump=0;
      for(const step of [.15,.3])for(const points of [route,[...route].reverse()]){
        let p={...points[0],y:1.15};
        for(const target of points.slice(1)){
          const start={...p},count=Math.ceil(Math.hypot(target.x-p.x,target.z-p.z)/step);
          for(let i=0;i<count;i++){
            const next=moveAroundObstacles(p,(target.x-start.x)/count,(target.z-start.z)/count);
            const ground=1.15+roadviewGroundHeight(next.x,next.z);
            next.y=resolveHeight(p,ground,ground);maxJump=Math.max(maxJump,Math.abs(next.y-p.y));
            d.player.setLocalPosition(next.x,next.y,next.z);d.orbit.apply(next,d.character.eyeHeight);
            if(!Number.isFinite(next.y)||Math.abs(next.y-1.15)>1e-9)throw Error('gate terrain ground jump');
            p=next;samples++;
          }
          if(Math.hypot(target.x-p.x,target.z-p.z)>.001)throw Error('terrain route blocked: '+target.id);
        }
      }
      return { samples,maxJump,vistas };
    });
    assert.equal(terrain.maxJump,0);assert.ok(terrain.samples>600);
    if (process.env.WORLD_GATE_QA_OUTPUT && name === 'portrait') {
      await mkdir(process.env.WORLD_GATE_QA_OUTPUT, { recursive: true });
      for (const [zoomLabel, evidenceDistance] of [['default', 3.5], ['max', 7]]) {
      const evidence = await page.evaluate(async distance => {
        const d = window.__INHAGAME_P0__, pc = await import('playcanvas');
        // Reconstruct the visible cap from the reported bug case as an offline
        // visual fixture. No account, inventory or production state is changed.
        let cap = d.player.findByName('Equipment_Model_equipment.head.induck_cap.v1');
        let fixtureCap = false;
        if (!cap) {
          const asset = await new Promise((resolve, reject) => d.app.assets.loadFromUrl('/assets/induck-cap-v1.glb', 'container', (error, asset) => error ? reject(error) : resolve(asset)));
          cap = asset.resource.instantiateRenderEntity();
          cap.name = 'Equipment_Model_equipment.head.induck_cap.v1';
          d.character.getEquipmentAnchor('HEAD').addChild(cap);
          fixtureCap = true;
        }
        cap.enabled = true;
        const { cameraSafeFraction } = await import('/src/world-collision.js');
        const { OBSTACLES } = await import('/src/campus-layout.js');
        const { polygonCameraFraction } = await import('/src/polygon-collision.js');
        const p = { x: .5, y: 1.15, z: -92.6 }, from = [.5, .8, -92.6];
        const pitch = Math.atan2(7.3, 18.5);
        const to = [.5, .8 + Math.sin(pitch) * distance, -92.6 - (Math.cos(pitch) * distance - .35)];
        const legacy = cameraSafeFraction(from, to, OBSTACLES), corrected = cameraSafeFraction(from, to);
        const camera = d.app.root.findByName('Camera');
        d.player.setLocalPosition(p.x, p.y, p.z);
        d.orbit.distance = distance; d.orbit.pitch = pitch; d.orbit.yaw = 0;
        d.orbit.apply(p, -.35); d.character.setCameraOccluded(false);
        const fixedPosition = camera.getPosition().clone(), fixedRotation = camera.getRotation().clone();
        camera.setPosition(from[0] + (to[0] - from[0]) * legacy,
          from[1] + (to[1] - from[1]) * legacy, -(from[2] + (to[2] - from[2]) * legacy));
        camera.lookAt(new pc.Vec3(d.orbit.target.x, d.orbit.target.y, -d.orbit.target.z));
        const arrows = d.app.root.findByName('gate_roadview_eeeadd');
        if (!arrows) throw Error('gate arrow evidence mesh is not resident');
        window.__gateEvidence = { cap, duck: d.player.findByName('Induck_GLB_Visual'), arrows, camera, fixedPosition, fixedRotation };
        const names = root => { const out = []; const walk = n => { if (n.render) out.push({ entity: n.name, meshes: n.render.meshInstances.map(mi => ({ mesh: mi.mesh.name, material: mi.material.name })) }); n.children.forEach(walk); }; walk(root); return out; };
        return { player: p, distance, from, to, legacy, corrected, fixtureCap, cap: names(cap), avatar: names(window.__gateEvidence.duck), arrows: names(arrows), phantomBodies: OBSTACLES.filter(b => polygonCameraFraction(from, to, b) < 1).map(b => ({ id: b.id, fraction: polygonCameraFraction(from, to, b) })) };
      }, evidenceDistance);
      const capture = async label => {
        const frame = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
        await page.waitForFunction(before => window.__INHAGAME_P0__.app.frame > before + 2, frame, { timeout: 15000 });
        await captureFrame(page, `${process.env.WORLD_GATE_QA_OUTPUT}/portrait-${zoomLabel}-${label}.png`);
      };
      await capture('legacy-all-visible');
      await page.evaluate(() => { window.__gateEvidence.cap.enabled = false; });
      await capture('legacy-cap-disabled');
      await page.evaluate(() => { const e = window.__gateEvidence; e.cap.enabled = true; e.duck.findByName('beak_orange_smile').enabled = false; });
      await capture('legacy-beak-disabled');
      await page.evaluate(() => { const e = window.__gateEvidence; e.duck.findByName('beak_orange_smile').enabled = true; e.duck.enabled = false; e.cap.enabled = false; });
      await capture('legacy-local-visuals-disabled');
      await page.evaluate(() => { window.__gateEvidence.arrows.enabled = false; });
      await capture('legacy-local-visuals-and-arrows-disabled');
      await page.evaluate(() => { window.__gateEvidence.arrows.enabled = true; });
      await page.evaluate(() => { const e = window.__gateEvidence; e.duck.enabled = true; e.cap.enabled = true; e.camera.setPosition(e.fixedPosition); e.camera.setRotation(e.fixedRotation); });
      await capture('corrected-all-visible');
      await writeFile(`${process.env.WORLD_GATE_QA_OUTPUT}/portrait-${zoomLabel}-evidence.json`, JSON.stringify(evidence, null, 2));
      console.log('main-gate render evidence:', JSON.stringify(evidence));
      await page.evaluate(() => { const e = window.__gateEvidence; e.cap.enabled = false; delete window.__gateEvidence; });
      }
    }
    // These points are test-only. No spawn, editor, GIS, quest or minimap authority changes.
    for(const viewDistance of ['NORMAL','MAX']){
      await page.evaluate(id=>{const e=document.getElementById('view-distance');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));},viewDistance);
      assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.viewSettings.current.id),viewDistance);
    for (const {id:label,x,z} of terrain.vistas) {
      const before = await page.evaluate(({x,z}) => {
        const d = window.__INHAGAME_P0__;
        d.orbit.distance=3.5;d.orbit.pitch=Math.atan2(7.3,18.5);d.orbit.yaw=0;
        d.player.setLocalPosition(x, 1.15, z); d.orbit.apply({ x, y: 1.15, z }, d.character.eyeHeight);
        for(let i=0;i<=d.streaming.registry.chunks.length;i++)d.streaming.update(.05,{x,y:1.15,z});
        return d.app.frame;
      }, {x,z});
      await page.waitForFunction(frame => window.__INHAGAME_P0__.app.frame > frame + 2, before, { timeout: 15000 });
      if (process.env.WORLD_GATE_QA_OUTPUT) {
        await mkdir(process.env.WORLD_GATE_QA_OUTPUT, { recursive: true });
        await captureFrame(page, `${process.env.WORLD_GATE_QA_OUTPUT}/${name}-${viewDistance}-${label}.png`);
      }
    }
    }
    assert.deepEqual(smoke.problems, [], `${name}: browser errors`);
    console.log(`main-gate camera ${name} ${viewport.width}x${viewport.height}: ${replay.samples} deterministic replay samples; renderer ${status.renderer}; PASS`);
    console.log(`main-gate terrain ${name}: ${terrain.samples} walk/RUN roundtrip samples; max ground jump ${terrain.maxJump}; NORMAL/MAX vistas PASS`);
  } finally { await smoke.close(); }
}
