// Original v09 orientation and 2 m/WU conversion. Render parent alone reflects Z.
import {FACILITIES} from './campus-facilities.js';
export function studentCandidateFrame(f=FACILITIES.find(f=>f.id==='bldg_07')){
 if(f?.id!=='bldg_07')throw new Error('Student candidate requires bldg_07 anchor');
 const ring=f.rings[0],a=ring[2],b=ring[3],length=Math.hypot(b.x-a.x,b.z-a.z);
 const area=ring.reduce((sum,p,i)=>sum+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0);
 const nx=(area>0?b.z-a.z:a.z-b.z)/length,nz=(area>0?a.x-b.x:b.x-a.x)/length,ux=nz,uz=-nx;
 const toWorld=([x,y,z])=>[f.center.x+(ux*x+nx*z)/2,y/2,f.center.z+(uz*x+nz*z)/2];
 const toLocal=([x,y,z])=>[(x-f.center.x)*2*ux+(z-f.center.z)*2*uz,y*2,(x-f.center.x)*2*nx+(z-f.center.z)*2*nz];
 return {toWorld,toLocal,determinant:ux*nz-uz*nx,yaw:Math.atan2(nx,nz)*180/Math.PI};
}
export function studentConnectedFrame(){const f=studentCandidateFrame();return {...f,toWorld:p=>{const q=f.toWorld(p);return[q[0]+2.2,q[1],q[2]-7.15]},toLocal:p=>f.toLocal([p[0]-2.2,p[1],p[2]+7.15])};}
