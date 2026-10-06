import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,export class StandardMaterial{update(){}};export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}',shortCircuit:true}:next(s,c);}});
const {FACILITIES}=await import('../src/campus-facilities.js');
const {SITE_FEATURES}=await import('../src/basic-campus.js');
const {geoToWorld}=await import('../src/geo-coordinates.js');
const {polygonOverlap}=await import('../src/polygon-collision.js');
const {canOccupy,moveAroundObstacles}=await import('../src/world-collision.js');
const {roadviewGroundHeight}=await import('../src/roadview-layout.js');
const {getPlaceZoneAt}=await import('../src/place-zone-registry.js');
const {SEAT_ANCHORS,GROUND_ORIGIN_Y,SIT_HIP_HEIGHT,findSeat}=await import('../src/seat-anchors.js');
const {createSeatInteraction}=await import('../src/seat-interaction.js');
const {createRealtimeWorld,createWorldClient,runWorld}=await import('./support/online-world-harness.mjs');
const {FacilityMeshBatch}=await import('../src/facility-mesh-batch.js');
const layoutUrl=new URL('../src/matching-tree-layout.js',import.meta.url),geometryUrl=new URL('../src/matching-tree-geometry.js',import.meta.url);
const layout=existsSync(layoutUrl)?await import(layoutUrl):{},geometry=existsSync(geometryUrl)?await import(geometryUrl):{};
const target=FACILITIES.find(f=>f.id==='lmk_matching_tree');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const anchors=()=>SEAT_ANCHORS.filter(a=>a.id.startsWith('SEAT_MATCHING_TREE_'));
const ring=id=>SITE_FEATURES.find(f=>f.id===id).vertices;

