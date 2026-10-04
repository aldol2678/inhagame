import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {OBSTACLES} from '../src/campus-layout.js';
import {roadviewGroundHeight,STUDENT_TERRACES} from '../src/roadview-layout.js';
import {studentCenterFrontPoint} from '../src/student-center-front.js';
const url=new URL('../src/student-center-runtime.js',import.meta.url);
const runtime=existsSync(url)?await import(url):{};

test('actual campus replaces the student monolith with render-source static prisms',()=>{
 assert.equal(OBSTACLES.some(o=>o.id==='bldg_07_0'),false);
 assert.ok(OBSTACLES.filter(o=>o.id.startsWith('student:')).length>300);
});
test('student grounding uses real source surfaces, never old invisible terrace ramps',()=>{
 const p=STUDENT_TERRACES[0].frame.at(1,1);
 assert.equal(roadviewGroundHeight(p.x,p.z),0);
 assert.deepEqual(studentCenterFrontPoint(),{x:144.31744749160396,z:34.0443831395582});
});
test('production runtime exposes a bounded real-controller step adapter',()=>{
 assert.equal(typeof runtime.studentCampusStep,'function');
 assert.equal(typeof runtime.studentCampusGroundHeight,'function');
});
test('facility rendering routes the connected student exactly once before legacy geometry',()=>{
 const source=readFileSync(new URL('../src/facility-blockout.js',import.meta.url),'utf8');
 assert.match(source,/buildStudentCenterConnected/);
 assert.match(source,/if\s*\(f\.id\s*===\s*['"]bldg_07['"]\)[\s\S]*?continue;/);
});

const {studentConnectedFrame}=await import('../src/student-center-frame.js');
const frame=studentConnectedFrame();
const loop=[[-14,14],[-14,1],[-24,1],[-24,-17],[-17.3,-17],[-17.3,-3],[0,-3],[0,29],[-14,29],[-14,14]];
function controllerAt(local){
 globalThis.window={addEventListener(){}};
 globalThis.document={body:{dataset:{}},getElementById:id=>['profile-panel','view-settings','keyboard-shortcuts-panel'].includes(id)?{hidden:true}:null};
 globalThis.HTMLElement=class{};
 const q=frame.toWorld(local),p={x:q[0],y:q[1]+1.15,z:q[2]};
 return {p,entity:{getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),setLocalEulerAngles(){}}};
}
const {PlayerController}=await import('../src/player-controller.js');
test('default production PlayerController walks the complete entry/Core A/terrace loop both ways',()=>{
 for(const route of [loop,[...loop].reverse()]){
  const {p,entity}=controllerAt([route[0][0],0,route[0][1]]),c=new PlayerController(entity);
  for(let i=1;i<route.length;i++){
   const a=frame.toWorld([route[i-1][0],0,route[i-1][1]]),b=frame.toWorld([route[i][0],0,route[i][1]]);
   const dx=b[0]-a[0],dz=b[2]-a[2],d=Math.hypot(dx,dz),n=Math.ceil(d/.06);
   c.setAssistedMovement({x:dx,z:dz});
   for(let j=1;j<=n;j++){
    c.update(d/n/c.walkSpeed);
    assert.ok(Math.hypot(p.x-(a[0]+dx*j/n),p.z-(a[2]+dz*j/n))<1e-5,JSON.stringify({i,j,p}));
    assert.equal(c.grounded,true,JSON.stringify({i,j,p}));
   }
  }
  assert.ok(Math.abs(p.y-1.15)<1e-8);
 }
});
test('production upper-floor jump lands grounded and combat displacement keeps that support',()=>{
 const {p,entity}=controllerAt([-17.3,4.03,-3]),c=new PlayerController(entity),start={...p};
 c.jumpQueued=true;let maxY=p.y;
 for(let i=0;i<160;i++){c.update(1/120);maxY=Math.max(maxY,p.y);}
 assert.ok(maxY>start.y+.1);
 assert.ok(Math.abs(p.y-start.y)<1e-6);assert.equal(c.grounded,true);
 c.applyCombatGroundDisplacement({x:.05,z:0});
 assert.ok(Math.abs(p.y-start.y)<1e-6);
});
test('resume preserves validated first/second-floor height and rejects phantom upper support',async()=>{
 const {validateResumeRecord}=await import('../src/lobby/world-resume.js');
 const record=local=>{const q=frame.toWorld(local);return{version:2,regionId:'CAMPUS',x:q[0],y:q[1]+1.15,z:q[2],savedAt:1000};};
 for(const local of [[-14,.08,1],[-17.3,4.03,-3],[-24,4.03,-17]]){
  const raw=record(local),v=validateResumeRecord(raw);
  assert.equal(v.state,'VALID',JSON.stringify(local));assert.equal(v.record.y,raw.y);
 }
 assert.equal(validateResumeRecord(record([-30,4.03,-27])).state,'INVALID');
});

test('night panes are attached to the real stepped window bands, never legacy footprint',async()=>{
 const u=new URL('../src/student-center-night-windows.js',import.meta.url),m=existsSync(u)?await import(u):{};
 assert.equal(typeof m.studentNightWindows,'function');
 const panes=m.studentNightWindows();assert.ok(panes.length>12);
 const {V09_PRIMITIVES}=await import('../src/student-center-candidate-data.js');
 for(const pane of panes){
  const p=frame.toLocal([pane.x,pane.y,pane.z]);
  const band=V09_PRIMITIVES.find(p=>p.name===pane.sourceName);assert.ok(band);
  assert.ok(Math.abs(p[0]-band.position[0])+pane.width<=band.size[0]/2+1e-7);
  assert.ok(Math.abs(p[1]-band.position[1])+pane.height<=band.size[1]/2+1e-7);
  assert.ok(Math.abs(p[2]-(band.position[2]+band.size[2]/2+.025))<1e-6);
 }
 const {nightWindowLayout}=await import('../src/environment/night-window-policy.js');
 const layout=nightWindowLayout([{id:'bldg_07',windows:panes}], 'high');
 assert.ok(layout.length>4);assert.ok(layout.every(p=>panes.includes(p)));
});

test('student floors and terrace are walk-only; mounting cannot strand a landing state',()=>{
 for(const local of [[10,4.045,8],[-14,.08,1],[-17.3,4.03,-3]]){
  const {p,entity}=controllerAt(local),c=new PlayerController(entity);
  assert.equal(c.getMountContextAction(),null);
  c.toggleMount();for(let i=0;i<30;i++)c.update(1/60);
  assert.equal(c.mounted,false);assert.equal(c.grounded,true);assert.equal(c.landing,false);
 }
 const {entity}=controllerAt([-37,0,14]),c=new PlayerController(entity);
 assert.ok(c.getMountContextAction(),'ordinary campus mounting remains available');
});

test('thin student partitions cannot pull an unobstructed outside orbit camera into the actor',async()=>{
 const {cameraSafeFraction}=await import('../src/world-collision.js');
 const {STUDENT_WORLD_COLLIDERS}=await import('../src/student-center-connected-data.js');
 const from=[137.36213492287067,.8,17.04007781485592],to=[143.05754743136532,2.6873993636967066,17.04007781485592];
 assert.equal(cameraSafeFraction(from,to,STUDENT_WORLD_COLLIDERS),1);
});

test('new solid envelope clears fixed campus obstacles and retains the C-building gap',async()=>{
 const {STUDENT_WORLD_COLLIDERS}=await import('../src/student-center-connected-data.js');
 const {polygonOverlap}=await import('../src/polygon-collision.js');
 const fixed=OBSTACLES.filter(p=>!p.id.startsWith('student:'));
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-12&&cross(c,d,a)*cross(c,d,b)<-1e-12;
 const overlap=(a,b)=>a.some(p=>polygonOverlap(p.x,p.z,b,0))||b.some(p=>polygonOverlap(p.x,p.z,a,0))||a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
 for(const p of STUDENT_WORLD_COLLIDERS)for(const q of fixed){
  if(p.minY>=q.maxY||p.maxY<=q.minY||!q.polygon)continue;
  assert.equal(overlap(p.polygon,q.polygon),false,`${p.id} / ${q.id}`);
 }
 const restoredUpperIds=['bldg_05_clock_core','bldg_60th_tower'];
 const restored=fixed.filter(p=>restoredUpperIds.includes(p.id));
 assert.deepEqual(restored.map(p=>p.id).sort(),restoredUpperIds);
 assert.ok(restored.every(p=>p.minY>=12),'restored skyline has no ground footprint delta');
 assert.equal(fixed.length-restored.length,854,'all pre-restoration non-student physical obstacles retained');
 const c=fixed.find(p=>p.id==='bldg_c_0');assert.ok(c);
 const distance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
 let gap=Infinity;
 for(const p of STUDENT_WORLD_COLLIDERS)for(const v of p.polygon)for(let i=0;i<c.polygon.length;i++)gap=Math.min(gap,distance(v,c.polygon[i],c.polygon[(i+1)%c.polygon.length]));
 assert.ok(gap>.73&&gap<.75,`C building gap in WU ${gap}`);
});

test('existing navigation polylines and shop approach retain full-body student clearance',async()=>{
 const {campusNavPolylines}=await import('../src/navigation/campus-navigation.js');
 const {canOccupy}=await import('../src/world-collision.js');
 const {STUDENT_WORLD_COLLIDERS}=await import('../src/student-center-connected-data.js');
 let probes=0;
 for(const line of campusNavPolylines())for(let i=1;i<line.points.length;i++){
  const a=line.points[i-1],b=line.points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.1));
  for(let j=0;j<=n;j++){
   const x=a.x+(b.x-a.x)*j/n,z=a.z+(b.z-a.z)*j/n;
   assert.ok(canOccupy({x,z,y:1.15},undefined,STUDENT_WORLD_COLLIDERS),line.id);probes++;
  }
 }
 const p=studentCenterFrontPoint();assert.ok(canOccupy({...p,y:1.15}));assert.ok(probes>10000);
});

