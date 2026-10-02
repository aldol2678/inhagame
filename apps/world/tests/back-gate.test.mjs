import test from 'node:test';
import assert from 'node:assert/strict';
import { BACK_GATE, BACK_GATE_FRAME as gate, BACK_GATE_COLLIDERS, BACK_SEGMENTS, BACK_TREES, backRoadTreeClear } from '../src/back-gate-layout.js';
import { fillBackGatePaving, fillBackGateStructure } from '../src/back-gate-geometry.js';
import { FACILITY_COLLIDERS } from '../src/campus-facilities.js';
import { BUILDINGS } from '../src/basic-campus.js';
import { polygonOverlap, moveAroundPolygons } from '../src/polygon-collision.js';
import { OBSTACLES, WORLD_BOUNDS } from '../src/campus-layout.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { PlayerController } from '../src/player-controller.js';

const buildings=[...FACILITY_COLLIDERS.filter(b=>b.minY===0),...BUILDINGS.map(b=>({id:b.id,polygon:b.vertices}))];
test('back gate paving is flat, upward, within the world, and clear of source buildings',()=>{
  fillBackGatePaving({quad(color,a,b,c,d){
    assert.ok([a,b,c,d].every(q=>q.every(Number.isFinite)&&q[1]===a[1]));
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    const n=Math.max(1,Math.ceil(Math.hypot(d[0]-a[0],d[2]-a[2])*3));
    for(let i=0;i<=n;i++)for(let j=0;j<=8;j++){
      const x=a[0]+(d[0]-a[0])*i/n+(b[0]-a[0])*j/8,z=a[2]+(d[2]-a[2])*i/n+(b[2]-a[2])*j/8;
      assert.ok(x>WORLD_BOUNDS.minX&&x<WORLD_BOUNDS.maxX&&z>WORLD_BOUNDS.minZ&&z<WORLD_BOUNDS.maxZ);
      for(const body of buildings)assert.ok(!polygonOverlap(x,z,body.polygon),`${body.id}: ${x},${z}`);
    }
  }});
});
globalThis.window={addEventListener(){}};
globalThis.document={getElementById(){return null;}};
function walk(points){
  let p={...points[0],y:1.15};
  const controller=new PlayerController({getLocalPosition:()=>({...p}),setLocalPosition(x,y,z){p={x,y,z};},setLocalEulerAngles(){}});
  for(const target of points.slice(1)){
    let arrived=false;
    for(let i=0;i<2000;i++){
      const dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);if(len<.005){arrived=true;break;}
      controller.touchVector={x:dx/len,y:-dz/len};controller.update(Math.min(1/60,len/7));
      assert.equal(p.y,1.15);
    }
    assert.ok(arrived,`blocked at ${JSON.stringify(p)} toward ${JSON.stringify(target)}`);
  }
}
test('both gate openings allow walking both directions underneath the lintel',()=>{
  for(const u of [-6.5,.5]){const route=[gate.at(u,2.4),gate.at(u,-4.5)];walk(route);walk([...route].reverse());}
  assert.equal(getPlaceZoneAt(BACK_GATE).id,'AREA_BACK_GATE');
});
test('back gate road network is walkable in both directions including the hitech bend',()=>{
  for(const s of BACK_SEGMENTS)for(const v of s.road.osmWayId===1223158575?[-1.7,1.7]:[0]){
    const route=[s.frame.at(0,v),s.frame.at(s.frame.length,v)];walk(route);walk([...route].reverse());
  }
});
test('gate pillars and lintel have persistent collision while the walking aperture stays open',()=>{
  assert.ok(BACK_GATE_COLLIDERS.every(b=>OBSTACLES.includes(b)));
  const options={radius:.65,footOffset:1.15,headOffset:1.45};
  for(const u of [-10,-3,4]){
    const from=gate.at(u,3),to=gate.at(u,-3),p=moveAroundPolygons({...from,y:1.15},to.x-from.x,to.z-from.z,OBSTACLES,options);
    assert.ok(Math.hypot(p.x-to.x,p.z-to.z)>2,'pillar must block walking');
  }
  const from=gate.at(.5,3),to=gate.at(.5,-3);
  const p=moveAroundPolygons({...from,y:3.4},to.x-from.x,to.z-from.z,OBSTACLES,options);
  assert.ok(Math.hypot(p.x-to.x,p.z-to.z)>2,'lintel must block flight');
});
test('back gate planting clears roads and buildings and geometry stays finite',()=>{
  assert.ok(BACK_TREES.length>0);
  for(const p of BACK_TREES){assert.ok(backRoadTreeClear(p,1.4));for(const b of buildings)assert.ok(!polygonOverlap(p.x,p.z,b.polygon,1.4));}
  let count=0;const primitive=(color,...values)=>{count++;assert.match(color,/^#[0-9a-f]{6}$/i);assert.ok(values.flat(Infinity).every(Number.isFinite));};
  fillBackGateStructure({box:primitive,tube:primitive,crown:primitive});assert.ok(count>30&&count<200);
});
