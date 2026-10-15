// Real pinned entities/components and NullGraphicsDevice; no GPU, browser, fetch or purchases.
// Run after installing the existing browser dependencies:
// node --test apps/world/tests/browser/furniture-preview-ownership.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pc from './node_modules/playcanvas/build/playcanvas.mjs';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'playcanvas'
    ? { url: pathToFileURL(realpathSync(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url))).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const { createFurnitureLayer } = await import('../../src/rooms/furniture-renderer.js');
const { surface } = await import('../../src/campus-render-kit.js');
hook.deregister();

const sofa = { id: '00000000-0000-4000-8000-000000000001', itemId: 'furniture.dorm_single_sofa', surface: 'floor', x: 0, z: 0, yaw: 0 };
const duck = { ...sofa, id: '00000000-0000-4000-8000-000000000002', itemId: 'furniture.mini_induck', x: 2 };
const chair = { ...sofa, itemId: 'furniture.induck_chair' };
function makeApp(t, name) {
  assert.equal(pc.version, '2.22.4');
  const canvas = { id: `${t.name}:${name}`, width: 16, height: 16, style: {}, addEventListener() {}, removeEventListener() {} };
  const app = new pc.AppBase(canvas), options = new pc.AppOptions();
  options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  options.componentSystems = [pc.RenderComponentSystem];
  options.resourceHandlers = [];
  app.init(options);
  app.autoRender = false;
  // Exercise the engine's actual current-app switch without requesting animation frames.
  app.requestAnimationFrame = () => {};
  t.after(() => { if (app.graphicsDevice) app.destroy(); });
  return app;
}
function makeCurrent(app) {
  app.renderNextFrame = false;
  app.tick(1);
  assert.ok(pc.AppBase.getApplication() === app);
}
const materials = layer => new Set(layer.root.findComponents('render').flatMap(c => c.meshInstances.map(mi => mi.material)));
const materialAt = (layer, name) => layer.root.findByName(name).render.meshInstances[0].material;

for (const ownerName of ['main', 'preview']) {
  test(`${ownerName} furniture keeps its app/device when the other app is current`, t => {
    const main = makeApp(t, 'main'), preview = makeApp(t, 'preview');
    const owner = ownerName === 'main' ? main : preview;
    const other = ownerName === 'main' ? preview : main;
    makeCurrent(other);
    const layer = createFurnitureLayer(owner, owner.root, { modelMode: 'procedural', isolatedMaterials: ownerName === 'preview' });
    layer.setObjects([sofa, duck]);
    const renders = layer.root.findComponents('render');
    t.diagnostic(JSON.stringify({ owner: ownerName, renderCount: renders.length,
      ownerComponents: renders.filter(c => c.system.app === owner).length,
      ownerMeshes: renders.filter(c => c.meshInstances.every(mi => mi.mesh.device === owner.graphicsDevice)).length,
      ownerLayerMeshes: owner.defaultLayerWorld.meshInstances.length, otherLayerMeshes: other.defaultLayerWorld.meshInstances.length }));
    assert.equal(renders.length, 14);
    layer.root.forEach(entity => assert.ok(entity._app === owner, `${entity.name} keeps the requested app`));
    assert.ok(renders.every(c => c.system.app === owner));
    assert.ok(renders.every(c => c.meshInstances.every(mi => mi.mesh.device === owner.graphicsDevice)));
    assert.equal(owner.defaultLayerWorld.meshInstances.length, renders.length);
    assert.equal(other.defaultLayerWorld.meshInstances.length, 0);
    layer.root.destroy();
    assert.equal(owner.defaultLayerWorld.meshInstances.length, 0);
    assert.equal(other.defaultLayerWorld.meshInstances.length, 0);
  });
}

