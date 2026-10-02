import test from 'node:test';
import assert from 'node:assert/strict';
import { FACILITIES, FACILITY_COLLIDERS } from '../src/campus-facilities.js';
import { BUILDINGS } from '../src/basic-campus.js';
import { GAZEBO, AIRCRAFT_COLLIDERS, aircraftPoint, aircraftLocal, aircraftTreeClear, overPondWater } from '../src/landmark-detail-layout.js';
import { fillAircraft } from '../src/landmark-detail-geometry.js';
import { fillSports, sportsFrame } from '../src/sports-detail-geometry.js';
import { roadviewGroundHeight, pondBankTrees, pondPromenadeCells, MAIN_HALL_APPROACH, STUDENT_CENTER_FIELDTRIP_PRESENTATION } from '../src/roadview-layout.js';
import { ROAD_SEGMENTS, distanceToRoad, forestRoadTrees, roadTreeClear } from '../src/campus-road-layout.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { PlayerController } from '../src/player-controller.js';
import { moveAroundObstacles, resolveHeight, canOccupy } from '../src/world-collision.js';
import { WALK_SHAPE, MOUNT_SHAPE } from '../src/player-dimensions.js';
import { OBSTACLES } from '../src/campus-layout.js';

globalThis.window={addEventListener(){}};
globalThis.document={getElementById(){return null;}};
function actor(x,z,y=1.15+roadviewGroundHeight(x,z)){
  let position={x,y,z};
  const entity={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z};},setLocalEulerAngles(){}};
  return {entity,controller:new PlayerController(entity)};
}
function walk(a,x,z){
  for(let i=0;i<900;i++){
    const p=a.entity.getLocalPosition(),dx=x-p.x,dz=z-p.z,len=Math.hypot(dx,dz);
    if(len<.002){a.controller.touchVector={x:0,y:0};return;}
    a.controller.touchVector={x:dx/len,y:-dz/len};a.controller.update(Math.min(1/60,len/7));
    const q=a.entity.getLocalPosition();assert.ok(Math.abs(q.y-1.15-roadviewGroundHeight(q.x,q.z))<1e-6);
  }
  assert.fail('walking route failed');
}
test('gazebo west stairs permit entry and return, deck supports jumping, rails block water-side exit',()=>{
  const {x,z}=GAZEBO.center,a=actor(x-5,z);
  walk(a,x,z);assert.ok(Math.abs(a.entity.getLocalPosition().y-1.57)<1e-8);
  a.controller.jumpQueued=true;a.controller.update(1/60);
  for(let i=0;i<120;i++)a.controller.update(1/60);
  assert.ok(Math.abs(a.entity.getLocalPosition().y-1.57)<1e-8);
  a.controller.touchVector={x:1,y:0};
  for(let i=0;i<120;i++)a.controller.update(1/60);
  assert.ok(a.entity.getLocalPosition().x<x+2,'rail stops player before deck edge');
  walk(a,x,z);walk(a,x-5,z);
});
test('sprint and jump cannot cross pond; flight can cross but only dismounts on dry shore',()=>{
  const start=actor(115,-8);start.controller.touchVector={x:0,y:-1};start.controller.touchSprint=true;start.controller.jumpQueued=true;
  start.controller.update(2);assert.ok(!overPondWater(start.entity.getLocalPosition().x,start.entity.getLocalPosition().z));
  const flight=actor(115,5,8);flight.controller.mounted=true;flight.controller.toggleMount();
  for(let i=0;i<120;i++)flight.controller.update(1/60);
  assert.ok(flight.controller.mounted);assert.equal(flight.controller.grounded,false);assert.equal(flight.entity.getLocalPosition().y,2.15);
  flight.controller.touchVector={x:0,y:1};
  for(let i=0;i<120;i++)flight.controller.update(1/60);
  assert.equal(flight.controller.mounted,false);assert.ok(!overPondWater(flight.entity.getLocalPosition().x,flight.entity.getLocalPosition().z));
});
test('main hall front steps use the same height for walking and rendering',()=>{
  const t=MAIN_HALL_APPROACH,p=t.frame.at(t.frame.length/2,3),end=t.frame.at(t.frame.length/2,.7),a=actor(p.x,p.z);
  walk(a,end.x,end.z);assert.ok(a.entity.getLocalPosition().y>1.35);walk(a,p.x,p.z);
});
test('southwest aircraft bearing, transformed clearance, wheels and supports stay finite',()=>{
  const f=FACILITIES.find(f=>f.style==='aircraft'),nose=aircraftPoint(f.center,0,0,5);
  assert.ok(nose[0]<f.center.x&&nose[2]<f.center.z);
  const local=aircraftLocal(f.center,{x:nose[0],z:nose[2]});assert.ok(Math.abs(local.x)<1e-6&&Math.abs(local.z-5)<1e-6);
  for(let x=-6.6;x<=6.6;x+=.25)for(let z=-5.6;z<=6.2;z+=.25){
    const p=aircraftPoint(f.center,x,0,z),q={x:p[0],z:p[2]};
    for(const b of [...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({id:b.id,polygon:b.vertices}))])assert.ok(!polygonOverlap(q.x,q.z,b.polygon,.4),b.id);
    for(const r of ROAD_SEGMENTS)assert.ok(distanceToRoad(q,r)>r.road.width/2+r.road.shoulder);
    assert.equal(aircraftTreeClear(f.center,q),false);
  }
  const tubes=[];fillAircraft({tube:(color,a,b,r)=>tubes.push({color,a,b,r}),box(){},crown(){}},f.center);
  const wheels=tubes.filter(t=>t.color==='#303735');assert.equal(wheels.length,3);
  for(const t of wheels)assert.ok(Math.abs(t.a[1]-t.r)<1e-8,'wheel touches ground');
});
test('pond planting and promenade clear buildings, stairs entry and existing roads; streaming owns their full extent',()=>{
  const trees=pondBankTrees(),owner=RENDER_CHUNKS.find(c=>c.facilities.includes('bldg_07'));
  assert.ok(trees.length>0);
  const heroes=trees.filter(p=>p.heroWillow);
  assert.equal(heroes.length,1,'fieldtrip pass keeps exactly one hero willow');
  assert.equal(heroes[0].willow,true,'hero willow uses the willow renderer');
  for(const p of trees){
    assert.ok(roadTreeClear(p,2.2));assert.ok(Math.hypot(p.x-GAZEBO.center.x,p.z-GAZEBO.center.z)>=6);
    assert.ok(p.x-2.2>=owner.bounds.minX&&p.x+2.2<=owner.bounds.maxX&&p.z-2.2>=owner.bounds.minZ&&p.z+2.2<=owner.bounds.maxZ);
  }
  for(const cell of pondPromenadeCells())for(const p of cell)for(const b of FACILITY_COLLIDERS)assert.ok(!polygonOverlap(p.x,p.z,b.polygon,.24));
  const forest=FACILITIES.find(f=>f.style==='forest'),a=forestRoadTrees(forest.center);
  assert.ok(a.length>10);assert.deepEqual(a,forestRoadTrees(forest.center));assert.ok(a.every(p=>roadTreeClear(p,2.5)));
});
test('student center fieldtrip presentation spec keeps waterfront openness and upper ribbon rhythm',()=>{
  const p=STUDENT_CENTER_FIELDTRIP_PRESENTATION;
  assert.deepEqual(p.waterfrontEdges,[2,4,5]);
  assert.ok(p.ribbonYs.includes(8.6)&&p.ribbonYs.includes(11.1),'upper ribbon treatment extends above the old two bands');
  assert.equal(p.groundFloorGlass,'#2f5058');
  assert.equal(p.canopy,'#d7cbb5');
});

