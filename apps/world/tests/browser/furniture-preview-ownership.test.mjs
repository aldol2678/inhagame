// Real pinned entities/components and NullGraphicsDevice; no GPU, browser, external fetch or purchases.
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
const { attachFurnitureVisual } = await import('../../src/rooms/furniture-glb-visual.js');
const { FURNITURE_VISUALS, OFFICIAL_FURNITURE_CANDIDATES, furnitureVisualForItem, furnitureVisualForUrl, requireFurnitureVisual } = await import('../../src/rooms/furniture-visual-assets.js');
const { createPersonalRoomFixtures } = await import('../../src/rooms/personal-room-fixtures-v2.js');
const { PERSONAL_ROOM_MATERIAL_PROFILES } = await import('../../src/rooms/personal-room-materials.js');
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

test('all five active replacements keep visible procedural fallbacks on bounded offline failure', async t => {
  const previousFetch=globalThis.fetch, fetches=[];
  globalThis.fetch=async(url,options)=>{fetches.push({url,options});throw Error('offline optional GLB fixture');};
  try {
    const app=makeApp(t,'active-replacements');
    makeCurrent(app);
    const layer=createFurnitureLayer(app,app.root,{isolatedMaterials:true});
    const active=FURNITURE_VISUALS.filter(visual=>visual.enabled&&visual.itemId!=='furniture.dorm_single_sofa');
    assert.equal(active.length,5);
    for(const visual of active.filter(visual=>visual.itemId!=='fixture.personal_bed')) {
      layer.setObjects([{...sofa,itemId:visual.itemId}]);await layer.whenVisualsReady();
      const status=layer.visualStatus().objects;
      assert.equal(status.length,1,`${visual.itemId} actually attempted its active model`);
      assert.equal(status[0].state,'FALLBACK');
      assert.equal(status[0].modelVisible,false);
      assert.equal(status[0].detail,'offline optional GLB fixture');
      assert.equal(status[0].sourceKey,`${visual.url}@${visual.sha256}`);
      assert.equal(layer.root.findByName('furniture_procedural_fallback').enabled,true);
      assert.ok(layer.root.findComponents('render').length>0);
    }
    const fixedRoot=new pc.Entity('fixed-fixtures',app);app.root.addChild(fixedRoot);
    const fixedChairRequests=[];
    app.assets.loadFromUrl=(url,type,callback)=>{fixedChairRequests.push({url,type});callback(Error('offline fixed chair fixture'));};
    const fixed=createPersonalRoomFixtures({app,root:fixedRoot,
      materials:{get:key=>surface(PERSONAL_ROOM_MATERIAL_PROFILES[key].color)}});
    assert.deepEqual(await fixed.ensureVisualAssets(),[false]);
    const bedFallback=fixedRoot.findByName('bed_procedural_fallback');
    assert.equal(bedFallback.enabled,true);assert.ok(bedFallback.findComponents('render').length>0);
    assert.equal(fixedRoot.findByName('chair_fallback').enabled,true);
    assert.equal(fixedChairRequests.length,1);assert.match(fixedChairRequests[0].url,/fixed-chair-oak-linen\.glb$/);
    assert.deepEqual(fetches.map(call=>call.url).sort(),active.map(visual=>visual.url).sort(), 'only the five active code-owned URLs are attempted once');
    assert.ok(fetches.every(call=>call.options.credentials==='same-origin'&&call.options.signal instanceof AbortSignal));
    assert.deepEqual(fixed.visualAssets().map(visual=>visual.itemId),['fixture.personal_bed']);
    layer.root.destroy();fixedRoot.destroy();
  } finally {globalThis.fetch=previousFetch;}
});

test('three retired official descriptors cannot load while procedural previews stay available', async t => {
  const previousFetch=globalThis.fetch;let fetches=0;
  globalThis.fetch=async()=>{fetches++;throw Error('disabled candidate must not fetch');};
  try {
    const app=makeApp(t,'disabled-candidates');
    const layer=createFurnitureLayer(app,app.root,{modelMode:'procedural',isolatedMaterials:true});
    const retired=OFFICIAL_FURNITURE_CANDIDATES.filter(visual=>!visual.enabled);
    assert.equal(retired.length,3);
    for(const visual of retired) {
      layer.setObjects([{...sofa,itemId:visual.itemId}]);await layer.whenVisualsReady();
      assert.equal(layer.visualStatus().objects.length,0);
      assert.ok(layer.root.findComponents('render').length>0);
      assert.equal(furnitureVisualForUrl(visual.url),null);
      assert.notEqual(furnitureVisualForItem(visual.itemId),visual,'the active successor never resolves to its retired descriptor');
      assert.throws(()=>requireFurnitureVisual(visual),/FURNITURE_UNTRUSTED_MANIFEST/);
      assert.throws(()=>attachFurnitureVisual({app,anchor:layer.root,fallback:layer.root,visual}),/FURNITURE_UNTRUSTED_MANIFEST/);
    }
    assert.equal(fetches,0);
    layer.root.destroy();
  } finally {globalThis.fetch=previousFetch;}
});

test('display, placement and activation refresh replace only layer-owned collision objects', t => {
  const app=makeApp(t,'collision-ownership');
  const layer=createFurnitureLayer(app,app.root,{modelMode:'procedural'});
  layer.setObjects([chair]);
  const shared=layer.obstacles;
  // No naming contract: even a coincident ID belongs to its caller by object identity.
  const external={id:chair.id,minX:5,maxX:6,minZ:2,maxZ:3};
  const unnamed={minX:6,maxX:7,minZ:0,maxZ:1};
  shared.push(external,unnamed);
  const assertExternal=()=>{assert.equal(layer.obstacles,shared);assert.equal(shared.filter(o=>o===external).length,1);assert.equal(shared.filter(o=>o===unnamed).length,1);assert.deepEqual(shared.slice(-2),[external,unnamed]);};
  const oldOwned=shared.find(o=>o.id===chair.id&&o!==external);
  layer.setDisplays([{objectId:chair.id,itemId:'badge.main_gate',category:'BADGE',name:'badge'}]);assertExternal();
  layer.setObjects([{...chair,x:2}]);assertExternal();assert.equal(shared.includes(oldOwned),false);
  layer.deactivate();assertExternal();layer.activate();assertExternal();
  layer.setObjects([]);assertExternal();assert.equal(shared.filter(o=>o.id===chair.id).length,1);
  layer.root.destroy();
});
