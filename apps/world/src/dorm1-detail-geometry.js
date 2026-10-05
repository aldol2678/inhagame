// Presentation-only entrance dressing for the already mapped bldg_dorm1 footprint.
// No source/reality polygon is changed here.

import { DORM_1_FRAME } from "./dorm1-layout.js";
import { DORM_1_FENCES } from './gate-dorm-exterior-layout.js';

const glass = "#496f7a";
const trim = "#e8e3d8";
const canopy = "#827b70";
const sign = "#b8a783";

export function buildDorm1EntranceDetail(batch, tier = "NEAR") {
  if (!batch || (tier !== "NEAR" && tier !== "DETAIL")) return false;
  const f = DORM_1_FRAME;
  const p = (u, y, v) => {
    const q = f.at(u, v);
    return [q.x, y, q.z];
  };

  if (tier === "NEAR") {
    // A compact game-readable entrance. Dimensions are visual estimates pending field/photo
    // revalidation; the authoritative footprint remains untouched.
    batch.box(glass, p(0, 1.35, 0.12), [3.4, 2.45, 0.16], f.yaw);
    batch.box(trim, p(-1.82, 1.4, 0.14), [0.22, 2.8, 0.22], f.yaw);
    batch.box(trim, p(1.82, 1.4, 0.14), [0.22, 2.8, 0.22], f.yaw);
    batch.box(canopy, p(0, 2.82, 0.72), [5.0, 0.22, 1.8], f.yaw);
    batch.box(sign, p(0, 2.95, 1.55), [4.8, 0.56, 0.16], f.yaw);
    // Street-facing apron is flat so the existing indoor/outdoor handoff stays step-free.
    batch.box('#bcb6a7',p(0,.052,2.7),[5.4,.055,5.3],f.yaw);
    for(const side of [-1,1]) {
      // Tall glazed stair bays and pale top shades observed from Sosung-ro.
      batch.box('#b4d0cb',p(side*3.75,5.7,.35),[1.45,10.2,.22],f.yaw);
      batch.box('#727e7c',p(side*3.75,11.05,.42),[2.1,.16,1.1],f.yaw);
      for(const u of [side*3.75-.75,side*3.75+.75])
        batch.box(trim,p(u,5.7,.43),[.13,10.4,.22],f.yaw);
      for(let u=3;u<5.5;u+=.6)batch.crown('#58784a',p(side*u,.48,3.8),[.8,.7,.65]);
    }
    for(const fence of DORM_1_FENCES) {
      const center=(fence.start+fence.end)/2,width=Math.abs(fence.end-fence.start);
      batch.box('#a7a998',p(center,.1,fence.v),[width,.2,.18],f.yaw);
      for(const y of [.38,1.05])batch.box('#426e61',p(center,y,fence.v),[width,.07,.1],f.yaw);
      for(let u=Math.min(fence.start,fence.end);u<=Math.max(fence.start,fence.end);u+=.22)
        batch.box('#426e61',p(u,.65,fence.v),[.035,1,.05],f.yaw);
    }
    return true;
  }

  // DETAIL adds a centre mullion and threshold without duplicating the generic facade windows.
  batch.box(trim, p(0, 1.35, 0.24), [0.12, 2.45, 0.12], f.yaw);
  batch.box(trim, p(0, 0.12, 0.42), [3.7, 0.16, 0.75], f.yaw);
  for(const side of [-1,1]) {
    for(let y=1.1;y<10.8;y+=1.05)batch.box('#607d78',p(side*3.75,y,.49),[1.45,.055,.055],f.yaw);
    batch.box('#607d78',p(side*3.75,5.7,.49),[.045,10.2,.06],f.yaw);
    batch.box('#d4d1c3',p(side*2.95,.55,4.8),[.28,1.1,.18],f.yaw);
  }
  for(let v=1;v<5.1;v+=.6)batch.box('#aaa797',p(0,.085,v),[5.2,.01,.018],f.yaw);
  for(const u of [-.3,.3])batch.box('#dce0d4',p(u,1.2,.27),[.035,.35,.08],f.yaw);
  return true;
}

// Separate punched windows and muted pink infill replace generic continuous ribbons.
export function fillDorm1Facade(batch,facility) {
  for(const ring of facility.rings) {
    const area=ring.reduce((sum,a,i)=>sum+a.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*a.z,0);
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      if(len<1.2)continue;
      const nx=(area>0?dz:-dz)/len,nz=(area>0?-dx:dx)/len,yaw=-Math.atan2(dz,dx)*180/Math.PI;
      const point=(u,y,out=.12)=>[a.x+dx*u+nx*out,y,a.z+dz*u+nz*out];
      const bays=Math.max(1,Math.floor(len/1.9)),width=len/bays;
      for(let k=0;k<bays;k++) {
        const u=(k+.5)/bays;
        if(k%3!==0)batch.box('#bd9e95',point(u,5.9,.035),[width-.12,10.7,.045],yaw);
        for(let floor=0;floor<5;floor++) {
          const y=1.35+floor*2.15,w=Math.min(1.05,width*.62);
          batch.box('#efeee6',point(u,y,.09),[w+.16,1.18,.1],yaw);
          batch.box(glass,point(u,y,.16),[w,1.02,.06],yaw);
          batch.box('#a5b6b0',point(u,y,.2),[.035,1.02,.035],yaw);
        }
      }
    }
  }
}

