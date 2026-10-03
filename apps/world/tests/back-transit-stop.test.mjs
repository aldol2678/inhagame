import test from 'node:test';
import assert from 'node:assert/strict';
import { geoToWorld } from '../src/geo-coordinates.js';
import {
  BACK_GATE_511_STOP,
  BACK_GATE_511_ROAD,
  BACK_GATE_511_BUS_BERTH,
  BACK_GATE_511_WAIT,
  BACK_GATE_511_TRANSIT,
  BACK_GATE_511_COLLIDER
} from '../src/back-transit-stop-layout.js';
import { fillBackTransitStop } from '../src/back-transit-stop-geometry.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { campusSpawn } from '../src/campus-spawn.js';
import { BACK_FURNITURE, BACK_FURNITURE_WALLS } from '../src/back-furniture-layout.js';
import { BACK_ROADSIDE_ASSETS } from '../src/back-roadside-layout.js';

const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;

test('37165 evidence projects to the committed INHA WORLD point',()=>{
  const p=geoToWorld(37.451352,126.65572);
  assert.equal(BACK_GATE_511_STOP.mobileId,'37165');
  assert.equal(BACK_GATE_511_STOP.stationId,'ICB163000165');
  assert.deepEqual(BACK_GATE_511_STOP.realRoutes,['511']);
  assert.ok(near(BACK_GATE_511_STOP.x,p.x));
  assert.ok(near(BACK_GATE_511_STOP.z,p.z));
});

test('37165 binds to the west Inha-ro extension with separated curb, berth and waiting points',()=>{
  assert.equal(BACK_GATE_511_ROAD.roadId,'inha_west_extension');
  assert.equal(BACK_GATE_511_ROAD.segmentIndex,2);
  assert.ok(Math.abs(BACK_GATE_511_ROAD.v)>BACK_GATE_511_ROAD.width/2,'pole must sit outside the road');
  const stopToBus=Math.hypot(BACK_GATE_511_STOP.x-BACK_GATE_511_BUS_BERTH.x,BACK_GATE_511_STOP.z-BACK_GATE_511_BUS_BERTH.z);
  const stopToWait=Math.hypot(BACK_GATE_511_STOP.x-BACK_GATE_511_WAIT.x,BACK_GATE_511_STOP.z-BACK_GATE_511_WAIT.z);
  assert.ok(stopToBus>2.5&&stopToBus<4.5,'bus berth should be road-side of the pole');
  assert.ok(stopToWait>.7&&stopToWait<1.0,'waiting point should sit just behind the pole');
  assert.ok(Math.hypot(BACK_GATE_511_BUS_BERTH.x-BACK_GATE_511_WAIT.x,BACK_GATE_511_BUS_BERTH.z-BACK_GATE_511_WAIT.z)>3);
});

test('procedural roadside dressing leaves the 37165 stop frontage clear',()=>{
  for(const q of [...BACK_FURNITURE,...BACK_FURNITURE_WALLS])
    assert.ok(Math.hypot(q.center.x-BACK_GATE_511_STOP.x,q.center.z-BACK_GATE_511_STOP.z)>=3.2,q.id);
  for(const q of BACK_ROADSIDE_ASSETS)
    assert.ok(Math.hypot(q.center.x-BACK_GATE_511_STOP.x,q.center.z-BACK_GATE_511_STOP.z)>=3.2,q.id);
});

test('real 511 presentation stays separate from the unavailable F1 game transit contract',()=>{
  assert.deepEqual(BACK_GATE_511_TRANSIT.realRoute,{routeId:'511',presentationOnly:true});
  assert.equal(BACK_GATE_511_TRANSIT.gameRoute.mobilityId,'transit.frontier_bus.f1');
  assert.equal(BACK_GATE_511_TRANSIT.gameRoute.category,'TRANSIT');
  assert.equal(BACK_GATE_511_TRANSIT.gameRoute.state,'COMING_SOON');
  assert.equal(BACK_GATE_511_TRANSIT.gameRoute.ownershipRequired,false);
});

test('stop pole renders finite primitives and participates in collision',()=>{
  assert.ok(OBSTACLES.includes(BACK_GATE_511_COLLIDER));
  let count=0;
  const finite=(color,...values)=>{count++;assert.match(color,/^#[0-9a-f]{6}$/i);assert.ok(values.flat(Infinity).every(Number.isFinite));};
  fillBackTransitStop({box:finite,tube:finite});
  assert.ok(count>=5&&count<20);
});

test('preview spawn lands behind the 37165 waiting area on preview hosts',()=>{
  const p=campusSpawn({hostname:'localhost',search:'?spawn=back-gate-511'});
  assert.ok(Math.hypot(p.x-BACK_GATE_511_WAIT.x,p.z-BACK_GATE_511_WAIT.z)<3);
  assert.ok(Number.isFinite(p.y)&&Number.isFinite(p.yaw));
});
