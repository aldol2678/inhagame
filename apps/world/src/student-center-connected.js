// Reviewed connected walk and standalone comparison adapter. Campus uses student-center-runtime.js.
import {studentConnectedFrame} from './student-center-frame.js';
export {studentConnectedFrame} from './student-center-frame.js';
import {STUDENT_CONNECTED,supports,solids,support,footprint,covered} from './student-center-connected-data.js';
export {STUDENT_CONNECTED} from './student-center-connected-data.js';
import {canOccupy,moveAroundObstacles} from './world-collision.js';
import {WALK_SHAPE} from './player-dimensions.js';
import {OBSTACLES} from './campus-layout.js';
import {POND_RING} from './roadview-layout.js';
const EPS=1e-7,R=WALK_SHAPE.radius*2,H=(WALK_SHAPE.footOffset+WALK_SHAPE.headOffset)*2,RISE=.30,FOOTPRINT_DROP=.55;
const bounds=p=>({x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x)),z0:Math.min(...p.map(q=>q.z)),z1:Math.max(...p.map(q=>q.z))});
const localShape=STUDENT_CONNECTED.shape;
const ground={x0:-60,x1:45,z0:-35,z1:45,height:0,id:'existing-flat-campus-ground'};
const frame=studentConnectedFrame();
const fixed=OBSTACLES.filter(p=>p.id!=='bldg_07_0'&&!p.id.startsWith('student:')).map(p=>({...p,minY:p.minY*2,maxY:p.maxY*2,polygon:p.polygon?.map(q=>{const a=frame.toLocal([q.x,0,q.z]);return{x:a[0],z:a[2]}})}));
const pond=POND_RING.map(p=>{const a=frame.toLocal([p.x,0,p.z]);return{x:a[0],z:a[2]}});
const collision=[...solids.filter(p=>! /^(Wayfinding_|QA|CoreGuide_)/.test(p.sourceName)),...fixed.filter(p=>{const b=bounds(p.polygon);return b.x1>=-61&&b.x0<=46&&b.z1>=-36&&b.z0<=46;}),{id:'fixed-pond',polygon:pond,minY:-100,maxY:100}];
const pose=(x,z,h)=>({x,z,y:h+localShape.footOffset});
function clear(x,z,h){return canOccupy(pose(x,z,h),localShape,collision);}
export function createStudentConnectedWalk({space='local'}={}){
 if(!['local','world'].includes(space))throw Error('Unsupported connected coordinate space');
 const toLocal=(x,z,h)=>space==='local'?[x,z,h]:(q=>[q[0],q[2],q[1]])(frame.toLocal([x,h,z]));
 const result=(x,z,h,blocked,reason)=>{const q=space==='local'?[x,h,z]:frame.toWorld([x,h,z]);return{x:q[0],z:q[2],elevation:q[1],blocked,reason};};
 return {
  inspect(x,z,elevation){const[a,b,h]=toLocal(x,z,elevation);const s=support(footprint(a,b),h);return{supported:!!s&&Math.abs(s.height-h)<EPS,clear:clear(a,b,h),supportHeight:s?(space==='world'?s.height/2:s.height):undefined,headHeight:(h+H)/(space==='world'?2:1)};},
  step(previous,x,z){if(![previous.x,previous.z,previous.elevation,x,z].every(Number.isFinite))throw Error('Invalid connected walk state');let[a,b,h]=toLocal(previous.x,previous.z,previous.elevation);const[tx,tz]=toLocal(x,z,previous.elevation);if(!clear(a,b,h))return result(a,b,h,true,'invalid-start');const n=Math.max(1,Math.ceil(Math.hypot(tx-a,tz-b)/.04)),dx=(tx-a)/n,dz=(tz-b)/n;
   for(let i=0;i<n;i++){const nx=a+dx,nz=b+dz,s=support(footprint(nx,nz),h);if(!s)return result(a,b,h,true,'unsupported-footprint');const swept={x0:Math.min(a,nx)-R,x1:Math.max(a,nx)+R,z0:Math.min(b,nz)-R,z1:Math.max(b,nz)+R};const candidates=[...supports,ground].filter(r=>r.height<=Math.max(h,s.height)+EPS&&r.height>=Math.min(h,s.height)-FOOTPRINT_DROP-EPS);if(!covered(swept,candidates))return result(a,b,h,true,'unsupported-sweep');
    if(!clear(nx,nz,s.height))return result(a,b,h,true,'body-clearance');
    const from=pose(a,b,Math.max(h,s.height)),sweep=moveAroundObstacles(from,dx,dz,collision.filter(p=>!p.support||p.maxY>Math.max(h,s.height)+EPS),localShape);
    if(Math.hypot(sweep.x-nx,sweep.z-nz)>1e-5)return result(a,b,h,true,'swept-collision');a=nx;b=nz;h=s.height;
   }return result(a,b,h,false,null);
  }
 };
}
// Existing PlayerController movement-space interface. Kept opt-in and per-player;
// no mutation of campus obstacles, global groundHeight, anchors or navigation.
export function createStudentConnectedMovementSpace({initialState=null}={}){
 const walk=createStudentConnectedWalk({space:'world'});let last=initialState?{...initialState}:null,prior=null;
 if(last){const check=walk.inspect(last.x,last.z,last.elevation);if(!check.supported||!check.clear)throw Error('Initial state requires actual support and body clearance');}
 const worldCollision=collision.map(p=>({...p,minY:p.minY/2,maxY:p.maxY/2,polygon:p.polygon.map(q=>{const a=frame.toWorld([q.x,0,q.z]);return{x:a[0],z:a[2]}})}));
 return {id:'student-connected-preview',allowMount:false,bounds:{minX:90,maxX:190,minZ:-30,maxZ:70},
  get obstacles(){const h=last?.elevation||0;return worldCollision.filter(p=>!p.support||p.maxY>h+RISE/2+EPS);},
  constrain(position,next){const start=frame.toLocal([position.x,0,position.z]);const h=last?.elevation??((support(footprint(start[0],start[2]),0)?.height||0)/2);prior={x:position.x,z:position.z,elevation:h};last=walk.step(prior,next.x,next.z);return{x:last.x,z:last.z};},
  groundHeight(x,z){for(const p of [last,prior])if(p&&Math.hypot(x-p.x,z-p.z)<1e-6)return p.elevation;const q=frame.toLocal([x,0,z]);const s=support(footprint(q[0],q[2]),(last?.elevation||0)*2);return s?s.height/2:0;}
 };
}
