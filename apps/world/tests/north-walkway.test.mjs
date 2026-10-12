import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WALKWAY_EVIDENCE,WALKWAY_SURFACES,WALKWAY_EXTERNAL_MASKS,WALKWAY_PROPS,WALKWAY_WALL_PROPS,WALKWAY_LINKS,WALKWAY_SOUTH_ANCHOR,WALKWAY_ENTRANCE,walkwayTreeClear} from '../src/north-walkway-layout.js';
import {intersectSurface,surfaceArea} from '../src/north-walkway-surface.js';
import {fillWalkwayPaving,fillWalkwayProps,fillWalkwayEntrance} from '../src/north-walkway-geometry.js';
import {SIDE_GATE_PATHS} from '../src/north-side-gate-layout.js';
import {NORTH_LANES,FIVE,ANNIVERSARY,FIVE_FRONT_TREES} from '../src/north-campus-layout.js';
import {FACILITY_COLLIDERS,towerParts} from '../src/campus-facilities.js';
import {FLAT_GROUND_Y as G,FLAT_GROUND_MAX_Y} from '../src/flat-ground-surface.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {createMiniMapDataSource} from '../src/minimap/minimap-data.js';
import {campusNavGraphData,campusNavPolylines,createCampusNavigation,isCampusSegmentClear} from '../src/navigation/campus-navigation.js';
import {createNavigationState,NAV_STATUS} from '../src/navigation/navigation-state.js';
import {createPlayerAutoMove} from '../src/navigation/player-auto-move.js';
import {PlayerController} from '../src/player-controller.js';
import {roadviewGroundHeight} from '../src/roadview-layout.js';
import {RENDER_CHUNKS} from '../src/render-chunk-registry.js';
import {CAMPUS_NIGHT_LAMPS} from '../src/environment/night-campus-lamp-layout.js';
import {NORTH_PHOTO_COLORS,fillAnniversaryPhotoFacade} from '../src/north-campus-photo-geometry.js';
const capture=fn=>{const calls=[];fn(Object.fromEntries(['box','quad','triangle','tube','crown'].map(kind=>[kind,(c,...args)=>calls.push({kind,c,args})])));return calls;};
const allRings=WALKWAY_SURFACES.flatMap(s=>s.rings);
const onWalk=p=>[...allRings,...WALKWAY_EXTERNAL_MASKS].some(r=>polygonOverlap(p.x,p.z,r,.015));

test('existing north surfaces own the restoration; base pieces are finite, disjoint, mapped exactly',()=>{
 const map=createMiniMapDataSource().geometry();
 assert.equal(WALKWAY_SURFACES.length,NORTH_LANES.length+2+WALKWAY_LINKS.length);
 for(const s of WALKWAY_SURFACES){
  assert.ok(s.rings.length,s.id);
  assert.deepEqual(map.find(m=>m.id.endsWith(`.${s.id}.0`)).rings,s.rings);
  for(const ring of s.rings){assert.ok(ring.length>=3&&Math.abs(surfaceArea(ring))>1e-8);assert.ok(ring.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));}
 }
 for(let i=0;i<allRings.length;i++)for(const r of [...allRings.slice(i+1),...WALKWAY_EXTERNAL_MASKS]){
  assert.ok(Math.abs(surfaceArea(intersectSurface(allRings[i],r)))<1e-7,'no positive-area duplicated surface or asphalt overlap');
 }
 const calls=capture(fillWalkwayPaving);assert.ok(calls.length>200&&calls.length<2500);
 for(const q of calls){assert.equal(q.kind,'quad');const y=q.args[0][1];assert.ok(y>=G.SURFACE&&y<=FLAT_GROUND_MAX_Y);assert.ok(q.args.every(p=>p[1]===y&&p.every(Number.isFinite)));}
 assert.deepEqual(capture(fillWalkwayPaving),calls,'re-entry determinism');
});

