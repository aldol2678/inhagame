// Opt-in local candidate. This module is intentionally not bound to production
// facility/collision/navigation factories while its independent envelope conflicts.
import {studentCandidateFrame} from './student-center-frame.js';
import {PHOTO_STUDENT_COLORS as C} from './student-center-palette.js';
import {V09_PRIMITIVES,V09_COLLIDERS} from './student-center-candidate-data.js';

function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const STUDENT_CANDIDATE=freeze({
 status:'ISOLATED_CANDIDATE_NOT_PRODUCTION',semanticId:'bldg_07',floors:6,
 source:'v09 numeric primitives + candidate v01 opposite core + current photo palette',
 interpretation:'Historical 1986 program and gameplay-expanded interior; current room uses unknown',
 units:'meters',metersPerWorldUnit:2,primitives:V09_PRIMITIVES,colliders:V09_COLLIDERS
});

export {studentCandidateFrame} from './student-center-frame.js';

const coarse=/^(SC1_(PublicWing|ServiceSpine|CultureWing|RoundedCulture|BackService)|SC2_TERRACE|SC2_MainMass|SC[3-6]_Shell|RoundedCoreTower|Terrace[3-5]Lip|ExtStep\d+|StairCheek[LR]|TerraceRail[LR]|PilotisColumn_)/;
const palette={concrete:C.trim,warm:C.wall,wall:C.wall,oldWall:C.wall,culture:C.wall,dark:C.recess,terrace:'#b5a487',floor:'#c7b596',shop:'#b9aa84',service:C.wall,metal:'#596065',table:'#6d5845',yellow:'#f2cb5b',glass:C.glass};
const candidateCore={name:'CandidateCoreB',shape:'box',position:[26.5,8,-10],size:[7,16,7],material:'wall',section:'exterior'};
function transformedBatch(batch,space){
 const frame=studentCandidateFrame(),world=space==='world',scale=world?.5:1,p=world?frame.toWorld:x=>x;
 return {box:(c,position,size)=>batch.box(c,p(position),size.map(x=>x*scale),world?frame.yaw:0),tube:(c,a,b,r,n)=>batch.tube(c,p(a),p(b),r*scale,n),quad:(c,...v)=>batch.quad(c,...v.map(p))};
}
function primitive(batch,p){const color=palette[p.material]||C.wall;if(p.shape==='box')batch.box(color,p.position,p.size);else {const [x,y,z]=p.position;batch.tube(color,[x,y-p.height/2,z],[x,y+p.height/2,z],p.radius,p.segments);}}
function photoCores(b){
 // Source candidate places the muted red stair end at +X. The right-handed
 // pondward frame + production Z reflection makes it screen-left exactly once.
 b.box(C.stairRed,[27.8,9,-5.8],[1.2,11,4.2]);
 for(const y of [4.5,8,11.5]){
  // Wrap the actual narrow source slab's front and +X side; broad strips
  // across the separate Core B box would float unsupported in front of it.
  const front=-3.68,back=-7.92,right=28.42,left=27.18;
  b.quad(C.trim,[left,y,front],[right,y,front],[right,y+.55,front],[left,y+.55,front]);
  b.quad(C.trim,[right,y,front],[right,y-1,back],[right,y-1+.55,back],[right,y+.55,front]);
 }
 // Rounded core uses the actual v09 radius/height. Only its observed front arc
 // receives new glazing; the rest retains estimated neutral presentation.
 // Quad chord stays beyond radius 4.6 even when the shared tube batch
 // tessellation is world-axis-aligned after the candidate frame rotates.
 const x=-30,z=-10,r=4.64;
 for(let i=0;i<16;i++){
  const a=-Math.PI/2+i*Math.PI/16,bb=a+Math.PI/16;
  const point=(ang,y)=>[x+Math.sin(ang)*r,y,z+Math.cos(ang)*r];
  for(const [lo,hi] of [[4.2,6.1],[8.4,10.3],...(i>=6&&i<=9?[[1,15.2]]:[])])
   b.quad(C.glass,point(a,lo),point(bb,lo),point(bb,hi),point(a,hi));
  for(const y of [4.2,6.1,8.4,10.3])b.quad(C.trim,point(a,y),point(bb,y),point(bb,y+.10),point(a,y+.10));
 }
}
export function fillStudentCenterCandidate(batch,tier='BASE',{space='world',view='exterior',floor=0}={}){
 if(!['BASE','NEAR','DETAIL'].includes(tier))return batch;
 if(!['world','local'].includes(space)||!['exterior','interior'].includes(view)||![0,4].includes(floor))throw new Error('Unsupported student candidate view');
 if(tier==='DETAIL')return batch;
 const b=transformedBatch(batch,space);
 if(view==='interior'){
  // Separate floor snapshots avoid rendering opaque v09 blockout mass over the
  // gameplay-expanded interior. This is an inspection view, not a new portal.
  for(const p of V09_PRIMITIVES.filter(p=>p.section===(floor===4?'interior2':'interior1'))){
   const structure=/Floor|Wall|Divider|Back$|Left$|Right$|Front|CoreBMass|step\d+/.test(p.name);
   if((tier==='BASE')===structure)primitive(b,p);
  }
  if(tier==='BASE'&&floor===4)primitive(b,V09_PRIMITIVES.find(p=>p.name==='SC2_TERRACE'));
  return batch;
 }
 for(const p of V09_PRIMITIVES.filter(p=>p.section==='exterior'))if((tier==='BASE')===coarse.test(p.name))primitive(b,p);
 if(tier==='BASE')primitive(b,candidateCore);else photoCores(b);
 return batch;
}
const exteriorStair=(x,z)=>z>=10.7&&z<=27.3&&Math.abs(x)<=6-.48;
const interiorStair=(x,z)=>x>=-26.2&&x<=-20.8&&z<=-.5&&z>=-14.6;
// Preserve original snapshot data; restrict the opt-in walk adapter to actual
// source floor slabs. A 0.26m contact tolerance bridges the prototype's 0.5m
// terrace/cafe seam, below the 0.48m actor radius. Never grant the whole bbox.
const upperSlabs=V09_PRIMITIVES.filter(p=>['SC2_TERRACE','CafeFloor','CoreAFloor'].includes(p.name));
const supported=(x,z)=>upperSlabs.some(p=>Math.abs(x-p.position[0])<=p.size[0]/2+.26&&Math.abs(z-p.position[2])<=p.size[2]/2+.26);
export function stepStudentCandidateWalk(previous,x,z){
 if(![x,z].every(Number.isFinite)||![0,4].includes(previous.level))throw new Error('Invalid student candidate walk state');
 let level=previous.level;
 const ext=exteriorStair(x,z),inside=interiorStair(x,z);
 if(ext){if(z<=11.25)level=4;else if(z>=26.75)level=0;}
 if(inside){if(z<=-13.95)level=4;else if(z>=-1.05)level=0;}
 if(level===4&&!supported(x,z)&&!ext&&!inside)return {...previous,blocked:true};
 const clamp=v=>Math.max(0,Math.min(4,v));
 const elevation=ext?clamp((27-z)/16*4):inside?clamp((-z-.5)/14.1*4):level===4&&supported(x,z)?4:0;
 const layer=ext||inside?(elevation>2?4:0):level,r=.48;
 const cheek=z>=10.5-r&&z<=27.5+r&&Math.abs(x)>=6-r&&Math.abs(x)<=7+r;
 const blocked=cheek||x<-43||x>43||z<-34||z>70||(layer===4&&z>11.55&&z<12.7&&Math.abs(x)>6&&Math.abs(x)<31)||V09_COLLIDERS.some(c=>c.level===layer&&x+r>c.r[0]&&x-r<c.r[2]&&z+r>c.r[1]&&z-r<c.r[3]);
 return blocked?{...previous,blocked:true}:{level,elevation,blocked:false};
}
