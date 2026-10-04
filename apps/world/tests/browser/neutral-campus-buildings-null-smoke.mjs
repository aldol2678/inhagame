// Real PlayCanvas mesh/material integration without a browser or pixels.
// This complements, and never replaces, the graphical browser smoke.
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';

const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const {FACILITIES}=await import('../../src/campus-facilities.js');
const {resolveWorldForgeBuilding}=await import('../../src/worldforge-campus-building-import.js');
const {fillNeutralCampusBuilding}=await import('../../src/neutral-campus-buildings.js');
const {FacilityMeshBatch}=await import('../../src/facility-mesh-batch.js');
const {neutralFacadeSurface}=await import('../../src/neutral-facade-materials.js');
const {surface}=await import('../../src/campus-render-kit.js');

const canvas={id:'neutral-campus-null-qa',width:512,height:512};
const device=new pc.NullGraphicsDevice(canvas),app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=device;options.componentSystems=[pc.RenderComponentSystem];app.init(options);
const totals={BASE:{meshes:0,vertices:0},NEAR:{meshes:0,vertices:0}};
const sourceMaterials={BASE:new Set(),NEAR:new Set()};
for(let cycle=0;cycle<3;cycle++)for(const tier of ['BASE','NEAR']){
  const root=new pc.Entity('ReflectedWorld');app.root.addChild(root);root.setLocalScale(1,1,-1);
  for(const f of FACILITIES.filter(f=>f.kind==='building')){
    const batch=new FacilityMeshBatch();
    fillNeutralCampusBuilding(batch,resolveWorldForgeBuilding(f),tier);
    batch.finish(root,f.id,{castShadows:tier==='BASE',materialForColor:tier==='NEAR'?neutralFacadeSurface:surface});
  }
  const renders=root.findComponents('render');assert.equal(renders.length,42);
  for(const render of renders)for(const instance of render.meshInstances){
    assert.ok(instance.mesh.vertexBuffer.numVertices>0);
    assert.equal(render.castShadows,tier==='BASE');
    if(cycle===0){
      sourceMaterials[tier].add(instance.material);
      totals[tier].meshes++;totals[tier].vertices+=instance.mesh.vertexBuffer.numVertices;
    }else assert.ok(sourceMaterials[tier].has(instance.material),'reuse material across rebuild');
    if(tier==='NEAR'){
      assert.equal(instance.material.depthBias,-1);
      const clone=instance.material.clone();
      assert.equal(clone.depthBias,-1);assert.equal(clone.slopeDepthBias,-1);clone.destroy();
    }
  }
  assert.equal(sourceMaterials[tier].size,2);
  root.destroy();
}
assert.deepEqual(totals,{BASE:{meshes:42,vertices:2469},NEAR:{meshes:42,vertices:29262}});
console.log(JSON.stringify({engine:pc.version,device:'NullGraphicsDevice (no pixels)',cycles:3,totals,materialReuseAndCloneBias:'PASS'}));
