// Real pinned PlayCanvas lifecycle/geometry checks. Null device is not visual QA.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:0,height:0,getContext(){return {measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {FACILITY_COLLIDERS}=await import('../../src/campus-facilities.js');
const {AGORA}=await import('../../src/roadview-layout.js');
const canvas={id:'north-landmarks-null',width:512,height:512},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=e=>e.findComponents('render').flatMap(c=>c.meshInstances);
const hash=e=>meshes(e).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const ids=['bldg_05','bldg_60th','fac_agora_courtyard','bldg_06','bldg_09'];
const report={device:'NullGraphicsDevice: no pixels',engine:pc.version,cycles:[]};
const stage=(label)=>console.error(JSON.stringify({stage:label,rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
try{
 const {fillNorthRoads}=await import('../../src/north-campus-geometry.js');
 const {FacilityMeshBatch}=await import('../../src/facility-mesh-batch.js');
 const {surface}=await import('../../src/campus-render-kit.js');
 const {buildNorthWalkwayRoads}=await import('../../src/north-walkway-renderer.js');
 const sourceBatch=fillNorthRoads(new FacilityMeshBatch());
 const batchRoot=new pc.Entity('PavingPerColorContract');app.root.addChild(batchRoot);buildNorthWalkwayRoads(batchRoot);
 const pavingOwners=meshes(batchRoot);assert.equal(pavingOwners.length,5);assert.equal(sourceBatch.groups.size,5);
 assert.deepEqual(pavingOwners.map(mi=>mi.node.name),[...sourceBatch.groups.keys()].map(color=>'north_campus_roads_'+color.slice(1)),'original owner creation order');
 const sourceVertices=[...sourceBatch.groups.values()].reduce((n,g)=>n+g.positions.length/3,0),indexedGroups=[];let indexedVertices=0;
 assert.equal(pavingOwners.reduce((n,mi)=>n+mi.mesh.primitive[0].count/3,0),[...sourceBatch.groups.values()].reduce((n,g)=>n+g.indices.length/3,0));
 for(const [color,g]of sourceBatch.groups){
  const mi=pavingOwners.find(mi=>mi.node.name==='north_campus_roads_'+color.slice(1));assert.ok(mi);
  const positions=[],normals=[],indices=[];mi.mesh.getPositions(positions);mi.mesh.getNormals(normals);mi.mesh.getIndices(indices);
  assert.equal(indices.length,g.indices.length,'original triangle count and order');
  assert.equal(positions.length,normals.length);assert.equal(positions.length%3,0);
  assert.ok(indices.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3));
  for(let i=0;i<indices.length;i++)for(let axis=0;axis<3;axis++){
   assert.ok(Object.is(positions[indices[i]*3+axis],Math.fround(g.positions[g.indices[i]*3+axis])),'expanded float32 position bits');
   assert.ok(Object.is(normals[indices[i]*3+axis],Math.fround(g.normals[g.indices[i]*3+axis])),'expanded float32 normal bits');
  }
  const expectedBounds=new pc.BoundingBox();expectedBounds.compute(g.positions);
  assert.deepEqual(mi.mesh.aabb.center,expectedBounds.center,'original source-space bounds center');
  assert.deepEqual(mi.mesh.aabb.halfExtents,expectedBounds.halfExtents,'original source-space bounds extents');
  indexedVertices+=positions.length/3;indexedGroups.push({color,sourceVertices:g.positions.length/3,indexedVertices:positions.length/3,triangles:indices.length/3});
  assert.equal(mi.material,surface(color),'original cached material identity preserved');
  assert.equal(mi.node.render.castShadows,false);
  assert.ok(!mi.mesh.vertexBuffer.format.elements.some(e=>e.name===pc.SEMANTIC_COLOR),'no interpolated color path');
 }
 const ownedPaving=pavingOwners.map(mi=>mi.mesh);batchRoot.destroy();for(const mesh of ownedPaving)assert.equal(mesh.vertexBuffer,null);
 assert.ok(indexedVertices<sourceVertices,'actual paving vertex storage decreases');
 report.pavingBatch={sourceMeshes:5,productionMeshes:5,sourceVertices,indexedVertices,groups:indexedGroups,originalSharedMaterials:true,expandedFloat32TriangleStreamPreserved:true,originalBoundsPreserved:true,geometryAndMaterialPreserved:true};
 const source=readFileSync(new URL('./north-landmark-smoke.mjs',import.meta.url),'utf8');
 const entryCameras=JSON.parse(source.match(/export const NORTH_ENTRY_CAMERA = (\{[^\n]+\});/)[1]);
 report.entryFraming=[];
 for(const [width,height]of [[1280,720],[390,844],[844,390]])for(const sign of [-1,1]){
  const aspect=width/height,profile=entryCameras[aspect<.8?'portrait':'wide'],camera=new pc.Entity('EntryFrameCheck');app.root.addChild(camera);
  camera.addComponent('camera',{fov:48,nearClip:2,farClip:1400,aspectRatioMode:pc.ASPECT_MANUAL,aspectRatio:aspect});
  const u=(AGORA.stairStart+AGORA.stairEnd)/2,from=AGORA.frame.at(u,profile.out),to=AGORA.frame.at(u,0);
  camera.setPosition(from.x,profile.y,from.z*sign);camera.lookAt(to.x,1.2,to.z*sign);
  Object.assign(app.graphicsDevice.clientRect,{width,height});
  const points=[];
  for(const side of [AGORA.stairStart,AGORA.stairEnd])for(const out of [0,AGORA.run])for(const rail of [0,.84]){
   const p=AGORA.frame.at(side,out),y=AGORA.height*(1-out/AGORA.run)+rail;
   const s=camera.camera.worldToScreen(new pc.Vec3(p.x,y,p.z*sign));
   assert.ok(s.x>width*.08&&s.x<width*.92&&s.y>height*.08&&s.y<height*.92,'entry/stair guard retains frame margin');points.push(s.toArray());
  }
  if(aspect<.8)assert.ok(points.some(p=>p[0]>width*.8),'valid CSS projection extends beyond the 80% mobile framebuffer width');
  report.entryFraming.push({width,height,sign,points});camera.destroy();
 }
 for(let cycle=0;cycle<3;cycle++){
  stage(`cycle ${cycle} start`);
  const root=new pc.Entity('NorthRestorationCampus'),sign=cycle%2?1:-1;root.setLocalScale(1,1,sign);app.root.addChild(root);
  const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,root,registry),base=renderer.base;
  stage(`cycle ${cycle} base ready`);
  const targets=ids.map(id=>base.children.filter(e=>e.name===id));assert.ok(targets.every(g=>g.length===1));
  const sourceMaterials=new Set(targets.flat().flatMap(meshes).map(m=>m.material));
  const states=new Map([...sourceMaterials].map(m=>[m,{alpha:m.alphaDither,dither:m.opacityDither,opacity:m.opacity}]));
  for(const id of ['bldg_05_clock_core','bldg_60th_tower']){
   const node=base.findByName(id),c=FACILITY_COLLIDERS.find(c=>c.id===id);assert.ok(node&&c);
   assert.equal(node.worldScaleSign,sign);const positions=[];node.render.meshInstances[0].mesh.getPositions(positions);
   assert.equal(Math.min(...positions.filter((_,i)=>i%3===1)),c.minY);
   assert.equal(Math.max(...positions.filter((_,i)=>i%3===1)),c.maxY);
  }
  const paving=base.children.filter(e=>e.name.startsWith('north_campus_roads_')).flatMap(meshes).map(m=>m.mesh);
  assert.ok(paving.length>0,'north paving uses existing BASE owner');
  const baseHash=hash(base),chunks=registry.chunks.filter(c=>c.facilities.some(id=>ids.includes(id))),tierReceipts=[];
  for(const chunk of chunks){
   stage(`cycle ${cycle} ${chunk.id} start`);
   const h=renderer.create(chunk);renderer.setState(h,'ACTIVE');renderer.update(1);
   const near=h.near,detail=h.detail,clones=new Set([...meshes(near),...meshes(detail)].map(m=>m.material));
   for(const m of clones){assert.ok(!sourceMaterials.has(m));assert.equal(m.alphaDither,1);assert.equal(m.opacityDither,pc.DITHER_BAYER8);}
   for(const mi of [...meshes(near),...meshes(detail)]){const p=[];mi.mesh.getPositions(p);assert.ok(p.length>0&&p.every(Number.isFinite));assert.equal(mi.material.depthWrite,true);}
   const geometry=hash(h.root),counts={near:meshes(near).length,detail:meshes(detail).length};
   renderer.setState(h,'FAR');renderer.update(1);assert.equal(near.enabled,false);assert.equal(detail.enabled,false);assert.deepEqual(hash(base),baseHash);
   renderer.setState(h,'ACTIVE');renderer.update(1);assert.ok(h.near===near,'same near owner');assert.ok(h.detail===detail,'same detail owner');assert.deepEqual(hash(h.root),geometry);
   // Other facilities in the same chunk use engine-cached primitive meshes.
   // They are not owned by this restoration; only assert disposal of our
   // generated target buffers, while exercising the actual shared chunk.
   const targets=[near,detail].flatMap(layer=>layer.children.filter(e=>ids.some(id=>e.name===`${id}_NEAR`||e.name===`${id}_DETAIL`)));
   const owned=[...new Set(targets.flatMap(meshes).map(m=>m.mesh))];renderer.destroy(h);assert.equal(renderer.fades.size,0);
   for(const m of owned)assert.ok(m.vertexBuffer===null,'streamed mesh buffer released');tierReceipts.push({chunk:chunk.id,...counts});
   stage(`cycle ${cycle} ${chunk.id} disposed`);
  }
  for(const [m,s]of states)assert.deepEqual({alpha:m.alphaDither,dither:m.opacityDither,opacity:m.opacity},s);
  const owned=[...targets.flat().flatMap(meshes).map(m=>m.mesh),...paving],receipt={cycle,sign,baseTargetMeshes:owned.length,chunks:tierReceipts};
  root.destroy();for(const mesh of owned)assert.ok(mesh.vertexBuffer===null,'base target mesh released');report.cycles.push(receipt);
  stage(`cycle ${cycle} disposed`);
 }
 console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
