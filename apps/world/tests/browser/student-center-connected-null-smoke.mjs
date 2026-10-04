import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,n){return n(s==='playcanvas'?engineUrl:s,c);}});
const pc=await import('playcanvas');
const {buildStudentCenterConnected}=await import('../../src/student-center-connected-renderer.js');
const canvas={id:'student-candidate-null',width:512,height:512};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
const invalidRoot=new pc.Entity('InvalidCandidate');app.root.addChild(invalidRoot);assert.throws(()=>buildStudentCenterConnected(invalidRoot,'BASE',{view:'bad'}));assert.equal(invalidRoot.children.length,0,'invalid input leaves no attached nodes');invalidRoot.destroy();
const materials=new Set(),totals={};
for(let cycle=0;cycle<3;cycle++)for(const view of ['connected','cutaway'])for(const space of ['local','world']){
 const root=new pc.Entity('Candidate');app.root.addChild(root);root.setLocalScale(1,1,-1);
 assert.equal(root.worldScaleSign,-1);
 const captured=[];
 for(const tier of ['BASE','NEAR','DETAIL']){
  const node=buildStudentCenterConnected(root,tier,{view,space});
  const mi=node.findComponents('render').flatMap(r=>r.meshInstances);captured.push(...mi);
  const value={meshes:mi.length,vertices:mi.reduce((sum,m)=>sum+m.mesh.vertexBuffer.numVertices,0)};
  assert.ok(value.meshes<=12);assert.ok(value.vertices<25000);
  if(tier==='DETAIL')assert.equal(value.vertices,0);
  const key=space+':'+view+':'+tier;if(cycle===0)totals[key]=value;else assert.deepEqual(value,totals[key]);
  for(const m of mi){
   if(cycle===0)materials.add(m.material);else assert.ok(materials.has(m.material));
   const clone=m.material.clone();assert.equal(clone.depthBias,m.material.depthBias);clone.destroy();
   const storage=new Float32Array(m.mesh.vertexBuffer.lock());assert.ok([...storage].every(Number.isFinite));m.mesh.vertexBuffer.unlock();
   const mesh=m.mesh,buffer=mesh.vertexBuffer;let calls=0,original=buffer.destroy.bind(buffer);buffer.destroy=()=>{calls++;original();};m.assertDisposed=()=>{assert.equal(calls,1);assert.equal(mesh.vertexBuffer,null);};
  }
 }
 root.destroy();captured.forEach(m=>m.assertDisposed());
}
console.log(JSON.stringify({engine:pc.version,device:'NullGraphicsDevice: no pixels',cycles:3,views:2,coordinateSpaces:2,totals,disposeOnce:true,materialsReused:true}));
