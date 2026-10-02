import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FACILITIES,FACILITY_COLLIDERS,FACILITY_BOUNDS,partitionCourtyard,towerParts} from '../src/campus-facilities.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {buildPolygonMeshGeometry,computePolygonAreaWU,projectPolygon,getCanonicalLandmark} from '../src/reality-adapter.js';
import {resolveHeight,moveAroundObstacles,cameraSafeFraction} from '../src/world-collision.js';
import {stadiumTrack,lawnTreePositions} from '../src/facility-ground-layout.js';
import {BUILDINGS,SITE_FEATURES} from '../src/basic-campus.js';
import {ROAD_SEGMENTS,distanceToRoad} from '../src/campus-road-layout.js';
const source=JSON.parse(readFileSync(new URL('../data/reality/evidence/facilities/source.json',import.meta.url)));

test('facility source rings survive projection and exclude similarly numbered technical-college buildings',()=>{
  const ids=new Set();
  for(const f of FACILITIES){
    assert.ok(!ids.has(f.id));ids.add(f.id);
    if(f.sourceWays?.length===1)assert.deepEqual(f.rings[0],projectPolygon(source.ways.find(w=>w.id===f.sourceWays[0]).coordinates));
    for(const [i,id] of (f.sourceHoleWays||[]).entries())assert.deepEqual(f.rings[i+1],projectPolygon(source.ways.find(w=>w.id===id).coordinates));
    for(const t of towerParts(f))for(const p of t.vertices)assert.ok(polygonOverlap(p.x,p.z,f.rings[0],0),`${t.id} stays over source building`);
    for(const p of f.rings.flat())assert.ok(p.x>FACILITY_BOUNDS.minX&&p.x<FACILITY_BOUNDS.maxX&&p.z>FACILITY_BOUNDS.minZ&&p.z<FACILITY_BOUNDS.maxZ);
  }
  assert.deepEqual(FACILITIES.find(f=>f.id==='bldg_06').sourceWays,[568420968]);
  assert.deepEqual(FACILITIES.find(f=>f.id==='bldg_05').sourceWays,[218188830]);
  const student=FACILITIES.find(f=>f.id==='bldg_07');
  assert.equal(student.officialMarker.id,'7');assert.ok(student.center.x>120);
});

test('5호관 courtyard remains open for walking and falling; slabs preserve outer minus inner area',()=>{
  const f=FACILITIES.find(f=>f.id==='bldg_05');
  const expected=computePolygonAreaWU(f.rings[0])-computePolygonAreaWU(f.rings[1]);
  assert.ok(Math.abs(f.parts.reduce((s,p)=>s+computePolygonAreaWU(p),0)-expected)<1e-6);
  const hole=f.rings[1],center={x:hole.reduce((s,p)=>s+p.x,0)/hole.length,z:hole.reduce((s,p)=>s+p.z,0)/hole.length,y:30};
  const colliders=FACILITY_COLLIDERS.filter(c=>c.id.startsWith('bldg_05_'));
  assert.equal(resolveHeight(center,1.15,1.15,colliders),1.15);
  assert.ok(Math.abs(moveAroundObstacles({...center,y:1.15},1,1,colliders).x-center.x-1)<.001);
  const reverse=partitionCourtyard(f.rings.map(r=>[...r].reverse()));
  assert.ok(Math.abs(reverse.reduce((s,p)=>s+computePolygonAreaWU(p),0)-expected)<1e-6);
});

test('every facility roof triangulates with finite data and correct area',()=>{
  for(const f of FACILITIES.filter(f=>f.kind==='building'))for(const part of f.parts){
    const mesh=buildPolygonMeshGeometry(part,{height:f.height});
    assert.ok(mesh.positions.every(Number.isFinite),f.id);
    let area=0;
    for(let i=0;i<(part.length-2)*3;i+=3){
      const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*3],z:mesh.positions[n*3+2]}));
      const up=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);assert.ok(up>0,f.id);area+=up/2;
    }
    assert.ok(Math.abs(area-computePolygonAreaWU(part))<1e-5,f.id);
  }
});

test('gate spawn camera clears the newly mapped first dormitory',()=>{
  assert.equal(cameraSafeFraction([0,2.35,-98],[0,9.65,-111],FACILITY_COLLIDERS),1);
});

