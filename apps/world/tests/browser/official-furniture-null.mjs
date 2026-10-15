// Optional local-only private-asset fixture; never copy GLBs into this checkout.
// Real pinned parser/entity/lifecycle, NullGraphicsDevice. Embedded PNG decoding,
// pixels, GPU memory and performance are NOT tested (blank textures below).
// OFFICIAL_FURNITURE_DIR=/private/assets node .../official-furniture-null.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = process.env.OFFICIAL_FURNITURE_DIR;
if (!directory) throw Error('OFFICIAL_FURNITURE_DIR is required; private assets stay outside checkout');
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
const manifestUrl = new URL('../../src/rooms/furniture-visual-assets.js', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) { return next(specifier === 'playcanvas' ? engine : specifier, context); },
  load(url, context, next) {
    const result = next(url, context);
    // Test-process-only activation also covers retired pinned candidates.
    // Production keeps those disabled; no runtime manifest injection API exists.
    return url === manifestUrl ? {...result, source: String(result.source).replaceAll('enabled: false','enabled: true')} : result;
  }
});
const pc = await import('playcanvas');
const { OFFICIAL_FURNITURE_CANDIDATES: visuals } = await import(manifestUrl);
const { attachFurnitureVisual, furnitureAssetStatus } = await import('../../src/rooms/furniture-glb-visual.js');
const { createPersonalRoomFixtures } = await import('../../src/rooms/personal-room-fixtures-v2.js');
const { validateFurniturePayload } = await import('../../src/rooms/furniture-glb-contract.js');
const files = ['official-chair-replacement-r1.glb','official-rug-replacement-r1.glb','official-bed-replacement-r2.glb','cabinets/nightstand/nightstand.glb','cabinets/bookshelf/bookshelf.glb'];
const payloads = new Map();
for (let i=0;i<visuals.length;i++) {
  const bytes=readFileSync(resolve(directory,files[i]));
  await validateFurniturePayload(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),visuals[i]);
  if(visuals[i].itemId==='fixture.personal_bed') {
    const jsonLength=bytes.readUInt32LE(12), gltf=JSON.parse(bytes.subarray(20,20+jsonLength));
    const binary=20+jsonLength+8;
    let aboveSupport=0;
    for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){
      const accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView];
      assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'VEC3');
      for(let vertex=0;vertex<accessor.count;vertex++){
        const offset=binary+(view.byteOffset??0)+(accessor.byteOffset??0)+vertex*(view.byteStride??12);
        const x=-3.8-bytes.readFloatLE(offset),y=bytes.readFloatLE(offset+4),z=1.9-bytes.readFloatLE(offset+8);
        if(y>.43001){aboveSupport++;assert.ok(x>=-4.296-.00001&&x<=-3.304+.00001&&z>=2.63-.00001&&z<=3.11+.00001,`bed vertex outside reserved pillow: ${[x,y,z]}`);}
      }
    }
    assert.ok(aboveSupport>0,'real pillow retains height above support');
  }
  payloads.set(visuals[i].url,bytes);
}
const canvas={id:'official-null',width:16,height:16};
const app=new pc.AppBase(canvas), options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);
options.componentSystems=[pc.RenderComponentSystem];options.resourceHandlers=[pc.ContainerHandler];app.init(options);
assert.equal(pc.version,'2.22.4');
let loads=0, fetches=0;
const load=app.assets.load.bind(app.assets);
app.assets.load=asset=>{
  if(asset.type==='container') {
    loads++;
    asset.options={image:{processAsync(_image,done){
      const texture=new pc.Asset('null-only-placeholder','texture');
      texture.resource=new pc.Texture(app.graphicsDevice,{width:1,height:1});
      app.assets.add(texture);done(null,texture);
    }}};
  }
  return load(asset);
};
const previousFetch=globalThis.fetch;
globalThis.fetch=async url=>{fetches++;assert.ok(payloads.has(url));return new Response(payloads.get(url));};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const handles=[];
function attach(visual,index=0){
  const anchor=new pc.Entity(`placement-${index}`,app),fallback=new pc.Entity('fallback',app);
  anchor.addChild(fallback);app.root.addChild(anchor);
  const handle=attachFurnitureVisual({app,anchor,fallback,visual});
  handles.push({anchor,fallback,handle});return handles.at(-1);
}
async function settle(group){
  for(let i=0;i<100 && group.some(entry=>entry.handle.status().state==='LOADING');i++){await tick();app.fire('postrender');}
  assert.ok(group.every(entry=>entry.handle.status().state==='GLB'),JSON.stringify(group.map(entry=>entry.handle.status())));
}
try {
  const single=Array.from({length:32},(_,i)=>attach(visuals[0],i));await settle(single);
  assert.equal(loads,1);assert.equal(furnitureAssetStatus(app)[0].refs,32);
  const models=single.map(entry=>entry.anchor.children.find(child=>child!==entry.fallback));
  assert.equal(new Set(models).size,32);
  const meshes=model=>model.findComponents('render').flatMap(render=>render.meshInstances.map(instance=>instance.mesh));
  assert.deepEqual(meshes(models[0]),meshes(models[31]));
  single[0].anchor.setLocalEulerAngles(0,90,0);assert.deepEqual(meshes(models[0]),meshes(models[31]));
  for(const entry of single) entry.anchor.destroy();await tick();assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  const mixed=Array.from({length:32},(_,i)=>attach(visuals[i%5],i));await settle(mixed);
  assert.equal(furnitureAssetStatus(app).length,5);assert.equal(loads,6);
  for(const entry of mixed)entry.anchor.destroy();await tick();assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  // Late load after account/room removal cannot reinsert entities or hold resources.
  let finish;
  globalThis.fetch=()=>new Promise(resolve=>finish=resolve);
  const stale=attach(visuals[0]);await tick();stale.anchor.destroy();await tick();
  finish(new Response(payloads.get(visuals[0].url)));await tick();await tick();
  assert.equal(stale.handle.status().state,'DISPOSED');assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  globalThis.fetch=async url=>new Response(payloads.get(url));
  const reenter=[attach(visuals[0])];await settle(reenter);reenter[0].anchor.destroy();await tick();
  assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  // Exercise the actual fixed-bed owner, including cached ensure, exit release,
  // re-entry and pending completion after deactivation. Existing chair is offline.
  const fixtureRoot=new pc.Entity('fixed-room',app);app.root.addChild(fixtureRoot);
  const materialMap=new Map();
  const materials={get(name){if(!materialMap.has(name)){const material=new pc.StandardMaterial();material.name=name;materialMap.set(name,material);}return materialMap.get(name);}};
  const originalLoadFromUrl=app.assets.loadFromUrl;
  app.assets.loadFromUrl=(_url,_type,callback)=>callback(Error('fixed-chair intentionally offline'));
  const fixtures=createPersonalRoomFixtures({app,root:fixtureRoot,materials});
  const beforeBedLoads=loads;
  const pending=fixtures.ensureVisualAssets(), concurrent=fixtures.ensureVisualAssets();
  for(let i=0;i<30;i++){await tick();app.fire('postrender');}
  assert.deepEqual(await concurrent,await pending,'concurrent readiness retains the same fixed-chair result');
  assert.equal(loads,beforeBedLoads+1,'concurrent readiness loads the fixed bed only once');
  assert.equal(fixtureRoot.findByName('bed_procedural_fallback').enabled,false);
  fixtures.deactivate();await tick();assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  assert.equal(fixtureRoot.findByName('bed_procedural_fallback').enabled,true);
  const again=fixtures.ensureVisualAssets();
  for(let i=0;i<30;i++){await tick();app.fire('postrender');}await again;
  assert.equal(fixtureRoot.findByName('bed_procedural_fallback').enabled,false);
  fixtures.deactivate();await tick();
  let delayed;
  globalThis.fetch=()=>new Promise(resolve=>delayed=resolve);
  const interrupted=fixtures.ensureVisualAssets();await tick();fixtures.deactivate();
  delayed(new Response(payloads.get(visuals.find(visual=>visual.itemId==='fixture.personal_bed').url)));
  await interrupted;await tick();
  assert.equal(fixtureRoot.findByName('bed_procedural_fallback').enabled,true);
  assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  fixtureRoot.destroy();await tick();assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0,'container and texture assets released');
  for(const material of materialMap.values())material.destroy();
  app.assets.loadFromUrl=originalLoadFromUrl;
  console.log(JSON.stringify({status:'PASS',engine:pc.version,device:'NullGraphicsDevice',loads,fetches,privatePayloads:5,sameAssetPlacements:32,mixedPlacements:32,fixedBedSupportAndKeepout:'PASS',fixedBedLifecycle:'PASS',imageDecode:'not_tested_placeholder_textures',pixels:'not_measured',gpu:'not_measured'},null,2));
} finally {for(const entry of handles)entry.anchor.destroy();app.destroy();globalThis.fetch=previousFetch;}