test('matching tree moves into the official map’s gate-side east lawn with explicitly estimated provenance',()=>{
 assert.ok(polygonOverlap(target.center.x,target.center.z,ring('site_258995412')),'must leave old main-building-side quadrant');
 assert.equal(polygonOverlap(target.center.x,target.center.z,ring('site_218221011')),false);
 assert.equal(target.lat,37.44792);assert.equal(target.lon,126.65378);
 assert.deepEqual(target.center,geoToWorld(target.lat,target.lon));
 assert.match(target.geometryAccuracy,/estimated|estimate/i);assert.match(target.geometryAccuracy,/uncertainty not quantified/i);
 assert.equal(target.positionEvidencePath,'matching-tree-placement.provenance.json');
});
test('two new natural-branch seats share the actual rendered surface and an open-side yaw',()=>{
 assert.ok(layout.MATCHING_TREE,'one shared layout authority');assert.equal(typeof geometry.fillMatchingTree,'function');
 const seats=anchors();assert.equal(seats.length,2);assert.deepEqual(seats.map(s=>s.id),['SEAT_MATCHING_TREE_A','SEAT_MATCHING_TREE_B']);
 const batch=new FacilityMeshBatch();geometry.fillMatchingTree(batch);let supported=0;
 const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
 for(const seat of seats){
  const supportY=seat.position.y-GROUND_ORIGIN_Y+SIT_HIP_HEIGHT;
  assert.ok(Math.abs(supportY-layout.MATCHING_TREE.seatTopY)<1e-9);
  const expected=Math.atan2(seat.approachDirection.x,seat.approachDirection.z)*180/Math.PI;
  assert.ok(Math.abs(seat.yaw-expected)<1e-9);
  for(const g of batch.groups.values())for(let i=0;i<g.indices.length;i+=3){
   const v=g.indices.slice(i,i+3).map(k=>g.positions.slice(k*3,k*3+3)),p=[seat.position.x,supportY,seat.position.z];
   if(v.every(v=>Math.abs(v[1]-supportY)<1e-8)&&cross(...v)<-1e-10&&v.every((a,k)=>cross(a,v[(k+1)%3],p)<=1e-8)){supported++;break;}
  }
 }
 assert.ok(supported>=2,'both anchors must have a real upward branch facet below them');
});
test('map-estimated location has inspectable provenance without fabricated survey precision',()=>{
 const source=new URL('../data/reality/matching-tree-placement.provenance.json',import.meta.url);
 assert.ok(existsSync(source),'placement must link a real provenance record');
 const proof=JSON.parse(readFileSync(source,'utf8'));
 assert.equal(proof.featureId,target.id);assert.deepEqual(proof.selectedCoordinate,{lat:target.lat,lon:target.lon});
 assert.equal(proof.surveyed,false);assert.equal(proof.horizontalUncertaintyMetres,null);
 assert.ok(proof.sources.some(s=>s.url==='https://www.inha.ac.kr/sites/kr/files/campusmap_front.jpg'));
 assert.equal(proof.lawnSourceId,'site_258995412');assert.equal(proof.photosShipped,false);
 assert.match(proof.method,/illustrat/i);assert.match(proof.limitations,/bearing|orientation/i);
});
test('approach, seated and stand positions retain one place zone and safe walk-out',()=>{
 const seats=anchors();assert.equal(seats.length,2);
 for(const seat of seats){
  for(const p of [seat.position,seat.standPoint]){assert.equal(getPlaceZoneAt(p)?.id,'AREA_CENTRAL_LAWN');assert.equal(roadviewGroundHeight(p.x,p.z),0);assert.ok(canOccupy(p));assert.ok(polygonOverlap(p.x,p.z,ring('site_258995412')));}
  assert.equal(findSeat(seat.standPoint)?.id,seat.id);
  const behind={x:seat.position.x-seat.approachDirection.x,z:seat.position.z-seat.approachDirection.z};
  assert.equal(findSeat(behind,{anchors:seats}),null,'no approach through the rear of the branch');
  const moved=moveAroundObstacles(seat.standPoint,seat.approachDirection.x*1.2,seat.approachDirection.z*1.2);
  assert.ok(Math.hypot(moved.x-seat.standPoint.x,moved.z-seat.standPoint.z)>1.1);
 }
 const d=Math.hypot(seats[0].position.x-seats[1].position.x,seats[0].position.z-seats[1].position.z);
 assert.ok(Math.abs(d-.54)<1e-8);assert.equal(findSeat(seats[0].standPoint,{anchors:seats,occupants:[seats[0].position]})?.id,seats[1].id);
 assert.equal(findSeat(seats[0].standPoint,{anchors:seats,occupants:seats.map(s=>s.position)}),null);
});
test('new matching-tree geometry is finite and bounded with clear upper trunks',()=>{
 assert.equal(typeof geometry.fillMatchingTree,'function');const batch=new FacilityMeshBatch();geometry.fillMatchingTree(batch);
 let n=0;for(const g of batch.groups.values()){assert.ok(g.positions.every(Number.isFinite));n+=g.indices.length/3;}
 assert.ok(n<1200);assert.ok(batch.groups.size<=3);
 const tree=layout.MATCHING_TREE;
 for(const p of tree.branches.flat())if(p.y>=tree.seatTopY+.2&&p.y<=tree.seatTopY+1.0)
  for(const u of [-.27,.27])assert.ok(Math.abs(p.u-u)-p.radius>=.34,'torso/lean clearance from each upright');
});
test('all existing seats and non-target facilities remain byte-equivalent to the grove baseline',()=>{
 assert.equal(hash(SEAT_ANCHORS.filter(s=>!s.id.startsWith('SEAT_MATCHING_TREE_'))),'7a6f1faefbcc35b1c5e91078c88c03c4a83d1c4ef620914485f148c852fce106');
 assert.equal(hash(FACILITIES.filter(f=>f.id!=='lmk_matching_tree')),'3a867a698b919ded3c9b5f7153d5d642a47acd8eb60807314c5ad0f3bde7640f');
});
test('paired branch seats reuse guest/member pose and occupancy with clean account turnover',async()=>{
 const [first,second]=anchors(),world=createRealtimeWorld();
 const a=createWorldClient(world,{label:'TreeA',at:first.standPoint}),b=createWorldClient(world,{label:'TreeB',user:null,at:second.standPoint});
 const rig=client=>{
  const seating=createSeatInteraction({player:client.local.entity,controller:client.local.controller,places:client.places,getOnline:()=>client.online});
  Object.defineProperty(client.seat,'seated',{get:()=>seating.seats.isSeated});return seating;
 };
 const sa=rig(a),sb=rig(b);await runWorld(world,800);
 assert.equal(a.online.status().placeZone,'AREA_CENTRAL_LAWN');
 assert.equal(sa.refreshNearby()?.id,first.id);assert.equal(sa.toggle(),true);
 await runWorld(world,180);
 assert.equal(sb.refreshNearby()?.id,second.id);assert.equal(sb.toggle(),true);
 await runWorld(world,180);
 assert.equal(a.online.remoteSeatedPositions().length,1);assert.equal(b.online.remoteSeatedPositions().length,1);
 assert.equal(findSeat(first.standPoint,{anchors:anchors(),occupants:[...a.online.remoteSeatedPositions(),a.local.pos]}),null);
 const oldSid=a.online.status().sessionId;
 a.lib.clients.find(c=>c.storageKey==='default').signIn({id:'tree-next-account',is_anonymous:false});
 await runWorld(world,1000);
 const nextSid=a.online.status().sessionId;assert.notEqual(nextSid,oldSid);
 assert.equal(b.online.network.remotes.get(oldSid),null,'old account cannot leave a ghost occupant');
 assert.deepEqual(b.online.remoteSeatedPositions().map(p=>p.sessionId),[nextSid]);
 assert.equal(sa.seats.isSeated,true,'account transport does not change the local seat controller');
 assert.equal(sa.toggle(),true);await runWorld(world,180);
 assert.equal(b.online.remoteSeatedPositions().length,0);assert.ok(canOccupy(a.local.pos));
 world.server.dropClient(b.online.transport.client);await runWorld(world,180);
 assert.equal(a.online.remoteSeatedPositions().length,0,'disconnect releases remote occupancy');
});