test('static camera and flight collision retain real student walls, ceiling and roof',async()=>{
 const {cameraSafeFraction,canOccupy,resolveHeight}=await import('../src/world-collision.js');
 const {STUDENT_WORLD_COLLIDERS}=await import('../src/student-center-connected-data.js');
 const world=p=>frame.toWorld(p),pose=p=>{const q=world(p);return{x:q[0],y:q[1]+1.15,z:q[2]};};
 const a=world([-14,1.6,8]),b=world([-14,8,8]);
 assert.ok(cameraSafeFraction(a,b,STUDENT_WORLD_COLLIDERS)<1);
 const under=pose([-14,.08,8]);assert.ok(resolveHeight(under,under.y+4,under.y)<under.y+1.5);
 assert.equal(canOccupy(pose([26,5,-10])),false,'Core B is solid to normal/flight occupancy');
 const above=pose([7,30,-19.5]),landed=resolveHeight(above,1.15,1.15);
 assert.ok(landed>=22.55/2+1.15,'flying actor cannot descend through roof');
});

test('walk inspection reports support and head heights in its requested coordinate units',async()=>{
 const {createStudentConnectedWalk}=await import('../src/student-center-connected.js');
 const q=frame.toWorld([-24,4.03,-17]);
 const local=createStudentConnectedWalk().inspect(-24,-17,4.03);
 const world=createStudentConnectedWalk({space:'world'}).inspect(q[0],q[2],q[1]);
 assert.equal(world.supportHeight,local.supportHeight/2);assert.equal(world.headHeight,local.headHeight/2);
});

