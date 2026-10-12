// Real pinned PlayCanvas + room renderer. Null device proves geometry/lifecycle, not pixels.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const labels=[];
globalThis.document={addEventListener(){},removeEventListener(){},body:{append(node){labels.push(node)}},
  createElement(){return {width:0,height:0,style:{},setAttribute(){},remove(){this.removed=true},
    getBoundingClientRect:()=>({width:160}),getContext(){return {measureText:text=>({width:text.length*45}),fillText(){}}}}}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engine:specifier,context)}});
const pc=await import('playcanvas');
const {createDorm1LobbyScene}=await import('../../src/rooms/dorm1-lobby-renderer.js');
const canvas={id:'dorm-vendor-null',width:512,height:512,getBoundingClientRect:()=>({left:0,top:0,width:512,height:512})};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const report={engine:pc.version,device:'NullGraphicsDevice',visualEvidence:false,cycles:[]};
try {
 for(let cycle=0;cycle<3;cycle++) {
  const scene=createDorm1LobbyScene(app,{player:{getLocalPosition:()=>({x:0,z:.85})}}),vendor=scene.shopVendor;
  assert.equal(scene.root.enabled,false);scene.root.enabled=true;app.fire('update',.05);
  assert.equal(vendor.visual.avatar.name,'NPC_TEST_HUMAN_DORM-SHOP-NPC-001');
  const meshes=vendor.visual.avatar.findComponents('render').flatMap(component=>component.meshInstances);
  assert.ok(meshes.length>20);for(const mi of meshes){const positions=[];mi.mesh.getPositions(positions);assert.ok(positions.length>0&&positions.every(Number.isFinite))}
  const position=vendor.visual.avatar.getLocalPosition();assert.equal(position.x,-.75);assert.equal(position.z,2.7);
  assert.ok(Math.abs(vendor.visual.avatar.getPosition().z+2.7)<1e-6,'room mirror applies only once');
  scene.root.enabled=false;app.fire('update',.05);assert.equal(labels.at(-1).hidden,true);
  scene.root.destroy();assert.equal(vendor.disposed,true);assert.equal(labels.at(-1).removed,true);
  vendor.destroy();report.cycles.push({cycle,meshCount:meshes.length,mirror:true,cleanup:true});
 }
 console.log(JSON.stringify(report,null,2));
} finally {app.destroy()}
