import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,export class StandardMaterial{update(){}};export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}',shortCircuit:true}:next(s,c);}});
const { FacilityMeshBatch }=await import('../src/facility-mesh-batch.js');
const { FACILITIES, FACILITY_COLLIDERS }=await import('../src/campus-facilities.js');
const { BUILDINGS, SITE_FEATURES }=await import('../src/basic-campus.js');
const { forestRoadTrees, ROAD_SEGMENTS, roadFrame, CAMPUS_PATH_WIDTHS }=await import('../src/campus-road-layout.js');
const { polygonOverlap }=await import('../src/polygon-collision.js');
const { roadviewGroundHeight }=await import('../src/roadview-layout.js');
const { SEAT_ANCHORS }=await import('../src/seat-anchors.js');
const source=new URL('../src/heidegger-forest-geometry.js',import.meta.url);
const forest=existsSync(source)?await import(source):{};
const center=FACILITIES.find(f=>f.id==='lmk_heidegger_forest').center;
const profiles=()=>{assert.equal(typeof forest.forestTreeProfiles,'function','photo-grounded profiles missing');return forest.forestTreeProfiles(center);};
const geometry=()=>{assert.equal(typeof forest.fillHeideggerForest,'function','photo-grounded geometry missing');const b=new FacilityMeshBatch();forest.fillHeideggerForest(b,center);return b;};
const tris=b=>[...b.groups].flatMap(([color,g])=>Array.from({length:g.indices.length/3},(_,i)=>({color,v:g.indices.slice(i*3,i*3+3).map(k=>g.positions.slice(k*3,k*3+3))})));
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10;
const overlap=(a,b)=>a.some(p=>polygonOverlap(p.x,p.z,b))||b.some(p=>polygonOverlap(p.x,p.z,a))||a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
const strip=(frame,v0,v1)=>[frame.at(0,v0),frame.at(frame.length,v0),frame.at(frame.length,v1),frame.at(0,v1)];
const protectedRings=[...FACILITY_COLLIDERS.map(f=>f.polygon),...BUILDINGS.map(f=>f.vertices),...SITE_FEATURES.filter(f=>f.kind!=='lawn'&&f.kind!=='path').map(f=>f.vertices),
 ...ROAD_SEGMENTS.map(s=>strip(s.frame,-s.road.width/2-s.road.shoulder,s.road.width/2+s.road.shoulder)),
 ...ROAD_SEGMENTS.filter(s=>s.road.osmWayId===481241661).map(s=>strip(s.frame,2.1,3.5)),
 ...SITE_FEATURES.filter(f=>f.kind==='path').flatMap(f=>f.vertices.slice(1).map((p,i)=>{const w=(CAMPUS_PATH_WIDTHS[f.id]||3.5)/2+1.05;return strip(roadFrame(f.vertices[i],p),-w,w);})),
 ...SITE_FEATURES.filter(f=>f.kind==='lawn').map(f=>f.vertices)];

test('forest preserves all existing positions but varies mature exposed trunks and mixed crowns',()=>{
 const p=profiles();assert.deepEqual(p.map(({x,z})=>({x,z})),forestRoadTrees(center));assert.equal(p.length,12);
 assert.deepEqual(new Set(p.map(t=>t.kind)),new Set(['broadleaf','pine']));assert.ok(new Set(p.map(t=>t.height)).size>=4);
 for(const t of p){assert.ok(t.trunkHeight>=4&&t.height>=7&&t.height<=10);assert.ok(t.crowns.length>=3);for(const c of t.crowns){assert.ok(c.y-c.size[1]/2>=3.5);assert.ok(Math.hypot(c.dx,c.dz)+Math.max(c.size[0],c.size[2])/2<=2.51,'canopies retain existing safe radius');}}
});
test('one compact soil clearing stays within the selected grove and outside every protected surface',()=>{
 profiles();assert.equal(typeof forest.forestSoilRing,'function');const ring=forest.forestSoilRing(center);
 assert.ok(ring.length>=8);const area=Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0)/2);assert.ok(area>=25&&area<=65,`bounded soil clearing: ${area}`);
 for(const r of protectedRings)assert.equal(overlap(ring,r),false,'soil cannot cover roads, paths, existing lawn compartments, water or buildings');
 for(const p of ring){assert.equal(roadviewGroundHeight(p.x,p.z),0);assert.ok(forestRoadTrees(center).some(t=>Math.hypot(t.x-p.x,t.z-p.z)<2.5));}
 for(const seat of SEAT_ANCHORS)assert.equal(polygonOverlap(seat.position.x,seat.position.z,ring,.5),false,'existing seats stay untouched');
 const t=tris(geometry()).filter(t=>t.color===forest.FOREST_COLORS.soil);assert.ok(t.length>=6);for(const {v} of t){assert.ok(v.every(p=>p[1]===.020));const [a,b,c]=v;assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);}
});
test('forest geometry stays finite, static, opaque, and within four shared color batches',()=>{
 const a=geometry(),b=geometry();assert.deepEqual([...a.groups],[...b.groups]);assert.equal(a.groups.size,4);
 const ts=tris(a),bytes=[...a.groups.values()].reduce((s,g)=>s+(g.positions.length+g.normals.length)*4+g.indices.length*2,0);
 assert.ok(ts.length>=1000&&ts.length<=1700,`triangle budget: ${ts.length}`);assert.ok(bytes<=140000,`buffer budget: ${bytes}`);
 for(const {v} of ts)assert.ok(v.flat().every(Number.isFinite));
 assert.equal(Math.min(...ts.flatMap(t=>t.v.map(p=>p[1]))),0,'trunks still ground at y=0');
});
test('existing forest facility remains its only persistent owner',()=>{
 const text=readFileSync(new URL('../src/facility-blockout.js',import.meta.url),'utf8');assert.match(text,/fillHeideggerForest\(batch,f\.center\)/);
 assert.doesNotMatch(text,/forestRoadTrees\(f\.center\)\.forEach/);
});

test('compacted soil uses the existing matte ground material profile',async()=>{
 const {inferCampusMaterialProfile}=await import('../src/campus-material-profile.js');
 assert.equal(inferCampusMaterialProfile(forest.FOREST_COLORS.soil),'ground');
 for(const kind of ['broadleaf','pine'])assert.equal(inferCampusMaterialProfile(forest.FOREST_COLORS[kind]),'foliage');
});
