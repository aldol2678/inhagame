// Photographed green rectangular court and pale central cross-path; all support,
// stair openings and guard extents remain the existing gameplay contract.
import {AGORA} from './roadview-layout.js';
import {buildPolygonMeshGeometry} from './reality-adapter.js';
const p=(u,out,y)=>{const q=AGORA.frame.at(u,out);return [q.x,y,q.z];};
const box=(b,c,u,out,y,w,h,d)=>b.box(c,p(u,out,y),[w,h,d],AGORA.frame.yaw);
function patch(b,u0,u1,v0,v1,color){
 const [a,d,c,e]=AGORA.ring,at=(u,v)=>[(a.x*(1-u)+d.x*u)*(1-v)+(e.x*(1-u)+c.x*u)*v,AGORA.height+.032,(a.z*(1-u)+d.z*u)*(1-v)+(e.z*(1-u)+c.z*u)*v];
 const q=[at(u0,v0),at(u1,v0),at(u1,v1),at(u0,v1)],[x,y,z]=q;
 if((y[2]-x[2])*(z[0]-x[0])-(y[0]-x[0])*(z[2]-x[2])<0)q.reverse();
 b.quad(color,...q);
}
export function fillAgoraPhotoStructure(b){
 const {height,run,steps,stairStart:start,stairEnd:end}=AGORA;
 const mesh=buildPolygonMeshGeometry(AGORA.ring,{height:height-.02});
 for(let i=0;i<mesh.indices.length;i+=3)b.triangle('#cfcec1',...mesh.indices.slice(i,i+3).map(k=>mesh.positions.slice(k*3,k*3+3)));
 for(let i=0;i<steps;i++){
  const depth=run/steps,top=height*(1-i/steps);
  box(b,'#d5d3c7',(start+end)/2,(i+.5)*depth,top/2,end-start,top,depth);
 }
 // Two non-overlapping cross arms avoid flickering coplanar duplicate faces.
 patch(b,.41,.59,.02,.98,'#dcd9cc');
 patch(b,.02,.41,.42,.58,'#dcd9cc');patch(b,.59,.98,.42,.58,'#dcd9cc');
 // The open edge's drain is a flat surface, not a new player obstacle.
 box(b,'#727e7c',AGORA.frame.length/2,-.15,height+.026,AGORA.frame.length-.2,.018,.10);
 return b;
}
export function fillAgoraPhotoNear(b){
 const {frame,height,stairStart:start,stairEnd:end,run}=AGORA;
 for(const [a,c]of [[.15,start-.12],[end+.12,frame.length-.15]]){
  if(c<=a)continue;
  for(const y of [height+.42,height+.84])b.tube('#a1aaa5',p(a,0,y),p(c,0,y),.035,6);
  for(let u=a;u<=c;u+=1.3)b.tube('#a1aaa5',p(u,0,height),p(u,0,height+.84),.035,6);
 }
 for(const u of [start+.10,end-.10]){
  b.tube('#a1aaa5',p(u,0,height+.84),p(u,run,.84),.035,6);
  for(let i=0;i<=4;i++){const out=i*run/4,y=height*(1-i/4);b.tube('#a1aaa5',p(u,out,y),p(u,out,y+.84),.028,6);}
 }
 return b;
}
