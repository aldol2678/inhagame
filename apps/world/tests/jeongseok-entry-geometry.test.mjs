import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LIBRARY_FRONT,BUILDINGS,LIBRARY_ROOF_PARTS} from '../src/basic-campus.js';
import {LIBRARY_APPROACHES,ROADVIEW_OBSTACLES,libraryStairHeight,roadviewGroundHeight} from '../src/roadview-layout.js';
import {fillLibraryApproaches,fillJeongseokEntry,JEONGSEOK_ENTRY_LAYOUT as L,JEONGSEOK_ENTRY_EVIDENCE as E,JEONGSEOK_ENTRY_COLORS as C} from '../src/jeongseok-entry-geometry.js';
import {fillPhotoLibraryFront} from '../src/photo-hall-library-geometry.js';
import {canOccupy} from '../src/world-collision.js';
import {WALK_SHAPE,PLAYER_ORIGIN_Y} from '../src/player-dimensions.js';

const capture=fn=>{const boxes=[],quads=[],tubes=[];fn({box:(...args)=>boxes.push(args),quad:(...args)=>quads.push(args),tube:(...args)=>tubes.push(args)});return {boxes,quads,tubes};};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const o=LIBRARY_FRONT.at(0,0),t=LIBRARY_FRONT.at(1,0),v=LIBRARY_FRONT.at(0,1);
const local=p=>({u:(p[0]-o.x)*(t.x-o.x)+(p[2]-o.z)*(t.z-o.z),y:p[1],v:(p[0]-o.x)*(v.x-o.x)+(p[2]-o.z)*(v.z-o.z)});

test('entry evidence distinguishes historic observation, game dimensions and held basement access',()=>{
  assert.equal(E.sourceClass,'HISTORICAL');assert.equal(E.dimensions,'GAME_ADAPTATION');
  assert.equal(E.currentSurvey,false);assert.equal(E.movingDoorPhysics,false);
  assert.equal(E.basement,'UNKNOWN_LOCATION_NO_EXTERIOR_ROUTE');
  assert.match(E.source,/tong\.visitkorea\.or\.kr/);
  assert.equal(L.revolvingCenters.length,2);assert.equal(L.ordinaryCenters.length,2);
  assert.equal(L.pierCenters.length,2);assert.equal(L.floor,1.65);
});

test('base owns paired round enclosures, flanking ordinary doors and stone piers, independent of detail',()=>{
  const base=capture(b=>fillJeongseokEntry(b,'BASE'));
  assert.equal(base.quads.length,2*2*24*4,'two revolving doors, each with upper and lower annular casing');
  for(const u of L.revolvingCenters){
    assert.ok(base.boxes.some(([color,p,size])=>color===C.metal&&Math.abs(local(p).u-u)<1e-8&&size[0]===.045&&size[2]===.045),'central revolving spindle');
  }
  for(const u of L.ordinaryCenters)assert.ok(base.boxes.some(([c,p,s])=>c===C.lightGlass&&Math.abs(local(p).u-u)<1e-8&&s[0]===L.ordinaryWidth));
  for(const u of L.pierCenters)assert.ok(base.boxes.some(([c,p,s])=>c===C.stone&&Math.abs(local(p).u-u)<1e-8&&s[0]===L.pierWidth));
  assert.deepEqual(capture(b=>fillJeongseokEntry(b,'UNKNOWN')),{boxes:[],quads:[],tubes:[]});
  assert.deepEqual(capture(b=>fillJeongseokEntry(b,'BASE')),base);
});

test('entry geometry remains finite and inside the unchanged front canopy presentation region',()=>{
  for(const tier of ['BASE','NEAR','DETAIL']){
    const {boxes,quads}=capture(b=>fillJeongseokEntry(b,tier));
    for(const [,p,size,yaw]of boxes){
      assert.ok([...p,...size,yaw].every(Number.isFinite));assert.ok(size.every(n=>n>0));
      const q=local(p);assert.ok(Math.abs(q.u)+size[0]/2<=4);
      assert.ok(q.y-size[1]/2>=L.floor-1e-8&&q.y+size[1]/2<=4.4);
    }
    for(const [, ...points] of quads)for(const p of points){
      const q=local(p);assert.ok(p.every(Number.isFinite));
      assert.ok(Math.abs(q.u)<1.5&&q.v>-.4&&q.v<.7&&q.y>=L.floor&&q.y<3.0);
    }
  }
});

