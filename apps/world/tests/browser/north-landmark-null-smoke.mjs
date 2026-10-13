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
 const {walkwayLinearColor}=await import('../../src/north-walkway-batching.js');
 const {inferCampusMaterialProfile}=await import('../../src/campus-material-profile.js');
 const {buildNorthWalkwayRoads}=await import('../../src/north-walkway-renderer.js');
 const sourceBatch=fillNorthRoads(new FacilityMeshBatch());
 for(const color of sourceBatch.groups.keys())assert.deepEqual(walkwayLinearColor(color).slice(0,3),[...surface(color).getUniform('diffuse')],'float32 vertex values match actual pinned engine uniform');
 const batchRoot=new pc.Entity('PavingBatchContract');app.root.addChild(batchRoot);buildNorthWalkwayRoads(batchRoot);
 const batched=meshes(batchRoot);assert.equal(batched.length,3);assert.equal(sourceBatch.groups.size,5);
 assert.equal(batched.reduce((n,mi)=>n+mi.mesh.primitive[0].count/3,0),[...sourceBatch.groups.values()].reduce((n,g)=>n+g.indices.length/3,0));
 for(const mi of batched){
  const attribute=mi.mesh.vertexBuffer.format.elements.find(e=>e.name===pc.SEMANTIC_COLOR);
  assert.equal(attribute.dataType,pc.TYPE_FLOAT32);assert.equal(attribute.normalize,false);
  assert.equal(mi.node.render.castShadows,false);assert.equal(mi.material.diffuseMapVertexColor,true);
  const profile=mi.material.name.replace('north-walkway-vertex-','');
  const reference=surface('#ffffff',profile);
  const originals=[...sourceBatch.groups].filter(([color])=>inferCampusMaterialProfile(color)===profile);
  const positions=[],normals=[],colors=[],indices=[];mi.mesh.getPositions(positions);mi.mesh.getNormals(normals);mi.mesh.getColors(colors);mi.mesh.getIndices(indices);
  assert.deepEqual(positions,[...new Float32Array(originals.flatMap(([,g])=>g.positions))]);
  assert.deepEqual(normals,[...new Float32Array(originals.flatMap(([,g])=>g.normals))]);
  const expectedColors=[],expectedIndices=[];let offset=0;
  for(const [color,g]of originals){for(let v=0;v<g.positions.length/3;v++)expectedColors.push(...walkwayLinearColor(color));expectedIndices.push(...g.indices.map(i=>i+offset));offset+=g.positions.length/3;}
  assert.deepEqual(colors,expectedColors);assert.deepEqual(indices,expectedIndices);

  for(const property of ['gloss','reflectivity','fresnelModel','metalness','useMetalness','opacity','blendType','cull','depthWrite','depthTest'])assert.equal(mi.material[property],reference[property],property+' preserved');
  assert.ok(mi.material.specular.equals(reference.specular));assert.ok(mi.material.diffuse.equals(new pc.Color(1,1,1)));
 }
 const ownMeshes=batched.map(mi=>mi.mesh);batchRoot.destroy();for(const mesh of ownMeshes)assert.equal(mesh.vertexBuffer,null);
 report.pavingBatch={sourceMeshes:5,profileMeshes:3,exactFloat32UniformColors:true,geometryAndMaterialPreserved:true};
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
