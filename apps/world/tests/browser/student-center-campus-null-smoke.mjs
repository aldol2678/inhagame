// Real engine/consumer ownership verification only; this is not a pixel test.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return{width:0,height:0,getContext(){return{measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engineUrl:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {PlaceScenePreview}=await import('../../src/preview/place-scene-preview.js');
const {studentConnectedFrame}=await import('../../src/student-center-frame.js');
const canvas={id:'student-center-current-campus-null',width:512,height:512};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const hash=root=>meshes(root).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const descendants=root=>[root,...root.children.flatMap(descendants)];
const report={engine:pc.version,device:'NullGraphicsDevice; no pixels',cycles:[]};
try{
 const campus=new pc.Entity('StudentCampusCoordinateFrame');campus.setLocalScale(1,1,-1);app.root.addChild(campus);
 const registry=new RenderChunkRegistry(),chunk=registry.chunks.find(c=>c.facilities.includes('bldg_07'));
 const renderer=new CampusChunkRenderer(app,campus,registry);
 assert.ok(chunk);assert.ok(!renderer.base.findByName('bldg_07_body_0'));
 const base=renderer.base.findByName('bldg_07_connected_BASE');assert.ok(base);assert.equal(base.worldScaleSign,-1);
 const baseMaterials=new Set(meshes(base).map(m=>m.material));
 assert.ok([...baseMaterials].some(m=>m.name==='campus-material-glass:#355d62'),'student glass uses current-main semantic optics');
 assert.ok([...baseMaterials].some(m=>m.name==='campus-material-brick:#ae8c79'),'student wall uses current-main semantic optics');
 for(let cycle=0;cycle<3;cycle++){
  const handle=renderer.create(chunk);renderer.setState(handle,'ACTIVE');renderer.update(1);
  const near=handle.near.findByName('bldg_07_connected_NEAR'),detail=handle.detail.findByName('bldg_07_connected_DETAIL');
  assert.ok(near&&detail);assert.ok(meshes(near).length>5);assert.equal(meshes(detail).length,0);
  assert.equal(near.worldScaleSign,-1);assert.equal(descendants(handle.root).filter(e=>e.name==='bldg_07_connected_NEAR').length,1);
  assert.ok(!handle.root.findByName('bldg_07_NEAR'));
  for(const m of meshes(near)){assert.ok(!baseMaterials.has(m.material));assert.equal(m.material.alphaDither,1);assert.ok(m.material.depthBias<0,'reviewed photo/detail depth bias survives current material profiles');}
  const before=hash(handle.root);renderer.setState(handle,'FAR');renderer.update(1);assert.equal(handle.near.enabled,false);
  renderer.setState(handle,'ACTIVE');renderer.update(1);assert.deepEqual(hash(handle.root),before);
  const owned=new Set(meshes(near).map(m=>m.mesh)),clones=new Set(meshes(near).map(m=>m.material));let destroyed=0;
  for(const material of clones){const fn=material.destroy.bind(material);material.destroy=()=>{destroyed++;fn();};}
  renderer.destroy(handle);assert.equal(destroyed,clones.size);for(const m of owned)assert.equal(m.vertexBuffer,null);
  report.cycles.push({cycle,meshes:owned.size,disposedMaterialClones:destroyed});
 }
 const preview=new PlaceScenePreview(canvas);preview.app=app;preview.registry=registry;preview.campusRoot=campus;
 preview.camera=new pc.Entity('StudentPreviewCamera');preview.camera.addComponent('camera');app.root.addChild(preview.camera);preview.groundMaterial=new pc.StandardMaterial();
 const q=studentConnectedFrame().toWorld([0,0,0]);
 for(let i=0;i<2;i++){
  preview.openPlace({id:'bldg_07',label:'Student Center',position:{x:q[0],z:q[2]},previewRadius:0});
  assert.ok(preview.placeRoot.findByName('bldg_07_connected_BASE'));assert.ok(!preview.placeRoot.findByName('bldg_07_body_0'));
  preview.clearPlace();assert.equal(preview.placeRoot,null);
 }
 report.status='PASS';report.placePreview=true;console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
