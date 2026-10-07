// CPU engine contract, explicitly NOT browser/GPU visual acceptance. Uses the exact pinned
// PlayCanvas parser, entities, matrices, materials and original GLB buffers on NullGraphicsDevice.
// PLAYCANVAS_MODULE may point to an already installed pinned playcanvas.mjs (no dependency mutation).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEquipmentAnchors } from '../../src/appearance/equipment-anchors.js';
import { createEquipmentModelLoader } from '../../src/appearance/equipment-asset-loader.js';
import { createFishingRenderView } from '../../src/activity/fishing-renderer.js';
import { FISHING_ASSETS, FISHING_MODEL_REGISTRY, fishingWaterTarget } from '../../src/activity/fishing-visuals.js';
import { FISHING_SPOTS } from '../../src/activity/fishing-spots.js';
const pc = await import(process.env.PLAYCANVAS_MODULE || 'playcanvas');
assert.equal(pc.version, '2.22.4');
const canvas = { width: 64, height: 64, addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }) };
const device = new pc.NullGraphicsDevice(canvas);
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
Object.assign(options, { graphicsDevice: device, componentSystems: [pc.RenderComponentSystem],
  resourceHandlers: [pc.ContainerHandler] });
app.init(options);
const sources = [];
for (const [key, spec] of Object.entries(FISHING_ASSETS)) {
  if (spec.url.endsWith('.glb')) {
    const b = readFileSync(new URL(`../..${spec.url}`, import.meta.url));
    const asset = new pc.Asset(key, 'container', { url: spec.url,
      contents: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
    app.assets.add(asset); sources.push(asset);
  } else {
    // Atlas pixel bytes/alpha/hashes are checked separately; this contract tests sampler/material state.
    const asset = new pc.Asset(key, 'texture', { url: spec.url });
    asset.resource = new pc.Texture(device, { width: 1024, height: 512 });
    asset.loaded = true; app.assets.add(asset); sources.push(asset);
  }
}
const parent = new pc.Entity('CampusCoordinateFrame');parent.setLocalScale(1, 1, -1);app.root.addChild(parent);
const player = new pc.Entity('Player');parent.addChild(player);
const anchors = createEquipmentAnchors({ createEntity: name => new pc.Entity(name), parent: player, height: .875 });
anchors.follow({ feetY: -1.15 });
const accessory = new pc.Entity('Existing_Wardrobe_Accessory');anchors.anchor('ACCESSORY').addChild(accessory);
const camera = new pc.Entity('Camera');app.root.addChild(camera);camera.setPosition(120, 6, -50);
const loadModel = createEquipmentModelLoader({ app, registry: FISHING_MODEL_REGISTRY });
let lines = 0;app.drawLine = (a, b) => { assert.ok([a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite));lines++; };
const report = { engine: pc.version, device: 'NullGraphicsDevice (no pixels/GPU)', spots: [], surfaces: {}, colors: {}, cacheShared: false };
try {
  for (const spot of FISHING_SPOTS) {
    player.setLocalPosition(spot.position.x, 1.15, spot.position.z);
    player.setLocalEulerAngles(0, 137, 0); // Deliberately not facing the lake.
    const view = createFishingRenderView({ pc, app, parent, player, frame: anchors.anchor('ACCESSORY').parent,
      camera, loadModel });
    for (let n = 0; n < 100 && view.status().loaded.length !== 3; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(view.status().failures, 0);assert.equal(view.status().loaded.length, 3);
    const frame = { phase: 'WAITING', spot, target: fishingWaterTarget(spot), showFish: false,
      castProgress: 1, reelProgress: 0, rippleFrame: 4, splashFrame: 2, floatOffset: 0 };
    view.render(frame);
    const splash = parent.findByName('Fishing_Splash');
    const normal = splash.getWorldTransform().transformVector(new pc.Vec3(0, 1, 0)).normalize();
    const towardCamera = camera.getPosition().clone().sub(splash.getPosition());towardCamera.y = 0;towardCamera.normalize();
    assert.ok(Math.abs(normal.dot(towardCamera)) > .9999, 'mirrored splash billboard faces diagonal camera');
    const rod = parent.findByName('Equipment_Model_rod'), float = parent.findByName('Equipment_Model_float');
    const fish = parent.findByName('Equipment_Model_fish');
    assert.equal(fish.enabled, false);
    assert.ok(Math.abs(float.getPosition().y - frame.target.y) < 1e-6);
    assert.ok(Math.abs(float.getPosition().z + frame.target.z) < 1e-5, 'campus north->render -Z transform');
    const grip = player.findByName('Activity_Grip_R');
    assert.ok(Math.abs(grip.getPosition().y - .62 * .875) < 1e-6);
    const tip = rod.findByName('Line_Tip').getPosition();
    const dx = tip.x - grip.getPosition().x, dz = -(tip.z - grip.getPosition().z);
    assert.ok(dx * Math.sin(spot.facingYaw) + dz * Math.cos(spot.facingYaw) > .6, 'rod points toward water regardless of avatar yaw');
    for (const [key, entity] of [['rod', rod], ['float', float], ['fish', fish]]) {
      assert.deepEqual(entity.getLocalScale().toArray(), [.5,.5,.5]);
      const meshes = entity.findComponents('render').flatMap(r => r.meshInstances);
      report.surfaces[key] = meshes.length;
      assert.equal(meshes.length, FISHING_ASSETS[key].surfaces);
      let coloredVertices = 0;
      for (const mi of meshes) {
        assert.equal(mi.material.diffuseVertexColor, true);
        const colors = []; const vertices = mi.mesh.getColors(colors);assert.ok(colors.length > 0);
        assert.ok(colors.every(Number.isFinite));coloredVertices += vertices;
      }
      report.colors[key] = coloredVertices;
    }
    view.render({ ...frame, phase: 'RESULT', showFish: true, reelProgress: 1 });
    assert.equal(fish.enabled, true);assert.equal(float.enabled, false);
    const mouth = fish.findByName('Catch_Line').getPosition(), reelTip = rod.findByName('Line_Tip').getPosition();
    assert.ok(mouth.distance(reelTip) < 1e-5, 'actual Catch_Line matrix meets actual Line_Tip');
    report.spots.push({ sourceRef: spot.sourceRef, target: frame.target, mouthTipDistance: mouth.distance(reelTip) });
    view.destroy();assert.equal(player.findByName('Activity_Grip_R'), null);
    assert.ok(accessory.parent === anchors.anchor('ACCESSORY'));
    assert.ok(sources.every(a => a.resource && a.loaded));
  }
  report.cacheShared = true;report.lineDraws = lines;
  console.log(JSON.stringify(report, null, 2));
} finally { app.destroy(); }