test('four gate paths, lane centres and footprint remain pinned; relocated clock still has one owner',()=>{
 assert.deepEqual(SIDE_GATE_PATHS.map(s=>s.id),['side_gate_entry','side_gate_anniversary','side_gate_five','side_gate_five_north']);
 const digest=p=>createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex');
 // File-level preservation protects ground coordinates and original colliders,
 // with the user-authorized elevated clock relocation tested independently.
 // in addition to the historical hashes in north-landmark-restoration.test.
 for(const [file,hash]of Object.entries(JSON.parse(readFileSync(new URL('./fixtures/north-walkway-owners.json',import.meta.url),'utf8'))))assert.equal(digest(file),hash,file);
 assert.equal(towerParts(FIVE).filter(t=>t.id==='bldg_05_clock_core').length,1);
 for(const f of [FIVE,ANNIVERSARY])assert.deepEqual(FACILITY_COLLIDERS.filter(c=>c.id.startsWith(f.id+'_')&&c.minY===0).map(c=>c.polygon),f.parts);
});

test('north-to-south physical route is supported at every sample and adds only the two missing joins',()=>{
 const nav=createCampusNavigation(),start=SIDE_GATE_PATHS[0].frame.at(1);
 for(const [a,b]of [[start,WALKWAY_SOUTH_ANCHOR],[WALKWAY_SOUTH_ANCHOR,start]]){
  const route=nav.solver.solve(a,b);assert.equal(route.mode,'NETWORK');
  assert.ok(route.distance<110,'no campus detour');
  for(let i=1;i<route.points.length;i++){
   const p=route.points[i-1],q=route.points[i];assert.ok(isCampusSegmentClear(p,q));
   const n=Math.ceil(Math.hypot(p.x-q.x,p.z-q.z)/.15);
   for(let j=0;j<=n;j++)assert.ok(onWalk({x:p.x+(q.x-p.x)*j/n,z:p.z+(q.z-p.z)*j/n}),`unrendered route ${i}/${j}`);
  }
 }
 assert.deepEqual(campusNavPolylines().filter(l=>l.source==='WALKWAY_LINKS').map(l=>l.id),WALKWAY_LINKS.map(l=>l.id));
 const graph=campusNavGraphData();assert.deepEqual(graph.dropped.lineIds,[]);
 for(const id of ['anniversary_perimeter_lane_3','anniversary_perimeter_lane_4'])assert.ok(!graph.edges.some(e=>e.lineId===`junction.${id}`),'physical joins replace these automatic guesses');
});

for(const reverse of [false,true])test(`real PlayerController and Auto Move complete ${reverse?'south to north':'north to south'} on paving`,()=>{
 globalThis.window={addEventListener(){}};globalThis.document={getElementById(){return null;}};
 const north=SIDE_GATE_PATHS[0].frame.at(1.4),[start,end]=reverse?[WALKWAY_SOUTH_ANCHOR,north]:[north,WALKWAY_SOUTH_ANCHOR];
 const p={...start,y:1.15},entity={getLocalPosition:()=>({...p}),setLocalPosition(x,y,z){Object.assign(p,{x,y,z});},setLocalEulerAngles(){}};
 const controller=new PlayerController(entity),clock={t:0,now(){return this.t;}};
 const state=createNavigationState({solver:createCampusNavigation().solver,clock,arrivalRadius:.35});
 const auto=createPlayerAutoMove({clock,setAssist:i=>controller.setAssistedMovement(i),clearAssist:()=>controller.clearAssistedMovement()});
 state.setDestination({...end,id:'walkway-test',title:'walkway-test',approach:end,arrivalRadius:.35},{position:p,spaceId:'campus'});
 assert.ok(auto.start(state.getSnapshot()));
 for(let i=0;i<2400&&state.getSnapshot().status!==NAV_STATUS.ARRIVED;i++){
  clock.t+=1000/60;state.update({position:p,spaceId:'campus'});auto.update(state.getSnapshot(),p);controller.update(1/60,1.2);
  assert.ok(onWalk(p),`player left physical paving ${JSON.stringify(p)}`);assert.ok(Math.abs(p.y-1.15-roadviewGroundHeight(p.x,p.z))<1e-6);
 }
 assert.equal(state.getSnapshot().status,NAV_STATUS.ARRIVED);assert.ok(Math.hypot(p.x-end.x,p.z-end.z)<.5);
 delete globalThis.window;delete globalThis.document;
});

