import test from 'node:test';
import assert from 'node:assert/strict';
import { BACK_STREET_BLOCKS, BACK_STREET_COLLIDERS, BACK_STREET_RAILS, BACK_STREET_SEGMENTS, BACK_CROSSING_STATION, streetPoint } from '../src/back-street-layout.js';
import { fillBackStreetBase, fillBackStreetNear, fillBackStreetDetail, fillBackStreetSignals } from '../src/back-street-geometry.js';
import { WORLD_BOUNDS, OBSTACLES } from '../src/campus-layout.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { moveAroundObstacles, cameraSafeFraction, resolveHeight } from '../src/world-collision.js';
import { polygonOverlap } from '../src/polygon-collision.js';

function walk(points){
  let p={...points[0],y:1.15};
  for(const target of points.slice(1)){
    for(let i=0;i<3000;i++){
      const dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);if(len<.005)break;
      p={...moveAroundObstacles(p,dx/len*Math.min(.08,len),dz/len*Math.min(.08,len)),y:1.15};
    }
    assert.ok(Math.hypot(p.x-target.x,p.z-target.z)<.005,`blocked at ${JSON.stringify(p)} toward ${JSON.stringify(target)}`);
  }
}
test('both sidewalks, traffic lanes and the crossing remain connected in both directions',()=>{
  // Campus-side pedestrians walk behind the curbside tree row (trunks at |v| = 4.65), mirroring 5.3.
  for(const v of [-5.3,-1.7,1.7,5.3]){
    const route=BACK_STREET_SEGMENTS.map(s=>s.frame.at(0,v));
    const last=BACK_STREET_SEGMENTS.at(-1);route.push(last.frame.at(last.frame.length,v));
    walk(route);walk([...route].reverse());
  }
  for(const offset of [-1.6,0,1.6]){
    const route=[streetPoint(BACK_CROSSING_STATION+offset,-4.5),streetPoint(BACK_CROSSING_STATION+offset,5.3)];
    walk(route);walk([...route].reverse());
  }
});
test('shop bodies have persistent collision, camera occlusion and roof landing',()=>{
  assert.ok(BACK_STREET_COLLIDERS.every(q=>OBSTACLES.includes(q)));
  for(const q of BACK_STREET_BLOCKS){
    const from=q.frame.at(0,5.3),to=q.frame.at(0,q.front+2);
    const p=moveAroundObstacles({...from,y:1.15},to.x-from.x,to.z-from.z);
    assert.ok(Math.hypot(p.x-to.x,p.z-to.z)>1);
    assert.ok(cameraSafeFraction([from.x,1,from.z],[to.x,1,to.z])<1);
    assert.equal(resolveHeight({...to,y:q.h+2},1.15),q.h+1.15);
  }
  for(const q of BACK_STREET_RAILS){
    const a=q.frame.at(0,-1),z=q.frame.at(0,1);
    const p=moveAroundObstacles({...a,y:1.15},z.x-a.x,z.z-a.z);
    assert.ok(Math.hypot(p.x-z.x,p.z-z.z)>.5);
  }
});
test('new shop footprints do not intersect existing buildings or leave world bounds',()=>{
  const existing=OBSTACLES.filter(b=>!BACK_STREET_COLLIDERS.includes(b)&&b.polygon&&b.minY===0);
  for(const q of BACK_STREET_BLOCKS)for(let u=-q.w/2;u<=q.w/2;u+=.2)for(let v=q.front;v<=q.front+q.d;v+=.2){
    const p=q.frame.at(u,v);
    assert.ok(p.x>WORLD_BOUNDS.minX&&p.x<WORLD_BOUNDS.maxX&&p.z>WORLD_BOUNDS.minZ&&p.z<WORLD_BOUNDS.maxZ);
    for(const b of existing)assert.ok(!polygonOverlap(p.x,p.z,b.polygon),`${q.id} overlaps ${b.id}`);
  }
});
test('each streetscape block has one streaming owner containing all its detail geometry',()=>{
  for(const q of BACK_STREET_BLOCKS){
    const owners=RENDER_CHUNKS.filter(c=>c.streetscape.includes(q.id));assert.equal(owners.length,1);
    const bounds=owners[0].bounds;
    const check=p=>assert.ok(p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[2]>=bounds.minZ&&p[2]<=bounds.maxZ,`${q.id} outside owner`);
    const batch={box(c,p){check(p);},tube(c,a,b){check(a);check(b);},crown(c,p){check(p);},quad(c,...ps){ps.forEach(check);}};
    fillBackStreetNear(batch,[q.id]);fillBackStreetDetail(batch,[q.id]);
  }
});
test('batched geometry is finite and material/primitive counts stay bounded',()=>{
  let count=0;const colors=new Set();
  const primitive=(color,...values)=>{count++;colors.add(color);assert.match(color,/^#[0-9a-f]{6}$/i);assert.ok(values.flat(Infinity).every(Number.isFinite));};
  const b={box:primitive,tube:primitive,crown:primitive,quad:primitive};
  fillBackStreetBase(b);fillBackStreetSignals(b);
  const ids=BACK_STREET_BLOCKS.map(q=>q.id);fillBackStreetNear(b,ids);fillBackStreetDetail(b,ids);
  assert.ok(count>=BACK_STREET_BLOCKS.length*3+BACK_STREET_RAILS.length&&count<2500);assert.ok(colors.size<=14);
});
