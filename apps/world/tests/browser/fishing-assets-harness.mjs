import * as pc from 'playcanvas';
import { createCharacter } from '/src/character-model.js';
import { createFishingRenderer } from '/src/activity/fishing-renderer.js';
import { FISHING_ASSETS, fishingWaterTarget } from '/src/activity/fishing-visuals.js';
import { FISHING_SPOTS } from '/src/activity/fishing-spots.js';
import { PLAYER_ORIGIN_Y } from '/src/player-dimensions.js';
import { createFishingFixture, pixelEvidence, FISHING_AVATAR_PROXY } from './fishing-assets-fixture.mjs';

const qa = window.__FISHING_ASSETS_QA__ = { ready: false };
try {
  const canvas = document.getElementById('stage');
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  app.autoRender = false; app.scene.ambientLight = new pc.Color(.7, .7, .7);
  const root = new pc.Entity('SyntheticCampusCoordinateFrame'); root.setLocalScale(1, 1, -1); app.root.addChild(root);
  const player = new pc.Entity('SyntheticPlayer'); root.addChild(player);
  const character = createCharacter(app, player);
  await character.ready;
  character.update(0, { mounted: false, moving: false, grounded: true });
  const anchors = { anchor: slot => character.getEquipmentAnchor(slot) };
  if (character.modelState !== 'glb') throw Error('Public QA cuboid proxy GLB did not load through createCharacter');
  const primitive = (name, type, parent, at, scale, color) => {
    const e = new pc.Entity(name); parent.addChild(e); e.addComponent('render', { type, castShadows: false, receiveShadows: false });
    e.setLocalPosition(...at); e.setLocalScale(...scale);
    const material = new pc.StandardMaterial(); material.diffuse.set(...color); material.update(); e.render.material = material;
    return e;
  };
  // Existing synthetic wardrobe object remains under the real production ACCESSORY anchor.
  const wardrobe = primitive('ExistingWardrobeSentinel', 'sphere', anchors.anchor('ACCESSORY'), [-.23, 0, 0], [.12, .12, .12], [.94, .14, .6]);
  const water = primitive('DiagnosticWaterOnly', 'plane', root, [0, 0, 0], [8, 1, 8], [.06, .28, .38]);
  const shore = primitive('DiagnosticShoreOnly', 'box', root, [0, -.05, 0], [1.2, .08, 1.2], [.42, .4, .3]);
  const camera = new pc.Entity('DiagnosticCamera'); app.root.addChild(camera);
  camera.addComponent('camera', { projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: 2, nearClip: .01, farClip: 100,
    clearColor: new pc.Color(.09, .16, .23) });
  const sun = new pc.Entity('Sun'); app.root.addChild(sun); sun.addComponent('light', { type: 'directional', intensity: 1.2, castShadows: false });
  sun.setLocalEulerAngles(45, 25, 0);
  const fixture = createFishingFixture(), cacheRefs = new Map();
  let overview = null;
  let presentation = null, spot = null, pendingHook = null, capturing = false, omitted = null, pendingFrame = false, lines = [], wardrobeMatrix = null;
  const modelName = key => ['rod', 'float', 'fish'].includes(key) ? `Equipment_Model_${key}` : `Fishing_${key === 'ripple' ? 'Ripple' : 'Splash'}`;
  const entity = key => root.findByName(modelName(key));
  const meshes = e => e?.findComponents('render').flatMap(r => r.meshInstances) ?? [];
  const drawLine = app.drawLine.bind(app);
  // Keep only the current requested diagnostic frame's immediate line. Endpoints/color remain production-authored.
  app.drawLine = (a, b, ...args) => {
    if (!capturing) return;
    lines.push({ from: a.toArray(), to: b.toArray(), submitted: omitted !== 'line' });
    if (omitted !== 'line') drawLine(a, b, ...args);
  };
  app.on('prerender', () => {
    lines = []; capturing = true;
    try { presentation?.update(); if (omitted && omitted !== 'line') { const e = entity(omitted); if (e) e.enabled = false; } }
    finally { capturing = false; }
  });
  canvas.addEventListener('webglcontextlost', () => { qa.error = 'WebGL context lost'; });
  const attach = () => createFishingRenderer({ pc, app, parent: root, player, character, camera, fishing: fixture.client });
  function caption(stage) { document.getElementById('label').textContent = `${spot?.sourceRef ?? ''} · ${stage} · synthetic frozen server time ${fixture.client.serverNow()}`; }
  function resize() {
    device.resizeCanvas(canvas.clientWidth, canvas.clientHeight); device.updateClientRect();
    camera.camera.orthoHeight = Math.max(1.35, 1.9 / (canvas.width / canvas.height));
  }
  function cache() {
    return Object.entries(FISHING_ASSETS).map(([key, spec]) => {
      const asset = app.assets.getByUrl(spec.url), resource = asset?.resource;
      if (resource && !cacheRefs.has(key)) cacheRefs.set(key, resource);
      const list = resource?.renders?.flatMap(r => r.resource?.meshes ?? []) ?? [];
      return { key, url: spec.url, loaded: Boolean(asset?.loaded && resource), sameResource: resource === cacheRefs.get(key),
        meshes: list.length, gpuResident: spec.url.endsWith('.glb')
          ? list.length > 0 && list.every(m => device.gl.isBuffer(m.vertexBuffer?.impl?.bufferId))
          : Boolean(resource && device.gl.isTexture(resource.impl?._glTexture)) };
    });
  }
  function stats() {
    const grip = player.findByName('Activity_Grip_R'), materialSources = [...cacheRefs.values()].flatMap(r => r.materials?.map(a => a.resource) ?? []);
    const target = spot && fishingWaterTarget(spot), tip = entity('rod')?.findByName('Line_Tip'), mouth = entity('fish')?.findByName('Catch_Line');
    const a = document.querySelector('aside').getBoundingClientRect(), c = canvas.getBoundingClientRect();
    const modelStats = Object.fromEntries(['rod', 'float', 'fish'].map(key => {
      const e = entity(key), list = meshes(e), sourceMeshes = cacheRefs.get(key)?.renders?.flatMap(r => r.resource.meshes) ?? [];
      return [key, { present: Boolean(e), enabled: Boolean(e?.enabled), surfaces: list.length,
        scale: e?.getLocalScale().toArray(), sharedMeshes: list.length > 0 && list.every(m => sourceMeshes.includes(m.mesh)),
        instanceMaterials: list.length > 0 && list.every(m => !materialSources.includes(m.material) && m.material.diffuseVertexColor),
        vertices: list.reduce((n, m) => n + m.mesh.vertexBuffer.numVertices, 0) }];
    }));
    const gripPosition = grip?.getPosition(), tipPosition = tip?.getPosition();
    const dx = tipPosition && tipPosition.x - gripPosition.x, dz = tipPosition && -(tipPosition.z - gripPosition.z);
    const sameWardrobeTransform = wardrobeMatrix && wardrobe.getWorldTransform().data.every((v, i) => Math.abs(v - wardrobeMatrix[i]) < 1e-6);
    return { engine: pc.version, device: device.deviceType, reflection: root.worldScaleSign, sourceRef: spot?.sourceRef,
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight },
      captionOverlapsCanvas: a.bottom > c.top + .5, captionOverflow: document.body.scrollWidth > innerWidth || document.querySelector('aside').scrollHeight > document.querySelector('aside').clientHeight,
      avatar: { ...FISHING_AVATAR_PROXY, modelState: character.modelState, source: FISHING_AVATAR_PROXY.url, helper: 'createCharacter',
        compatibilityWingOrigin: player.findByName('DuckWing_R')?.getPosition().toArray(),
        gripToCompatibilityWingOrigin: grip ? grip.getPosition().distance(player.findByName('DuckWing_R').getPosition()) : null },
      presentation: presentation?.status(), client: fixture.client.status(), models: modelStats,
      sprites: Object.fromEntries(['ripple', 'splash'].map(key => [key, Boolean(entity(key)?.enabled)])),
      grip: { present: Boolean(grip), dedicated: Boolean(grip && grip.parent === anchors.anchor('ACCESSORY').parent && grip.parent !== anchors.anchor('ACCESSORY')),
        pointsTowardWater: tipPosition ? dx * Math.sin(spot.facingYaw) + dz * Math.cos(spot.facingYaw) : null },
      wardrobe: { preserved: wardrobe.parent === anchors.anchor('ACCESSORY'), unchanged: Boolean(sameWardrobeTransform), enabled: wardrobe.enabled },
      roots: root.children.filter(e => e.name === 'Fishing_Water_Visuals').length,
      target, floatPosition: entity('float')?.getPosition().toArray(),
      mouthTipDistance: mouth && tip ? mouth.getPosition().distance(tip.getPosition()) : null, cache: cache(), lines };
  }
  async function loaded() {
    const end = performance.now() + 10_000;
    while (performance.now() < end) {
      if (presentation.status().failed || presentation.status().resources?.failures) throw Error('Fishing runtime asset load failed');
      if (presentation.status().resources?.loaded.length === 3 && cache().every(a => a.loaded)) return stats();
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    throw Error('Fishing original asset load deadline exceeded');
  }
  async function setup(index) {
    presentation?.destroy(); await fixture.reset(FISHING_SPOTS[index].sourceRef); spot = FISHING_SPOTS[index];
    player.setLocalPosition(spot.position.x, PLAYER_ORIGIN_Y, spot.position.z); player.setLocalEulerAngles(0, 137, 0);
    wardrobeMatrix = Array.from(wardrobe.getWorldTransform().data);
    const target = fishingWaterTarget(spot), sx = Math.sin(spot.facingYaw), cz = Math.cos(spot.facingYaw);
    water.setLocalPosition(target.x, target.y - .008, target.z);
    shore.setLocalPosition(spot.position.x, -.05, spot.position.z);
    const center = new pc.Vec3((spot.position.x + target.x) / 2, .6, -(spot.position.z + target.z) / 2);
    camera.setPosition(center.x + cz * 4 - sx * 2, 3.4, center.z + sx * 4 + cz * 2); camera.lookAt(center);
    overview = { position: camera.getPosition().clone(), rotation: camera.getRotation().clone() };
    resize(); presentation = attach(); presentation.setOpen(true);
    const started = await fixture.start(); if (started.outcome !== 'STARTED') throw Error('Synthetic start failed');
    await loaded(); return tick(1400, 'WAITING');
  }
  function tick(elapsed, label) { fixture.advance(elapsed); presentation.update(); caption(label); return stats(); }
  function bounds(key) {
    const points = key === 'line' ? lines.flatMap(line => [line.from, line.to]).map(v => new pc.Vec3(...v))
      : meshes(entity(key)).flatMap(mi => {
        const min = mi.aabb.getMin(), max = mi.aabb.getMax();
        return [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => new pc.Vec3(x, y, z))));
      });
    if (!points.length) throw Error(`Missing ${key} render bounds`);
    const screen = points.map(p => camera.camera.worldToScreen(p));
    const view = camera.getWorldTransform().clone().invert();
    const depths = points.map(p => -view.transformPoint(p, new pc.Vec3()).z);
    return { minX: Math.floor(Math.min(...screen.map(p => p.x))) - 2, maxX: Math.ceil(Math.max(...screen.map(p => p.x))) + 2,
      minY: Math.floor(Math.min(...screen.map(p => p.y))) - 2, maxY: Math.ceil(Math.max(...screen.map(p => p.y))) + 2,
      minDepth: Math.min(...depths), maxDepth: Math.max(...depths), points: points.length };
  }
  async function frame(hide = null) {
    if (pendingFrame) throw Error('Concurrent framebuffer read');
    if (qa.error || device.gl.isContextLost()) throw Error(qa.error || 'Lost GL context');
    pendingFrame = true; omitted = hide;
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer); pendingFrame = false; omitted = null;
        try {
          const gl = device.gl, width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
          const data = new Uint8Array(width * height * 4), old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data); }
          finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old); }
          resolve({ data, evidence: { ...pixelEvidence(data, width, height), glError: gl.getError(), contextLost: gl.isContextLost() } });
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => { app.off('postrender', finish); pendingFrame = false; omitted = null; reject(Error('Framebuffer frame deadline exceeded (6000ms)')); }, 6000);
      app.once('postrender', finish); app.renderNextFrame = true;
    });
  }
  async function proof(key) {
    const visible = await frame(), roi = bounds(key), hidden = await frame(key), restored = await frame();
    return { key, roi, visible: visible.evidence, hidden: hidden.evidence, restored: restored.evidence,
      delta: pixelEvidence(hidden.data, canvas.width, canvas.height, visible.data, roi),
      restoreDelta: pixelEvidence(restored.data, canvas.width, canvas.height, visible.data, roi), stats: stats() };
  }
  Object.assign(qa, { setup, tick, loaded, stats, cache, proof, resize,
    async gripCloseup() {
      const grip = player.findByName('Activity_Grip_R'), wing = player.findByName('DuckWing_R');
      if (!grip || !wing) throw Error('QA proxy grip/compatibility node unavailable for close-up');
      const center = grip.getPosition().clone().add(wing.getPosition()).mulScalar(.5);
      const direction = player.getWorldTransform().transformVector(new pc.Vec3(1, .7, 1.2)).normalize().mulScalar(3);
      camera.setPosition(center.clone().add(direction)); camera.lookAt(center);
      camera.camera.orthoHeight = Math.max(.42, .38 / (canvas.width / canvas.height));
      caption('QA PROXY GRIP / COMPATIBILITY NODE · no duck hand-fit acceptance');
      const captured = await frame();
      return { ...stats(), pixels: captured.evidence, cameraPosition: camera.getPosition().toArray(),
        gripScreen: camera.camera.worldToScreen(grip.getPosition()).toArray(),
        compatibilityWingScreen: camera.camera.worldToScreen(wing.getPosition()).toArray() };
    },
    overview() { camera.setPosition(overview.position); camera.setRotation(overview.rotation); resize(); return stats(); },
    pixels: async () => (await frame()).evidence,
    async beginHook() { pendingHook = fixture.hook(); await fixture.waitForPendingHook(); caption('HOOK PENDING · no speculative fish'); return stats(); },
    async completeHook() { fixture.respondHook(); await pendingHook; pendingHook = null; caption('CURRENT SYNTHETIC SERVER SUCCESS'); return stats(); },
    close() { presentation.setOpen(false); caption('CLOSED'); return stats(); },
    async reopen() { presentation.setOpen(true); caption('REOPENED'); if (presentation.status().attached) await loaded(); return stats(); },
    suppress(value) { presentation.setSuppressed(value); caption(value ? 'SUPPRESSED' : 'RESUMED'); return stats(); },
    async refresh() { await fixture.client.refresh(); presentation.update(); caption('RESULT REPLAY'); return stats(); },
    dispose() { presentation.destroy(); presentation.destroy(); caption('DISPOSED'); return stats(); },
    requests: () => fixture.requests,
    async recreate() { presentation = attach(); presentation.setOpen(true); await fixture.client.refresh(); caption('RECREATED RESULT REPLAY'); return stats(); }
  });
  app.start(); qa.ready = true;
} catch (error) { qa.error = error.stack || String(error); throw error; }
