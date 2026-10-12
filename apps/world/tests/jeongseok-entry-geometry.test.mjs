import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LIBRARY_FRONT,BUILDINGS,LIBRARY_ROOF_PARTS} from '../src/basic-campus.js';
import {LIBRARY_APPROACHES,ROADVIEW_OBSTACLES,libraryStairHeight,roadviewGroundHeight} from '../src/roadview-layout.js';
import {fillLibraryApproaches,fillJeongseokEntry,JEONGSEOK_ENTRY_LAYOUT as L,JEONGSEOK_ENTRY_EVIDENCE as E,JEONGSEOK_ENTRY_COLORS as C} from '../src/jeongseok-entry-geometry.js';
import {fillPhotoLibraryFront} from '../src/photo-hall-library-geometry.js';
import {canOccupy} from '../src/world-collision.js';
import {WALK_SHAPE,PLAYER_ORIGIN_Y,HUMAN_HEIGHT} from '../src/player-dimensions.js';

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
  const sign=capture(b=>fillJeongseokEntry(b,'DETAIL')).boxes.filter(([color])=>color===C.tactile);
  assert.equal(sign.length,1,'one plain sign band, not dot-pattern pseudo lettering');
  assert.equal(sign[0][2][0],2.80);
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
      assert.ok(Math.abs(q.u)<1.5&&q.v>.17&&q.v<1.21&&q.y>=L.floor&&q.y<3.0);
    }
  }
});

test('existing reader, door and safe return retain full walking-capsule clearance',()=>{
  const fixed=[{u:0,v:1},{u:0,v:.45},{u:-2.6,v:1.05}];
  for(const p of fixed){
    const q=LIBRARY_FRONT.at(p.u,p.v);close(roadviewGroundHeight(q.x,q.z),L.floor);
    assert.ok(canOccupy({...q,y:PLAYER_ORIGIN_Y+L.floor}));
    for(const u of L.revolvingCenters)assert.ok(Math.hypot(p.u-u,p.v-L.revolvingV)>L.revolvingRadius+WALK_SHAPE.radius);
    for(const u of L.pierCenters)assert.ok(Math.abs(p.u-u)>L.pierWidth/2+WALK_SHAPE.radius || Math.abs(p.v-L.pierV)>.26+WALK_SHAPE.radius);
    for(const tier of ['BASE','NEAR','DETAIL'])for(const [,center,size,yaw]of capture(b=>fillJeongseokEntry(b,tier)).boxes){
      if(center[1]-size[1]/2>=L.floor+HUMAN_HEIGHT||center[1]+size[1]/2<=L.floor+.04)continue;
      const angle=yaw*Math.PI/180,dx=q.x-center[0],dz=q.z-center[2];
      const x=dx*Math.cos(angle)-dz*Math.sin(angle),z=dx*Math.sin(angle)+dz*Math.cos(angle);
      const gap=Math.hypot(Math.max(0,Math.abs(x)-size[0]/2),Math.max(0,Math.abs(z)-size[2]/2));
      assert.ok(gap>WALK_SHAPE.radius,`${tier} box intersects anchor capsule ${JSON.stringify({p,gap,center,size})}`);
    }
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

test('complete curtain-wall quad streams remain exact to pre-exterior main, including upper triangles',()=>{
  // SHA256 of the pure quad streams from immutable tree 96155632b0301631744bae69b9dd6f02e9d990b5.
  const expected={BASE:'3508c45e261a3bc6111fc297afc150f4996f21cb0150f0dfaf43eab02e156215',DETAIL:'2ba0df24b4946499ee7e0e58b58c6abac5e3243ded9aed310a3dae4c545d911c'};
  for(const tier of ['BASE','DETAIL'])assert.equal(createHash('sha256').update(JSON.stringify(capture(b=>fillPhotoLibraryFront(b,tier)).quads)).digest('hex'),expected[tier]);
});

test('closed entrance glazing has independent depth, seated doors and no coincident old facade',()=>{
  const oldFront=Math.max(...['BASE','DETAIL'].flatMap(tier=>capture(b=>fillPhotoLibraryFront(b,tier)).quads.flatMap(([, ...points])=>points.map(p=>local(p).v))));
  assert.ok(L.facadeV-L.facadeDepth/2-oldFront>.08,'positive depth gap from untouched curtain wall');
  assert.ok(L.ordinaryV-.025-(L.facadeV+L.facadeDepth/2)>.025,'ordinary doors have a distinct front depth');
  const boxes=capture(b=>fillJeongseokEntry(b,'BASE')).boxes;
  for(const u of L.ordinaryCenters){
    const door=boxes.find(([c,p,size])=>c===C.lightGlass&&Math.abs(local(p).u-u)<1e-8&&size[0]===L.ordinaryWidth);
    close(door[1][1]-door[2][1]/2,L.floor);
  }
  for(const u of L.pierCenters){
    const pier=boxes.find(([c,p,size])=>c===C.stone&&Math.abs(local(p).u-u)<1e-8&&size[0]===L.pierWidth);
    close(pier[1][1]-pier[2][1]/2,L.floor);
    const support=boxes.find(([c,p,size])=>c===C.stone&&Math.abs(local(p).u-u)<1e-8&&size[0]===.20);
    const canopy=LIBRARY_ROOF_PARTS.find(part=>part.id==='library_entry_canopy');
    close(support[1][1]-support[2][1]/2,pier[1][1]+pier[2][1]/2);
    close(support[1][1]+support[2][1]/2,canopy.y-canopy.height/2);
    const oldAtPier=['BASE','DETAIL'].flatMap(tier=>capture(b=>fillPhotoLibraryFront(b,tier)).quads).filter(([, ...points])=>{const us=points.map(p=>local(p).u);return Math.min(...us)<=u+.1&&Math.max(...us)>=u-.1;}).flatMap(([, ...points])=>points.map(p=>local(p).v));
    assert.ok(L.pierV-.1-Math.max(...oldAtPier)>.04,'narrow support stays visibly ahead of old glass');
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
