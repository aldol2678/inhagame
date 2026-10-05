import test from 'node:test';
import assert from 'node:assert/strict';
import { CULTURE_BUILDINGS, CULTURE_GATE, CULTURE_POSTS, CULTURE_COLLIDERS, CULTURE_STREAM_ITEMS, CULTURE_GATE_STATION, CULTURE_LENGTH, CULTURE_PREVIEW_SPAWN, CULTURE_TERMINAL, culturePoint, culturePolygonsOverlap } from '../src/culture-street-layout.js';
import { fillCulturePaving, fillCultureBase, fillCultureNear, fillCultureDetail } from '../src/culture-street-geometry.js';
import { BACK_APPROACH_ROADS, BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from '../src/back-approach-layout.js';
import { BACK_ALLEY_BLOCKS } from '../src/back-alley-layout.js';
import { WORLD_BOUNDS, OBSTACLES } from '../src/campus-layout.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { canOccupy, moveAroundObstacles, cameraSafeFraction, resolveHeight } from '../src/world-collision.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { campusSpawn } from '../src/campus-spawn.js';
import { WALK_SHAPE } from '../src/player-dimensions.js';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';

const cultureRoads=BACK_APPROACH_ROADS.filter(r=>r.id==='inha_77_entrance'||r.id.startsWith('culture_'));
function walk(a,b) {
  let p={...a,y:1.15};
  const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.18);
  for(let i=0;i<steps;i++)p={...moveAroundObstacles(p,(b.x-a.x)/steps,(b.z-a.z)/steps),y:1.15};
  assert.ok(Math.hypot(p.x-b.x,p.z-b.z)<.02,`Blocked route to ${JSON.stringify(b)} at ${JSON.stringify(p)}`);
}

test('source 77 axis reaches the 47 junction and all source nodes remain walkable both ways',()=>{
  const main=cultureRoads.find(r=>r.id==='inha_77_entrance');
  assert.equal(main.nodeIds.at(-1),2401071758);
  assert.ok(cultureRoads.find(r=>r.id==='culture_47_junction').nodeIds.includes(main.nodeIds.at(-1)));
  for(const s of BACK_APPROACH_SEGMENTS.filter(s=>cultureRoads.includes(s.road))) {
    for(const offset of [-.45,0,.45]) {
      const a=s.frame.at(0,offset),b=s.frame.at(s.frame.length,offset);
      walk(a,b);walk(b,a);
    }
  }
});

test('canopy leaves longitudinal and transverse walking apertures open but collides with posts and roof',()=>{
  const f=CULTURE_GATE.frame;
  for(const v of [-.6,0,.6])walk(f.at(-4,v),f.at(4,v));
  for(const u of [-.6,0,.6])walk(f.at(u,-4),f.at(u,4));
  for(const p of CULTURE_POSTS)assert.equal(canOccupy({...f.at(p.u,p.v),y:1.15}),false);
  const center=f.at(0);
  assert.equal(canOccupy({...center,y:1.15}),true);
  assert.equal(canOccupy({...center,y:3.7}),false);
  assert.equal(resolveHeight({...center,y:1.15},7)+WALK_SHAPE.headOffset,3.1);
  assert.equal(resolveHeight({...center,y:8},1.15),4.35+1.15);
});

test('authored corners and terminal replace generic plots without overlaps or road obstruction',()=>{
  for(const id of ['yellow','check','dark','pink'])assert.ok(CULTURE_BUILDINGS.some(q=>q.id===`culture_corner_${id}`));
  assert.ok(CULTURE_BUILDINGS.length>=20);
  assert.equal(CULTURE_TERMINAL.style,'public_qa');
  assert.ok(CULTURE_BUILDINGS.every(q=>q.h===6&&q.style==='public_qa'));
  for(const q of CULTURE_BUILDINGS) {
    assert.ok(backApproachFootprintClear(q.polygon),q.id);
    const own=CULTURE_COLLIDERS.find(c=>c.id===q.id);
    assert.ok(OBSTACLES.includes(own));
    assert.equal(canOccupy({...q.center,y:1.15}),false);
    for(const other of OBSTACLES.filter(c=>c!==own&&c.polygon&&c.minY===0))
      assert.equal(culturePolygonsOverlap(q.polygon,other.polygon),false,`${q.id} overlaps ${other.id}`);
    for(const p of q.bounds)assert.ok(p.x>WORLD_BOUNDS.minX&&p.x<WORLD_BOUNDS.maxX&&p.z>WORLD_BOUNDS.minZ&&p.z<WORLD_BOUNDS.maxZ);
    const front=q.frame.at(0,-1),inside=q.frame.at(0,1);
    assert.ok(cameraSafeFraction([front.x,1,front.z],[inside.x,1,inside.z])<1);
    assert.equal(resolveHeight({...q.center,y:q.h+3},1.15),q.h+.18+1.15);
  }
  assert.ok(!BACK_ALLEY_BLOCKS.some(q=>q.id.includes('inha_77_entrance')));
});

