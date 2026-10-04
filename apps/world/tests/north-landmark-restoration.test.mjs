import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FACILITIES,FACILITY_COLLIDERS,towerParts} from '../src/campus-facilities.js';
import {FIVE,ANNIVERSARY,NORTH_APPROACHES,exteriorFrame} from '../src/north-campus-layout.js';
import {fillFiveFacade,fillAnniversaryFacade} from '../src/north-campus-geometry.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {canOccupy,resolveHeight,cameraSafeFraction} from '../src/world-collision.js';
import {AGORA,ROADVIEW_OBSTACLES,roadviewGroundHeight} from '../src/roadview-layout.js';
import {campusNavGraphData} from '../src/navigation/campus-navigation.js';
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

test('pinned main ground facilities, all previous colliders and static navigation remain identical',()=>{
 // Recorded from public main5b262960, independently identical to PR186's tree.
 assert.equal(digest(FACILITIES.map(({presentationAccuracy,...f})=>f)),'d13b6d4ce976693026cd069f626efdf10514ca4ed11b42f08bb832cd17829854');
 assert.equal(digest(FACILITY_COLLIDERS.filter(c=>!['bldg_05_clock_core','bldg_60th_tower'].includes(c.id))),
  '7de36ac06fe915500ba8bf761ce6a0b5bef4793a125bb8ced291c8861fb4b0b7');
 assert.equal(digest(campusNavGraphData()),'1ac730af2cc57f62fcef822a716e2451f566505f25fc428f2014a8ac64abed1f');
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
