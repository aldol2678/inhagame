// Real pinned PlayCanvas scene/ownership/lifecycle regression. NOT pixel evidence.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { return next(specifier === 'playcanvas' ? engine : specifier, context); } });
const pc = await import('playcanvas');
const { createPersonalRoomScene } = await import('../../src/rooms/personal-room-renderer.js');
const { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_BASIC_SPAWN } = await import('../../src/rooms/personal-room-layout.js');
const { FURNITURE_LIMIT } = await import('../../src/rooms/furniture-layout.js');
const canvas = { id: 'personal-room-v2-null', width: 1280, height: 720 };
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
app.init(options);
const loadRequests = [];
app.assets.loadFromUrl = (url, type, callback) => { loadRequests.push({ url, type }); queueMicrotask(() => callback(new Error('QA intentional offline asset fallback'))); };
const components = root => root.findComponents('render');
const meshes = root => components(root).flatMap(component => component.meshInstances);
const childCount = root => 1 + root.children.reduce((n, child) => n + childCount(child), 0);
const report = { engine: pc.version, device: 'NullGraphicsDevice; no pixel or GPU performance proof', assetMode: 'all optional asset loads fail intentionally', layoutSha256: createHash('sha256').update(readFileSync(new URL('../../src/rooms/personal-room-layout.js', import.meta.url))).digest('hex'), cycles: [] };
try {
  assert.equal(FURNITURE_LIMIT, 32);
  const initialRoots = app.root.children.length;
  for (let cycle = 0; cycle < 5; cycle++) {
    const initialTextures = app.graphicsDevice.textures.size;
    const scene = createPersonalRoomScene(app);
    assert.equal(scene.root.enabled, false);
    assert.equal(app.root.children.length, initialRoots + 1);
    assert.equal(scene.lights.length, 2);
    assert.ok(scene.lights.every(e => !e.light.castShadows));
    scene.root.enabled = true;
    const first = scene.ensureVisualAssets(), concurrent = scene.ensureVisualAssets();
    await Promise.all([first, concurrent]);
    const stableCount = childCount(scene.root), stableMeshCount = meshes(scene.root).length;
    for (let enter = 0; enter < 10; enter++) {
      scene.onDeactivate(); scene.root.enabled = false;
      scene.root.enabled = true; await scene.ensureVisualAssets();
      assert.equal(childCount(scene.root), stableCount, 're-entry never duplicates entities');
      assert.equal(meshes(scene.root).length, stableMeshCount, 're-entry never duplicates meshes');
    }
    for (const item of PERSONAL_ROOM_BASIC_FURNITURE) {
      const anchor = scene.root.findByName(`personal_${item.id}`);
      assert.ok(anchor, `stable editing seam ${item.id}`);
      const p = anchor.getLocalPosition(); assert.deepEqual([p.x,p.y,p.z], item.at);
      const instances = meshes(anchor);
      assert.ok(instances.length >= (item.kind === 'rug' ? 1 : 2));
      for (const instance of instances) {
        const positions = []; instance.mesh.getPositions(positions);
        assert.ok(positions.length > 0 && positions.every(Number.isFinite));
      }
    }
    const wardrobe = scene.root.findByName('personal_bookshelf');
    const footprint = PERSONAL_ROOM_BASIC_FURNITURE.find(x => x.id === 'bookshelf');
    for (const instance of meshes(wardrobe)) {
      const bounds = instance.aabb, min = bounds.getMin(), max = bounds.getMax();
      assert.ok(min.x >= footprint.at[0] - footprint.size[0]/2 - .015 && max.x <= footprint.at[0] + footprint.size[0]/2 + .015, `storage X footprint: ${min.x}..${max.x}`);
      // The entire scene is mirrored on Z; compare the mirrored source footprint.
      assert.ok(min.z >= -footprint.at[2] - footprint.size[2]/2 - .015 && max.z <= -footprint.at[2] + footprint.size[2]/2 + .015, `storage Z footprint: ${min.z}..${max.z}`);
      assert.ok(max.y <= footprint.size[1] + .015, `storage stays below collision top: ${max.y}`);
    }
    const before = JSON.stringify(PERSONAL_ROOM_BASIC_OBSTACLES);
    scene.ownedFurniture.setObjects([]); scene.ownedFurniture.setObjects([]);
    assert.equal(new Set(scene.obstacles.map(x=>x.id)).size, scene.obstacles.length, 'owned/decor collision IDs stay unique');
    assert.equal(JSON.stringify(PERSONAL_ROOM_BASIC_OBSTACLES), before);
    assert.equal(PERSONAL_ROOM_BASIC_SPAWN.position.x, 0);
    const renderMeshes = meshes(scene.root);
    let triangles = 0;
    for (const {mesh} of renderMeshes) triangles += mesh.primitive[0].count / 3;
    assert.ok(triangles < 40000, `fallback room fixture triangles ${triangles} exceeds low-tier target`);
    report.cycles.push({ cycle, entities: stableCount, meshInstances: stableMeshCount, triangles });
    const generatedTextures = [...new Set(renderMeshes.flatMap(instance => [instance.material.diffuseMap, instance.material.normalMap]).filter(texture => texture?.name.startsWith('personal-room-')))];
    assert.equal(generatedTextures.length, 4, 'wood and weave each share color/normal textures');
    scene.root.destroy();
    assert.equal(app.graphicsDevice.textures.size, initialTextures, 'room procedural textures do not leak across teardown');
    for (const texture of generatedTextures) assert.equal(texture.device, null, 'procedural texture releases its graphics device');
    await scene.ensureVisualAssets();
    assert.equal(app.root.children.length, initialRoots, 'teardown removes complete scene root');
  }
  report.assetRequests = loadRequests.length;
  console.log(JSON.stringify(report, null, 2));
} finally { app.destroy(); }