test('every culture detail has one streaming owner that contains its geometry',()=>{
  for(const q of CULTURE_STREAM_ITEMS) {
    const owners=RENDER_CHUNKS.filter(c=>c.streetscape.includes(q.id));assert.equal(owners.length,1);
    const bounds=owners[0].bounds;
    const check=p=>assert.ok(p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[2]>=bounds.minZ&&p[2]<=bounds.maxZ,`${q.id} escapes chunk`);
    const b={box(c,p,size,yaw=0){const r=yaw*Math.PI/180;for(const x of [-1,1])for(const z of [-1,1])check([p[0]+x*size[0]/2*Math.cos(r)+z*size[2]/2*Math.sin(r),p[1],p[2]-x*size[0]/2*Math.sin(r)+z*size[2]/2*Math.cos(r)]);},tube(c,a,z){check(a);check(z);}};
    fillCultureNear(b,[q.id]);fillCultureDetail(b,[q.id]);
  }
});

test('paving faces up, stays flush, and geometry uses finite bounded batches',()=>{
  let primitives=0;const colors=new Set();
  const primitive=(c,...args)=>{primitives++;colors.add(c);assert.match(c,/^#[0-9a-f]{6}$/i);assert.ok(args.flat(Infinity).every(Number.isFinite));};
  const up=(c,a,b,d)=>{primitive(c,a,b,d);const ny=(b[2]-a[2])*(d[0]-a[0])-(b[0]-a[0])*(d[2]-a[2]);assert.ok(ny>=-1e-8);[a,b,d].forEach(p=>assert.ok(p[1]>=FLAT_GROUND_Y.UNDERLAY&&p[1]<=FLAT_GROUND_MAX_Y));};
  fillCulturePaving({triangle:up,quad(c,a,b,d,e){up(c,a,b,d);up(c,a,d,e);}});
  const batch={box:primitive,tube:primitive,quad:primitive,triangle:primitive};
  fillCultureBase(batch);const ids=CULTURE_BUILDINGS.map(q=>q.id);fillCultureNear(batch,ids);fillCultureDetail(batch,ids);
  assert.ok(primitives>=CULTURE_BUILDINGS.length*7&&primitives<10000,primitives);assert.ok(colors.size<=20,colors.size);
});

test('preview, extended map bounds, and place labels agree along the new district',()=>{
  const spawn=campusSpawn({hostname:'localhost',search:'?spawn=culture-street'});
  assert.equal(canOccupy(spawn),true);assert.equal(spawn.x,CULTURE_PREVIEW_SPAWN.x);
  const direction=culturePoint(CULTURE_GATE_STATION);
  const dx=direction.x-spawn.x,dz=direction.z-spawn.z,len=Math.hypot(dx,dz);
  assert.ok(Math.abs(-Math.sin(spawn.yaw)-dx/len)<1e-6);
  for(const station of [CULTURE_GATE_STATION,CULTURE_LENGTH])assert.equal(getPlaceZoneAt(culturePoint(station)).id,'AREA_CULTURE_STREET');
  const data=createMiniMapDataSource(),geometry=data.geometry();assert.deepEqual(data.bounds,WORLD_BOUNDS);
  for(const q of CULTURE_BUILDINGS)assert.deepEqual(geometry.find(g=>g.id===q.id).rings[0],q.polygon);
  for(const road of cultureRoads)for(let i=0;i<road.vertices.length-1;i++)assert.ok(geometry.some(g=>g.id===`maproad.${road.id}.${i}`));
});