test('compressed student stair orbit hides only the local avatar without changing perspective or zoom',async()=>{
 const {OrbitCameraController}=await import('../src/orbit-camera-controller.js');
 controllerAt([-24,2.5,-7.940397350991514]);
 const camera={camera:{nearClip:.3},setPosition(...p){this.position=p;},lookAt(){}};
 const orbit=new OrbitCameraController(camera,{addEventListener(){}}),q=frame.toWorld([-24,2.5,-7.940397350991514]);
 orbit.yaw=-2.080148822704922;orbit.pitch=.18;orbit.distance=2.2;
 orbit.apply({x:q[0],y:q[1]+1.15,z:q[2]},-.35);
 assert.equal(orbit.localVisualOccluded,true,'actual close Core A wall must not leave the camera inside the local body');
 assert.equal(orbit.firstPerson,false);assert.equal(orbit.distance,2.2);assert.equal(camera.camera.nearClip,.3);
 const clear=frame.toWorld([0,0,29]);orbit.yaw=Math.PI/2;orbit.pitch=.32;orbit.distance=6;
 orbit.apply({x:clear[0],y:1.15,z:clear[2]},-.35);assert.equal(orbit.localVisualOccluded,false,'open outdoor orbit restores avatar');
});

test('real compressed portrait landing keeps the route visible without changing wide or uncompressed views',async()=>{
 const {OrbitCameraController}=await import('../src/orbit-camera-controller.js');
 controllerAt([-24,4.03,-17]);
 const camera={camera:{nearClip:.3,fov:62,aspectRatio:390/844,horizontalFov:false},setPosition(...p){this.position=p;},lookAt(){}};
 const orbit=new OrbitCameraController(camera,{addEventListener(){}}),q=frame.toWorld([-24,4.03,-17]),p={x:q[0],y:q[1]+1.15,z:q[2]};
 orbit.yaw=1.061443830884926;orbit.pitch=.18;orbit.distance=2.2;
 orbit.apply(p,-.35);
 assert.equal(orbit.localVisualOccluded,true,'a real wall compresses the portrait avatar across the descending stair view');
 const position=[...camera.position];camera.camera.aspectRatio=1280/720;orbit.apply(p,-.35);
 assert.equal(orbit.localVisualOccluded,false,'wide landing view keeps its existing visible avatar');
 assert.deepEqual(camera.position,position,'visibility policy does not alter the physical camera');
 assert.equal(camera.camera.fov,62);assert.equal(camera.camera.nearClip,.3);assert.equal(orbit.distance,2.2);assert.equal(orbit.firstPerson,false);
 camera.camera.aspectRatio=390/844;const clear=frame.toWorld([0,0,29]);orbit.yaw=Math.PI/2;orbit.pitch=.32;orbit.distance=1.5;
 orbit.apply({x:clear[0],y:1.15,z:clear[2]},-.35);assert.equal(orbit.localVisualOccluded,false,'uncompressed intentional close zoom stays visible');
});