test('preview clones reuse their own cache and uniform scope while main keeps shared surfaces', t => {
  const main = makeApp(t, 'main'), preview = makeApp(t, 'preview');
  const world = createFurnitureLayer(main, main.root, { modelMode: 'procedural' });
  world.setObjects([sofa]);
  const shared = surface('#718da3');
  assert.ok(materialAt(world, 'seat') === shared, 'default main material stays shared');
  shared.setParameter('uFurnitureOwnershipProbe', 1);
  shared.setParameters(main.graphicsDevice);
  const layer = createFurnitureLayer(preview, preview.root, { modelMode: 'procedural', isolatedMaterials: true });
  layer.setObjects([sofa]);
  const isolated = materialAt(layer, 'seat');
  assert.ok(isolated !== shared, 'preview owns a separate material');
  assert.ok(materialAt(layer, 'back') === isolated, 'same source material reuses one preview clone');
  assert.ok(isolated.variants !== shared.variants, 'shader variants are device-local');
  assert.equal(isolated.diffuse.toString(), shared.diffuse.toString());
  assert.equal(isolated.gloss, shared.gloss);
  assert.equal(isolated.reflectivity, shared.reflectivity);
  isolated.setParameter('uFurnitureOwnershipProbe', 2);
  isolated.setParameters(preview.graphicsDevice);
  assert.equal(main.graphicsDevice.scope.resolve('uFurnitureOwnershipProbe').getValue(), 1);
  assert.equal(preview.graphicsDevice.scope.resolve('uFurnitureOwnershipProbe').getValue(), 2);
  layer.setObjects([chair]);
  layer.setObjects([sofa]);
  assert.ok(materialAt(layer, 'seat') === isolated, 'changing items reuses the layer cache');
  layer.root.destroy();
  assert.ok(materialAt(world, 'seat') === shared);
  assert.ok(surface('#718da3') === shared, 'preview disposal leaves the global cache intact');
  shared.deleteParameter('uFurnitureOwnershipProbe');
});

test('three preview reopen cycles release only owned clones exactly once and leave main meshes intact', t => {
  const main = makeApp(t, 'main');
  const world = createFurnitureLayer(main, main.root, { modelMode: 'procedural' });
  world.setObjects([sofa]);
  const worldMaterials = materials(world), allPreviewMaterials = new Set();
  const mainMeshCount = main.defaultLayerWorld.meshInstances.length;
  for (let cycle = 0; cycle < 3; cycle++) {
    const preview = makeApp(t, `preview-${cycle}`);
    makeCurrent(main);
    const layer = createFurnitureLayer(preview, preview.root, { modelMode: 'procedural', isolatedMaterials: true });
    const counts = new Map();
    for (const objects of [[sofa], [chair], [], [sofa]]) {
      layer.setObjects(objects);
      for (const material of materials(layer)) {
        assert.ok(!worldMaterials.has(material), 'preview never owns main materials');
        if (counts.has(material)) continue;
        assert.ok(!allPreviewMaterials.has(material), 'reopening never reuses a disposed clone');
        allPreviewMaterials.add(material); counts.set(material, 0);
        const destroy = material.destroy.bind(material);
        material.destroy = () => { counts.set(material, counts.get(material) + 1); destroy(); };
      }
      assert.ok([...counts.values()].every(count => count === 0), 'item changes retain reusable layer materials');
      assert.equal(main.defaultLayerWorld.meshInstances.length, mainMeshCount);
    }
    layer.root.destroy();
    layer.root.destroy();
    assert.ok([...counts.values()].every(count => count === 1), 'all preview clones disposed exactly once');
    assert.ok([...counts.keys()].every(material => material.meshInstances.size === 0));
    assert.equal(preview.defaultLayerWorld.meshInstances.length, 0);
    assert.equal(main.defaultLayerWorld.meshInstances.length, mainMeshCount);
    assert.ok(world.root.findComponents('render').every(c => c.meshInstances.every(mi => worldMaterials.has(mi.material))));
    preview.destroy();
    t.diagnostic(JSON.stringify({ cycle, disposedClones: counts.size, mainMeshesRemaining: mainMeshCount, previewMeshesRemaining: 0 }));
  }
});

test('disabled official replacements retain procedural previews and never fetch', async t => {
  const previousFetch=globalThis.fetch;let fetches=0;
  globalThis.fetch=async()=>{fetches++;throw Error('disabled candidate must not fetch');};
  try {
    const app=makeApp(t,'disabled-candidates');
    const layer=createFurnitureLayer(app,app.root,{isolatedMaterials:true});
    for(const itemId of ['furniture.induck_chair','furniture.campus_rug_blue','furniture.dorm_side_table_low','furniture.dorm_bookshelf_slim']) {
      layer.setObjects([{...sofa,itemId}]);await layer.whenVisualsReady();
      assert.equal(layer.visualStatus().objects.length,0);
      assert.ok(layer.root.findComponents('render').length>0);
    }
    assert.equal(fetches,0);
    layer.root.destroy();
  } finally {globalThis.fetch=previousFetch;}
});
