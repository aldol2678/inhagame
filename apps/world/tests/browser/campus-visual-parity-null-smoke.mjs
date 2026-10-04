// Real pinned PlayCanvas ownership/streaming check. Null device is not pixel proof.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
// Only unrelated text-label 2D canvases need a host shim.
globalThis.document={addEventListener(){},removeEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:0,height:0,getContext(type){assert.equal(type,'2d');return {measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engine:specifier,context);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {LIBRARY_GREENS}=await import('../../src/library-garden-layout.js');
const canvas={id:'campus-visual-parity-null',width:512,height:512};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=root=>meshes(root).map(mi=>createHash('sha256').update(new Uint8Array(mi.mesh.vertexBuffer.storage)).digest('hex'));
const report={engine:pc.version,device:'NullGraphicsDevice, no visual evidence',cycles:[]};
try{
 for(let cycle=0;cycle<3;cycle++){
  const campus=new pc.Entity('parityCampus');campus.setLocalScale(1,1,cycle%2===0?-1:1);app.root.addChild(campus);
  const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,campus,registry);
  const targets=renderer.base.children.filter(e=>/^(back_alley_base_|library_garden_|stadium_stands_)/.test(e.name));
  for(const prefix of ['back_alley_base_','library_garden_','stadium_stands_'])assert.ok(targets.some(e=>e.name.startsWith(prefix)),`${prefix} has a persistent real mesh`);
  assert.equal(renderer.base.children.filter(e=>e.name==='campus_terrain_garden_floor').length,1,'exactly one unchanged garden floor owner');
  for(const e of targets){assert.equal(e.worldScaleSign,cycle%2===0?-1:1);for(const mi of meshes(e)){const p=[];mi.mesh.getPositions(p);assert.ok(p.length>0&&p.every(Number.isFinite));assert.equal(mi.material.opacity,1);assert.equal(mi.material.depthWrite,true);}}
  const sources=new Set(targets.flatMap(meshes).map(mi=>mi.material));const states=new Map([...sources].map(m=>[m,{alpha:m.alphaDither,opacity:m.opacity,dither:m.opacityDither}]));
  const stable=fingerprint(renderer.base),chunk=registry.chunks.find(c=>c.streetscape.includes(LIBRARY_GREENS[0].id));assert.ok(chunk);
  const handle=renderer.create(chunk);renderer.setState(handle,'ACTIVE');renderer.update(1);
  const near=handle.near,detail=handle.detail,clones=[...new Set(meshes(detail).map(mi=>mi.material))];assert.ok(meshes(detail).length>0);
  for(const m of clones){assert.ok(!sources.has(m));assert.equal(m.alphaDither,1);}
  renderer.setState(handle,'FAR');renderer.update(1);assert.equal(near.enabled,false);assert.equal(detail.enabled,false);
  assert.deepEqual(fingerprint(renderer.base),stable,'BASE remains present across LOD unload');
  renderer.setState(handle,'ACTIVE');renderer.update(1);assert.equal(handle.near,near);assert.equal(handle.detail,detail);
  renderer.destroy(handle);assert.equal(renderer.fades.size,0);
  for(const [m,s] of states)assert.deepEqual({alpha:m.alphaDither,opacity:m.opacity,dither:m.opacityDither},s,'fade never mutates source materials');
  const targetMeshes=[...new Set(targets.flatMap(meshes).map(mi=>mi.mesh))];
  const receipt={cycle,reflection:cycle%2===0?-1:1,baseTargetEntities:targets.length,targetMeshes:targetMeshes.length,detailClones:clones.length};
  campus.destroy();for(const mesh of targetMeshes)assert.equal(mesh.vertexBuffer,null,'custom target buffers released with parent');
  report.cycles.push(receipt);
 }
 console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
