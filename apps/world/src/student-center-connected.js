// Isolated connected preview. Raw v09 data, canonical campus and global nav stay immutable.
import {V09_PRIMITIVES} from './student-center-candidate-data.js';
import {studentCandidateFrame} from './student-center-candidate.js';
import {canOccupy,moveAroundObstacles} from './world-collision.js';
import {WALK_SHAPE} from './player-dimensions.js';
import {OBSTACLES} from './campus-layout.js';
import {POND_RING} from './roadview-layout.js';
import {polygonOverlap} from './polygon-collision.js';
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const EPS=1e-7,R=WALK_SHAPE.radius*2,H=(WALK_SHAPE.footOffset+WALK_SHAPE.headOffset)*2,RISE=.30,FOOTPRINT_DROP=.55;
const rect=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const bounds=p=>({x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x)),z0:Math.min(...p.map(q=>q.z)),z1:Math.max(...p.map(q=>q.z))});
export function studentConnectedFrame(){const f=studentCandidateFrame();return {...f,toWorld:p=>{const q=f.toWorld(p);return[q[0]+2.2,q[1],q[2]-7.15]},toLocal:p=>f.toLocal([p[0]-2.2,p[1],p[2]+7.15])};}
function clip(poly,axis,value,sign){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-value)*sign,db=(b[axis]-value)*sign;if(da>=-EPS)out.push(a);if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}return out.filter((v,i)=>i===0||Math.hypot(v.x-out[i-1].x,v.z-out[i-1].z)>EPS);}
const area=p=>Math.abs(p.reduce((s,v,i)=>{const q=p[(i+1)%p.length];return s+v.x*q.z-q.x*v.z},0))/2;
// Subtract only the documented rectangular room/door/aperture volumes. Convex
// pieces remain shared by render and polygon collision, including rounded shells.
function cut(p,c){const [x0,y0,z0,x1,y1,z1]=c,b=bounds(p.polygon);if(p.maxY<=y0+EPS||p.minY>=y1-EPS||b.x1<=x0+EPS||b.x0>=x1-EPS||b.z1<=z0+EPS||b.z0>=z1-EPS)return[p];const out=[];
 if(p.minY<y0)out.push({...p,maxY:y0});if(p.maxY>y1)out.push({...p,minY:y1});
 const part={...p,minY:Math.max(p.minY,y0),maxY:Math.min(p.maxY,y1)};let inside=p.polygon;
 for(const [axis,v,s] of [['x',x0,1],['x',x1,-1],['z',z0,1],['z',z1,-1]]){const outside=clip(inside,axis,v,-s);if(outside.length>=3&&area(outside)>EPS)out.push({...part,polygon:outside});inside=clip(inside,axis,v,s);if(inside.length<3)break;}
 return out;
}
const cuts=(parts,list)=>list.reduce((a,c)=>a.flatMap(p=>cut(p,c)),parts);
function prism(p,i){const [x,y,z]=p.position;return {id:`${p.section}:${i}:${p.name}`,sourceName:p.name,section:p.section,material:p.material,minY:y-(p.size?.[1]||p.height)/2,maxY:y+(p.size?.[1]||p.height)/2,polygon:p.shape==='box'?rect(x-p.size[0]/2,z-p.size[2]/2,x+p.size[0]/2,z+p.size[2]/2):Array.from({length:p.segments},(_,i)=>({x:x+Math.cos(i*Math.PI*2/p.segments)*p.radius,z:z+Math.sin(i*Math.PI*2/p.segments)*p.radius})),support:/^(SC1Floor|CafeFloor$|CoreAFloor$|SC2_TERRACE$|ExtStep\d+$|CoreA_1to2_step)/.test(p.name)};}
const floor1=V09_PRIMITIVES.filter(p=>/^SC1Floor/.test(p.name));
const roomCuts=floor1.map(p=>[p.position[0]-p.size[0]/2,.08,p.position[2]-p.size[2]/2,p.position[0]+p.size[0]/2,3.50,p.position[2]+p.size[2]/2]);
const coreClear=[-27.2,.08,-19.2,-20.8,7.0,.1];
const coreHole=[-27.2,3.5,-14.2,-20.8,4.2,-2];
const rearDoor=[-25.2,4.03,-18.2,-16.8,6.43,-15.8];
const door1=[-14.9,.08,10.8,-13.1,2.58,11.7];
const door2=[-.9,4.03,-.3,.9,6.53,2.4];
const parts=[];
for(const [i,p]of V09_PRIMITIVES.entries()){
 let q=[prism(p,i)];
 // Source interior slab overhung its opaque wing by up to 0.7 m. Trim only
 // that slab, preserving the approved exterior envelope and surrounding gap.
 if(p.name==='SC1FloorPublic')q=[{...q[0],polygon:rect(.8,-22.5,28.8,4.5)}];
 if(/^SC1_(PublicWing|ServiceSpine|CultureWing|RoundedCulture|BackService)$/.test(p.name))q=cuts(q,[...roomCuts,coreClear]);
 if(p.name==='SC2_MainMass')q=cuts(q,[[-23,4.03,-26.2,22.2,8.85,.5],rearDoor,door2,coreClear]);
 if(p.name==='RoundedCoreTower')q=cuts(q,[coreClear]);
 if(p.name==='SC2_TERRACE')q=cuts(q,[[-6,3.4,11.485,6,4.2,13.1]]);
 if(p.name==='CoreAFloor')q=cuts(q,[coreHole]);
 if(p.name==='CafeLeft')q=cuts(q,[rearDoor]);
 if(/^SC1EntryGlass/.test(p.name))q=cuts(q,[door1]);
 if(/^SC2EntryGlass/.test(p.name)||p.name==='HorizontalBand')q=cuts(q,[door2]);
 parts.push(...q);
}
function add(name,box,material='floor',support=true){const[x0,y0,z0,x1,y1,z1]=box;parts.push({id:name,sourceName:name,section:'connector',material,minY:y0,maxY:y1,polygon:rect(x0,z0,x1,z1),support});}
// Explicit inferred gameplay connectors; source treads and outer dimensions stay exact.
add('EntryApron',[-15.1,0,6.4,-12.9,.08,13]);
add('CafeSeamBridge',[-7.1,3.85,.49,7.1,4.03,1.01]);
// Macro Core B and the photo red slab from the prior candidate remain solid.
add('CandidateCoreB',[23,0,-13.5,30,16,-6.5],'wall',false);
add('CandidateRedCore',[27.2,3.5,-7.9,28.4,14.5,-3.7],'red',false);
// Thin guard volumes bound the new Core A hole; rear landing is left open.
add('CoreHoleGuardL',[-27.30,4.03,-14.2,-27.20,5.13,-2],'metal',false);
add('CoreHoleGuardR',[-20.80,4.03,-14.2,-20.70,5.13,-2],'metal',false);
// A radius-square can straddle two 0.25 m risers on the original 0.85 m
// interior treads. Allow a 0.55 m vertical spread under that square, but never
// an uncovered horizontal gap; center advance remains limited to 0.30 m.
const supports=parts.filter(p=>p.support).map(p=>({...bounds(p.polygon),height:p.maxY,id:p.id}));
const solids=parts.map((p,i)=>({...p,id:p.id+':'+i}));
const frame=studentConnectedFrame();
const fixed=OBSTACLES.filter(p=>p.id!=='bldg_07_0').map(p=>({...p,minY:p.minY*2,maxY:p.maxY*2,polygon:p.polygon?.map(q=>{const a=frame.toLocal([q.x,0,q.z]);return{x:a[0],z:a[2]}})}));
const pond=POND_RING.map(p=>{const a=frame.toLocal([p.x,0,p.z]);return{x:a[0],z:a[2]}});
const localShape={radius:R,footOffset:WALK_SHAPE.footOffset*2,headOffset:WALK_SHAPE.headOffset*2};
export const STUDENT_CONNECTED=freeze({status:'ISOLATED_CONNECTED_CANDIDATE',offsetWorld:[2.2,-7.15],rotationDelta:0,scale:1,interpretation:'Conceptual historical/gameplay interior, including inferred doorways and safety cutouts. Not a current surveyed plan.',prisms:solids,supports,openings:{door1,door2,rearDoor,coreHole},shape:localShape,maxStepMeters:RISE,footprintDropMeters:FOOTPRINT_DROP});
const overlaps=(a,b)=>a.x1>=b.x0-EPS&&a.x0<=b.x1+EPS&&a.z1>=b.z0-EPS&&a.z0<=b.z1+EPS;
// Exact rectangle-union coverage of a radius-square (a conservative superset of
// the actor disc). This tests whole footprints/swept strips, not radial samples.
function covered(b,rects){const relevant=rects.filter(r=>overlaps(b,r)),xs=[b.x0,b.x1,...relevant.flatMap(r=>[Math.max(b.x0,r.x0),Math.min(b.x1,r.x1)])].sort((a,b)=>a-b);for(let i=1;i<xs.length;i++){if(xs[i]-xs[i-1]<EPS)continue;const x=(xs[i]+xs[i-1])/2,spans=relevant.filter(r=>x>=r.x0-EPS&&x<=r.x1+EPS).map(r=>[Math.max(b.z0,r.z0),Math.min(b.z1,r.z1)]).sort((a,b)=>a[0]-b[0]);let z=b.z0;for(const[a,v]of spans){if(a>z+EPS)return false;z=Math.max(z,v);}if(z<b.z1-EPS)return false;}return true;}
const footprint=(x,z,r=R)=>({x0:x-r,x1:x+r,z0:z-r,z1:z+r});
const ground={x0:-60,x1:45,z0:-35,z1:45,height:0,id:'existing-flat-campus-ground'};
function support(b,previous){const touching=supports.filter(r=>overlaps(b,r)),candidate=[...touching,ground].filter(r=>r.height<=previous+RISE+EPS&&r.height>=previous-RISE-EPS).sort((a,b)=>b.height-a.height);for(const r of candidate){const h=r.height,allowed=[...touching,ground].filter(s=>s.height<=h+EPS&&s.height>=h-FOOTPRINT_DROP-EPS);if(covered(b,allowed))return {height:h,ids:allowed.map(s=>s.id)};}return null;}
const collision=[...solids.filter(p=>! /^(Wayfinding_|QA|CoreGuide_)/.test(p.sourceName)),...fixed.filter(p=>{const b=bounds(p.polygon);return b.x1>=-61&&b.x0<=46&&b.z1>=-36&&b.z0<=46;}),{id:'fixed-pond',polygon:pond,minY:-100,maxY:100}];
const pose=(x,z,h)=>({x,z,y:h+localShape.footOffset});
function clear(x,z,h){return canOccupy(pose(x,z,h),localShape,collision);}
export function createStudentConnectedWalk({space='local'}={}){
 if(!['local','world'].includes(space))throw Error('Unsupported connected coordinate space');
 const toLocal=(x,z,h)=>space==='local'?[x,z,h]:(q=>[q[0],q[2],q[1]])(frame.toLocal([x,h,z]));
 const result=(x,z,h,blocked,reason)=>{const q=space==='local'?[x,h,z]:frame.toWorld([x,h,z]);return{x:q[0],z:q[2],elevation:q[1],blocked,reason};};
 return {
  inspect(x,z,elevation){const[a,b,h]=toLocal(x,z,elevation);const s=support(footprint(a,b),h);return{supported:!!s&&Math.abs(s.height-h)<EPS,clear:clear(a,b,h),supportHeight:s?.height,headHeight:h+H};},
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
