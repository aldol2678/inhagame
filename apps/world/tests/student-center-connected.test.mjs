import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {V09_PRIMITIVES} from '../src/student-center-candidate-data.js';
import {studentCandidateFrame} from '../src/student-center-candidate.js';
const url=new URL('../src/student-center-connected.js',import.meta.url),m=existsSync(url)?await import(url):{};
const state=(x,z,elevation=0)=>({x,z,elevation});
const loop=[[-14,14],[-14,1],[-24,1],[-24,-17],[-17.3,-17],[-17.3,-3],[0,-3],[0,29],[-14,29],[-14,14]];
function walk(route,space='local'){
 assert.equal(typeof m.createStudentConnectedWalk,'function');const w=m.createStudentConnectedWalk({space}),f=m.studentConnectedFrame();
 const point=([x,z])=>space==='local'?[x,z]:((q)=>[q[0],q[2]])(f.toWorld([x,0,z]));
 let [x,z]=point(route[0]),s=state(x,z),n=0;
 for(let i=1;i<route.length;i++){const a=point(route[i-1]),b=point(route[i]),steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(space==='local'?.04:.02));for(let j=1;j<=steps;j++){const target=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps];s=w.step(s,...target);assert.equal(s.blocked,false,JSON.stringify({i,j,target,s}));n++;}}
 return {s,n,w};
}
test('connected adapter uses approved translation without rotation, rescale or source mutation',()=>{
 assert.equal(typeof m.studentConnectedFrame,'function');const before=JSON.stringify(V09_PRIMITIVES),f=m.studentConnectedFrame(),base=studentCandidateFrame();
 for(const p of [[0,0,0],[-24,4,-17],[0,0,27]]){const a=base.toWorld(p),b=f.toWorld(p);assert.ok(Math.abs(b[0]-a[0]-2.2)<1e-10);assert.ok(Math.abs(b[2]-a[2]+7.15)<1e-10);assert.equal(b[1],a[1]);assert.ok(f.toLocal(b).every((v,i)=>Math.abs(v-p[i])<1e-9));}
 assert.equal(m.STUDENT_CONNECTED.status,'ISOLATED_CONNECTED_CANDIDATE');assert.equal(JSON.stringify(V09_PRIMITIVES),before);
});
test('entry/Core A/food hall/terrace/outside-stair loop has supported radius and head clearance both directions',()=>{
 for(const route of [loop,[...loop].reverse()]){const {s,n}=walk(route);assert.equal(s.elevation,0);assert.ok(n>2000);}
});
test('same movement loop works in collision world coordinates without render reflection',()=>{const {s}=walk(loop,'world');assert.equal(s.elevation,0);});
test('rejects phantom upper floor, walking off treads and high-speed tunnelling',()=>{
 assert.equal(typeof m.createStudentConnectedWalk,'function');const w=m.createStudentConnectedWalk();
 assert.equal(w.inspect(-30,-27,4.03).supported,false);
 assert.equal(w.inspect(7.5,16,2.95).supported,false);
 const down=w.step(state(-24,-17,4.03),-24,-4);assert.ok(down.blocked||down.elevation<2,'aperture never grants a phantom upper floor over the flight');
 assert.equal(w.step(state(-19.95,-10,4.03),-24,-10).blocked,true,'cannot cross the guard sideways');
 assert.equal(w.step(state(-14,14),-3.2,-4).blocked,true,'cannot tunnel through wall/furniture');
});
test('actual glass doors, slab holes, new rear core doorway and seam bridge are in the geometry itself',()=>{
 assert.ok(Array.isArray(m.STUDENT_CONNECTED?.prisms));const p=m.STUDENT_CONNECTED.prisms;
 const hit=(x,y,z,name)=>p.filter(p=>!name||p.sourceName===name).some(p=>y>p.minY+1e-6&&y<p.maxY-1e-6&&inside(x,z,p.polygon));
 assert.equal(hit(-14,1.8,11.25),false);assert.equal(hit(0,5.2,.35),false);
 assert.equal(hit(-24,3.94,-10,'CoreAFloor'),false);assert.equal(hit(-19.5,5.2,-17),false);
 assert.equal(hit(0,4,.75),true,'solid bridge over source half-meter seam');
 assert.equal(hit(0,3.8,12.8,'SC2_TERRACE'),false);
});
function inside(x,z,p){let v=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)v=!v;}return v;}

test('physical panes, walls, guards and undersides block body radius/head while openings pass',()=>{
 const w=m.createStudentConnectedWalk();
 for(const [x,z,h] of [[-16,11.25,.08],[2,.35,4.03],[-19.5,-14.7,4.03],[-20.75,-9,4.03],[0,8,3],[-24,-7,4.03]])assert.equal(w.inspect(x,z,h).clear,false,JSON.stringify([x,z,h]));
 for(const [x,z,h] of [[-14,11.25,.08],[0,.75,4.045],[-19.5,-17,4.03],[-24,-17,4.03]])assert.equal(w.inspect(x,z,h).clear,true,JSON.stringify([x,z,h]));
 assert.equal(w.step(state(-14,14),-13.25,10.8).blocked,true,'center fits, radius clips pane');
});