test('sports paint is flat and upward; detailed furniture stays inside each source perimeter',()=>{
  for(const f of FACILITIES.filter(f=>['stadium','basketball','tennis','court'].includes(f.style))){
    const frame=sportsFrame(f);assert.ok(frame.w>frame.d);
    const calls=[],batch={quad:(color,...p)=>calls.push({type:'quad',color,p}),box:(color,p)=>calls.push({type:'box',color,p:[p]}),tube:(color,a,b)=>calls.push({type:'tube',color,p:[a,b]})};
    fillSports(batch,f);fillSports(batch,f,'NEAR');
    assert.ok(calls.length>100);
    for(const call of calls){
      for(const p of call.p){assert.ok(p.every(Number.isFinite));assert.ok(polygonOverlap(p[0],p[2],f.rings[0]),f.id);}
      if(call.type==='quad'){
        const [a,b,c]=call.p;assert.ok(call.p.every(p=>p[1]===a[1]&&p[1]<.09));
        assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
      }
    }
  }
});

test('human-sized collision clears a narrow passage and low beam but still stops at walls',()=>{
  const passage=[{minX:-3,maxX:3,minZ:.5,maxZ:2,minY:0,maxY:4},
    {minX:-3,maxX:3,minZ:-2,maxZ:-.5,minY:0,maxY:4},
    {minX:-1,maxX:1,minZ:-.5,maxZ:.5,minY:1.1,maxY:1.3}];
  assert.deepEqual(moveAroundObstacles({x:-4,y:1.15,z:0},8,0,passage),{x:4,z:0});
  const hit=moveAroundObstacles({x:0,y:1.15,z:0},0,2,passage);
  assert.ok(hit.z>0&&hit.z<.5);
  assert.equal(canOccupy({x:0,y:1.15,z:0},MOUNT_SHAPE,passage),false);
  // Headroom uses the duck's actual .875-unit standing height, not its root height.
  assert.ok(Math.abs(resolveHeight({x:0,y:1.15,z:0},2,1.15,passage)-(1.1-WALK_SHAPE.headOffset))<1e-8);
});

