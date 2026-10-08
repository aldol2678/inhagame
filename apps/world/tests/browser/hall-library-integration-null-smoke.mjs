// Real PlayCanvas CPU/ownership checks. This does not claim graphical evidence.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
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
const {BUILDINGS,HALL_FRONT}=await import('../../src/basic-campus.js');
const diagnosticViews=await import('./hall-library-hosted-views.js');
const canvas={id:'hall-library-current-main-null',width:512,height:512};
const app=new pc.AppBase(canvas), options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);
options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const ids=['bldg_01','bldg_jungseok'], tiers=['BASE','NEAR','DETAIL'];
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const optics=m=>({name:m.name,diffuse:m.diffuse.toArray(),specular:m.specular.toArray(),gloss:m.gloss,reflectivity:m.reflectivity,fresnelModel:m.fresnelModel});
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
  const sourceMaterialState=new Map([...sourceMaterials].map(m=>[m,{opacityDither:m.opacityDither,alphaDither:m.alphaDither,opacity:m.opacity,optics:optics(m)}]));
  const sourceOpticsByName=new Map([...sourceMaterials].map(m=>[m.name,optics(m)]));
  assert.ok([...sourceOpticsByName.keys()].some(name=>name.startsWith('campus-material-glass:')),'current-main semantic glass material is in use');
  assert.ok([...sourceOpticsByName.keys()].some(name=>name.startsWith('campus-material-concrete:')),'current-main semantic concrete material is in use');
  for(const id of ids)for(const tier of tiers){
    const first=selectCampusLandmark(mixed,id,tier,{mode:'candidate'}),geometry=fingerprint(first);
    mixed.removeChild(first);assert.equal(selectCampusLandmark(mixed,id,tier,{mode:'candidate'}),first,'detached owner remounts');
    first.destroy();const second=selectCampusLandmark(mixed,id,tier,{mode:'candidate'});
    assert.notEqual(first,second);assert.deepEqual(fingerprint(second),geometry,'destroyed owner rebuilds same geometry');
    for(const mesh of meshes(second))assert.ok(sourceMaterials.has(mesh.material),'source material reuse');
  }
  report.router={deduplicated:true,unknownIgnored:true,emptyAndInvalidNonmutating:true,detachedRemounted:true,destroyedRebuilt:true,sourceMaterials:sourceMaterials.size};
  mixed.destroy();
  let rain=0,night=0,graphics='medium',snow=0;
  const campus=new pc.Entity('RealCampusFrame');campus.setLocalScale(1,1,-1);app.root.addChild(campus);
  const registry=new RenderChunkRegistry();
  const renderer=new CampusChunkRenderer(app,campus,registry,{getRainIntensity:()=>rain,getArtificialLightFactor:()=>night,getGraphicsTier:()=>graphics,getSnowAccumulation:()=>snow});
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
    let verifiedOpticalClones=0;
    const contacts=[...clones].filter(material=>material.name.startsWith('campus_contact_'));
    assert.equal(contacts.length,1,'selected chunk owns one transparent contact batch');
    for(const material of clones){
      assert.ok(!persistentMaterials.has(material),'tier fade never mutates BASE source material');
      assert.ok(!windowMaterials.has(material),'tier fade never owns night window material');
      if(contacts.includes(material)){
        assert.equal(material.blendType,pc.BLEND_NORMAL);
        assert.equal(material.depthWrite,false);
        assert.equal(material.opacityDither,pc.DITHER_NONE);
        assert.equal(material.opacity,1,'transparent contact reached the same full layer fade');
        assert.ok(!renderer.fades.get(near).materials.includes(material),'contact stays outside opaque clone/dither ownership');
      }else{
        assert.equal(material.opacityDither,pc.DITHER_BAYER8);assert.equal(material.alphaDither,1);
      }
      if(sourceOpticsByName.has(material.name)){assert.deepEqual(optics(material),sourceOpticsByName.get(material.name),'fade clones retain current-main optical profiles');verifiedOpticalClones++;}
    }
    assert.ok(verifiedOpticalClones>0,'actual streamed landmark materials retain their source optics');
    const contactStatus=()=>renderer.contactShading.status();
    const contactBase=renderer.base.findByName('campus_contact_base');
    const contactBaseMesh=contactBase.render.meshInstances[0].mesh;
    graphics='low';renderer.update(0);assert.equal(contactStatus().activeMeshes,1,'low retains only BASE contact');
    graphics='high';renderer.update(0);assert.equal(contactStatus().activeMeshes,2,'high restores selected NEAR contact');
    snow=.07;renderer.update(0);assert.ok(contactStatus().batches.every(b=>Math.abs(b.opacity-.5)<1e-9),'partial snow halves opacity');
    snow=.14;renderer.update(0);assert.equal(contactStatus().activeMeshes,0,'snow hides contacts');
    snow=0;renderer.update(0);assert.equal(contactStatus().activeMeshes,2,'melt restores contacts');
    renderer.contactShading.setEnabled(false);assert.equal(contactStatus().activeMeshes,0);
    renderer.contactShading.setEnabled(true);assert.equal(contactStatus().activeMeshes,2);
    assert.equal(contactBase.render.meshInstances[0].mesh,contactBaseMesh,'quality and snow do not rebuild BASE');
    const geometry=fingerprint(handle.root),metrics=renderer.getMetrics();
    renderer.setState(handle,'FAR');renderer.update(.1);
    assert.ok(renderer.fades.get(near).value>0&&renderer.fades.get(near).value<1,'partial fade');
    for(const material of contacts)assert.equal(material.opacity,renderer.fades.get(near).value,'transparent contact follows partial layer fade');
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
    assert.equal(renderer.contactShading.status().meshes,1,'destroy unregisters NEAR contact resources');
    assert.equal(destroyedMaterials,clones.size,'every fade clone disposed once');assert.ok(destroyedMeshes>=ownedMeshes.size,'custom mesh cleanup runs');for(const mesh of ownedMeshes)assert.equal(mesh.vertexBuffer,null,'custom vertex buffer is released');
    assert.equal(windows.status().enabled,true,'landmark destruction preserves independent environment');
    report.chunkCycles.push({cycle,id,sourceMaterials:persistentMaterials.size,verifiedOpticalClones,disposedFadeMaterials:destroyedMaterials,disposedCustomMeshes:ownedMeshes.size,meshDestroyCalls:destroyedMeshes});
  }
  for(const [material,expected]of sourceMaterialState)assert.deepEqual({opacityDither:material.opacityDither,alphaDither:material.alphaDither,opacity:material.opacity,optics:optics(material)},expected,'source material including current-main optics is unchanged after fade/destruction');
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
  // Exercise the browser fixture's real camera math with PlayCanvas. The null
  // device supplies no pixels: render lifecycle events only invalidate matrices.
  const fixtureCanvas={width:1280,height:653,clientWidth:1280,clientHeight:653,getBoundingClientRect:()=>({top:67})};
  app.graphicsDevice.clientRect={width:1280,height:653};
  const camera=preview.camera;
  camera.camera.fov=48;camera.camera.aspectRatioMode=pc.ASPECT_MANUAL;camera.camera.aspectRatio=1280/653;
  const {a,b,along,inward}=HALL_FRONT;
  const entryPoint=(u,y,v)=>[(a.x+b.x)/2+along.x*u+inward.x*v,y,(a.z+b.z)/2+along.z*u+inward.z*v];
  camera.setPosition(...entryPoint(5,3.3,-9));camera.lookAt(...entryPoint(0,1.6,0));
  app.fire('prerender');camera.camera.worldToScreen(new pc.Vec3(...entryPoint(0,1.6,0)));
  const handles=ids.map(id=>{const handle=renderer.create(registry.chunks.find(c=>c.buildings.includes(id)));renderer.setState(handle,'ACTIVE');renderer.update(1);return handle;});
  const corners=root=>meshes(root).flatMap(m=>{const min=m.aabb.getMin(),max=m.aabb.getMax();return [min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>[x,y,z])));});
  const harness=readFileSync(new URL('./hall-library-hosted-harness.html',import.meta.url),'utf8');
  const fixtureFunctions=harness.slice(harness.indexOf('  function campusOwners('),harness.indexOf('  function disposeCampus('));
  const fixtureView=runInNewContext(fixtureFunctions+';campusView',{
    pc,app,campus:{root:campus,renderer,handles},tiers,corners,...diagnosticViews,camera,canvas:fixtureCanvas,previous:null,
    document:{querySelector:()=>({getBoundingClientRect:()=>({bottom:67})}),getElementById:()=>({})},
    device:{resizeCanvas(){},updateClientRect(){}}
  });
  report.diagnosticCamera=[];
  for(const [width,height]of [[1280,653],[390,760]])for(const id of ids){
    Object.assign(fixtureCanvas,{width,height,clientWidth:width,clientHeight:height});
    app.graphicsDevice.clientRect={width,height};camera.camera.aspectRatio=width/height;
    const pending=Promise.resolve(fixtureView(id));
    app.fire('prerender');app.fire('postrender');
    const frame=await pending;
    assert.ok(frame.points>0&&frame.minDepth>0,`${id} camera must project after the render lifecycle refreshes its cached view matrix: ${JSON.stringify(frame)}`);
    assert.ok(frame.minX>=.06&&frame.maxX<=.94&&frame.minY>=.06&&frame.maxY<=.94,JSON.stringify(frame));
    report.diagnosticCamera.push({id,width,height,points:frame.points,minDepth:frame.minDepth});
  }
  for(const handle of handles)renderer.destroy(handle);
  const frameEvents=new pc.EventHandler();
  const rendered=diagnosticViews.waitForDiagnosticFrame(frameEvents);
  assert.equal(frameEvents.renderNextFrame,true);assert.equal(frameEvents.hasEvent('postrender'),true);
  frameEvents.fire('postrender');await rendered;assert.equal(frameEvents.hasEvent('postrender'),false);
  await assert.rejects(diagnosticViews.waitForDiagnosticFrame(frameEvents,5),/Diagnostic camera frame deadline/);
  assert.equal(frameEvents.hasEvent('postrender'),false,'timeout removes its pending frame listener');
  preview.groundMaterial.destroy();preview.camera.destroy();
  windows.destroy();windows.destroy();assert.equal(windowRoot.children.length,0);
  campus.destroy();assert.equal(renderer.fades.size,0);
  console.log(JSON.stringify({...report,status:'PASS'},null,2));
}finally{app.destroy();}
