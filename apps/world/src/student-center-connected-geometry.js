import {PHOTO_STUDENT_COLORS as C} from './photo-student-center.js';
import {STUDENT_CONNECTED,studentConnectedFrame} from './student-center-connected.js';
import {fillStudentCenterCandidate} from './student-center-candidate.js';
// Clip photo facades by the same bounded Core A clearance volume as their
// backing tower. This keeps visible panes from sealing the new physical void.
export function clipPhotoOpening(face){
 let inside=face;const outside=[];
 const split=(p,axis,value,sign)=>{const out=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],da=(a[axis]-value)*sign,db=(b[axis]-value)*sign;if(da>=0)out.push(a);if(da*db<0){const t=da/(da-db);out.push(a.map((v,k)=>v+(b[k]-v)*t));}}return out;};
 for(const [axis,value,sign]of [[0,-27.2,1],[0,-20.8,-1],[1,.08,1],[1,7,-1],[2,-19.2,1],[2,.1,-1]]){const p=split(inside,axis,value,-sign);if(p.length>=3)outside.push(p);inside=split(inside,axis,value,sign);if(inside.length<3)break;}
 return outside;
}
const palette={concrete:C.trim,warm:C.wall,wall:C.wall,oldWall:C.wall,culture:C.wall,dark:C.recess,terrace:'#b5a487',floor:'#c7b596',shop:'#b9aa84',service:C.wall,metal:'#596065',table:'#6d5845',yellow:'#f2cb5b',glass:C.glass,red:C.stairRed};
const detail=/Window|mullion|Rail_|ShadowLine|Wayfinding|QA|CoreGuide|Table|Bench|Counter|Shelf|Seat/;
export function fillStudentCenterConnected(batch,tier='BASE',{space='world',view='connected'}={}){
 if(!['world','local'].includes(space)||!['connected','cutaway'].includes(view))throw Error('Unsupported connected preview options');
 if(!['BASE','NEAR','DETAIL'].includes(tier)||tier==='DETAIL')return batch;
 const f=studentConnectedFrame(),point=p=>space==='local'?p:f.toWorld(p),tri=(c,...v)=>batch.triangle(c,...v.map(point)),quad=(c,...v)=>batch.quad(c,...v.map(point));
 for(const p of STUDENT_CONNECTED.prisms){
  if((tier==='NEAR')!==detail.test(p.sourceName))continue;
  if(view==='cutaway'&&p.section==='exterior'&&p.minY>7)continue;
  const c=palette[p.material]||C.wall,lower=p.polygon.map(q=>[q.x,p.minY,q.z]),upper=p.polygon.map(q=>[q.x,p.maxY,q.z]);
  for(let i=1;i<lower.length-1;i++){tri(c,lower[0],lower[i],lower[i+1]);tri(c,upper[0],upper[i+1],upper[i]);}
  for(let i=0;i<lower.length;i++){const j=(i+1)%lower.length;quad(c,lower[i],upper[i],upper[j],lower[j]);}
 }
 if(tier==='NEAR'){
  // Retain the phase-one photo-only quads; source geometry itself is emitted
  // above from the cut prisms, so uncut glass/mass is never reintroduced.
  fillStudentCenterCandidate({box(){},tube(){},quad:(c,...v)=>{for(const face of clipPhotoOpening(v))for(let i=1;i<face.length-1;i++)tri(c,face[0],face[i],face[i+1]);}},'NEAR',{space:'local'});
 }
 return batch;
}
