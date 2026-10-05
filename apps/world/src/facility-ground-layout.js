import { polygonOverlap } from './polygon-collision.js';
import { aircraftTreeClear } from './landmark-detail-layout.js';

// A painted annulus has only upward-facing horizontal quads, never tube sidewalls.
export function stadiumTrack(w,d,point) {
  const alongU=w>=d, radius=Math.min(w,d)/2-.6, width=3.6;
  const ring=r=>Array.from({length:128},(_,i)=>{
    const a=i/128*Math.PI*2;
    return point(Math.cos(a)*r+(alongU?Math.sign(Math.cos(a))*(w-d)/2:0),
      Math.sin(a)*r+(!alongU?Math.sign(Math.sin(a))*(d-w)/2:0));
  });
  const strip=(inner,outer,y,color)=>{
    const a=ring(inner),b=ring(outer);
    return a.map((p,i)=>{
      const j=(i+1)%a.length;
      const vertices=[p,a[j],b[j],b[i]].map(q=>[q.x,y,q.z]);
      const [u,v,t]=vertices;
      if((v[2]-u[2])*(t[0]-u[0])-(v[0]-u[0])*(t[2]-u[2])<0)vertices.reverse();
      return {color,vertices};
    });
  };
  return [...strip(radius,radius+width,.05,'#b46e5d'),
    ...Array.from({length:6},(_,i)=>strip(radius+i*width/5-.035,radius+i*width/5+.035,.06,'#eee9d8')).flat()];
}

// Deterministic small offsets break up rows while preserving paths and the
// rotated aircraft's full silhouette plus crown radius and a one-unit gap.
export function lawnTreePositions(points,aircraftCenters) {
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
  const trees=[];
  for(let ix=0;minX+4+ix*9<maxX-3;ix++)for(let iz=0;minZ+4+iz*10<maxZ-3;iz++) {
    const x=minX+4+ix*9+Math.sin(ix*3.7+iz*2.1)*1.6,z=minZ+4+iz*10+Math.cos(ix*1.9-iz*3.3)*1.8;
    if(!polygonOverlap(x,z,points)||![-2,2].every(d=>polygonOverlap(x+d,z+d,points)))continue;
    if(aircraftCenters.some(p=>!aircraftTreeClear(p,{x,z})))continue;
    trees.push({x,z});
  }
  return trees;
}
