import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERIOR_BUILDINGS, INTERIOR_COLLIDERS, INTERIOR_PREVIEWS, INTERIOR_FURNITURE } from '../src/market-interior-layout.js';
import { INTERIOR_PATHS, INTERIOR_SEGMENTS, INTERIOR_COURTS } from '../src/market-interior-plan.js';
import { fillInteriorBase, fillInteriorNear, fillInteriorDetail } from '../src/market-interior-geometry.js';
import { BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from '../src/back-approach-layout.js';
import { culturePolygonsOverlap } from '../src/culture-street-layout.js';
import { OBSTACLES, WORLD_BOUNDS } from '../src/campus-layout.js';
import { moveAroundObstacles, canOccupy, resolveHeight, cameraSafeFraction } from '../src/world-collision.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { distanceToRoad } from '../src/campus-road-layout.js';
import { campusSpawn } from '../src/campus-spawn.js';

test('interior passages connect to source streets and remain walkable both ways across every branch',()=>{
  for(const s of INTERIOR_SEGMENTS)for(const reverse of [false,true]) {
    const a=s.frame.at(reverse?s.frame.length:0),z=s.frame.at(reverse?0:s.frame.length),steps=Math.ceil(s.frame.length/.2);
    let p={...a,y:1.15};
    assert.ok(canOccupy(p),s.id);
    for(let i=0;i<steps;i++)p={...moveAroundObstacles(p,(z.x-a.x)/steps,(z.z-a.z)/steps),y:1.15};
    assert.ok(Math.hypot(p.x-z.x,p.z-z.z)<.02,s.id);
  }
  // Each component must reach a source road, rather than just being an isolated clear line.
  const connected=new Set(INTERIOR_SEGMENTS.filter(s=>[s.frame.at(0),s.frame.at(s.frame.length)].some(p=>BACK_APPROACH_SEGMENTS.some(r=>distanceToRoad(p,r)<r.road.width/2))).map(s=>s.id));
  let changed=true;
  while(changed){changed=false;for(const s of INTERIOR_SEGMENTS)if(!connected.has(s.id)&&INTERIOR_SEGMENTS.some(r=>connected.has(r.id)&&culturePolygonsOverlap(s.polygon,r.polygon))){connected.add(s.id);changed=true;}}
  assert.equal(connected.size,INTERIOR_SEGMENTS.length);
});

test('interior homes have clear entrances, distinct bodies and permanent rooftop collision',()=>{
  assert.ok(INTERIOR_BUILDINGS.length>=25);
  assert.equal(new Set(INTERIOR_BUILDINGS.map(q=>q.kind)).size,3);
  for(const q of INTERIOR_BUILDINGS) {
    assert.ok(backApproachFootprintClear(q.polygon),q.id);
    for(const other of OBSTACLES.filter(c=>c.minY===0&&c.id!==q.id))assert.ok(!culturePolygonsOverlap(q.polygon,other.polygon),`${q.id}/${other.id}`);
    const own=INTERIOR_COLLIDERS.find(c=>c.id===q.id);assert.ok(OBSTACLES.includes(own));
    assert.equal(canOccupy({...q.center,y:1.15}),false);
    const from=q.frame.at(0,-.8),door=q.frame.at(0,-.4);
    assert.equal(canOccupy({...door,y:1.15}),true,`${q.id} entrance`);
    assert.ok(cameraSafeFraction([from.x,1,from.z],[q.center.x,1,q.center.z])<1);
    const stair=q.frame.at(-q.w*.23,q.d*.67);
    assert.equal(resolveHeight({...stair,y:q.h+4},1.15),q.h+1.4+1.15);
    for(const p of q.bounds)assert.ok(p.x>WORLD_BOUNDS.minX&&p.x<WORLD_BOUNDS.maxX&&p.z>WORLD_BOUNDS.minZ&&p.z<WORLD_BOUNDS.maxZ);
  }
});

test('courts stay open and furniture avoids walking corridors',()=>{
  assert.equal(INTERIOR_COURTS.length,5);
  assert.equal(INTERIOR_COURTS.filter(q=>q.kind==='parking').length,2);
  for(const c of INTERIOR_COURTS)assert.ok(canOccupy({...c.center,y:1.15}),c.id);
  for(const q of INTERIOR_FURNITURE) {
    assert.ok(INTERIOR_SEGMENTS.every(s=>!culturePolygonsOverlap(q.polygon,s.polygon)),q.id);
    assert.ok(!canOccupy({...q.center,y:1.15}),q.id);
  }
});

test('interior footprints and paths appear on the map and preview spawns are clear',()=>{
  const g=createMiniMapDataSource().geometry();
  for(const q of [...INTERIOR_BUILDINGS,...INTERIOR_COURTS])assert.deepEqual(g.find(x=>x.id===q.id).rings[0],q.polygon);
  for(const p of INTERIOR_PATHS)assert.ok(g.some(q=>q.id===`maproad.${p.id}.0`));
  for(const name of Object.keys(INTERIOR_PREVIEWS))assert.ok(canOccupy(campusSpawn({search:`?spawn=${name}`})));
});

test('interior detail geometry fits one streaming owner and has finite bounded geometry',()=>{
  let count=0;const colors=new Set();
  const primitive=(c,...args)=>{colors.add(c);count++;assert.ok(args.flat(Infinity).every(Number.isFinite));};
  fillInteriorBase({box:primitive,tube:primitive,triangle:primitive,quad:primitive});
  for(const q of INTERIOR_BUILDINGS) {
    const owners=RENDER_CHUNKS.filter(c=>c.streetscape.includes(q.id));assert.equal(owners.length,1);
    const b=owners[0].bounds,check=p=>assert.ok(p[0]>=b.minX&&p[0]<=b.maxX&&p[2]>=b.minZ&&p[2]<=b.maxZ,q.id);
    const batch={box(c,p,size,yaw=0){primitive(c,p,size,yaw);const a=yaw*Math.PI/180;for(const x of [-1,1])for(const z of [-1,1])check([p[0]+x*size[0]/2*Math.cos(a)+z*size[2]/2*Math.sin(a),p[1],p[2]-x*size[0]/2*Math.sin(a)+z*size[2]/2*Math.cos(a)]);},tube(c,a,z,r,n){primitive(c,a,z,r,n);check(a);check(z);}};
    fillInteriorNear(batch,[q.id]);fillInteriorDetail(batch,[q.id]);
  }
  assert.ok(colors.size<30);assert.ok(count>1000&&count<12000,count);
});
