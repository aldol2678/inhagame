// Real pinned PlayCanvas lifecycle/geometry checks. Null device is not visual QA.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:0,height:0,getContext(){return {measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {FACILITY_COLLIDERS}=await import('../../src/campus-facilities.js');
const canvas={id:'north-landmarks-null',width:512,height:512},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=e=>e.findComponents('render').flatMap(c=>c.meshInstances);
const hash=e=>meshes(e).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const ids=['bldg_05','bldg_60th','fac_agora_courtyard','bldg_06','bldg_09'];
const report={device:'NullGraphicsDevice: no pixels',engine:pc.version,cycles:[]};
const stage=(label)=>console.error(JSON.stringify({stage:label,rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
try{
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
  const owned=targets.flat().flatMap(meshes).map(m=>m.mesh),receipt={cycle,sign,baseTargetMeshes:owned.length,chunks:tierReceipts};
  root.destroy();for(const mesh of owned)assert.ok(mesh.vertexBuffer===null,'base target mesh released');report.cycles.push(receipt);
  stage(`cycle ${cycle} disposed`);
 }
 console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
