// Exercise the real pinned PlayCanvas GLB ContainerHandler, hierarchy and room
// material binding. Local bytes replace transport only. NOT game pixel evidence.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { return next(specifier === 'playcanvas' ? engine : specifier, context); } });
const pc = await import('playcanvas');
const { createPersonalRoomChairModel, PERSONAL_ROOM_CHAIR_MODEL_URL } = await import('../../src/rooms/personal-room-chair-model.js');
const { createPersonalRoomChairFallback } = await import('../../src/rooms/personal-room-chair-visual.js');
const { createPersonalRoomMaterials } = await import('../../src/rooms/personal-room-materials.js');
const { PERSONAL_ROOM_CHAIR_PARTS, PERSONAL_ROOM_FIXED_CHAIR_YAW } = await import('../../src/rooms/personal-room-chair-design.js');
const canvas = { id: 'fixed-chair-container-null', width: 1280, height: 720 };
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
options.graphicsDevice = new pc.NullGraphicsDevice(canvas); options.componentSystems = [pc.RenderComponentSystem]; options.resourceHandlers = [pc.ContainerHandler]; app.init(options);
const bytes = readFileSync(new URL('../../assets/rooms/personal-v2/fixed-chair-oak-linen.glb', import.meta.url));
const asset = new pc.Asset('fixed-chair-oak-linen', 'container', { url: PERSONAL_ROOM_CHAIR_MODEL_URL,
  contents: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
app.assets.add(asset);
const report = { engine: pc.version, device: 'NullGraphicsDevice; no pixels or GPU performance proof',
  assetMode: 'real AssetRegistry and ContainerHandler, self-contained GLB via local Asset.file.contents',
  sha256: createHash('sha256').update(bytes).digest('hex'), cycles: [] };
const renders = root => root.findComponents('render').flatMap(render => render.meshInstances);
try {
  assert.equal(asset.loaded, false);
  let sharedMaterials;
  for (let cycle = 0; cycle < 3; cycle++) {
    const root = new pc.Entity('RoomFixedChairTest'), anchor = new pc.Entity('personal_chair');
    app.root.addChild(root); root.addChild(anchor); anchor.setLocalPosition(2.95, 0, .85); anchor.setLocalEulerAngles(0, PERSONAL_ROOM_FIXED_CHAIR_YAW, 0);
    const materials = createPersonalRoomMaterials({ root, app, engine: pc, fallbackSurface: () => { throw Error('Unexpected material fallback'); } });
    const fallback = createPersonalRoomChairFallback({ app, root, anchor, materials });
    const ensure = createPersonalRoomChairModel({ app, root, anchor, fallback, materials });
    const first = ensure(); assert.strictEqual(ensure(), first); assert.equal(fallback.enabled, true);
    assert.equal(await first, true, 'actual GLB parse and instantiate succeed');
    assert.equal(asset.loaded, true); assert.equal(fallback.enabled, false);
    const model = anchor.findByName('personal_chair_oak_linen'); assert.ok(model);
    assert.equal(renders(model).length, 17);
    sharedMaterials ??= asset.resource.materials.map(a => a.resource);
    assert.deepEqual(asset.resource.materials.map(a => a.resource), sharedMaterials, 'cached source materials never replaced');
    for (const part of PERSONAL_ROOM_CHAIR_PARTS) {
      const entity = model.findByName(part.name), fallbackEntity = fallback.findByName(part.name);
      assert.ok(entity); assert.ok(fallbackEntity);
      const instance = entity.render.meshInstances[0], fallbackInstance = fallbackEntity.render.meshInstances[0];
      assert.strictEqual(instance.material, materials.get(part.material)); assert.strictEqual(instance.material, fallbackInstance.material);
      assert.ok(!sharedMaterials.includes(instance.material), 'only instance bindings use room materials');
      const positions = [], reference = [];
      instance.mesh.getPositions(positions); fallbackInstance.mesh.getPositions(reference);
      assert.deepEqual(positions, reference, 'loaded and fallback vertices are identical');
      const min = instance.aabb.getMin(), max = instance.aabb.getMax();
      assert.ok(min.x >= 2.95 - .275 - 1e-6 && max.x <= 2.95 + .275 + 1e-6);
      assert.ok(min.z >= .85 - .275 - 1e-6 && max.z <= .85 + .275 + 1e-6);
      assert.ok(min.y >= -1e-7 && max.y <= .6);
      if (part.name === 'seat') assert.ok(Math.abs(max.y - .27) < 1e-6);
      if (part.name === 'back') assert.ok(max.z < .85 - .15, 'fixed-chair back is rotated away from desk');
    }
    for (let i = 0; i < 8; i++) { root.enabled = !root.enabled; assert.equal(await ensure(), true); }
    assert.equal(anchor.children.length, 2, 'no duplicate loaded hierarchy on re-entry');
    const sharedGeometry = renders(model).map(instance => instance.mesh);
    const chairTriangles = renders(model).reduce((n, instance) => n + instance.mesh.primitive[0].count / 3, 0);
    assert.equal(chairTriangles, 3808);
    report.cycles.push({ cycle, loadedParts: renders(model).length, triangles: chairTriangles, seatTop: model.findByName('seat').render.meshInstances[0].aabb.getMax().y });
    root.destroy();
    assert.equal(await ensure(), false);
    assert.ok(sharedGeometry.every(mesh => mesh.vertexBuffer), 'room teardown preserves registry-owned GLB geometry for next room');
    assert.ok(sharedMaterials.every(m => m.name && !m.name.startsWith('personal-room-v2-')), 'room teardown does not destroy/rebind source materials');
  }
  const instance = asset.resource.instantiateRenderEntity();
  assert.ok(renders(instance).every(mi => sharedMaterials.includes(mi.material)), 'fresh cached instance still has untouched asset slots');
  instance.destroy();
  console.log(JSON.stringify(report, null, 2));
} finally { app.destroy(); }
