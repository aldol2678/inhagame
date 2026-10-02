import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_BUILDINGS, MARKET_EXISTING_SHOPS, MARKET_COLLIDERS, MARKET_SIGNS, MARKET_MAP_BUILDINGS, MARKET_PREVIEWS, GEONMULJU_BUILDING } from '../src/back-market-layout.js';
import { fillMarketBase, fillMarketNear, fillMarketDetail } from '../src/back-market-geometry.js';
import { BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from '../src/back-approach-layout.js';
import { culturePolygonsOverlap } from '../src/culture-street-layout.js';
import { WORLD_BOUNDS, OBSTACLES } from '../src/campus-layout.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { canOccupy, moveAroundObstacles, resolveHeight, cameraSafeFraction } from '../src/world-collision.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { campusSpawn } from '../src/campus-spawn.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { VIEW_DISTANCE_PRESETS } from '../src/view-distance.js';

test('infill keeps all source streets and narrow west passages walkable in both directions',()=>{
  for(const s of BACK_APPROACH_SEGMENTS)for(const sign of [-1,1]) {
    const a=s.frame.at(sign>0?0:s.frame.length),z=s.frame.at(sign>0?s.frame.length:0);
    let p={...a,y:1.15};const steps=Math.ceil(s.frame.length/.25);
    for(let i=0;i<steps;i++)p={...moveAroundObstacles(p,(z.x-a.x)/steps,(z.z-a.z)/steps),y:1.15};
    assert.ok(Math.hypot(p.x-z.x,p.z-z.z)<.02,`${s.id} blocked ${sign}`);
  }
});

test('MCM Geonmulju venue owns a dedicated Culture Street frontage and door',()=>{
  assert.equal(GEONMULJU_BUILDING.id,'back_market_geonmulju');
  assert.equal(GEONMULJU_BUILDING.roadId,'culture_67_link');
  assert.equal(GEONMULJU_BUILDING.w,5.35);
  assert.ok(MARKET_BUILDINGS.includes(GEONMULJU_BUILDING));
  assert.ok(Number.isFinite(GEONMULJU_BUILDING.door.x)&&Number.isFinite(GEONMULJU_BUILDING.door.z));
});

test('new buildings avoid existing bodies and source roads and retain persistent collision',()=>{
  assert.ok(MARKET_BUILDINGS.length>=70);
  for(const id of ['culture_cross_west','culture_cross_east','culture_67_north','culture_67_link','culture_47_junction','inha_east_extension'])assert.ok(MARKET_BUILDINGS.some(q=>q.roadId===id));
  for(const q of MARKET_BUILDINGS) {
    const own=MARKET_COLLIDERS.find(c=>c.id===q.id);assert.ok(OBSTACLES.includes(own));
    assert.ok(backApproachFootprintClear(q.polygon),q.id);
    for(const other of OBSTACLES.filter(o=>o!==own&&o.polygon&&o.minY===0))
      assert.equal(culturePolygonsOverlap(q.polygon,other.polygon),false,`${q.id} overlaps ${other.id}`);
    assert.equal(canOccupy({...q.center,y:1.15}),false);
    assert.equal(resolveHeight({...q.center,y:q.h+3},1.15),q.h+.18+1.15);
    const a=q.frame.at(0,-1),b=q.center;
    assert.ok(cameraSafeFraction([a.x,1,a.z],[b.x,1,b.z])<1);
    for(const p of q.bounds)assert.ok(p.x>WORLD_BOUNDS.minX&&p.x<WORLD_BOUNDS.maxX&&p.z>WORLD_BOUNDS.minZ&&p.z<WORLD_BOUNDS.maxZ);
  }
});

test('new and existing shop details and signs stay within exactly one owner chunk',()=>{
  for(const q of [...MARKET_BUILDINGS,...MARKET_EXISTING_SHOPS]) {
    const owners=RENDER_CHUNKS.filter(c=>c.streetscape.includes(q.id));assert.equal(owners.length,1,q.id);
    const b=owners[0].bounds;
    const check=p=>assert.ok(p[0]>=b.minX&&p[0]<=b.maxX&&p[2]>=b.minZ&&p[2]<=b.maxZ,`${q.id} outside chunk`);
    const batch={box(c,p,size,yaw=0){const a=yaw*Math.PI/180;for(const x of [-1,1])for(const z of [-1,1])check([p[0]+x*size[0]/2*Math.cos(a)+z*size[2]/2*Math.sin(a),p[1],p[2]-x*size[0]/2*Math.sin(a)+z*size[2]/2*Math.cos(a)]);},tube(c,a,z){check(a);check(z);}};
    fillMarketNear(batch,[q.id]);fillMarketDetail(batch,[q.id]);
    MARKET_SIGNS.find(s=>s.id===q.id).corners.forEach(check);
  }
});

test('generic fascia signs face outward with upright rows on every facade orientation',()=>{
  assert.equal(MARKET_SIGNS.length,MARKET_BUILDINGS.length+MARKET_EXISTING_SHOPS.length);
  for(const q of [...MARKET_BUILDINGS,...MARKET_EXISTING_SHOPS]) {
    const s=MARKET_SIGNS.find(s=>s.id===q.id),c=q.frame.at(0),out=q.frame.at(0,-1);
    assert.ok(s.normal[0]*(out.x-c.x)+s.normal[2]*(out.z-c.z)>.99,q.id);
    assert.equal(s.corners[0][1],s.corners[1][1]);assert.ok(s.corners[2][1]>s.corners[0][1]);
    const [a,b,d]=s.corners,right=b.map((x,i)=>x-a[i]),up=d.map((x,i)=>x-b[i]);
    // Renderer reverses this quad's winding for the reflected campus root.
    const nx=right[2]*up[1],nz=-right[0]*up[1];
    assert.ok(nx*s.normal[0]+nz*s.normal[2]>0);
  }
});

test('market map, spawn positions, place labels and far clipping cover the extended district',()=>{
  const geometry=createMiniMapDataSource().geometry();
  for(const q of MARKET_MAP_BUILDINGS)assert.deepEqual(geometry.find(g=>g.id===q.id).rings[0],q.polygon);
  const expected={'market-67':'AREA_BACK_MARKET_67','market-91':'AREA_BACK_MARKET_91','market-west':'AREA_BACK_MARKET_WEST','market-north':'AREA_BACK_MARKET_NORTH','market-cross':'AREA_CULTURE_STREET'};
  for(const id of Object.keys(MARKET_PREVIEWS)) {
    const p=campusSpawn({search:`?spawn=${id}`});assert.equal(canOccupy(p),true,id);
    assert.equal(getPlaceZoneAt(p).id,expected[id],id);
  }
  assert.ok(VIEW_DISTANCE_PRESETS.MAX.load>=Math.hypot(WORLD_BOUNDS.maxX-WORLD_BOUNDS.minX,WORLD_BOUNDS.maxZ-WORLD_BOUNDS.minZ));
});

test('market mesh batches have finite geometry and a bounded palette',()=>{
  const colors=new Set();let count=0;
  const primitive=(c,...args)=>{colors.add(c);count++;assert.ok(args.flat(Infinity).every(Number.isFinite));};
  const b={box:primitive,tube:primitive,quad:primitive,triangle:primitive};
  fillMarketBase(b);const ids=[...MARKET_BUILDINGS,...MARKET_EXISTING_SHOPS].map(q=>q.id);fillMarketNear(b,ids);fillMarketDetail(b,ids);
  assert.ok(colors.size<=25,colors.size);assert.ok(count>1000&&count<40000,count);
});