test('red track and lane paint are horizontal surfaces with upward winding in either orientation',()=>{
  for(const [w,d] of [[70,38],[38,70]]){
    const quads=stadiumTrack(w,d,(u,v)=>({x:12+u*.8-v*.6,z:-9+u*.6+v*.8}));
    for(const {color,vertices} of quads){
      assert.ok(vertices.flat().every(Number.isFinite));
      assert.deepEqual([...new Set(vertices.map(p=>p[1]))],[color==='#b46e5d'?.05:.06]);
      const [a,b,c]=vertices;
      assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    }
  }
});

test('procedural lawn tree crowns clear the full Woonam aircraft and retain surrounding planting',()=>{
  const aircraft=FACILITIES.filter(f=>f.style==='aircraft').map(f=>f.center);
  let removed=0,retained=0;
  // The east-hall display lawn has no source planting polygon yet. Exercise
  // exclusion there as well as checking every currently planted source lawn.
  const displayLawns=aircraft.map(p=>({vertices:[[-20,-20],[20,-20],[20,20],[-20,20]].map(([x,z])=>({x:p.x+x,z:p.z+z}))}));
  for(const f of [...SITE_FEATURES.filter(f=>!['path','reflecting_pool'].includes(f.kind)),...displayLawns]){
    const trees=lawnTreePositions(f.vertices,aircraft);
    removed+=lawnTreePositions(f.vertices,[]).length-trees.length;retained+=trees.length;
    for(const tree of trees)for(const p of aircraft){
      const dx=Math.max(p.x-6.6-tree.x,0,tree.x-(p.x+6.6));
      const dz=Math.max(p.z-5.6-tree.z,0,tree.z-(p.z+6.2));
      assert.ok(Math.hypot(dx,dz)>=2.9,'crown radius plus one-unit gap');
    }
  }
  assert.ok(removed>0);assert.ok(retained>0);
});

test('Woonam display clears the east hall and roads; gazebo straddles the northwest pond shore',()=>{
  const plane=FACILITIES.find(f=>f.id==='lmk_woonam_aircraft').center;
  const hall=BUILDINGS.find(f=>f.id==='bldg_01');
  assert.ok(plane.x>Math.max(...hall.vertices.map(p=>p.x)));
  // Sample the conservative full silhouette, not just its center point.
  for(let x=-6.6;x<=6.6;x+=.2)for(let z=-5.6;z<=6.2;z+=.2){
    const p={x:plane.x+x,z:plane.z+z};
    for(const b of [...BUILDINGS,...FACILITY_COLLIDERS])assert.ok(!polygonOverlap(p.x,p.z,b.vertices||b.polygon,.5),b.id);
    for(const road of ROAD_SEGMENTS)assert.ok(distanceToRoad(p,road)>road.road.width/2+road.road.shoulder);
  }
  const gazebo=FACILITIES.find(f=>f.id==='lmk_pond_gazebo').center;
  const pond=projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
  const north=Math.max(...pond.map(p=>p.z)),south=Math.min(...pond.map(p=>p.z));
  assert.ok(gazebo.z>south+(north-south)*.7&&gazebo.z<north);
  assert.ok(polygonOverlap(gazebo.x,gazebo.z,pond,0));
  assert.ok(!polygonOverlap(gazebo.x-2.5,gazebo.z,pond,0),'west deck reaches land');
  assert.ok(polygonOverlap(gazebo.x+2.5,gazebo.z,pond,0),'east deck projects into water');
});

test('Agora is a walkable ground courtyard between 6 and 9, away from the retired pond-side plaza',()=>{
  const f=FACILITIES.find(f=>f.id==='fac_agora_courtyard');
  assert.equal(f.kind,'ground');assert.equal(f.legacyZoneId,'C01_GATE');
  assert.ok(f.center.z<FACILITIES.find(f=>f.id==='bldg_06').center.z);
  assert.ok(f.center.z>FACILITIES.find(f=>f.id==='bldg_09').center.z);
  const [nw,ne,se,sw]=f.rings[0];
  for(let u=0;u<=1;u+=.1)for(let v=0;v<=1;v+=.1){
    const x=(nw.x*(1-u)+ne.x*u)*(1-v)+(sw.x*(1-u)+se.x*u)*v;
    const z=(nw.z*(1-u)+ne.z*u)*(1-v)+(sw.z*(1-u)+se.z*u)*v;
    assert.ok(!FACILITY_COLLIDERS.some(c=>polygonOverlap(x,z,c.polygon,0)));
  }
});