test('grounded runtime movement-space contract follows the same loop with real collision functions',async()=>{
 const {moveAroundObstacles,resolveHeight}=await import('../src/world-collision.js');const {WALK_SHAPE}=await import('../src/player-dimensions.js');
 const space=m.createStudentConnectedMovementSpace(),f=m.studentConnectedFrame();let q=f.toWorld([loop[0][0],0,loop[0][1]]),p={x:q[0],y:WALK_SHAPE.footOffset,z:q[2]},count=0;
 for(let i=1;i<loop.length;i++){const a=f.toWorld([loop[i-1][0],0,loop[i-1][1]]),b=f.toWorld([loop[i][0],0,loop[i][1]]),n=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/.02);for(let j=1;j<=n;j++){
  const x=a[0]+(b[0]-a[0])*j/n,z=a[2]+(b[2]-a[2])*j/n,obstacles=space.obstacles,next=space.constrain(p,moveAroundObstacles(p,x-p.x,z-p.z,obstacles));
  assert.ok(Math.hypot(next.x-x,next.z-z)<1e-5,JSON.stringify({i,j,next,x,z}));
  const ground=WALK_SHAPE.footOffset+space.groundHeight(next.x,next.z),y=resolveHeight({...p,x:next.x,z:next.z},ground,ground,obstacles);p={...next,y};assert.ok(Math.abs(y-ground)<1e-8);count++;
 }}assert.ok(count>2000);assert.equal(p.y,WALK_SHAPE.footOffset);
});

test('approved land approaches reach the fixed shop and real 1F entry with actor clearance',async()=>{
 const {SITE_FEATURES}=await import('../src/basic-campus.js');const {roadFrame}=await import('../src/campus-road-layout.js');const {studentCenterFrontPoint}=await import('../src/student-center-front.js');
 const path=SITE_FEATURES.find(p=>p.id==='site_481241696'),f=roadFrame(path.vertices.at(-2),path.vertices.at(-1)),start=f.at(f.length-2,2.2),shop=studentCenterFrontPoint(),frame=m.studentConnectedFrame();
 const local=p=>{const q=frame.toLocal([p.x,0,p.z]);return[q[0],q[2]];},s=local(start),p=local(shop);
 for(const route of [[s,[-37,14],[-14,14],[-14,1],[-14,14],[-37,14],s],[s,[-37,14],[-14,14],[-14,29],[p[0],29],p]]){const {s:end}=walk(route);assert.equal(end.elevation,0);}
 assert.equal(shop.x,144.31744749160396);assert.equal(shop.z,34.0443831395582);
});

test('combined public floor stays inside the preserved outer wing envelope',()=>{
 const p=m.STUDENT_CONNECTED.prisms.filter(p=>p.sourceName==='SC1FloorPublic');assert.ok(p.length);for(const q of p)for(const v of q.polygon){assert.ok(v.x<=28.8+1e-9);assert.ok(v.z>=-22.5-1e-9);assert.ok(v.z<=4.5+1e-9);}
});

test('photo panes retain outward geometry without re-sealing the carved Core A void',async()=>{
 const {clipPhotoOpening}=await import('../src/student-center-connected-geometry.js');
 const faces=clipPhotoOpening([[-26,1,-8],[-25.8,1,-8.2],[-25.8,15,-8.2],[-26,15,-8]]);assert.ok(faces.length);assert.ok(faces.flat().every(p=>p[1]>=7));
 const red=[[27,4,-3],[28,4,-3],[28,5,-3],[27,5,-3]];assert.deepEqual(clipPhotoOpening(red),[red]);
});

test('airborne feet never become cached ground and real ceilings limit jumps',async()=>{
 const {WALK_SHAPE}=await import('../src/player-dimensions.js');const {resolveHeight}=await import('../src/world-collision.js');
 const f=m.studentConnectedFrame(),q=f.toWorld([-14,0,14]),space=m.createStudentConnectedMovementSpace(),p={x:q[0],z:q[2],y:WALK_SHAPE.footOffset+.2};
 assert.equal(space.groundHeight(p.x,p.z),0);const n=space.constrain(p,{x:p.x+.02,z:p.z});assert.equal(space.groundHeight(n.x,n.z),0);
 const under=f.toWorld([-14,.08,8]),a={x:under[0],z:under[2],y:under[1]+WALK_SHAPE.footOffset};
 const ceiling=resolveHeight(a,a.y+3,a.y,space.obstacles);assert.ok(ceiling<a.y+1.5);assert.ok(ceiling+WALK_SHAPE.headOffset<=3.595/2+.001);
});

test('explicit upper spawn is validated against real support, while floating spawn is rejected',()=>{
 const f=m.studentConnectedFrame(),q=f.toWorld([-24,4.03,-17]),initialState={x:q[0],z:q[2],elevation:q[1]};
 const space=m.createStudentConnectedMovementSpace({initialState});assert.equal(space.groundHeight(q[0],q[2]),2.015);
 const n=space.constrain({x:q[0],z:q[2],y:q[1]+1.15},{x:q[0],z:q[2]});assert.equal(space.groundHeight(n.x,n.z),2.015);
 assert.throws(()=>m.createStudentConnectedMovementSpace({initialState:{...initialState,elevation:2.5}}),/support/);
});
