// Real pinned PlayCanvas projection/scene readback. No browser or pixels; this is
// separate from the GitHub-hosted-only browser acceptance and never relaxes it.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  body: { dataset: {} }, createElement() { return { getContext() { return { measureText: text => ({ width: text.length * 45 }), fillText() {} }; } }; } };
globalThis.window = { addEventListener() {} };
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(s, c, next) { return next(s === 'playcanvas' ? engine : s, c); } });
const pc = await import('playcanvas');
const { OrbitCameraController } = await import('../../src/orbit-camera-controller.js');
const { createBiryongRealmScene } = await import('../../src/biryong/biryong-realm-renderer.js');
const { createBiryongRealmWorldAdapter, BIRYONG_REALM_CAMERA_OBSTACLES } = await import('../../src/biryong/biryong-realm-world-adapter.js');
const { createBiryongRealmTransition } = await import('../../src/biryong/biryong-realm-transition.js');
const { BIRYONG_MAP_DESTINATIONS } = await import('../../src/biryong/biryong-map-data.js');
const { BIRYONG_VILLAGE_BUILDINGS } = await import('../../src/biryong/biryong-village-layout.js');
const { cameraSafeFraction } = await import('../../src/world-collision.js');
const canvas = { id: 'biryong-camera-null', width: 1280, height: 720, addEventListener() {} };
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
app.init(options);
const report = { engine: pc.version, device: 'NullGraphicsDevice: no pixels', cameraSamples: 0, localBodyOcclusionSamples: 0, viewports: [], cycles: 0 };
try {
  const campusRoot = new pc.Entity('Campus'); campusRoot.setLocalScale(1, 1, -1); app.root.addChild(campusRoot);
  const { root: biryongRoot } = createBiryongRealmScene(app);
  const player = new pc.Entity('Player'); campusRoot.addChild(player); player.setLocalPosition(.5, 1.15, -92.6);
  const camera = new pc.Entity('Camera'); app.root.addChild(camera);
  camera.addComponent('camera', { fov: 50, nearClip: .3, aspectRatioMode: pc.ASPECT_MANUAL, aspectRatio: 1280 / 720 });
  const orbit = new OrbitCameraController(camera, canvas);
  const controller = { setMovementSpace(space) { this.space = space; }, groundY: 1.15 };
  const world = createBiryongRealmWorldAdapter({ player, controller, orbit, campusRoot, biryongRoot });
  let now = 0;
  const transition = createBiryongRealmTransition({ world, clock: { now: () => now }, campusReturnAnchor: { x: .5, y: 1.15, z: -92.6 } });
  const points = [{ x: -4.7, z: 19.93 }, { x: -1.2164960827128801, z: 29.446387731183304 }, ...BIRYONG_MAP_DESTINATIONS.map(p => p.position),
    ...BIRYONG_VILLAGE_BUILDINGS.map(b => ({ x: b.x, z: b.z - b.depth / 2 - .6 }))];
  const stationMesh = biryongRoot.findByName('biryong_station_building').render.meshInstances[0];
  const stationBox = BIRYONG_REALM_CAMERA_OBSTACLES.find(b => b.id === 'biryong_station_building');
  const aabb = stationMesh.aabb;
  assert.ok(Math.abs(aabb.center.x - (stationBox.minX + stationBox.maxX) / 2) < 1e-6);
  assert.ok(Math.abs(-aabb.center.z - (stationBox.minZ + stationBox.maxZ) / 2) < 1e-6);
  assert.ok(Math.abs(aabb.halfExtents.x * 2 - (stationBox.maxX - stationBox.minX)) < 1e-6);
  assert.ok(Math.abs(aabb.center.y - (stationBox.minY + stationBox.maxY) / 2) < 1e-6);
  assert.ok(Math.abs(aabb.halfExtents.y * 2 - (stationBox.maxY - stationBox.minY)) < 1e-6);
  assert.ok(Math.abs(aabb.halfExtents.z * 2 - (stationBox.maxZ - stationBox.minZ)) < 1e-6);
  report.stationColliderMatchesVisibleMesh = true;
  for (const [width, height] of [[1280, 720], [390, 844], [844, 390]]) {
    camera.camera.aspectRatio = width / height;
    Object.assign(app.graphicsDevice.clientRect, { width, height });
    assert.equal(transition.enter(), true); now += 1000;
    assert.equal(player.parent, biryongRoot); assert.equal(campusRoot.enabled, false);
    const projected = [];
    for (const q of points) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const distance of [1.5, 3.5, 7]) for (const pitch of [-.5, Math.atan2(7.3, 18.5), 1.2]) {
        const p = { ...q, y: 1.15 };
        Object.assign(orbit, { yaw, distance, pitch }); orbit.apply(p);
        app.fire("prerender"); // refresh real camera view matrices as a rendered frame does
        const from = [p.x, .8, p.z], h = Math.cos(Math.max(.12, pitch)) * distance - .35;
        const to = [p.x + Math.sin(yaw) * h, .8 + Math.sin(Math.max(.12, pitch)) * distance, p.z - Math.cos(yaw) * h];
        const fraction = cameraSafeFraction(from, to, BIRYONG_REALM_CAMERA_OBSTACLES);
        const position = camera.getPosition();
        const expected = [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction, -(from[2] + (to[2] - from[2]) * fraction)];
        position.toArray().forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-5));
        const screen = camera.camera.worldToScreen(new pc.Vec3(p.x, .8, -p.z));
        assert.ok(screen.toArray().every(Number.isFinite));
        report.cameraSamples += 1;
        const eyeDistance = position.distance(new pc.Vec3(p.x, .8, -p.z));
        if (fraction < 1 && eyeDistance < .6) {
          assert.equal(orbit.localVisualOccluded, true, 'real regional wall cannot expose local avatar interior');
          report.localBodyOcclusionSamples += 1;
        } else if (fraction === 1) assert.equal(orbit.localVisualOccluded, false, 'clear view keeps local avatar visible');
        if (q === points[0] && yaw === 0 && distance === 3.5 && pitch > 0 && pitch < .5) {
          const baselineFraction = cameraSafeFraction(from, to);
          const chosenOrbitLength = Math.hypot(...to.map((v, i) => v - from[i]));
          projected.push({ baselineFraction, currentFraction: fraction, baselineDistance: baselineFraction * chosenOrbitLength,
            currentDistance: fraction * chosenOrbitLength, chosenZoom: orbit.distance, projectedEye: screen.toArray() });
          assert.equal(baselineFraction, .06); assert.equal(fraction, 1);
        }
      }
    assert.equal(transition.returnToCampus(), true); now += 1000;
    assert.equal(player.parent, campusRoot); assert.equal(orbit.outdoorObstacles, undefined);
    Object.assign(orbit, { yaw: 0, pitch: Math.atan2(7.3, 18.5), distance: 3.5 });
    orbit.apply(player.getLocalPosition());
    assert.ok(camera.getPosition().distance(new pc.Vec3(.5, .8, 92.6)) > 3);
    report.viewports.push({ width, height, npcApproach: projected }); report.cycles += 1;
  }
  transition.dispose();
  assert.equal(orbit.outdoorObstacles, undefined);
  console.log(JSON.stringify(report, null, 2));
} finally { app.destroy(); }