test('photo props stay clear of route capsules, existing trees and building bodies; one streamed owner',()=>{
 const props=[...WALKWAY_PROPS,...WALKWAY_WALL_PROPS];assert.equal(new Set(props.map(q=>q.id)).size,props.length);
 for(const q of props){
  assert.ok(!FACILITY_COLLIDERS.filter(c=>c.minY===0).some(c=>polygonOverlap(q.position.x,q.position.z,c.polygon,q.radius)),q.id);
  if(q.kind==='globe')assert.ok(CAMPUS_NIGHT_LAMPS.every(l=>Math.hypot(l.center.x-q.position.x,l.center.z-q.position.z)>3.2),'no duplicate existing street lamp');
  assert.ok(!FIVE_FRONT_TREES.some(p=>Math.hypot(p.x-q.position.x,p.z-q.position.z)<1.3+q.radius),q.id);
  for(const lane of NORTH_LANES.filter(s=>s.id.endsWith('_2')||s.id.endsWith('_3'))){
   for(let u=0;u<lane.frame.length;u+=.3){const p=lane.frame.at(u);assert.ok(Math.hypot(p.x-q.position.x,p.z-q.position.z)>.65+q.radius,q.id);}
  }
 }
 const chunk=RENDER_CHUNKS.find(c=>c.facilities.includes('bldg_60th'));assert.ok(chunk);
 for(const q of props){const p=q.position;assert.ok(p.x>=chunk.bounds.minX&&p.x<=chunk.bounds.maxX&&p.z>=chunk.bounds.minZ&&p.z<=chunk.bounds.maxZ);}
 for(const c of RENDER_CHUNKS)for(const p of c.trees)assert.ok(walkwayTreeClear(p),'generic trees cannot duplicate observed planting strip');
 const near=capture(b=>fillWalkwayProps(b)),detail=capture(b=>fillWalkwayProps(b,'DETAIL'));
 assert.ok(near.length<600&&detail.length<12,'bounded shared material batch, detail only lattice');
 assert.deepEqual(capture(b=>fillWalkwayProps(b)),near);
 for(const q of [...near,...detail,...capture(b=>fillWalkwayEntrance(b,NORTH_PHOTO_COLORS))])assert.ok(q.args.flat(Infinity).every(Number.isFinite));
});

test('survey uncertainties and unsupported facilities stay explicit, not generated as facts',()=>{
 assert.equal(WALKWAY_EVIDENCE.status,'DERIVED_BLOCKOUT');assert.equal(WALKWAY_EVIDENCE.surveyStatus,'SURVEY_TBD');
 assert.ok(Object.values(WALKWAY_EVIDENCE.survey).every(v=>v===null));assert.equal(WALKWAY_EVIDENCE.fiveEastFacade,'FACADE_TBD');
 assert.equal(WALKWAY_ENTRANCE.orientation,'INFERRED');
 for(const kind of ['bench','rack','bollard','stairs','crosswalk'])assert.ok(![...WALKWAY_PROPS,...WALKWAY_WALL_PROPS].some(p=>p.kind===kind));
 assert.ok(WALKWAY_EVIDENCE.deferred.includes('current_crosswalk'));
});


test('curved facade frame segments share exact joints without visible wedge gaps',()=>{
 const faces=capture(fillAnniversaryPhotoFacade).filter(c=>c.kind==='quad'&&c.c===NORTH_PHOTO_COLORS.ribbon).filter((_,i)=>i%2===0);
 let joins=0;
 for(let i=1;i<faces.length;i++){
  const previous=faces[i-1].args,next=faces[i].args;
  const distance=Math.hypot(...previous[1].map((v,k)=>v-next[0][k]));
  if(distance<2){assert.deepEqual(previous[1],next[0]);assert.deepEqual(previous[2],next[3]);joins++;}
 }
 assert.ok(joins>=25,'all three existing ribbons retain connected silhouettes');
});
