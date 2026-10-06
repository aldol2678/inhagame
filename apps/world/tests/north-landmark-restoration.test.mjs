import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FACILITIES,FACILITY_COLLIDERS,towerParts} from '../src/campus-facilities.js';
import {geoToWorld} from '../src/geo-coordinates.js';
import {FIVE,ANNIVERSARY,NORTH_APPROACHES,exteriorFrame} from '../src/north-campus-layout.js';
import {fillFiveFacade,fillAnniversaryFacade} from '../src/north-campus-geometry.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {canOccupy,resolveHeight,cameraSafeFraction} from '../src/world-collision.js';
import {AGORA,ROADVIEW_OBSTACLES,roadviewGroundHeight} from '../src/roadview-layout.js';
import {campusNavGraphData} from '../src/navigation/campus-navigation.js';
import {SITE_FEATURES} from '../src/basic-campus.js';
import {CAMPUS_ROADS,CAMPUS_PATH_WIDTHS} from '../src/campus-road-layout.js';
import {OBSTACLES} from '../src/campus-layout.js';
import {inferCampusMaterialProfile} from '../src/campus-material-profile.js';
import {NORTH_PHOTO_COLORS,fillNorthPhotoTower} from '../src/north-campus-photo-geometry.js';
const url=new URL('../src/agora-photo-geometry.js',import.meta.url);
const agora=existsSync(url)?await import(url.href):{};
const capture=fn=>{const calls=[];const b=Object.fromEntries(['box','tube','crown','quad','triangle'].map(kind=>[kind,(color,...args)=>calls.push({kind,color,args})]));fn(b);return calls;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('restored glass, stone and frame palettes retain the current semantic optical profiles',()=>{
 for(const key of ['glass','darkGlass'])assert.equal(inferCampusMaterialProfile(NORTH_PHOTO_COLORS[key]),'glass');
 for(const key of ['metal','ribbon','joint'])assert.equal(inferCampusMaterialProfile(NORTH_PHOTO_COLORS[key]),'metal');
 for(const key of ['stone','trim'])assert.equal(inferCampusMaterialProfile(NORTH_PHOTO_COLORS[key]),'concrete');
 assert.equal(inferCampusMaterialProfile('#408f88'),'paint');
});

test('pinned ground facilities, previous colliders and approved navigation metadata remain identical',()=>{
 // Recorded from public main5b262960, independently identical to PR186's tree.
 // The requested Matching Tree relocation is independently asserted by
 // matching-tree.test.mjs. Normalize only its approved location/provenance delta
 // back to the old point, retaining this original hash for everything else.
 const pinned=FACILITIES.map(({presentationAccuracy,...f})=>{
  if(f.id!=='lmk_matching_tree')return f;
  const {positionEvidencePath,...legacy}=f,center=geoToWorld(37.44828,126.65451);
  return {...legacy,lat:37.44828,lon:126.65451,
   geometryAccuracy:'Game navigation anchor; not a surveyed real-world location',center,footprintCenter:{...center}};
 });
 assert.equal(digest(pinned),'d13b6d4ce976693026cd069f626efdf10514ca4ed11b42f08bb832cd17829854');
 assert.equal(digest(FACILITY_COLLIDERS.filter(c=>!['bldg_05_clock_core','bldg_60th_tower'].includes(c.id))),
  '7de36ac06fe915500ba8bf761ce6a0b5bef4793a125bb8ced291c8861fb4b0b7');
 // #201 explicitly promotes two existing geometric connectors to authored PATHs.
 // Geometry/collision stay pinned independently below; this hash includes metadata.
 assert.equal(digest(campusNavGraphData()),'ae73226173d2113c9446f22ea2903efb56bca1ba1d2c8e027d7ff3f264a96e80');
});

test('surroundings integration preserves exact-main path shape and all ground collision',()=>{
 // Independently derived from main 0f875b88 after #196, before #201 integration.
 // Ignore incidental graph IDs but retain each undirected geometric edge to 1e-8 WU.
 const graph=campusNavGraphData(),points=new Map(graph.nodes.map(n=>[n.id,[n.x,n.z].map(x=>x.toFixed(8)).join(',')]));
 const edges=graph.edges.map(e=>[points.get(e.a),points.get(e.b)].sort().join('|')).sort();
 assert.equal(graph.nodes.length,187);assert.equal(graph.edges.length,212);
 assert.equal(digest(edges),'9959b3a7ad148200c2c338d9e1f7ecbd2d6d142683c705668723d1e9bd3be78c');
 const paths=SITE_FEATURES.filter(f=>f.kind==='path').map(f=>({id:f.id,vertices:f.vertices,width:CAMPUS_PATH_WIDTHS[f.id]||3.5}));
 const roads=CAMPUS_ROADS.map(({id,vertices,width,shoulder})=>({id,vertices,width,shoulder}));
 assert.equal(digest({paths,roads}),'0c0be0db6814556e0703ee548e6e12e57dff20a9fb2077e761ac063d059d39de');
 const ground=OBSTACLES.filter(c=>(c.minY??0)<=.5);
 assert.equal(ground.length,864);
 assert.equal(digest(ground),'86e9348b1156f4eacd7d86d9b5ef5703b24b81895e04527075e8b2dbd3d21987');
 const promoted=graph.edges.filter(e=>e.source==='MAIN_HALL_WALKWAYS');
 assert.deepEqual(promoted.map(e=>e.lineId).sort(),['main_hall_walkway_east','main_hall_walkway_west']);
 assert.ok(promoted.every(e=>e.kind==='PATH'));
});

test('60th Anniversary regains a tall slab inside the original footprint, shared by rendering and collision',()=>{
 const parts=towerParts(ANNIVERSARY);assert.ok(parts.length>0,'photo-confirmed skyline is missing');
 assert.ok(parts.some(t=>t.height>=30&&t.height<=36),'bounded game-scale skyline estimate');
 for(const t of parts){
  const collider=FACILITY_COLLIDERS.find(c=>c.id===t.id);assert.ok(collider);
  assert.deepEqual(collider.polygon,t.vertices);assert.equal(collider.minY,ANNIVERSARY.height);assert.equal(collider.maxY,t.height);
  for(const p of t.vertices)assert.ok(polygonOverlap(p.x,p.z,ANNIVERSARY.rings[0],0));
 }
});

test('photo-review fit anchors the clock at the existing south notch and keeps the high slab slender',()=>{
 const clock=towerParts(FIVE)[0],notch=exteriorFrame(FIVE.rings[0],4),anchor=notch.at(notch.length/2,-2.19);
 const center=clock.vertices.reduce((p,q)=>({x:p.x+q.x/4,z:p.z+q.z/4}),{x:0,z:0});
 assert.ok(Math.hypot(center.x-anchor.x,center.z-anchor.z)<.01,'clock rises from central facade break, not the eastern window wing');
 const slab=towerParts(ANNIVERSARY)[0],length=Math.hypot(slab.vertices[1].x-slab.vertices[0].x,slab.vertices[1].z-slab.vertices[0].z);
 assert.ok(length>=24&&length<=27,'bounded slimmer photographic fit; not a surveyed dimension');
 assert.ok(length/(slab.height-ANNIVERSARY.height)<1.15,'exposed slab reads near-square/tall instead of a 2:1 panel');
});

test('restored upper masses stop flight/camera and support landing without changing ground bodies',()=>{
 const targets=[FIVE,ANNIVERSARY];
 for(const f of targets){
  const parts=towerParts(f);assert.ok(parts.length>0,`${f.id} upper silhouette`);
  const base=FACILITY_COLLIDERS.filter(c=>c.id.startsWith(f.id+'_')&&c.minY===0);
  assert.deepEqual(base.map(c=>c.polygon),f.parts);assert.ok(base.every(c=>c.maxY===f.height));
  for(const t of parts){
   const c=FACILITY_COLLIDERS.find(c=>c.id===t.id),p={x:t.vertices.reduce((s,p)=>s+p.x,0)/t.vertices.length,z:t.vertices.reduce((s,p)=>s+p.z,0)/t.vertices.length};
   assert.equal(canOccupy({...p,y:(f.height+t.height)/2},undefined,[c]),false);
   assert.equal(resolveHeight({...p,y:t.height+5},1.15,1.15,[c]),t.height+1.15);
   assert.ok(cameraSafeFraction([p.x-40,(f.height+t.height)/2,p.z],[p.x+40,(f.height+t.height)/2,p.z],[c])<1);
   assert.equal(cameraSafeFraction([p.x-40,2,p.z],[p.x+40,2,p.z],[c]),1,'no new ground navigation obstacle');
  }
 }
});

test('5th-building restores verified south arches without inventing arched courtyard elevations',()=>{
 const calls=capture(fillFiveFacade);
 assert.ok(calls.filter(c=>c.kind==='triangle').length>30,'actual curved bay heads');
 assert.ok(calls.filter(c=>c.kind==='box').length>150,'multi-storey bay rhythm');
 assert.ok(calls.every(c=>c.kind!=='box'||!polygonOverlap(c.args[0][0],c.args[0][2],FIVE.rings[1],0)),'unseen inner elevations remain undecorated');
});

test('5th clock core visually continues into its facade rather than floating as a rooftop box',()=>{
 const boxes=capture(b=>fillNorthPhotoTower(b,FIVE)).filter(c=>c.kind==='box'&&c.color===NORTH_PHOTO_COLORS.darkGlass);
 assert.ok(boxes.some(c=>c.args[0][1]-c.args[1][1]/2<1&&c.args[0][1]+c.args[1][1]/2>=FIVE.height));
});

test('60th podium has a continuous glass grid and bounded curved facade-ribbon segments',()=>{
 const calls=capture(fillAnniversaryFacade);
 assert.ok(calls.filter(c=>c.kind==='box').length>100,'continuous podium glazing grid');
 assert.ok(calls.filter(c=>c.kind==='tube').length>12,'photographed flowing facade frame');
 assert.ok(calls.filter(c=>c.kind==='quad').length>=18,'broad facade ribbon has planar width, not only a wire outline');
});

test('Agora has a solid base, supported stairs, visible guards and an open cross-path',()=>{
 assert.equal(typeof agora.fillAgoraPhotoStructure,'function');assert.equal(typeof agora.fillAgoraPhotoNear,'function');
 const base=capture(b=>agora.fillAgoraPhotoStructure?.(b));
 const steps=base.filter(c=>c.kind==='box'&&Math.abs(c.args[1][0]-(AGORA.stairEnd-AGORA.stairStart))<1e-6);
 assert.equal(steps.length,AGORA.steps,'one bounded riser per existing step');
 for(const s of steps){const [p,size]=s.args;assert.ok(Math.abs(p[1]+size[1]/2-roadviewGroundHeight(p[0],p[2]))<=AGORA.height/AGORA.steps+.001);}
 const near=capture(b=>agora.fillAgoraPhotoNear?.(b));assert.ok(near.some(c=>c.kind==='tube'),'visible existing retaining guards');
 assert.ok(base.some(c=>c.kind==='quad'&&c.args.every(p=>p[1]>AGORA.height)),'cross-path surface');
 for(const c of ROADVIEW_OBSTACLES.filter(c=>c.id.startsWith('fac_agora_courtyard_guard_')))assert.ok(c.maxY===AGORA.height+.9);
});

test('photo presentation is deterministic, finite and bounded; original approaches and courtyard support persist',()=>{
 for(const fn of [fillFiveFacade,fillAnniversaryFacade,...Object.values(agora).filter(v=>typeof v==='function')]){
  const a=capture(fn),b=capture(fn);assert.deepEqual(a,b);assert.ok(a.length<5000);
  for(const c of a){assert.match(c.color,/^#[0-9a-f]{6}$/i);for(const n of c.args.flat(Infinity))assert.ok(Number.isFinite(n));}
 }
 for(const entry of NORTH_APPROACHES){const p=entry.frame.at(entry.u,entry.landing*.5);assert.equal(roadviewGroundHeight(p.x,p.z),entry.height);}
 const center=FIVE.rings[1].reduce((p,q)=>({x:p.x+q.x/4,z:p.z+q.z/4}),{x:0,z:0});
 assert.equal(resolveHeight({...center,y:50},1.15,1.15,FACILITY_COLLIDERS),1.15);
});
