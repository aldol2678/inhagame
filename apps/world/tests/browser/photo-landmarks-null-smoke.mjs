// Real engine integration, including the production negative-Z parent, but no pixels.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const {buildCampusFacilities}=await import('../../src/facility-blockout.js');
const {FACILITIES}=await import('../../src/campus-facilities.js');
const {buildMainHallBlockout}=await import('../../src/main-hall-blockout.js');
const {photoLandmarkSurface}=await import('../../src/photo-landmark-materials.js');
const {PHOTO_STUDENT_COLORS:c}=await import('../../src/photo-student-center.js');
const canvas={id:'photo-landmarks-null',width:512,height:512};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
let expected=null;
const materials=new Set();
for(let cycle=0;cycle<3;cycle++){
 const root=new pc.Entity('PhotoLandmarks');app.root.addChild(root);root.setLocalScale(1,1,-1);assert.equal(root.worldScaleSign,-1,'production reflected parent');
 const totals={};
 for(const tier of ['BASE','NEAR','DETAIL']){
   const node=new pc.Entity(tier);root.addChild(node);
   buildCampusFacilities(node,['bldg_07'],tier);buildMainHallBlockout(node,['bldg_01','bldg_jungseok'],tier);
   const renders=node.findComponents('render'),instances=renders.flatMap(r=>r.meshInstances);
   totals[tier]={meshes:instances.length,vertices:instances.reduce((n,m)=>n+m.mesh.vertexBuffer.numVertices,0)};
   assert.ok(totals[tier].meshes<110,`${tier} draw-call bound`);assert.ok(totals[tier].vertices<30000,`${tier} vertex bound`);
   if(tier==='BASE')assert.equal(renders.filter(r=>r.entity.name.includes('bldg_07_photo_envelope')).length,2);
   if(tier==='NEAR'){
     const student=renders.filter(r=>r.entity.name.includes('bldg_07_photo_facade'));
     assert.equal(student.length,5,'student material batches');
     for(const render of student)for(const m of render.meshInstances){
       assert.ok(m.material.depthBias===-1||m.material.depthBias===-2);
       const clone=m.material.clone();assert.equal(clone.depthBias,m.material.depthBias);assert.equal(clone.slopeDepthBias,m.material.slopeDepthBias);clone.destroy();
     }
   }
   if(tier==='DETAIL')assert.equal(renders.filter(r=>r.entity.name.includes('bldg_07')).length,0);
   for(const m of instances){assert.ok(m.mesh.vertexBuffer.numVertices>0);if(cycle===0)materials.add(m.material);else assert.ok(materials.has(m.material),'rebuild shares source material');}
 }
 if(cycle===0)expected=totals;else assert.deepEqual(totals,expected);root.destroy();
}
assert.equal(photoLandmarkSurface(c.trim).depthBias,-2);assert.equal(photoLandmarkSurface(c.warmWindow).depthBias,-2);assert.equal(photoLandmarkSurface(c.glass).depthBias,-1);
const campus=new pc.Entity('CampusBinding');app.root.addChild(campus);
// The unchanged dormitory NEAR sign requires a real canvas; leave it to browser QA.
const campusBinding={};
for(const tier of ['BASE','NEAR']){const node=new pc.Entity(tier);campus.addChild(node);buildCampusFacilities(node,FACILITIES.filter(f=>f.kind==='building'&&(tier==='BASE'||f.id!=='bldg_dorm1')).map(f=>f.id),tier);const names=node.findComponents('render').map(r=>r.entity.name);const suffix=tier==='BASE'?'envelope':'facade';campusBinding[tier]={neutral:names.filter(n=>n.includes('_neutral_'+suffix+'_')).length,photo:names.filter(n=>n.includes('_photo_'+suffix+'_')).length};}
assert.deepEqual(campusBinding,{BASE:{neutral:40,photo:2},NEAR:{neutral:38,photo:5}});campus.destroy();
console.log(JSON.stringify({engine:pc.version,device:'NullGraphicsDevice (no pixels)',cycles:3,totals:expected,campusBinding,cloneBiasAndMaterialReuse:'PASS'}));
