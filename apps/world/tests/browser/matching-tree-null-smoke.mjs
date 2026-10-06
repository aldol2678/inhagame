// Pinned-engine geometry and actual movement/camera controllers. No pixel claim.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.document={getElementById(){return null;},addEventListener(){},removeEventListener(){},createElement(){return {width:0,height:0,getContext(){return {measureText:t=>({width:t.length*45}),fillText(){}}}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {VIEW_DISTANCE_PRESETS}=await import('../../src/view-distance.js');
const {MATCHING_TREE:T}=await import('../../src/matching-tree-layout.js');
const {SEAT_ANCHORS,GROUND_ORIGIN_Y,SIT_HIP_HEIGHT}=await import('../../src/seat-anchors.js');
const {createSeatInteraction}=await import('../../src/seat-interaction.js');
const {PlayerController}=await import('../../src/player-controller.js');
const {OrbitCameraController}=await import('../../src/orbit-camera-controller.js');
const {canOccupy}=await import('../../src/world-collision.js');
const {getPlaceZoneAt}=await import('../../src/place-zone-registry.js');
const {campusMaterialCacheStatus}=await import('../../src/campus-render-kit.js');
const seats=SEAT_ANCHORS.filter(a=>a.id.startsWith('SEAT_MATCHING_TREE_'));
assert.equal(seats.length,2);
const canvas={id:'matching-tree-null',width:1280,height:720,clientHeight:720,addEventListener(){}};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=root=>meshes(root).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const report={engine:pc.version,device:'NullGraphicsDevice; no browser, pixel, hardware or real-account evidence',cycles:[],movement:[],cameraPoses:0};
let materialCount;
try{
 for(let cycle=0;cycle<3;cycle++){
  const frame=new pc.Entity('MatchingTreeFrame');frame.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(frame);
  const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,frame,registry);
  const owners=renderer.base.children.filter(e=>e.name===T.id);assert.equal(owners.length,1);
  const tree=owners[0],original=fingerprint(tree),resources=meshes(tree);assert.equal(resources.length,3);
  let triangles=0,bytes=0;
  for(const mi of resources){
   const p=[],n=[],ix=[];mi.mesh.getPositions(p);mi.mesh.getNormals(n);mi.mesh.getIndices(ix);
   assert.ok(p.length&&p.length===n.length&&[...p,...n].every(Number.isFinite));
   assert.equal(mi.material.opacity,1);assert.equal(mi.material.depthWrite,true);
   assert.equal(mi.node.parent,tree);triangles+=ix.length/3;bytes+=mi.mesh.vertexBuffer.storage.byteLength+mi.mesh.indexBuffer[0].storage.byteLength;
  }
  assert.ok(triangles<1200&&bytes<100000);
  // Float32 engine mesh positions must support the same anchor tops as the layout.
  const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
  for(const seat of seats){
   const y=seat.position.y-GROUND_ORIGIN_Y+SIT_HIP_HEIGHT,p=[seat.position.x,y,seat.position.z];let supported=false;
   for(const mi of resources){const v=[],ix=[];mi.mesh.getPositions(v);mi.mesh.getIndices(ix);
    for(let i=0;i<ix.length;i+=3){const q=ix.slice(i,i+3).map(k=>v.slice(k*3,k*3+3));
     if(q.every(v=>Math.abs(v[1]-y)<1e-5)&&cross(...q)<-1e-9&&q.every((a,k)=>cross(a,q[(k+1)%3],p)<1e-5))supported=true;
    }
   }assert.ok(supported,seat.id+' must be supported by actual engine triangles');
  }
  const chunk=registry.chunks.find(c=>c.facilities.includes(T.id));assert.ok(chunk);const handle=renderer.create(chunk);
  for(const policy of [VIEW_DISTANCE_PRESETS.SHORT,VIEW_DISTANCE_PRESETS.MAX])for(const state of ['ACTIVE','FAR','VISTA','NEAR','ACTIVE']){
   renderer.setViewPolicy(policy);renderer.setState(handle,state);renderer.update(1);
   assert.ok(tree.enabled&&renderer.base.enabled);assert.deepEqual(fingerprint(tree),original);
   assert.equal(meshes(handle.root).filter(mi=>mi.node.name.startsWith(T.id+'_')).length,0,'no streamed duplicate tree');
  }
  const count=campusMaterialCacheStatus().materialCount;if(materialCount!==undefined)assert.equal(count,materialCount);materialCount=count;
  renderer.destroy(handle);assert.equal(renderer.fades.size,0);
  const owned=resources.map(m=>m.mesh);frame.destroy();assert.ok(owned.every(m=>m.vertexBuffer===null&&m.indexBuffer.every(b=>b===null)));
  report.cycles.push({cycle,reflection:cycle%2?-1:1,meshes:resources.length,triangles,bytes,materialCount,stable:true,disposed:true});
 }
 const player=new pc.Entity('MatchingTreePlayer'),camera=new pc.Entity('MatchingTreeCamera');app.root.addChild(player);app.root.addChild(camera);camera.addComponent('camera');
 const controller=new PlayerController(player,{campusShuttleEnabled:false}),orbit=new OrbitCameraController(camera,canvas);
 let zone='AREA_CENTRAL_LAWN';
 const seating=createSeatInteraction({player,controller,places:{getCurrentPlaceZone:()=>({id:zone})}});
 const clear=()=>{controller.keys.clear();controller.touchVector.x=controller.touchVector.y=0;controller.jumpQueued=false;controller.ascendHeld=false;controller.velocityY=0;controller.grounded=true;controller.mounted=false;zone='AREA_CENTRAL_LAWN';};
 const place=p=>{clear();player.setLocalPosition(p.x,p.y??GROUND_ORIGIN_Y,p.z);};
 const walk=target=>{
  let ticks=0;
  for(;ticks<100;ticks++){const p=player.getLocalPosition(),d=flat(p,target);if(d<.005)break;
   const throttle=Math.min(1,d/(controller.walkSpeed/60));controller.touchVector.x=(target.x-p.x)/d*throttle;controller.touchVector.y=-(target.z-p.z)/d*throttle;
   if(!seating.beforeController())controller.update(1/60,0);assert.ok(canOccupy(player.getLocalPosition()));
  }
  controller.touchVector.x=controller.touchVector.y=0;assert.ok(flat(player.getLocalPosition(),target)<.005,'movement must reach safe target');return ticks;
 };
 for(const seat of seats){
  const start={x:seat.standPoint.x+T.front.x*2,z:seat.standPoint.z+T.front.z*2};place(start);
  const approachTicks=walk(seat.standPoint);assert.equal(seating.refreshNearby()?.id,seat.id);
  for(const mode of ['explicit','keyboard','touch','jump','zone','mount']){
   place(seat.standPoint);seating.refreshNearby();assert.equal(seating.toggle(),true);
   assert.ok(flat(player.getLocalPosition(),seat.position)<1e-9);assert.ok(Math.abs(player.getLocalPosition().y-seat.position.y)<1e-9);
   for(let i=0;i<60;i++)assert.equal(seating.beforeController(),true,'idle must remain seated');
   for(const aspect of [1280/720,390/844,844/390])for(const firstPerson of [false,true])for(const yaw of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
    camera.camera.aspectRatioMode=pc.ASPECT_MANUAL;camera.camera.aspectRatio=aspect;
    orbit.firstPerson=firstPerson;orbit.yaw=yaw;orbit.apply(player.getLocalPosition());
    assert.ok([...camera.getPosition().toArray(),...camera.getEulerAngles().toArray()].every(Number.isFinite));
    assert.equal(seating.beforeController(),true,'camera updates cannot release seating');report.cameraPoses++;
   }
   if(mode==='explicit')assert.equal(seating.toggle(),true);
   if(mode==='keyboard')controller.keys.add('KeyW');
   if(mode==='touch')controller.touchVector.x=.5;
   if(mode==='jump')controller.jumpQueued=true;
   if(mode==='zone')zone='AREA_MAIN_HALL';
   if(mode==='mount')controller.mounted=true;
   assert.equal(seating.beforeController(),false);assert.ok(flat(player.getLocalPosition(),seat.standPoint)<1e-9);assert.ok(canOccupy(player.getLocalPosition()));
   let apex=player.getLocalPosition().y;
   if(mode==='jump'){
    for(let i=0;i<80;i++){controller.update(1/60,0);apex=Math.max(apex,player.getLocalPosition().y);assert.ok(canOccupy(player.getLocalPosition()));}
    assert.ok(apex>GROUND_ORIGIN_Y+.5);assert.ok(Math.abs(player.getLocalPosition().y-GROUND_ORIGIN_Y)<1e-8);assert.equal(controller.grounded,true);
   }
   clear();const walkTicks=walk({x:seat.standPoint.x+T.front.x,z:seat.standPoint.z+T.front.z});
   assert.equal(getPlaceZoneAt(player.getLocalPosition())?.id,'AREA_CENTRAL_LAWN');
   report.movement.push({seat:seat.id,mode,approachTicks,walkTicks,apex,passed:true});
  }
 }
 player.destroy();camera.destroy();report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