test('existing reader, door and safe return retain physical and visual clearance',()=>{
  const fixed=[{u:0,v:1},{u:0,v:.45},{u:-2.6,v:1.05}];
  for(const p of fixed){
    const q=LIBRARY_FRONT.at(p.u,p.v);close(roadviewGroundHeight(q.x,q.z),L.floor);
    assert.ok(canOccupy({...q,y:PLAYER_ORIGIN_Y+L.floor}));
    for(const u of L.revolvingCenters)assert.ok(Math.hypot(p.u-u,p.v-L.revolvingV)>L.revolvingRadius+WALK_SHAPE.radius);
    for(const u of L.pierCenters)assert.ok(Math.abs(p.u-u)>L.pierWidth/2+WALK_SHAPE.radius || Math.abs(p.v-L.pierV)>.26+WALK_SHAPE.radius);
  }
  assert.ok(Math.hypot(-2.6,1.05-1)>2.2,'return remains outside reader radius');
  assert.ok(Math.hypot(-2.6,1.05-.45)>2,'return remains outside entrance radius with margin');
});

test('canonical landing, each step and parapet render exactly at the existing ground/collision heights',()=>{
  for(const approach of LIBRARY_APPROACHES){
    const {boxes,tubes}=capture(b=>fillLibraryApproaches(b,[approach]));
    const walking=boxes.slice(0,1+approach.steps);
    assert.equal(walking.length,approach.steps+1);assert.ok(tubes.length>0);
    for(const [,p,size] of walking){
      const q=approach.frame.local({x:p[0],z:p[2]});
      close(size[0],approach.frame.length-2*approach.inset);
      close(p[1]+size[1]/2,libraryStairHeight(approach,q.out));
      close(p[1]+size[1]/2,roadviewGroundHeight(p[0],p[2]));
      close(p[1]-size[1]/2,0);
    }
  }
});

test('low central curtain bays are replaced rather than layered over entry modules',()=>{
  const base=capture(b=>fillPhotoLibraryFront(b,'BASE'));
  for(const [, ...points]of base.quads){
    const ps=points.map(local);
    if(ps.every(p=>Math.abs(p.u)<L.openingHalfWidth))assert.ok(ps.every(p=>p.y>=L.facadeTop));
  }
  const details=capture(b=>fillPhotoLibraryFront(b,'DETAIL'));
  for(const [, ...points]of details.quads){
    const ps=points.map(local);
    if(ps.every(p=>Math.abs(p.u)<L.openingHalfWidth))assert.ok(ps.every(p=>p.y>=L.facadeTop));
  }
});

test('entry drawing never mutates geometry authorities or introduces access, lighting or physics state',()=>{
  const before=JSON.stringify({BUILDINGS,LIBRARY_ROOF_PARTS,LIBRARY_APPROACHES,ROADVIEW_OBSTACLES});
  for(const tier of ['BASE','NEAR','DETAIL'])capture(b=>fillJeongseokEntry(b,tier));
  capture(b=>fillLibraryApproaches(b));
  assert.equal(JSON.stringify({BUILDINGS,LIBRARY_ROOF_PARTS,LIBRARY_APPROACHES,ROADVIEW_OBSTACLES}),before);
  const source=readFileSync(new URL('../src/jeongseok-entry-geometry.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/addComponent|setInterval|setTimeout|onEnter|purchase_|createJeongseok|fetch\(/);
  const renderer=readFileSync(new URL('../src/main-hall-blockout.js',import.meta.url),'utf8');
  assert.equal(renderer.match(/fillJeongseokEntry\(libraryDetails,tier\)/g).length,1);
});
