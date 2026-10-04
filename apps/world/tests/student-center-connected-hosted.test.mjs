import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createStudentConnectedWalk,studentConnectedFrame,STUDENT_CONNECTED} from '../src/student-center-connected.js';
import {studentCandidateFrame} from '../src/student-center-candidate.js';
const file=new URL('./browser/student-center-connected-hosted-harness.html',import.meta.url);
const fixture=()=>{assert.ok(existsSync(file),'hosted fixture must exist');return readFileSync(file,'utf8');};
const plan=()=>JSON.parse(fixture().match(/<script id="qa-plan" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('hosted fixture renders reviewed geometry with only the negative-Z parent reflection',()=>{
 const text=fixture();assert.match(text,/buildStudentCenterConnected/);assert.match(text,/setLocalScale\(1, 1, -1\)/);
 assert.match(text,/playcanvas@2\.22\.4/);assert.match(text,/event\.isTrusted/);assert.match(text,/gl\.readPixels/);
 assert.doesNotMatch(text,/NullGraphicsDevice|window\.__STUDENT_CONNECTED_QA__\.verify|fetch\(/);
 const p=plan();assert.deepEqual(p.actor,{radiusMeters:.48,diameterMeters:.96,heightMeters:1.75});
 assert.deepEqual(STUDENT_CONNECTED.offsetWorld,[2.2,-7.15]);assert.equal(STUDENT_CONNECTED.rotationDelta,0);
 const f=studentConnectedFrame(),base=studentCandidateFrame();for(const point of [[0,0,0],[-24,4,-17],[0,0,27]]){
  const a=f.toWorld(point),b=base.toWorld(point);assert.ok(Math.abs(a[0]-b[0]-2.2)<1e-9);assert.ok(Math.abs(a[2]-b[2]+7.15)<1e-9);
 }
});

test('keyboard plan consists only of axis-aligned exact ticks through every requested checkpoint',()=>{
 const p=plan();assert.equal(p.tickMeters,.1);assert.deepEqual(p.route[0].at,p.route.at(-1).at);
 for(const id of ['entry','core-stair','rear-door','foodhall','terrace','exterior-stair'])assert.ok(p.route.some(q=>q.view===id),id);
 for(const space of ['local','world'])for(const reverse of [false,true]){
  const points=reverse?[...p.route].reverse():p.route,f=studentConnectedFrame(),w=createStudentConnectedWalk({space});
  const toState=(x,z)=>{const q=f.toWorld([x,0,z]);return space==='local'?{x,z,elevation:0}:{x:q[0],z:q[2],elevation:q[1]};};
  let state=toState(...points[0].at),ticks=0,maxElevation=0;
  for(let i=1;i<points.length;i++){
   const [ax,az]=points[i-1].at,[bx,bz]=points[i].at,dx=bx-ax,dz=bz-az;
   assert.equal(Number(dx!==0)+Number(dz!==0),1);const n=Math.hypot(dx,dz)/p.tickMeters;assert.ok(Math.abs(n-Math.round(n))<1e-8);
   for(let j=0;j<Math.round(n);j++){
    const local=space==='local'?[state.x,state.elevation,state.z]:f.toLocal([state.x,state.elevation,state.z]);
    const next=[local[0]+Math.sign(dx)*p.tickMeters,local[1],local[2]+Math.sign(dz)*p.tickMeters];
    const target=space==='local'?next:f.toWorld(next);state=w.step(state,target[0],target[2]);
    assert.equal(state.blocked,false,JSON.stringify({space,reverse,i,j,state}));const inspected=w.inspect(state.x,state.z,state.elevation);
    assert.ok(inspected.supported&&inspected.clear);maxElevation=Math.max(maxElevation,state.elevation*(space==='world'?2:1));ticks++;
   }
   const local=space==='local'?[state.x,state.elevation,state.z]:f.toLocal([state.x,state.elevation,state.z]);assert.ok(Math.hypot(local[0]-bx,local[2]-bz)<1e-7);
  }
  assert.ok(ticks>1000);assert.ok(maxElevation>=4.03);assert.ok(Math.abs(state.elevation)<1e-8);
 }
});

test('hosted workflow is read-only and runs the isolated network-blocked browser harness',()=>{
 const workflow=new URL('../../../.github/workflows/student-center-connected-browser.yml',import.meta.url);
 assert.ok(existsSync(workflow),'hosted workflow must exist');const text=readFileSync(workflow,'utf8');
 assert.match(text,/contents: read/);assert.doesNotMatch(text,/pull_request_target|secrets\.|id-token: write|contents: write/);
 assert.match(text,/student-center-connected-hosted-smoke\.mjs/);assert.match(text,/if: always\(\)/);
 const smoke=readFileSync(new URL('./browser/student-center-connected-hosted-smoke.mjs',import.meta.url),'utf8');
 assert.match(smoke,/startSmoke/);assert.match(smoke,/page\.keyboard\.down/);assert.match(smoke,/page\.keyboard\.up/);
 assert.match(smoke,/setViewportSize/);assert.match(smoke,/pixelEvidence/);assert.match(smoke,/programmaticContracts/);
});
