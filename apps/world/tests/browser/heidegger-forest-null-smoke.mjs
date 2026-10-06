// Actual pinned-engine geometry, ownership and disposal. Null device is not pixels.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return {width:0,height:0,getContext(){return {measureText:t=>({width:t.length*45}),fillText(){}}}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {VIEW_DISTANCE_PRESETS}=await import('../../src/view-distance.js');
const {forestTreeProfiles,forestSoilRing,FOREST_COLORS}=await import('../../src/heidegger-forest-geometry.js');
const {FACILITIES}=await import('../../src/campus-facilities.js');
const canvas={id:'heidegger-forest-null',width:256,height:256},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=root=>meshes(root).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const report={engine:pc.version,device:'NullGraphicsDevice; no pixel or hardware performance evidence',cycles:[]};
try{
 for(let cycle=0;cycle<3;cycle++){
  const parent=new pc.Entity('ForestLifecycle');parent.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(parent);
  const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,parent,registry),forest=renderer.base.findByName('lmk_heidegger_forest');
  assert.ok(forest);assert.equal(meshes(forest).length,4);
  const original=fingerprint(forest),materials=meshes(forest).map(m=>m.material),materialState=materials.map(m=>({opacity:m.opacity,depthWrite:m.depthWrite,alphaDither:m.alphaDither}));
  let triangles=0,bytes=0;
  for(const mi of meshes(forest)){
   const p=[],n=[],indices=[];mi.mesh.getPositions(p);mi.mesh.getNormals(n);mi.mesh.getIndices(indices);
   assert.ok(p.length&&p.every(Number.isFinite)&&n.every(Number.isFinite));triangles+=indices.length/3;
   bytes+=mi.mesh.vertexBuffer.storage.byteLength+mi.mesh.indexBuffer[0].storage.byteLength;
   assert.equal(mi.material.opacity,1);assert.equal(mi.material.depthWrite,true);
   assert.equal(mi.node.parent,forest,'one unchanged BASE facility owner');
  }
  assert.ok(triangles<=1700&&bytes<=140000);
  const chunk=registry.chunks.find(c=>c.facilities.includes('lmk_heidegger_forest')),handle=renderer.create(chunk);
  assert.equal(chunk.id,'RC_1_-2','outside contact shading pilot chunks');
  for(const policy of [VIEW_DISTANCE_PRESETS.SHORT,VIEW_DISTANCE_PRESETS.MAX])for(const state of ['ACTIVE','FAR','VISTA','NEAR','ACTIVE']){
   renderer.setViewPolicy(policy);renderer.setState(handle,state);renderer.update(1);
   assert.ok(forest.enabled&&renderer.base.enabled,'near/far never removes this existing persistent grove');
   assert.deepEqual(fingerprint(forest),original,'no distance-time rebuild');
   assert.equal(meshes(handle.root).filter(mi=>mi.node.name.startsWith('lmk_heidegger_forest_details_')).length,0,'streamed layers cannot duplicate BASE trees');
  }
  assert.deepEqual(materials.map(m=>({opacity:m.opacity,depthWrite:m.depthWrite,alphaDither:m.alphaDither})),materialState,'fade cannot mutate shared grove materials');
  const owned=meshes(forest).map(m=>m.mesh);renderer.destroy(handle);assert.equal(renderer.fades.size,0);
  parent.destroy();assert.ok(owned.every(m=>m.vertexBuffer===null&&m.indexBuffer.every(b=>b===null)),'all forest buffers disposed');
  report.cycles.push({cycle,reflection:cycle%2?-1:1,trees:12,baseMeshes:4,triangles,bytes,stable:true,disposed:true});
 }
 const center=FACILITIES.find(f=>f.id==='lmk_heidegger_forest').center,ring=forestSoilRing(center);
 report.profiles=forestTreeProfiles(center).map(t=>({index:t.index,kind:t.kind,height:t.height,trunkHeight:t.trunkHeight}));
 report.soilArea=Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0)/2);
 console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