test('gazebo jump has real headroom; blocked mount stays walkable and recovers outside',()=>{
  const {x,z}=GAZEBO.center,a=actor(x,z),start=a.entity.getLocalPosition().y;
  a.controller.jumpQueued=true;let peak=start;
  for(let i=0;i<120;i++){a.controller.update(1/60);peak=Math.max(peak,a.entity.getLocalPosition().y);}
  assert.ok(peak-start>1.1,'standing human can jump freely under the gazebo roof');
  a.controller.toggleMount();assert.equal(a.controller.mounted,false);assert.equal(a.controller.mountBlocked,true);
  walk(a,x-7,z);assert.equal(a.controller.mountBlocked,false);
  a.controller.toggleMount();assert.equal(a.controller.mounted,true);
  a.controller.ascendHeld=true;
  for(let i=0;i<60;i++)a.controller.update(1/60);
  assert.ok(Math.abs(a.entity.getLocalPosition().y-9.15)<1e-6,'flight ascent remains 8 units per second');
  a.controller.ascendHeld=false;a.controller.touchVector={x:1,y:0};
  const before=a.entity.getLocalPosition();
  for(let i=0;i<60;i++)a.controller.update(1/60);
  assert.ok(Math.abs(a.entity.getLocalPosition().x-before.x-11)<1e-6,'flight speed unchanged');
});

test('pitch paint, including all four corners and line thickness, stays off the red track',()=>{
  const f=FACILITIES.find(f=>f.style==='stadium'),quads=[];
  fillSports({quad:(color,...p)=>quads.push({color,p}),tube(){},box(){}},f);
  const track=quads.filter(q=>q.color==='#b46e5d').map(q=>q.p.map(p=>({x:p[0],z:p[2]})));
  const paint=quads.filter(q=>q.p[0][1]===.075);
  assert.ok(paint.length>4);
  for(const q of paint)for(let i=0;i<4;i++){
    const a=q.p[i],b=q.p[(i+1)%4];
    for(const t of [0,.25,.5,.75,1])assert.ok(!track.some(r=>polygonOverlap(a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t,r)),'paint overlaps red track');
  }
});

test('aircraft gear and elevated body block contact while the wing underpass remains open',()=>{
  const center=FACILITIES.find(f=>f.style==='aircraft').center;
  const p=(x,y,z)=>{const q=aircraftPoint(center,x,y,z);return {x:q[0],y:q[1],z:q[2]};};
  const cross=(start,end)=>moveAroundObstacles(start,end.x-start.x,end.z-start.z);
  assert.ok(AIRCRAFT_COLLIDERS.every(c=>OBSTACLES.includes(c)),'collision persists independently of render layers');
  const wheel=cross(p(2.3,1.15,-1.5),p(2.3,1.15,1.5));
  assert.ok(aircraftLocal(center,wheel).z<.1,'cannot sprint through landing gear');
  const body=cross(p(-3,2.95,3),p(3,2.95,3));
  assert.ok(aircraftLocal(center,body).x<-.6,'cannot cross elevated fuselage');
  const start=p(4,1.15,-3),end=p(4,1.15,3),a=actor(start.x,start.z);
  walk(a,end.x,end.z);walk(a,start.x,start.z);
  const under=p(4,1.15,0),jump=actor(under.x,under.z);jump.controller.jumpQueued=true;let peak=1.15;
  for(let i=0;i<120;i++){jump.controller.update(1/60);peak=Math.max(peak,jump.entity.getLocalPosition().y);}
  assert.ok(peak>1.7&&peak+WALK_SHAPE.headOffset<=1.62+1e-7,'jump hits the wing underside');
  assert.equal(jump.controller.grounded,true);
  assert.ok(Math.abs(resolveHeight(p(0,6,3),1.15)-3.55)<1e-7,'airborne descent rests on fuselage');
  jump.controller.toggleMount();assert.equal(jump.controller.mounted,false,'no expansion into a wing');
});
