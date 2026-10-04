// Real PlayCanvas CPU/ownership checks. This does not claim graphical evidence.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Only the unrelated street-label canvas API is shimmed; no rendering or landmark API is mocked.
globalThis.document={addEventListener(){},removeEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:0,height:0,getContext(type){assert.equal(type,'2d');return {measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const {buildCampusLandmarks,selectCampusLandmark}=await import('../../src/campus-landmark-candidate-selector.js');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {PlaceScenePreview}=await import('../../src/preview/place-scene-preview.js');
const {createNightBuildingWindows}=await import('../../src/environment/night-building-windows.js');
const {BUILDINGS}=await import('../../src/basic-campus.js');
const canvas={id:'hall-library-current-main-null',width:512,height:512};
const app=new pc.AppBase(canvas), options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);
options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const ids=['bldg_01','bldg_jungseok'], tiers=['BASE','NEAR','DETAIL'];
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=root=>meshes(root).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const descendants=root=>[root,...root.children.flatMap(descendants)];
const owner=(root,id,tier)=>descendants(root).filter(e=>e.name===`${id}_presentation_${tier}`);
const point=id=>{const b=BUILDINGS.find(b=>b.id===id);return {x:b.vertices.reduce((s,p)=>s+p.x,0)/b.vertices.length,z:b.vertices.reduce((s,p)=>s+p.z,0)/b.vertices.length};};
const report={engine:pc.version,device:'NullGraphicsDevice (no pixel proof)',router:{},chunkCycles:[],preview:[],environment:{}};
try {
  const mixed=new pc.Entity('mixed-router');app.root.addChild(mixed);
  for(const tier of tiers){
    buildCampusLandmarks(mixed,['bldg_01','unknown','bldg_01','bldg_jungseok','bldg_jungseok'],tier);
    for(const id of ids)assert.equal(owner(mixed,id,tier).length,1,'deduplicated selected owner');
  }
  assert.equal(mixed.children.length,6,'unknown noncanonical IDs create no content');
  const originalChildren=[...mixed.children];
  buildCampusLandmarks(mixed,[]);
  assert.throws(()=>buildCampusLandmarks(mixed,ids,'FAR'),/Unsupported/);
  assert.throws(()=>buildCampusLandmarks(mixed,null),/array/);
  assert.deepEqual(mixed.children,originalChildren,'invalid and empty routes preserve tree');
  const sourceMaterials=new Set(meshes(mixed).map(m=>m.material));
  const sourceMaterialState=new Map([...sourceMaterials].map(m=>[m,{opacityDither:m.opacityDither,alphaDither:m.alphaDither,opacity:m.opacity}]));
  for(const id of ids)for(const tier of tiers){
    const first=selectCampusLandmark(mixed,id,tier,{mode:'candidate'}),geometry=fingerprint(first);
    mixed.removeChild(first);assert.equal(selectCampusLandmark(mixed,id,tier,{mode:'candidate'}),first,'detached owner remounts');
    first.destroy();const second=selectCampusLandmark(mixed,id,tier,{mode:'candidate'});
    assert.notEqual(first,second);assert.deepEqual(fingerprint(second),geometry,'destroyed owner rebuilds same geometry');
    for(const mesh of meshes(second))assert.ok(sourceMaterials.has(mesh.material),'source material reuse');
  }
  report.router={deduplicated:true,unknownIgnored:true,emptyAndInvalidNonmutating:true,detachedRemounted:true,destroyedRebuilt:true,sourceMaterials:sourceMaterials.size};
  mixed.destroy();
  let rain=0,night=0,graphics='medium';
  const campus=new pc.Entity('RealCampusFrame');campus.setLocalScale(1,1,-1);app.root.addChild(campus);
  const registry=new RenderChunkRegistry();
  const renderer=new CampusChunkRenderer(app,campus,registry,{getRainIntensity:()=>rain,getArtificialLightFactor:()=>night});
  const persistentMaterials=new Set(meshes(renderer.base).map(m=>m.material));
  const windowRoot=new pc.Entity('IndependentEnvironmentWindows');campus.addChild(windowRoot);
  const windows=createNightBuildingWindows({app,root:windowRoot,getArtificialLightFactor:()=>night,getGraphicsTier:()=>graphics});
  const windowMaterials=new Set(meshes(windowRoot).map(m=>m.material));
  assert.equal(windowMaterials.size,1);for(const material of windowMaterials)assert.ok(!persistentMaterials.has(material));
  windows.update();assert.equal(windows.status().enabled,false);
  rain=.8;night=1;windows.update();app.fire('update',.016);
  assert.equal(windows.status().drawMeshes,1);
  assert.equal(renderer.getPondWeatherStatus().rainIntensity,.8);
  assert.equal(renderer.getPondWeatherStatus().artificialLightFactor,1);
  for(let cycle=0;cycle<2;cycle++)for(const id of ids){
    const chunk=registry.chunks.find(chunk=>chunk.buildings.includes(id));assert.ok(chunk);
    const handle=renderer.create(chunk);renderer.setState(handle,'ACTIVE');renderer.update(1);
    const roots=[renderer.base,handle.near,handle.detail];
    for(const [index,tier]of tiers.entries()){
      const selected=owner(roots[index],id,tier);assert.equal(selected.length,1,`${id} ${tier} one actual owner`);
      assert.equal(selected[0].worldScaleSign,-1,'exactly one campus reflection');
      assert.deepEqual(selected[0].getLocalPosition().toArray(),[0,0,0]);
      assert.deepEqual(selected[0].getLocalScale().toArray(),[1,1,1]);
    }
    const near=handle.near,detail=handle.detail,clones=new Set([...meshes(near),...meshes(detail)].map(m=>m.material));
    for(const material of clones){assert.ok(!persistentMaterials.has(material),'tier fade never mutates BASE source material');assert.ok(!windowMaterials.has(material),'tier fade never owns night window material');assert.equal(material.opacityDither,pc.DITHER_BAYER8);assert.equal(material.alphaDither,1);}
    const geometry=fingerprint(handle.root),metrics=renderer.getMetrics();
    renderer.setState(handle,'FAR');renderer.update(.1);
    assert.ok(renderer.fades.get(near).value>0&&renderer.fades.get(near).value<1,'partial fade');
    renderer.update(1);assert.equal(near.enabled,false);assert.equal(detail.enabled,false);
    renderer.setState(handle,'ACTIVE');renderer.update(1);
    assert.equal(handle.near,near);assert.equal(handle.detail,detail);assert.deepEqual(fingerprint(handle.root),geometry);
    assert.equal(renderer.getMetrics().nearBuilds,metrics.nearBuilds);assert.equal(renderer.getMetrics().detailBuilds,metrics.detailBuilds);
    assert.equal(windows.status().enabled,true);
    // Observe real owned-resource destruction without replacing its implementation.
    let destroyedMaterials=0,destroyedMeshes=0;
    for(const material of clones){const destroy=material.destroy.bind(material);material.destroy=()=>{destroyedMaterials++;return destroy();};}
    const ownedMeshes=new Set(meshes(handle.root).filter(m=>m.node.render.type==='asset').map(m=>m.mesh));
    for(const mesh of ownedMeshes){const destroy=mesh.destroy.bind(mesh);mesh.destroy=()=>{destroyedMeshes++;return destroy();};}
    renderer.destroy(handle);
    assert.equal(renderer.fades.has(near),false);assert.equal(renderer.fades.has(detail),false);
    assert.equal(destroyedMaterials,clones.size,'every fade clone disposed once');assert.ok(destroyedMeshes>=ownedMeshes.size,'custom mesh cleanup runs');for(const mesh of ownedMeshes)assert.equal(mesh.vertexBuffer,null,'custom vertex buffer is released');
    assert.equal(windows.status().enabled,true,'landmark destruction preserves independent environment');
    report.chunkCycles.push({cycle,id,sourceMaterials:persistentMaterials.size,disposedFadeMaterials:destroyedMaterials,disposedCustomMeshes:ownedMeshes.size,meshDestroyCalls:destroyedMeshes});
  }
  for(const [material,expected]of sourceMaterialState)assert.deepEqual({opacityDither:material.opacityDither,alphaDither:material.alphaDither,opacity:material.opacity},expected,'source material is unchanged after fade/destruction');
  report.environment={nightWindows:windows.status(),pondWeather:renderer.getPondWeatherStatus(),independentOwnership:true};
  const preview=new PlaceScenePreview(canvas);preview.app=app;preview.registry=registry;preview.campusRoot=campus;
  preview.camera=new pc.Entity('PreviewTestCamera');preview.camera.addComponent('camera');app.root.addChild(preview.camera);
  preview.groundMaterial=new pc.StandardMaterial();
  for(const id of [...ids,...ids]){
    const old=preview.placeRoot;const status=preview.openPlace({id,label:id,position:point(id),previewRadius:0});
    if(old)assert.equal(old.parent,null,'previous place destroyed');
    for(const tier of tiers)assert.equal(owner(preview.placeRoot,id,tier).length,1,`${id} actual preview ${tier}`);
    assert.equal(status.placeId,id);assert.ok(status.entitiesCreated>1);report.preview.push({id,residentChunks:status.residentChunks,entitiesCreated:status.entitiesCreated});
  }
  preview.clearPlace();assert.equal(preview.placeRoot,null);assert.equal(preview.status().placeId,null);
  preview.groundMaterial.destroy();preview.camera.destroy();
  windows.destroy();windows.destroy();assert.equal(windowRoot.children.length,0);
  campus.destroy();assert.equal(renderer.fades.size,0);
  console.log(JSON.stringify({...report,status:'PASS'},null,2));
}finally{app.destroy();}
