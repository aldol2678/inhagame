// Real pinned engine / actual chunk renderer. Null device is not pixel evidence.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return {width:0,height:0,getContext(){return {measureText:text=>({width:text.length*45}),fillText(){}};}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engine:specifier,context);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {BACK_STREET_BLOCKS}=await import('../../src/back-street-layout.js');
const {CULTURE_BUILDINGS}=await import('../../src/culture-street-layout.js');
const {campusMaterialCacheStatus}=await import('../../src/campus-render-kit.js');
const canvas={id:'backgate-facade-null',width:512,height:512};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=roots=>roots.flatMap(meshes).map(mi=>createHash('sha256').update(new Uint8Array(mi.mesh.vertexBuffer.storage)).digest('hex'));
const ids=new Set([...BACK_STREET_BLOCKS,...CULTURE_BUILDINGS].map(q=>q.id));
const report={engine:pc.version,device:'NullGraphicsDevice',visualEvidence:false,cycles:[]};
let warmed;
try {
  for(let cycle=0;cycle<3;cycle++) {
    const parent=new pc.Entity('ShopfrontLifecycle');parent.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(parent);
    const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,parent,registry);
    const base=renderer.base.children.filter(e=>/^(back_street_base_|culture_street_base_)/.test(e.name));
    assert.equal(base.length,25,'12 street and 13 culture material batches, including unchanged paving/canopy');
    const baseMeshes=base.flatMap(meshes),sources=new Set(baseMeshes.map(mi=>mi.material));
    assert.ok(baseMeshes.every(mi=>mi.material.opacity===1&&mi.material.depthWrite));
    const before=fingerprint(base),handles=[];let owned=0,layerMeshes=0;
    for(const chunk of registry.chunks.filter(c=>c.streetscape.some(id=>ids.has(id)))) {
      owned+=chunk.streetscape.filter(id=>ids.has(id)).length;
      const handle=renderer.create(chunk);handles.push(handle);
      renderer.setState(handle,'ACTIVE');renderer.update(1);
      const near=handle.near,detail=handle.detail;
      for(const layer of [near,detail]) {
        const targets=layer.children.filter(e=>/^(back_street_|culture_street_)/.test(e.name));
        for(const mi of targets.flatMap(meshes)) {
          const positions=[];mi.mesh.getPositions(positions);assert.ok(positions.length&&positions.every(Number.isFinite));
          assert.ok(!sources.has(mi.material));assert.equal(mi.material.alphaDither,1);layerMeshes++;
        }
      }
      renderer.setState(handle,'VISTA');renderer.update(1);
      assert.equal(near.enabled,false);assert.equal(detail.enabled,false);assert.deepEqual(fingerprint(base),before);
      renderer.setState(handle,'ACTIVE');renderer.update(1);assert.equal(handle.near,near);assert.equal(handle.detail,detail);
    }
    assert.equal(owned,37);assert.ok(layerMeshes>0);
    const ownedBuffers=[...baseMeshes.map(mi=>mi.mesh),...handles.flatMap(h=>meshes(h.root).map(mi=>mi.mesh))];
    for(const handle of handles)renderer.destroy(handle);
    assert.equal(renderer.fades.size,0);assert.deepEqual(fingerprint(base),before);
    assert.ok(baseMeshes.every(mi=>mi.material.alphaDither===1&&mi.material.opacity===1));
    const materialCount=campusMaterialCacheStatus().materialCount;
    if(warmed!==undefined)assert.equal(materialCount,warmed);warmed=materialCount;
    parent.destroy();assert.ok(ownedBuffers.every(mesh=>mesh.vertexBuffer===null));
    report.cycles.push({cycle,buildings:owned,baseMeshes:base.length,layerMeshes,materialCount,cleanup:true});
  }
  console.log(JSON.stringify(report,null,2));
} finally { app.destroy(); }
