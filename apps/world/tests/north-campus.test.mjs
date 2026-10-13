import test from 'node:test';
import assert from 'node:assert/strict';
import { NORTH_APPROACHES, NORTH_LANES, ANNIVERSARY_BACK_GATE_LINKS, FIVE, exteriorFrame } from '../src/north-campus-layout.js';
import { fillNorthRoads, fillFiveGardenPaths, fillNorthEntrances } from '../src/north-campus-geometry.js';
import { FACILITY_COLLIDERS } from '../src/campus-facilities.js';
import { BUILDINGS } from '../src/basic-campus.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { PlayerController } from '../src/player-controller.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';

const surfaces=[];
fillNorthRoads({triangle(color,...vertices){surfaces.push({color,vertices});}});
fillFiveGardenPaths({quad(color,...vertices){surfaces.push({color,vertices});}});
const bodies=[...FACILITY_COLLIDERS.filter(b=>b.minY===0),...BUILDINGS.map(b=>({id:b.id,polygon:b.vertices}))];
test('new north pavements stay flat, face up and never cover a building or courtyard wall',()=>{
  for(const {vertices:p} of surfaces){const [a,b,c,d]=p;
    assert.ok(p.every(q=>q.every(Number.isFinite)&&q[1]===a[1]&&q[1]>=FLAT_GROUND_Y.UNDERLAY&&q[1]<=FLAT_GROUND_MAX_Y));
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    // Clip fans are triangles, not necessarily parallelograms. Sample the two
    // actual GPU triangles, including edges, rather than the enclosing rhombus.
    for(const [v0,v1,v2]of (d?[[a,b,c],[a,c,d]]:[[a,b,c]]))for(let i=0;i<=10;i++)for(let j=0;j<=10-i;j++){
      const x=v0[0]+(v1[0]-v0[0])*i/10+(v2[0]-v0[0])*j/10;
      const z=v0[2]+(v1[2]-v0[2])*i/10+(v2[2]-v0[2])*j/10;
      for(const body of bodies){
        // Boundary points belong to the shared edge, not the building interior.
        const cx=(v0[0]+v1[0]+v2[0])/3,cz=(v0[2]+v1[2]+v2[2])/3;
        assert.ok(!polygonOverlap(x+(cx-x)*1e-6,z+(cz-z)*1e-6,body.polygon),`${body.id} overlaps at ${x},${z}`);
      }
    }
  }
});
test('courtyard facade points into open garden; new lanes retain walking capsule clearance',()=>{
  const ring=FIVE.rings[1];
  for(let i=0;i<ring.length;i++){const f=exteriorFrame(ring,i,true),p=f.at(f.length/2,.2);assert.ok(polygonOverlap(p.x,p.z,ring));}
  for(const lane of [...NORTH_LANES,...ANNIVERSARY_BACK_GATE_LINKS])for(let u=.15;u<lane.frame.length-.15;u+=.25){const p=lane.frame.at(u);for(const b of bodies)assert.ok(!polygonOverlap(p.x,p.z,b.polygon,.65),lane.id);}
  assert.deepEqual(ANNIVERSARY_BACK_GATE_LINKS.map(link=>link.id),['anniversary_back_gate_link','anniversary_perimeter_join']);
  assert.ok(ANNIVERSARY_BACK_GATE_LINKS.every(link=>link.frame.length>1&&link.frame.length<6),'bypass only closes the audited north-east corner gaps');
});
globalThis.window={addEventListener(){}};
globalThis.document={getElementById(){return null;}};
for(const t of NORTH_APPROACHES)test(`${t.id}: climb, jump, land and descend`,()=>{
  let p={...t.frame.at(t.u,t.landing+t.run+1),y:1.15};
  const entity={getLocalPosition:()=>({...p}),setLocalPosition(x,y,z){p={x,y,z};},setLocalEulerAngles(){}};
  const controller=new PlayerController(entity);
  function walk(out){const target=t.frame.at(t.u,out);
    for(let i=0;i<500;i++){const dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);if(len<.005){controller.touchVector={x:0,y:0};return;}
      controller.touchVector={x:dx/len,y:-dz/len};controller.update(Math.min(1/60,len/7));
      assert.ok(Math.abs(p.y-1.15-roadviewGroundHeight(p.x,p.z))<1e-6);
    }assert.fail('approach blocked');
  }
  walk(t.landing*.95);assert.ok(Math.abs(p.y-1.15-t.height)<1e-6);
  controller.jumpQueued=true;controller.update(1/60);for(let i=0;i<120;i++)controller.update(1/60);
  assert.ok(controller.grounded);assert.ok(Math.abs(p.y-1.15-t.height)<1e-6);
  walk(t.landing+t.run+1);assert.equal(p.y,1.15);
  const boxes=[];fillNorthEntrances({box(c,p,size){boxes.push({p,size});},quad(){}},t.owner);
  const canopy=boxes.find(b=>b.size[0]===t.width+1);
  if(canopy)assert.ok(canopy.p[1]-canopy.size[1]/2>t.height+1.15+1.45);
});
import { FIVE_FRONT_TREES, northRoadTreeClear } from '../src/north-campus-layout.js';
import { roadTreeClear } from '../src/campus-road-layout.js';
test('front garden planting stays out of both road systems and source buildings',()=>{
  assert.ok(FIVE_FRONT_TREES.length>0);
  for(const p of FIVE_FRONT_TREES){
    assert.ok(roadTreeClear(p,1.3)&&northRoadTreeClear(p,1.3));
    for(const b of bodies)assert.ok(!polygonOverlap(p.x,p.z,b.polygon,1.3));
  }
});
import { fillFiveFacade, fillAnniversaryFacade, fillNorthFurniture } from '../src/north-campus-geometry.js';
test('all new batched facade/furniture primitives are finite and bounded',()=>{
  let primitives=0;
  const accept=(color,...args)=>{
    primitives++;assert.match(color,/^#[0-9a-f]{6}$/i);
    for(const n of args.flat(Infinity))assert.ok(Number.isFinite(n));
  };
  const batch={box:accept,tube:accept,crown:accept,triangle:accept,quad:accept};
  fillFiveFacade(batch);fillAnniversaryFacade(batch);
  for(const owner of ['bldg_05','bldg_60th']){fillNorthEntrances(batch,owner);fillNorthFurniture(batch,owner);}
  assert.ok(primitives>=NORTH_APPROACHES.length+FIVE_FRONT_TREES.length*2&&primitives<10000,`bounded primitive count: ${primitives}`);
});
